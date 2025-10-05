document.addEventListener('DOMContentLoaded', () => {
    const questionInput = document.getElementById('question-input');
    const askButton = document.getElementById('ask-button');
    const chatHistory = document.getElementById('chat-history');
    const loadingIndicator = document.getElementById('loading-indicator');
    const fileUpload = document.getElementById('file-upload');
    const uploadButton = document.getElementById('upload-button');
    const uploadStatus = document.getElementById('upload-status');
    const urlInput = document.getElementById('url-input');
    const crawlButton = document.getElementById('crawl-button');
    const crawlStatus = document.getElementById('crawl-status');
    const crawlUrls = document.getElementById('crawl-urls');
    const fileList = document.getElementById('file-list');

    fileUpload.addEventListener('change', () => {
        const fileName = fileUpload.files[0] ? fileUpload.files[0].name : 'Select File';
        const labelSpan = document.querySelector('.file-upload-label span');
        if (labelSpan) {
            labelSpan.textContent = fileName;
        }
    });

    const addMessage = (sender, message, sources = []) => {
        const messageElement = document.createElement('div');
        messageElement.classList.add('message', `${sender}-message`);

        const messageParagraph = document.createElement('p');
        messageParagraph.innerHTML = message; // Use innerHTML to render line breaks
        messageElement.appendChild(messageParagraph);

        // Normalize sources: accept undefined/null, array of docs with different shapes
        const normalizedSources = Array.isArray(sources)
            ? sources
                .filter((s) => s && (s.source || (s.metadata && (s.metadata.source || s.metadata.path))))
                .map((s) => {
                    const name = s.source || (s.metadata && (s.metadata.source || s.metadata.path)) || 'Unknown source';
                    const section = s.section || (s.metadata && s.metadata.section);
                    return { name, section };
                })
            : [];

        if (normalizedSources.length > 0 && sender === 'bot') {
            const sourcesDiv = document.createElement('div');
            sourcesDiv.classList.add('sources');
            sourcesDiv.innerHTML = '<strong>Sources:</strong>';
            const sourcesList = document.createElement('ul');
            normalizedSources.forEach(source => {
                const sourceItem = document.createElement('li');
                sourceItem.textContent = source.section
                    ? `${source.name} (${source.section})`
                    : `${source.name}`;
                sourcesList.appendChild(sourceItem);
            });
            sourcesDiv.appendChild(sourcesList);
            messageElement.appendChild(sourcesDiv);
        }
        
        chatHistory.appendChild(messageElement);
        chatHistory.scrollTop = chatHistory.scrollHeight; // Auto-scroll to the latest message
    };

    const formatFileSize = (bytes) => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const formatDate = (dateString) => {
        const date = new Date(dateString);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    };

    const loadFileList = async () => {
        try {
            const params = new URLSearchParams({ userId: getUserId() });
            const response = await fetch(`/api/files?${params.toString()}`);
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Failed to load files');
            }
            
            displayFileList(data.files);
        } catch (error) {
            console.error('Error loading file list:', error);
            fileList.innerHTML = '<div class="error">Failed to load files</div>';
        }
    };

    const displayFileList = (files) => {
        if (files.length === 0) {
            fileList.innerHTML = '<div class="no-files">No files uploaded yet</div>';
            return;
        }
        
        fileList.innerHTML = files.map(file => `
            <div class="file-item">
                <div class="file-info">
                    <div class="file-name">${file.name}</div>
                    <div class="file-details">
                        <span class="file-type">${file.type.toUpperCase()}</span>
                        <span class="file-size">${formatFileSize(file.size)}</span>
                        <span class="file-date">${formatDate(file.uploadDate)}</span>
                    </div>
                </div>
                <button class="delete-button" onclick="deleteFile('${file.name}')" title="Delete file">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="m19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        <line x1="10" y1="11" x2="10" y2="17"></line>
                        <line x1="14" y1="11" x2="14" y2="17"></line>
                    </svg>
                </button>
            </div>
        `).join('');
    };

    const deleteFile = async (filename) => {
        if (!confirm(`Are you sure you want to delete "${filename}"?`)) {
            return;
        }
        
        try {
            const params = new URLSearchParams({ userId: getUserId() });
            const response = await fetch(`/api/files/${encodeURIComponent(filename)}?${params.toString()}`, {
                method: 'DELETE'
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Failed to delete file');
            }
            
            addMessage('bot', `🗑️ Successfully deleted "${filename}". The knowledge base has been updated.`);
            loadFileList(); // Refresh the file list
        } catch (error) {
            console.error('Error deleting file:', error);
            addMessage('bot', `🔴 Error deleting file: ${error.message}`);
        }
    };

    // Make deleteFile globally available
    window.deleteFile = deleteFile;

    // Ensure a stable userId in localStorage
    const getUserId = () => {
        const key = 'rag_user_id';
        let id = localStorage.getItem(key);
        if (!id) {
            id = crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2));
            localStorage.setItem(key, id);
        }
        return id;
    };

    const handleUpload = async () => {
        const file = fileUpload.files[0];
        if (!file) {
            uploadStatus.textContent = 'Please select a file first.';
            uploadStatus.style.color = 'red';
            return;
        }

        const formData = new FormData();
        formData.append('userId', getUserId());
        formData.append('document', file);

        uploadStatus.textContent = 'Uploading & indexing...';
        uploadStatus.style.color = '#333';
        uploadButton.disabled = true;

        try {
            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData,
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || 'Upload failed');
            }
            
            uploadStatus.textContent = result.message;
            uploadStatus.style.color = 'green';
            addMessage('bot', `✅ Successfully indexed "${file.name}". The knowledge base is updated.`);
            loadFileList(); // Refresh the file list

        } catch (error) {
            if (error.message.includes('Rate limit exceeded')) {
                uploadStatus.textContent = 'Rate limit exceeded. Please wait a few minutes before uploading more files.';
                uploadStatus.style.color = 'orange';
                addMessage('bot', '⚠️ Rate limit exceeded. Please wait a few minutes before uploading more documents.');
            } else {
                uploadStatus.textContent = `Error: ${error.message}`;
                uploadStatus.style.color = 'red';
            }
        } finally {
            uploadButton.disabled = false;
            fileUpload.value = ''; // Reset file input
        }
    };

    const loadScheduledUrls = async () => {
        try {
            const res = await fetch('/api/crawl/urls');
            const data = await res.json();
            const urls = Array.isArray(data.urls) ? data.urls : [];
            crawlUrls.innerHTML = urls.map(u => `<li>${u}</li>`).join('');
        } catch (e) {
            crawlUrls.innerHTML = '';
        }
    };

    const handleCrawl = async () => {
        const url = (urlInput?.value || '').trim();
        if (!url) {
            crawlStatus.textContent = 'Please enter a valid URL.';
            crawlStatus.style.color = 'orange';
            return;
        }
        crawlButton.disabled = true;
        crawlStatus.textContent = 'Crawling...';
        crawlStatus.style.color = '#94a1b2';
        try {
            const res = await fetch('/api/crawl', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, schedule: 'daily' })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to crawl');
            crawlStatus.textContent = 'Crawled and scheduled successfully.';
            crawlStatus.style.color = 'green';
            await loadFileList();
            await loadScheduledUrls();
        } catch (e) {
            crawlStatus.textContent = `Error: ${e.message}`;
            crawlStatus.style.color = 'red';
        } finally {
            crawlButton.disabled = false;
        }
    };

    const handleAskQuestion = async () => {
        const question = questionInput.value.trim();
        if (!question) return;

        addMessage('user', question);
        questionInput.value = '';
        loadingIndicator.style.display = 'flex';
        askButton.disabled = true;

        try {
            const response = await fetch('/api/ask', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ question, userId: getUserId() }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Something went wrong');
            }

            const data = await response.json();
            const answer = data.text.replace(/\n/g, '<br>');
            addMessage('bot', answer, data.sourceDocuments);

        } catch (error) {
            if (error.message.includes('Rate limit exceeded')) {
                addMessage('bot', '⚠️ Rate limit exceeded. Please wait a few minutes before asking more questions.');
            } else {
                addMessage('bot', `🔴 Error: ${error.message}`);
            }
        } finally {
            loadingIndicator.style.display = 'none';
            askButton.disabled = false;
            questionInput.focus();
        }
    };

    uploadButton.addEventListener('click', handleUpload);
    if (crawlButton) crawlButton.addEventListener('click', handleCrawl);
    askButton.addEventListener('click', handleAskQuestion);
    questionInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            handleAskQuestion();
        }
    });

    // Load file list when page loads
    loadFileList();
    loadScheduledUrls();
}); 