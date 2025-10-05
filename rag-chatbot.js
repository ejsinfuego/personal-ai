require('dotenv').config();
const { ChatOpenAI, OpenAIEmbeddings } = require("@langchain/openai");
const { RecursiveCharacterTextSplitter } = require("langchain/text_splitter");
const { MemoryVectorStore } = require("langchain/vectorstores/memory");
const { RetrievalQAChain } = require("langchain/chains");
const { PromptTemplate } = require("@langchain/core/prompts");
const fs = require("fs");
const path = require("path");
const pdf = require("pdf-parse");
let xlsx;
try { xlsx = require('xlsx'); } catch (_) { xlsx = null; }

// --- 1. Initialize Models ---
// Chat via Groq (OpenAI-compatible API)
const model = new ChatOpenAI({
    apiKey: process.env.GROQ_API_KEY,
    modelName: "llama-3.1-8b-instant",
    temperature: 0.7,
    maxTokens: 2048,
    configuration: {
      baseURL: "https://api.groq.com/openai/v1",
    }
  });

// Embeddings via OpenRouter (OpenAI-compatible embeddings)
const remoteEmbeddings = new OpenAIEmbeddings({
  apiKey: process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY,
  modelName: "text-embedding-3-small",
  configuration: {
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": process.env.APP_PUBLIC_URL || "http://localhost:3000",
      "X-Title": "RAG Chatbot",
    },
  },
});

// --- Local fallback embeddings (simple hashing) ---
class LocalHashEmbeddings {
  constructor(options = {}) {
    this.dim = options.dim || 384;
  }
  async embedDocuments(texts) {
    return texts.map((t) => this.#hashToVector(t));
  }
  async embedQuery(text) {
    return this.#hashToVector(text);
  }
  #hashToVector(text) {
    const v = new Array(this.dim).fill(0);
    if (!text) return v;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      const idx = code % this.dim;
      v[idx] += 1;
    }
    // L2 normalize
    let norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    for (let i = 0; i < v.length; i++) v[i] = v[i] / norm;
    return v;
  }
}

// --- 2. Define RAG Prompt ---
const ragPrompt = PromptTemplate.fromTemplate(`
You are a helpful AI assistant that answers questions based on the provided context.

Context: {context}

Question: {question}

Answer the question based on the context above. If the context doesn't contain enough information to answer the question, say so. Always cite specific parts of the context when possible.

Answer: `);

// --- 3. Document Loading and Splitting ---
async function loadProjectDocs(docsPath) {
  const documents = [];
  
  if (!fs.existsSync(docsPath)) {
    console.log(`Creating docs directory: ${docsPath}`);
    fs.mkdirSync(docsPath, { recursive: true });
    return documents;
  }
  
  const files = fs.readdirSync(docsPath);
  
  for (const file of files) {
    const filePath = path.join(docsPath, file);
    const fileExt = path.extname(file).slice(1);

    if (['md', 'txt', 'js', 'csv', 'json'].includes(fileExt)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      let pageContent = content;
      // Light normalization for CSV/JSON to improve embedding quality
      if (fileExt === 'csv') {
        // Replace commas with tabs and collapse multiple spaces
        pageContent = content
          .split('\n')
          .map((line) => line.replace(/,/g, '\t'))
          .join('\n');
      } else if (fileExt === 'json') {
        try {
          const parsed = JSON.parse(content);
          // Pretty-print flattened-ish JSON for readability
          pageContent = JSON.stringify(parsed, null, 2);
        } catch (_) {
          // keep original if invalid JSON
        }
      }
      documents.push({
        pageContent,
        metadata: { 
          source: file,
          type: fileExt
        }
      });
    } else if (fileExt === 'pdf') {
      try {
        const dataBuffer = fs.readFileSync(filePath);
        const data = await pdf(dataBuffer);
        documents.push({
          pageContent: data.text,
          metadata: {
            source: file,
            type: 'pdf',
            totalPages: data.numpages,
          }
        });
      } catch (error) {
        console.error(`Error parsing PDF file ${file}:`, error);
      }
    } else if (fileExt === 'xlsx') {
      try {
        if (!xlsx) {
          console.warn('XLSX parsing requires the "xlsx" package. Run: npm install xlsx');
        } else {
          const wb = xlsx.readFile(filePath);
          const sheetNames = wb.SheetNames || [];
          let combined = '';
          for (const name of sheetNames) {
            const ws = wb.Sheets[name];
            if (!ws) continue;
            // Convert each sheet to CSV-like text
            const csv = xlsx.utils.sheet_to_csv(ws);
            combined += `Sheet: ${name}\n${csv}\n\n`;
          }
          documents.push({
            pageContent: combined || fs.readFileSync(filePath, 'utf-8'),
            metadata: {
              source: file,
              type: 'xlsx',
              sheets: (wb.SheetNames || []).length
            }
          });
        }
      } catch (error) {
        console.error(`Error parsing XLSX file ${file}:`, error);
      }
    }
  }
  
  return documents;
}

const textSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1000,
  chunkOverlap: 200,
});

// --- 4. Helper function to add delays ---
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- 5. Create RAG Chain with error handling ---
let hasLoggedEmbeddingError = false; // avoid noisy logs once fallback kicks in
async function createRAGChain(docsPathArg) {
    console.log("Loading documents...");
    const docsPathToUse = docsPathArg || './docs';
    const docs = await loadProjectDocs(docsPathToUse);
    
    if (docs.length === 0) {
      console.log("No documents found. The chatbot will rely on its general knowledge.");
      // Return a simple chain that doesn't do retrieval
      return {
        call: async ({ query }) => {
          return {
            text: "I don't have any documents to reference. Please upload some documents first to build a knowledge base.",
            sourceDocuments: []
          };
        }
      };
    }
    
    console.log("Splitting documents...");
    const allSplits = await textSplitter.splitDocuments(docs);
    
    const totalDocuments = allSplits.length;
    const third = Math.floor(totalDocuments / 3);
    
    allSplits.forEach((document, i) => {
      if (i < third) {
        document.metadata.section = "beginning";
      } else if (i < 2 * third) {
        document.metadata.section = "middle";
      } else {
        document.metadata.section = "end";
      }
    });
    
    console.log("Creating vector store...");
    
    let vectorStore;
    let embeddingsClient = remoteEmbeddings;
    try {
      // Test if Embeddings API is available
      console.log("Testing embeddings API connection (OpenRouter)...");
      await embeddingsClient.embedQuery("test");
      console.log("✅ Embeddings API connection successful");
      
      // Create vector store
      vectorStore = await MemoryVectorStore.fromDocuments(
        allSplits,
        embeddingsClient 
      );
      
    } catch (error) {
      if (!hasLoggedEmbeddingError) {
        console.warn(
          "Embeddings API unavailable; using local fallback:",
          error && error.message ? error.message : String(error)
        );
        hasLoggedEmbeddingError = true;
      }
      try {
        embeddingsClient = new LocalHashEmbeddings();
        vectorStore = await MemoryVectorStore.fromDocuments(
          allSplits,
          embeddingsClient
        );
        console.log("✅ Local embeddings ready");
      } catch (fallbackErr) {
        console.warn(
          "Local embeddings fallback failed; using chat-only mode:",
          fallbackErr && fallbackErr.message ? fallbackErr.message : String(fallbackErr)
        );
        return {
          call: async ({ query }) => {
            try {
              const response = await model.invoke(query);
              return {
                text: response.content || "I'm having trouble connecting to the AI service. Please try again later.",
                sourceDocuments: []
              };
            } catch (error) {
              return {
                text: "I'm having trouble connecting to the AI service. Please check your internet connection and try again.",
                sourceDocuments: []
              };
            }
          }
        };
      }
    }
    
    console.log("Creating retrieval chain...");
    const chain = RetrievalQAChain.fromLLM(
      model,
      vectorStore.asRetriever({ k: 4 }),
      {
        returnSourceDocuments: true,
        prompt: ragPrompt,
      }
    );
    
    return chain;
}

module.exports = { createRAGChain };
