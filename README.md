# RAG Chatbot with Free Online API

A knowledge-based chatbot using LangChain, Hugging Face Inference API (free online API), and RAG (Retrieval-Augmented Generation) with a modern ChatGPT-like interface.

## Features

- **Side-by-Side Layout**: File management on the left, chat on the right
- **File Upload & Management**: Upload PDF, TXT, MD, and JS files
- **File Deletion**: Remove files from your knowledge base
- **RAG Integration**: Ask questions about your uploaded documents
- **Free Online API**: Uses Hugging Face Inference API - no local installation required
- **Modern UI**: Clean, responsive design

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Start the Server

```bash
npm start
```

The server will start at `http://localhost:3000`

**That's it!** No need to install Ollama or download large models. The chatbot uses Hugging Face's free inference API.

## Usage

1. **Upload Documents**: Use the left sidebar to upload PDF, TXT, MD, or JS files
2. **Ask Questions**: Use the chat interface to ask questions about your documents
3. **Manage Files**: View, delete, and manage your uploaded files
4. **Get Answers**: The chatbot will provide answers based on your uploaded documents

## Available Models

- **Chat Model**: `microsoft/DialoGPT-medium` (Conversational AI model)
- **Embedding Model**: `sentence-transformers/all-MiniLM-L6-v2` (for document similarity search)

## Troubleshooting

### API Connection Issues

If you see connection errors:

1. Check your internet connection
2. The free API may have rate limits - wait a moment and try again
3. If issues persist, the service might be temporarily unavailable

### Port Conflicts

If port 3000 is in use, you can change it in `server.js`:
```javascript
const port = 3001; // Change to your preferred port
```

## File Management

- **Supported Formats**: PDF, TXT, MD, JS
- **File Size**: No specific limits (limited by available memory)
- **Storage**: Files are stored in the `./docs` directory
- **Deletion**: Files can be deleted through the web interface

## API Endpoints

- `POST /api/upload` - Upload a document
- `POST /api/ask` - Ask a question
- `GET /api/files` - List uploaded files
- `DELETE /api/files/:filename` - Delete a file

## Technology Stack

- **Backend**: Node.js, Express
- **AI**: LangChain, Hugging Face Inference API (free online API)
- **Frontend**: HTML, CSS, JavaScript
- **File Processing**: PDF-parse, Multer

## License

MIT License