const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const { createRAGChain } = require('./rag-chatbot'); // Assuming rag-chatbot.js is in the same directory

const app = express();
const port = 3000;

// --- Setup Multer for File Uploads ---
const docsDir = path.join(__dirname, 'docs');
if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, docsDir);
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    }
});
const upload = multer({ storage });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let ragChain;

// --- API Endpoints ---

// Endpoint for file upload
app.post('/api/upload', upload.single('document'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded.' });
    }

    try {
        console.log(`File uploaded: ${req.file.originalname}. Re-initializing RAG chain...`);
        // Re-initialize the chain to include the new document
        await initialize(); 
        res.json({ message: `File "${req.file.originalname}" uploaded successfully.` });
    } catch (error) {
        console.error('Error during file upload processing:', error);
        res.status(500).json({ error: 'Failed to process and index the file.' });
    }
});

// Endpoint to handle chat questions
app.post('/api/ask', async (req, res) => {
    const { question } = req.body;

    if (!question) {
        return res.status(400).json({ error: 'Question is required' });
    }

    try {
        if (!ragChain) {
            return res.status(503).json({ error: 'RAG chain is not initialized yet. Please wait a moment and try again.' });
        }
        
        const response = await ragChain.call({ query: question });
        res.json(response);

    } catch (error) {
        console.error('Error processing question:', error);
        res.status(500).json({ error: 'Failed to get an answer from the chatbot.' });
    }
});

// Initialize the RAG chain when the server starts
async function initialize() {
    console.log('Initializing RAG chain...');
    try {
        ragChain = await createRAGChain();
        console.log('✅ RAG chain initialized successfully.');
    } catch (error) {
        console.error('🔴 Failed to initialize RAG chain:', error);
        ragChain = null; // Ensure chain is null on failure
    }
}

app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
    initialize();
}); 