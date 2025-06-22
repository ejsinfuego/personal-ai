const { ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings } = require("@langchain/google-genai");
const { RecursiveCharacterTextSplitter } = require("langchain/text_splitter");
const { MemoryVectorStore } = require("langchain/vectorstores/memory");
const { RetrievalQAChain } = require("langchain/chains");
const { PromptTemplate } = require("@langchain/core/prompts");
const fs = require("fs");
const path = require("path");
const pdf = require("pdf-parse");

// --- Pre-run check for API key ---
if (!process.env.GOOGLE_API_KEY) {
  console.error("🔴 Error: GOOGLE_API_KEY environment variable is not set.");
  console.log("Please get your API key from Google AI Studio and set it:");
  console.log("export GOOGLE_API_KEY='your-api-key'");
  process.exit(1);
}

// --- 1. Initialize Models ---
const model = new ChatGoogleGenerativeAI({
    model: "gemma-3-12b-it",
    temperature: 0.7,
    maxOutputTokens: 2048,
  });

const embeddings = new GoogleGenerativeAIEmbeddings({
  modelName: "embedding-001",
});

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

    if (['md', 'txt', 'js'].includes(fileExt)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      documents.push({
        pageContent: content,
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
    }
  }
  
  return documents;
}

const textSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1000,
  chunkOverlap: 200,
});

// --- 4. Create RAG Chain ---
async function createRAGChain() {
    console.log("Loading documents...");
    const docs = await loadProjectDocs('./docs');
    
    if (docs.length === 0) {
      console.log("No documents found. The chatbot will rely on its general knowledge.");
      // You might want to handle this case differently, maybe by returning a chain that doesn't do retrieval.
      // For now, we'll proceed, but retrieval will be empty.
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
    const vectorStore = await MemoryVectorStore.fromDocuments(
      allSplits,
      embeddings 
    );
    
    console.log("Creating retrieval chain...");
    const chain = RetrievalQAChain.fromLLM(
      model,
      vectorStore.asRetriever({ k: 4 }),
      {
        returnSourceDocuments: true,
        // verbose: true, // Can be noisy, enable for debugging
        prompt: ragPrompt,
      }
    );
    
    return chain;
}

module.exports = { createRAGChain };
