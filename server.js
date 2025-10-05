require('dotenv').config();
const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const { createRAGChain } = require('./rag-chatbot');
const cheerio = require('cheerio');
const fetch = global.fetch || ((...args) => import('node-fetch').then(({default: f}) => f(...args)));

const app = express();
const port = process.env.PORT || 3000;
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_FILES_PER_USER = 5;

// --- Setup Multer for File Uploads ---
const docsRoot = process.env.DOCS_PATH || path.join(__dirname, 'docs');
if (!fs.existsSync(docsRoot)) {
    fs.mkdirSync(docsRoot, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const userId = (req.body && req.body.userId) || 'anonymous';
        const userDir = path.join(docsRoot, userId);
        if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
        cb(null, userDir);
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    }
});
const upload = multer({ storage, limits: { fileSize: MAX_FILE_SIZE_BYTES } });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Handle Multer file-size limit errors globally
app.use((err, req, res, next) => {
    if (err && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: `File too large. Max size is ${Math.floor(MAX_FILE_SIZE_BYTES / (1024*1024))}MB.` });
    }
    return next(err);
});

let ragChains = {}; // userId -> chain
const crawlerStatePath = path.join(__dirname, 'crawler.json');
let crawledUrls = [];

// --- API Endpoints ---

// Endpoint for file upload
app.post('/api/upload', upload.single('document'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded.' });
    }

    try {
        const userId = req.body.userId || 'anonymous';
        const userDir = path.join(docsRoot, userId);

        // Enforce per-user file count limit
        const currentFiles = fs.existsSync(userDir) ? fs.readdirSync(userDir).filter(f => fs.statSync(path.join(userDir, f)).isFile()).length : 0;
        if (currentFiles >= MAX_FILES_PER_USER) {
            try { fs.unlinkSync(req.file.path); } catch(e) {}
            return res.status(400).json({ error: `You can only upload up to ${MAX_FILES_PER_USER} files.` });
        }

        // Double-check size
        if (req.file.size > MAX_FILE_SIZE_BYTES) {
            try { fs.unlinkSync(req.file.path); } catch(e) {}
            return res.status(413).json({ error: `File too large. Max size is ${Math.floor(MAX_FILE_SIZE_BYTES / (1024*1024))}MB.` });
        }

        console.log(`File uploaded: ${req.file.originalname} for user ${userId}. Re-initializing RAG chain...`);
        // Re-initialize this user's chain to include the new document
        ragChains[userId] = await createRAGChain(userDir);
        res.json({ message: `File "${req.file.originalname}" uploaded successfully.` });
    } catch (error) {
        console.error('Error during file upload processing:', error);
        
        // Handle rate limit errors specifically
        if (error.message && error.message.includes('Rate limit exceeded')) {
            return res.status(429).json({ 
                error: 'Rate limit exceeded. Please wait a few minutes before uploading more documents.',
                retryAfter: 300 // 5 minutes
            });
        }
        
        res.status(500).json({ error: 'Failed to process and index the file.' });
    }
});

// Endpoint to handle chat questions
app.post('/api/ask', async (req, res) => {
    const { question, userId } = req.body;

    if (!question) {
        return res.status(400).json({ error: 'Question is required' });
    }

    try {
        const id = userId || 'anonymous';
        if (!ragChains[id]) {
            const userDir = path.join(docsRoot, id);
            ragChains[id] = await createRAGChain(userDir);
        }
        const response = await ragChains[id].call({ query: question });
        res.json(response);

    } catch (error) {
        console.error('Error processing question:', error);
        
        // Handle rate limit errors specifically
        if (error.status === 429 || (error.message && error.message.includes('Rate limit'))) {
            return res.status(429).json({ 
                error: 'Rate limit exceeded. Please wait a few minutes before asking more questions.',
                retryAfter: 300 // 5 minutes
            });
        }
        
        res.status(500).json({ error: 'Failed to get an answer from the chatbot.' });
    }
});

// Add a URL to crawl immediately and schedule for future recrawls
app.post('/api/crawl', async (req, res) => {
    try {
        const { url, schedule } = req.body || {};
        if (!url || typeof url !== 'string') {
            return res.status(400).json({ error: 'url is required' });
        }
        const result = await crawlAndIndexUrl(url);
        if (schedule === 'daily' && !crawledUrls.includes(url)) {
            crawledUrls.push(url);
            await saveCrawlerState();
        }
        if (!result.ok) return res.status(500).json({ error: result.reason || 'crawl failed' });
        return res.json({ message: 'Crawled and indexed', file: result.file, scheduled: schedule === 'daily' });
    } catch (e) {
        console.error('POST /api/crawl error:', e);
        return res.status(500).json({ error: 'Failed to crawl' });
    }
});

// List scheduled URLs
app.get('/api/crawl/urls', (req, res) => {
    res.json({ urls: crawledUrls });
});

// Endpoint to list uploaded files
app.get('/api/files', (req, res) => {
    try {
        const userId = req.query.userId || 'anonymous';
        const userDir = path.join(docsRoot, userId);
        if (!fs.existsSync(userDir)) {
            return res.json({ files: [] });
        }
        const files = fs.readdirSync(userDir).map(file => {
            const filePath = path.join(userDir, file);
            const stats = fs.statSync(filePath);
            return {
                name: file,
                size: stats.size,
                uploadDate: stats.birthtime,
                type: path.extname(file).slice(1) || 'unknown'
            };
        });
        
        res.json({ files });
    } catch (error) {
        console.error('Error listing files:', error);
        res.status(500).json({ error: 'Failed to list files.' });
    }
});

// Endpoint to delete a file
app.delete('/api/files/:filename', async (req, res) => {
    const { filename } = req.params;
    const userId = req.query.userId || 'anonymous';
    try {
        const userDir = path.join(docsRoot, userId);
        const filePath = path.join(userDir, filename);
        
        // Check if file exists
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found.' });
        }
        
        // Delete the file
        fs.unlinkSync(filePath);
        
        console.log(`File deleted: ${filename} for user ${userId}. Re-initializing RAG chain...`);
        // Re-initialize this user's chain to reflect the deletion
        ragChains[userId] = await createRAGChain(userDir);
        
        res.json({ message: `File "${filename}" deleted successfully.` });
    } catch (error) {
        console.error('Error deleting file:', error);
        res.status(500).json({ error: 'Failed to delete the file.' });
    }
});

// Initialize the RAG chain when the server starts
async function initialize() {
    console.log('Initializing RAG chain...');
    try {
        // Do nothing at global level; user chains build on demand
        ragChains = {};
        console.log('✅ RAG chain initialized successfully.');
    } catch (error) {
        console.error('🔴 Failed to initialize RAG chain:', error);
        ragChains = {};
    }
}

// --- Utilities for crawler ---
function sanitizeFilename(input) {
    return input.replace(/[^a-z0-9]+/gi, '_').toLowerCase().slice(0, 80);
}

async function saveCrawlerState() {
    try {
        fs.writeFileSync(crawlerStatePath, JSON.stringify({ urls: crawledUrls }, null, 2));
    } catch (e) {
        console.warn('Failed to save crawler state:', e.message);
    }
}

function loadCrawlerState() {
    try {
        if (fs.existsSync(crawlerStatePath)) {
            const raw = fs.readFileSync(crawlerStatePath, 'utf-8');
            const parsed = JSON.parse(raw);
            crawledUrls = Array.isArray(parsed.urls) ? parsed.urls : [];
        }
    } catch (e) {
        console.warn('Failed to load crawler state:', e.message);
        crawledUrls = [];
    }
}

async function crawlAndIndexUrl(url) {
    try {
        const res = await fetch(url);
        const html = await res.text();
        const $ = cheerio.load(html);
        $('script, style, noscript').remove();
        const text = $('body').text().replace(/\s+/g, ' ').trim();
        if (!text) return { ok: false, reason: 'Empty content' };
        const fname = sanitizeFilename(url) + '.txt';
        const dest = path.join(docsDir, fname);
        fs.writeFileSync(dest, `Source: ${url}\n\n${text}`);
        console.log(`Crawled and saved: ${url} -> ${dest}`);
        await initialize();
        return { ok: true, file: fname };
    } catch (e) {
        console.error('Crawler error for', url, e);
        return { ok: false, reason: e.message };
    }
}

// Load saved URLs at boot
loadCrawlerState();

// Simple daily scheduler (~24h)
const DAY_MS = 24 * 60 * 60 * 1000;
setInterval(async () => {
    if (!crawledUrls.length) return;
    console.log('Scheduled recrawl starting...');
    for (const url of crawledUrls) {
        await crawlAndIndexUrl(url);
    }
    console.log('Scheduled recrawl complete.');
}, DAY_MS);

const server = app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
    initialize();
});

server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
        console.error(`Port ${port} is already in use. You can:
 - stop the other process using it
 - or start this server on another port, e.g. PORT=3001 npm start`);
    } else {
        console.error('Server error:', err);
    }
    process.exit(1);
});