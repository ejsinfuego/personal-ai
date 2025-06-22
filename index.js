const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { RecursiveCharacterTextSplitter } = require("langchain/text_splitter");
const { MemoryVectorStore } = require("langchain/vectorstores/memory");
const { RetrievalQAChain } = require("langchain/chains");
const fs = require("fs");
const path = require("path");

// Initialize Gemma model
const model = new ChatGoogleGenerativeAI({
  maxOutputTokens: 2048,
  temperature: 0.7,
  model: "gemma-3-12b-it",
});

// Function to load documentation
async function loadDocumentation(docsPath) {
  const documents = [];
  
  // Read all files in the documentation directory
  const files = fs.readdirSync(docsPath);
  
  for (const file of files) {
    if (file.endsWith('.md') || file.endsWith('.txt')) {
      const content = fs.readFileSync(path.join(docsPath, file), 'utf-8');
      documents.push({
        pageContent: content,
        metadata: { source: file }
      });
    }
  }
  
  return documents;
}

// Function to create vector store
async function createVectorStore(documents) {
  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
  });
  
  const docs = await textSplitter.splitDocuments(documents);
  const vectorStore = await MemoryVectorStore.fromDocuments(docs);
  
  return vectorStore;
}

// Main chatbot function
async function createChatbot() {
  try {
    // Load your documentation (adjust path as needed)
    const docs = await loadDocumentation('./docs');
    console.log(docs); 
    // Create vector store
    const vectorStore = await createVectorStore(docs);
    // Create retrieval chain
    const chain = RetrievalQAChain.fromLLM(
      model,
      vectorStore.asRetriever(),
      {
        returnSourceDocuments: true,
        verbose: true,
      }
    );
    
    return chain;
  } catch (error) {
    console.error("Error creating chatbot:", error);
    throw error;
  }
}

// Example usage
async function askQuestion(question) {
  const chatbot = await createChatbot();
  
  const response = await chatbot.call({
    query: question,
  });
  
  console.log("Answer:", response.text);
  console.log("Sources:", response.sourceDocuments.map(doc => doc.metadata.source));
}

// Test the chatbot
askQuestion("What is the main purpose of this project?"); 