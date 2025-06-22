document.addEventListener('DOMContentLoaded', () => {
    const questionInput = document.getElementById('question-input');
    const askButton = document.getElementById('ask-button');
    const chatHistory = document.getElementById('chat-history');
    const loadingIndicator = document.getElementById('loading-indicator');
    const fileUpload = document.getElementById('file-upload');
    const uploadButton = document.getElementById('upload-button');
    const uploadStatus = document.getElementById('upload-status');

    fileUpload.addEventListener('change', () => {
        const fileName = fileUpload.files[0] ? fileUpload.files[0].name : 'Select File';
        document.querySelector('.file-upload-label span').textContent = fileName;
    });

    const addMessage = (sender, message, sources = []) => {
        const messageElement = document.createElement('div');
        messageElement.classList.add('message', `${sender}-message`);

        const messageParagraph = document.createElement('p');
        messageParagraph.innerHTML = message; // Use innerHTML to render line breaks
        messageElement.appendChild(messageParagraph);

        if (sources.length > 0 && sender === 'bot') {
            const sourcesDiv = document.createElement('div');
            sourcesDiv.classList.add('sources');
            sourcesDiv.innerHTML = '<strong>Sources:</strong>';
            const sourcesList = document.createElement('ul');
            sources.forEach(source => {
                const sourceItem = document.createElement('li');
                sourceItem.textContent = `${source.source} (${source.section})`;
                sourcesList.appendChild(sourceItem);
            });
            sourcesDiv.appendChild(sourcesList);
            messageElement.appendChild(sourcesDiv);
        }
        
        chatHistory.appendChild(messageElement);
        chatHistory.scrollTop = chatHistory.scrollHeight; // Auto-scroll to the latest message
    };

    const handleUpload = async () => {
        const file = fileUpload.files[0];
        if (!file) {
            uploadStatus.textContent = 'Please select a file first.';
            uploadStatus.style.color = 'red';
            return;
        }

        const formData = new FormData();
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

        } catch (error) {
            uploadStatus.textContent = `Error: ${error.message}`;
            uploadStatus.style.color = 'red';
        } finally {
            uploadButton.disabled = false;
            fileUpload.value = ''; // Reset file input
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
                body: JSON.stringify({ question }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Something went wrong');
            }

            const data = await response.json();
            const answer = data.text.replace(/\n/g, '<br>');
            addMessage('bot', answer, data.sourceDocuments);

        } catch (error) {
            addMessage('bot', `🔴 Error: ${error.message}`);
        } finally {
            loadingIndicator.style.display = 'none';
            askButton.disabled = false;
            questionInput.focus();
        }
    };

    uploadButton.addEventListener('click', handleUpload);
    askButton.addEventListener('click', handleAskQuestion);
    questionInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            handleAskQuestion();
        }
    });
}); 