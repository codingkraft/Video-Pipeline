// Socket.IO connection
const socket = io();

let selectedDocuments = [];
let allFolders = []; // Store multiple folders

// Handle folder selection from file input
function handleFolderSelect() {
    const folderInput = document.getElementById('folderInput');
    const files = Array.from(folderInput.files);

    if (files.length === 0) {
        return;
    }

    // Get folder name from first file's path
    const folderPath = files[0].webkitRelativePath.split('/')[0];

    // Filter for document files
    const documentExtensions = ['.pdf', '.txt', '.md', '.doc', '.docx', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
    const documents = files
        .filter(file => {
            const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
            return documentExtensions.includes(ext);
        })
        .map(file => ({
            name: file.name,
            path: file.webkitRelativePath,
            size: file.size,
            file: file
        }));

    // Add folder to list
    allFolders.push({
        name: folderPath,
        documents: documents
    });

    updateFolderDisplay();
    displayAllDocuments();
}

// Update folder display
function updateFolderDisplay() {
    const folderNameEl = document.getElementById('folderName');
    if (allFolders.length === 0) {
        folderNameEl.textContent = 'No folders selected';
    } else if (allFolders.length === 1) {
        folderNameEl.textContent = allFolders[0].name;
    } else {
        folderNameEl.textContent = `${allFolders.length} folders selected`;
    }
}

// Display all documents from all folders
function displayAllDocuments() {
    const listEl = document.getElementById('documentList');

    const allDocs = allFolders.flatMap((folder, folderIndex) =>
        folder.documents.map((doc, docIndex) => ({
            ...doc,
            folderIndex,
            docIndex,
            folderName: folder.name
        }))
    );

    if (allDocs.length === 0) {
        listEl.innerHTML = '<p style="color: var(--text-muted);">No documents found.</p>';
        return;
    }

    listEl.innerHTML = allDocs.map((doc, index) => `
        <div class="document-item">
            <input 
                type="checkbox" 
                id="doc-${index}" 
                data-folder-index="${doc.folderIndex}"
                data-doc-index="${doc.docIndex}"
                onchange="updateSelectedDocuments()"
                checked
            >
            <div class="document-info">
                <div class="document-name">${doc.folderName}/${doc.name}</div>
                <div class="document-size">${formatBytes(doc.size)}</div>
            </div>
        </div>
    `).join('');

    updateSelectedDocuments();
}

// Update selected documents array
function updateSelectedDocuments() {
    const checkboxes = document.querySelectorAll('#documentList input[type="checkbox"]');
    selectedDocuments = Array.from(checkboxes)
        .filter(cb => cb.checked)
        .map(cb => {
            const folderIndex = parseInt(cb.dataset.folderIndex);
            const docIndex = parseInt(cb.dataset.docIndex);
            return allFolders[folderIndex].documents[docIndex];
        });

    const generateBtn = document.getElementById('generateBtn');
    generateBtn.disabled = selectedDocuments.length === 0;
}

// Load saved settings from server (file-based)
async function loadSettings() {
    try {
        const response = await fetch('/api/load-settings');
        const data = await response.json();

        if (data.success && data.settings) {
            const settings = data.settings;
            document.getElementById('perplexityChatUrl').value = settings.perplexityChatUrl || '';
            document.getElementById('promptText').value = settings.promptText || '';
            document.getElementById('notebookLmChatSettings').value = settings.notebookLmChatSettings || 'Focus on key concepts and provide clear explanations';
            document.getElementById('notebookLmStyleSettings').value = settings.notebookLmStyleSettings || 'Modern, engaging, educational style';
            document.getElementById('stylePrompt').value = settings.stylePrompt || 'Professional with smooth transitions';
            document.getElementById('outputDir').value = settings.outputDir || '';
            console.log('Settings loaded from file');
        }
    } catch (error) {
        console.error('Failed to load settings:', error);
    }
}

// Save settings to localStorage
function saveSettings() {
    const settings = {
        perplexityChatUrl: document.getElementById('perplexityChatUrl').value,
        promptText: document.getElementById('promptText').value,
        notebookLmChatSettings: document.getElementById('notebookLmChatSettings').value,
        notebookLmStyleSettings: document.getElementById('notebookLmStyleSettings').value,
        stylePrompt: document.getElementById('stylePrompt').value,
        outputDir: document.getElementById('outputDir').value,
    };
    fetch('/api/save-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) }).then(r => r.json()).then(d => { if (d.success) { const msg = document.getElementById('saveMessage'); if (msg) { msg.textContent = ' Saved'; msg.style.display = 'block'; setTimeout(() => msg.style.display = 'none', 3000); } console.log('Saved to:', d.path); } }).catch(e => console.error('Save failed:', e));

    // Show confirmation message
    const saveMessage = document.getElementById('saveMessage');
    if (saveMessage) {
        saveMessage.style.display = 'block';
        setTimeout(() => {
            saveMessage.style.display = 'none';
        }, 2000);
    }

    console.log('Settings saved:', settings);
}

// Auto-save settings when inputs change
function setupAutoSave() {
    const inputIds = [
        'perplexityChatUrl',
        'promptText',
        'notebookLmChatSettings',
        'notebookLmStyleSettings',
        'stylePrompt',
        'outputDir'
    ];

    inputIds.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            // Save on blur (when user leaves the field)
            element.addEventListener('blur', () => {
                saveSettings();
            });
        }
    });
}

// Generate video
async function generateVideo() {
    if (selectedDocuments.length === 0) {
        alert('Please select at least one document');
        return;
    }

    // Save settings for next time
    saveSettings();

    const perplexityChatUrl = document.getElementById('perplexityChatUrl').value;
    const promptText = document.getElementById('promptText').value;
    const notebookLmChatSettings = document.getElementById('notebookLmChatSettings').value;
    const notebookLmStyleSettings = document.getElementById('notebookLmStyleSettings').value;
    const stylePrompt = document.getElementById('stylePrompt').value;
    const outputDir = document.getElementById('outputDir').value;

    // Show progress section
    document.getElementById('progressSection').style.display = 'block';
    document.getElementById('resultsSection').style.display = 'none';
    document.getElementById('progressLog').innerHTML = '';
    document.getElementById('progressFill').style.width = '0%';

    // Update status
    updateStatus('processing');

    // Disable generate button
    document.getElementById('generateBtn').disabled = true;

    try {
        // Create FormData to upload files
        const formData = new FormData();

        selectedDocuments.forEach((doc, index) => {
            formData.append('documents', doc.file);
        });

        formData.append('perplexityChatUrl', perplexityChatUrl);
        formData.append('promptText', promptText);
        formData.append('notebookLmChatSettings', notebookLmChatSettings);
        formData.append('notebookLmStyleSettings', notebookLmStyleSettings);
        formData.append('stylePrompt', stylePrompt);
        formData.append('outputDir', outputDir);

        const response = await fetch('/api/generate-video', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        if (response.ok) {
            addLogEntry(`✅ ${data.message} (Job ID: ${data.jobId})`);
        } else {
            addLogEntry(`❌ Error: ${data.error}`, 'error');
            updateStatus('error');
            document.getElementById('generateBtn').disabled = false;
        }
    } catch (error) {
        addLogEntry(`❌ Error: ${error.message}`, 'error');
        updateStatus('error');
        document.getElementById('generateBtn').disabled = false;
    }
}

// Socket.IO: Listen for progress updates
socket.on('progress', (data) => {
    const { jobId, step, message, outputPath, error } = data;

    if (step === 'started') {
        addLogEntry(`🚀 ${message}`);
        updateProgressBar(10);
    } else if (step === 'completed') {
        addLogEntry(`✅ Video generation completed!`);
        updateProgressBar(100);
        updateStatus('success');
        showResults(outputPath);
        document.getElementById('generateBtn').disabled = false;
    } else if (step === 'failed') {
        addLogEntry(`❌ Failed: ${error}`, 'error');
        updateStatus('error');
        document.getElementById('generateBtn').disabled = false;
    } else {
        addLogEntry(`📝 ${step}: ${message}`);
        const stepProgress = {
            'perplexity': 20,
            'notebooklm': 50,
            'gemini': 70,
            'tts': 85,
            'processing': 95
        };
        updateProgressBar(stepProgress[step] || 50);
    }
});

// Add log entry
function addLogEntry(message, type = 'info') {
    const logEl = document.getElementById('progressLog');
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;

    if (type === 'error') {
        entry.style.color = 'var(--danger)';
    }

    logEl.appendChild(entry);
    logEl.scrollTop = logEl.scrollHeight;
}

// Update progress bar
function updateProgressBar(percent) {
    document.getElementById('progressFill').style.width = `${percent}%`;
}

// Update status indicator
function updateStatus(status) {
    const statusEl = document.getElementById('status');
    statusEl.className = `status-${status}`;

    const statusText = {
        'idle': 'Idle',
        'processing': 'Processing...',
        'success': 'Success',
        'error': 'Error'
    };

    statusEl.textContent = statusText[status] || status;
}

// Show results
function showResults(outputPath) {
    const resultsEl = document.getElementById('resultsSection');
    const contentEl = document.getElementById('resultsContent');

    contentEl.innerHTML = `
        <div style="background: var(--bg-input); padding: 1.5rem; border-radius: 0.5rem;">
            <h3 style="margin-bottom: 1rem;">📹 Video Generated Successfully!</h3>
            <p style="margin-bottom: 0.5rem;"><strong>Output Path:</strong></p>
            <code style="background: var(--bg); padding: 0.5rem; border-radius: 0.25rem; display: block; word-break: break-all;">
                ${outputPath}
            </code>
        </div>
    `;

    resultsEl.style.display = 'block';
}

// Utility: Format bytes
function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// Check server status on load
async function checkStatus() {
    try {
        const response = await fetch('/api/status');
        const data = await response.json();

        if (data.isProcessing) {
            updateStatus('processing');
            document.getElementById('generateBtn').disabled = true;
        }
    } catch (error) {
        console.error('Failed to check status:', error);
    }
}

// Clear all folders
function clearFolders() {
    allFolders = [];
    selectedDocuments = [];
    updateFolderDisplay();
    document.getElementById('documentList').innerHTML = '';
    document.getElementById('generateBtn').disabled = true;
}

// Setup login - open browser for manual login
async function setupLogin() {
    const loginBtn = document.getElementById('loginBtn');
    loginBtn.disabled = true;
    loginBtn.textContent = 'Opening browser...';

    try {
        const response = await fetch('/api/login', {
            method: 'POST'
        });

        const data = await response.json();

        if (response.ok) {
            alert(data.message + '\n\nPlease log into:\n- Perplexity\n- NotebookLM\n- Gemini\n\nYour sessions will be saved automatically.');
            loginBtn.textContent = '✓ Browser Opened';

            // Auto-verify after 30 seconds
            setTimeout(() => {
                verifySessions();
            }, 30000);
        } else {
            alert(`Error: ${data.error}`);
            loginBtn.textContent = '🔐 Setup Login';
            loginBtn.disabled = false;
        }
    } catch (error) {
        alert(`Error: ${error.message}`);
        loginBtn.textContent = '🔐 Setup Login';
        loginBtn.disabled = false;
    }
}

// Verify sessions
async function verifySessions() {
    const verifyBtn = document.getElementById('verifyBtn');
    const statusEl = document.getElementById('sessionStatus');

    verifyBtn.disabled = true;
    statusEl.textContent = 'Checking...';
    statusEl.className = 'session-status';

    try {
        const response = await fetch('/api/verify-sessions');
        const data = await response.json();

        if (response.ok) {
            if (data.needsRestart) {
                // Browser was closed, sessions saved but need to restart
                statusEl.textContent = '✓ Sessions saved (browser closed)';
                statusEl.className = 'session-status verified';
                console.log('Browser was closed. Sessions are saved and will be used when generating videos.');
            } else if (data.verified) {
                statusEl.textContent = '✓ All sessions verified';
                statusEl.className = 'session-status verified';
            } else {
                statusEl.textContent = '⚠ Login required';
                statusEl.className = 'session-status not-verified';

                // Show details
                let details = 'Session Status:\n';
                for (const [service, status] of Object.entries(data.sessions)) {
                    details += `\n${service}: ${status.loggedIn ? '✓ Logged in' : '✗ Not logged in'}`;
                }
                console.log(details);
            }
        } else {
            statusEl.textContent = data.message || 'Error';
            statusEl.className = 'session-status not-verified';
        }
    } catch (error) {
        statusEl.textContent = 'Error checking sessions';
        statusEl.className = 'session-status not-verified';
    } finally {
        verifyBtn.disabled = false;
    }
}

// Test Perplexity workflow
async function testPerplexity() {
    const testBtn = document.getElementById('testPerplexityBtn');
    const testResults = document.getElementById('testResults');
    const testMessage = document.getElementById('testMessage');

    if (selectedDocuments.length === 0) {
        alert('Please select at least one document/image first');
        return;
    }

    const perplexityChatUrl = document.getElementById('perplexityChatUrl').value;
    const promptText = document.getElementById('promptText').value;

    if (!promptText) {
        alert('Please enter a prompt text');
        return;
    }

    testBtn.disabled = true;
    testBtn.textContent = '🧪 Testing...';
    testResults.style.display = 'block';
    testMessage.textContent = 'Running Perplexity test workflow...';

    try {
        const formData = new FormData();

        selectedDocuments.forEach((doc) => {
            formData.append('files', doc.file);
        });

        const outputDir = document.getElementById('outputDir').value;

        formData.append('chatUrl', perplexityChatUrl);
        formData.append('prompt', promptText);
        if (outputDir) {
            formData.append('outputDir', outputDir);
        }

        const response = await fetch('/api/test-perplexity', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        if (data.success) {
            testMessage.innerHTML = `
                <strong>✅ Test Completed!</strong><br><br>
                <strong>📄 Response File:</strong><br>
                <code style="background: var(--bg); padding: 0.5rem; border-radius: 0.25rem; display: block; margin: 0.5rem 0; word-break: break-all;">
                    ${data.details.responseFilePath}
                </code>
                <strong>Response Length:</strong> ${data.details.responseLength} characters<br><br>
                <strong>Steps:</strong><br>
                ${data.details.steps.join('<br>')}
                <br><br>
                <strong>Screenshot:</strong> ${data.details.screenshotPath}
            `;
            testMessage.style.color = 'var(--success)';
        } else {
            testMessage.innerHTML = `<strong>❌ Test Failed:</strong> ${data.message}`;
            testMessage.style.color = 'var(--danger)';
        }

        testBtn.textContent = '🧪 Test Perplexity';
        testBtn.disabled = false;

    } catch (error) {
        testMessage.innerHTML = `<strong>❌ Error:</strong> ${error.message}`;
        testMessage.style.color = 'var(--danger)';
        testBtn.textContent = '🧪 Test Perplexity';
        testBtn.disabled = false;
    }
}

// Socket.IO: Listen for login status updates
socket.on('login-status', (data) => {
    const statusEl = document.getElementById('sessionStatus');
    statusEl.textContent = data.message;
});

// Initialize
loadSettings();
checkStatus();
verifySessions(); // Auto-verify on load
setupAutoSave(); // Enable auto-save on input blur

