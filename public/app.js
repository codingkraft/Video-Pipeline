// Socket.IO connection
const socket = io();

let selectedDocuments = [];
let allFolders = []; // Store multiple folders
let selectedLocalFolders = []; // Array of absolute paths of selected local folders

// Load common settings from server on page load
async function loadCommonSettings() {
    try {
        const response = await fetch('/api/get-settings');
        const data = await response.json();

        if (data.success && data.settings) {
            const s = data.settings;

            // Populate form fields
            if (s.sourceFolder) document.getElementById('sourceFolder').value = s.sourceFolder;
            if (s.perplexityModel) document.getElementById('perplexityModel').value = s.perplexityModel;
            if (s.audioNarrationPerplexityModel) document.getElementById('audioNarrationPerplexityModel').value = s.audioNarrationPerplexityModel;
            if (s.promptText) document.getElementById('promptText').value = s.promptText;
            if (s.notebookLmChatSettings) document.getElementById('notebookLmChatSettings').value = s.notebookLmChatSettings;
            if (s.notebookLmStyleSettings) document.getElementById('notebookLmStyleSettings').value = s.notebookLmStyleSettings;
            if (s.stylePrompt) document.getElementById('stylePrompt').value = s.stylePrompt;
            if (s.audioNarrationPrompt) document.getElementById('audioNarrationPrompt').value = s.audioNarrationPrompt;
            // Populate Google Studio Model Dropdown
            const modelSelect = document.getElementById('googleStudioModel');
            if (s.googleStudioModels && Array.isArray(s.googleStudioModels)) {
                modelSelect.innerHTML = '';
                s.googleStudioModels.forEach(model => {
                    const option = document.createElement('option');
                    option.value = model;
                    option.textContent = model;
                    modelSelect.appendChild(option);
                });
            }
            if (s.googleStudioModel) modelSelect.value = s.googleStudioModel;

            // Populate Google Studio Voice Dropdown
            const voiceSelect = document.getElementById('googleStudioVoice');
            if (s.googleStudioVoices && Array.isArray(s.googleStudioVoices)) {
                voiceSelect.innerHTML = '';
                s.googleStudioVoices.forEach(voice => {
                    const option = document.createElement('option');
                    option.value = voice;
                    option.textContent = voice;
                    voiceSelect.appendChild(option);
                });
            }
            if (s.googleStudioVoice) voiceSelect.value = s.googleStudioVoice;
            if (s.googleStudioStyleInstructions) document.getElementById('googleStudioStyleInstructions').value = s.googleStudioStyleInstructions;
            if (s.outputDir) document.getElementById('outputDir').value = s.outputDir;

            // Checkboxes
            if (s.headlessMode !== undefined) document.getElementById('headlessMode').checked = s.headlessMode;
            if (s.deleteConversation !== undefined) document.getElementById('deleteConversation').checked = s.deleteConversation;

            console.log('Common settings loaded');
        }
    } catch (error) {
        console.error('Failed to load common settings:', error);
    }
}

// Call loadCommonSettings when page loads
document.addEventListener('DOMContentLoaded', loadCommonSettings);

// Select local folder using native Windows dialog
async function selectLocalFolder() {
    const btn = document.getElementById('selectFolderBtn');
    const originalText = btn.textContent;
    btn.textContent = '⏳ Opening...';
    btn.disabled = true;

    try {
        const response = await fetch('/api/browse-folder');
        const data = await response.json();

        if (data.path) {
            // Add to array if not already present
            if (!selectedLocalFolders.includes(data.path)) {
                selectedLocalFolders.push(data.path);
            }

            // Update display
            updateLocalFolderDisplay();

            // Save first folder to settings (for backwards compatibility)
            document.getElementById('sourceFolder').value = selectedLocalFolders.join(';');
            saveSettings();

            // Load files from the folder
            await loadFilesFromFolder(data.path);

            // Update audio start options based on folder progress
            await updateAudioStartOptions(data.path);
        } else if (data.cancelled) {
            console.log('Folder selection cancelled');
        }
    } catch (error) {
        console.error('Browse error:', error);
        alert('Failed to open folder picker: ' + error.message);
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

// Update folder display for multiple folders
function updateLocalFolderDisplay() {
    const folderPathEl = document.getElementById('folderPath');
    const outputPreviewEl = document.getElementById('outputPathPreview');

    if (selectedLocalFolders.length === 0) {
        folderPathEl.textContent = 'No folder selected';
        outputPreviewEl.textContent = '[Selected Folder]/output/';
    } else if (selectedLocalFolders.length === 1) {
        folderPathEl.textContent = selectedLocalFolders[0];
        outputPreviewEl.textContent = selectedLocalFolders[0] + '\\output\\';
    } else {
        folderPathEl.innerHTML = selectedLocalFolders.map(f => `📁 ${f}`).join('<br>');
        outputPreviewEl.textContent = 'Each folder will have its own output subfolder';
    }
}

// Clear all selected local folders
function clearLocalFolders() {
    selectedLocalFolders = [];
    updateLocalFolderDisplay();
    document.getElementById('documentList').innerHTML = '';
    document.getElementById('sourceFolder').value = '';
    saveSettings();
}

// Load and display files from a local folder
async function loadFilesFromFolder(folderPath) {
    const docList = document.getElementById('documentList');
    docList.innerHTML = '<p style="color: var(--text-muted);">Loading files...</p>';

    try {
        const response = await fetch('/api/list-folder?path=' + encodeURIComponent(folderPath));
        const data = await response.json();

        // Also load progress for this folder
        const progressResponse = await fetch('/api/folder-progress?path=' + encodeURIComponent(folderPath));
        const progressData = await progressResponse.json();

        if (data.files && data.files.length > 0) {
            docList.innerHTML = '';

            // Show progress status if any steps are complete
            if (progressData.success && progressData.summary && progressData.summary.completedSteps.length > 0) {
                const progressDiv = document.createElement('div');
                progressDiv.className = 'progress-status';
                progressDiv.style.cssText = 'background: rgba(76, 175, 80, 0.15); border: 1px solid #4caf50; border-radius: 8px; padding: 12px 14px; margin-bottom: 12px;';

                const stepLabels = {
                    'perplexity': '✅ Perplexity Prompt',
                    'notebooklm_notebook_created': '✅ Notebook Created',
                    'notebooklm_sources_uploaded': '✅ Sources Uploaded',
                    'notebooklm_video_started': '✅ Video Started'
                };

                const completedHtml = progressData.summary.completedSteps
                    .map(step => `<span style="color: #4caf50; margin-right: 12px;">${stepLabels[step] || step}</span>`)
                    .join('');

                const nextStep = progressData.summary.nextStep;
                const nextStepText = nextStep ?
                    `<br><strong style="color: var(--text-muted);">Next: ${nextStep.replace(/_/g, ' ')}</strong>` :
                    '<br><strong style="color: #4caf50;">All steps complete!</strong>';

                // Build dropdown options based on completed steps
                let dropdownOptions = '<option value="start-fresh">🔄 Start Fresh (from Perplexity)</option>';
                let lastOption = 'start-fresh'; // Track the last option added

                // If Perplexity is done, show option to skip to NotebookLM
                if (progressData.summary.completedSteps.includes('perplexity')) {
                    dropdownOptions += '<option value="skip-to-notebooklm">📓 Skip to NotebookLM</option>';
                    lastOption = 'skip-to-notebooklm';
                }

                // If notebook is created, show option to continue from there
                if (progressData.summary.completedSteps.includes('notebooklm_notebook_created')) {
                    // Check if sources are also uploaded
                    if (progressData.summary.completedSteps.includes('notebooklm_sources_uploaded')) {
                        dropdownOptions += '<option value="continue-from-notebook">📂 Continue (Sources Uploaded)</option>';
                    } else {
                        dropdownOptions += '<option value="continue-from-notebook">📂 Open Existing Notebook</option>';
                    }
                    lastOption = 'continue-from-notebook';
                }

                const dropdownHtml = `
                    <div style="margin-top: 10px;">
                        <label for="pipelineStartPoint" style="display: block; margin-bottom: 4px; font-size: 0.9em; color: var(--text-muted);">
                            <strong>Start pipeline from:</strong>
                        </label>
                        <select id="pipelineStartPoint" style="width: 100%; padding: 8px; border-radius: 4px; border: 1px solid #4caf50; background: var(--bg); color: var(--text); font-size: 0.9em;">
                            ${dropdownOptions}
                        </select>
                    </div>
                `;

                progressDiv.innerHTML = `
                    <div style="font-size: 0.9em;">
                        <strong style="color: var(--text);">Pipeline Progress:</strong><br>
                        ${completedHtml}
                        ${nextStepText}
                        ${dropdownHtml}
                    </div>
                `;
                docList.appendChild(progressDiv);

                // Set the last option as selected after rendering
                setTimeout(() => {
                    const dropdown = document.getElementById('pipelineStartPoint');
                    if (dropdown) {
                        dropdown.value = lastOption;
                    }
                }, 50);

                // Store progress for later use
                window.currentFolderProgress = progressData;
            }

            // Show warning if perplexity output already exists
            if (data.warning) {
                const warningDiv = document.createElement('div');
                warningDiv.className = 'warning-banner';
                warningDiv.style.cssText = 'background: rgba(255, 193, 7, 0.15); border: 1px solid #ffc107; border-radius: 8px; padding: 10px 14px; margin-bottom: 12px; color: #ffc107; font-size: 0.9em;';
                warningDiv.innerHTML = `⚠ ${data.warning}. Running again will overwrite existing output.`;
                docList.appendChild(warningDiv);
            }

            data.files.forEach(file => {
                const item = document.createElement('div');
                item.className = 'document-item';
                item.innerHTML = `<span>📄 ${file}</span>`;
                docList.appendChild(item);
            });
        } else {
            docList.innerHTML = '<p style="color: var(--text-muted);">No supported files found in this folder.</p>';
        }
    } catch (error) {
        console.error('Error loading files:', error);
        docList.innerHTML = '<p style="color: var(--danger);">Error loading files: ' + error.message + '</p>';
    }
}

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

            // Load active profile first
            document.getElementById('activeProfile').value = settings.activeProfile || 'profile1';

            // Load profile-specific settings (Perplexity URLs from current profile)
            const currentProfile = settings.profiles?.[settings.activeProfile || 'profile1'] || {};
            document.getElementById('perplexityChatUrl').value = currentProfile.perplexityChatUrl || settings.perplexityChatUrl || '';
            document.getElementById('audioNarrationPerplexityUrl').value = currentProfile.audioNarrationPerplexityUrl || '';

            // Load common settings
            document.getElementById('promptText').value = settings.promptText || '';
            document.getElementById('notebookLmChatSettings').value = settings.notebookLmChatSettings || 'Focus on key concepts and provide clear explanations';
            document.getElementById('notebookLmStyleSettings').value = settings.notebookLmStyleSettings || 'Modern, engaging, educational style';
            document.getElementById('stylePrompt').value = settings.stylePrompt || 'Professional with smooth transitions';
            document.getElementById('sourceFolder').value = settings.sourceFolder || '';
            document.getElementById('headlessMode').checked = settings.headlessMode === true;
            document.getElementById('deleteConversation').checked = settings.deleteConversation === true;
            document.getElementById('perplexityModel').value = settings.perplexityModel || 'Best';

            // Load audio generation settings
            document.getElementById('audioNarrationPrompt').value = settings.audioNarrationPrompt || '';
            document.getElementById('googleStudioModel').value = settings.googleStudioModel || '';
            document.getElementById('googleStudioVoice').value = settings.googleStudioVoice || '';
            document.getElementById('googleStudioStyleInstructions').value = settings.googleStudioStyleInstructions || '';

            console.log('Settings loaded from file');
        }
    } catch (error) {
        console.error('Failed to load settings:', error);
    }
}

// Handle profile change - reload settings for new profile
async function onProfileChange() {
    const newProfile = document.getElementById('activeProfile').value;
    console.log('Profile changed to:', newProfile);

    // Fetch settings from server
    try {
        const response = await fetch('/api/load-settings');
        const data = await response.json();

        if (data.success && data.settings) {
            const settings = data.settings;

            // Load the NEW profile's specific settings (not the old activeProfile from file)
            const profileData = settings.profiles?.[newProfile] || {};
            document.getElementById('perplexityChatUrl').value = profileData.perplexityChatUrl || '';
            document.getElementById('audioNarrationPerplexityUrl').value = profileData.audioNarrationPerplexityUrl || '';

            // Keep the dropdown on the new profile
            document.getElementById('activeProfile').value = newProfile;
        }
    } catch (error) {
        console.error('Failed to load profile settings:', error);
    }

    // Show confirmation with restart warning
    const hint = document.querySelector('#activeProfile + .hint');
    if (hint) {
        const originalText = hint.textContent;
        hint.innerHTML = `✓ Switched to ${newProfile}<br><strong style="color: var(--warning);">⚠ Browser restart needed - close browser or restart server</strong>`;
        hint.style.color = 'var(--success)';
        setTimeout(() => {
            hint.textContent = originalText;
            hint.style.color = '';
        }, 5000);
    }
}

// Save profile-specific settings
async function saveProfileSettings() {
    const activeProfile = document.getElementById('activeProfile').value;
    const profileSettings = {
        activeProfile,
        profiles: {
            [activeProfile]: {
                perplexityChatUrl: document.getElementById('perplexityChatUrl').value,
                audioNarrationPerplexityUrl: document.getElementById('audioNarrationPerplexityUrl').value
            }
        }
    };

    try {
        const response = await fetch('/api/save-profile-settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(profileSettings)
        });

        const result = await response.json();
        if (result.success) {
            const msg = document.getElementById('saveProfileMessage');
            if (msg) {
                msg.style.display = 'block';
                setTimeout(() => msg.style.display = 'none', 2000);
            }
            console.log('Profile settings saved');
        }
    } catch (e) {
        console.error('Save profile settings failed:', e);
    }
}

// Save common settings (applies to all profiles)
async function saveCommonSettings() {
    const settings = {
        promptText: document.getElementById('promptText').value,
        notebookLmChatSettings: document.getElementById('notebookLmChatSettings').value,
        notebookLmStyleSettings: document.getElementById('notebookLmStyleSettings').value,
        stylePrompt: document.getElementById('stylePrompt').value,
        outputDir: document.getElementById('outputDir').value,
        sourceFolder: document.getElementById('sourceFolder').value,
        headlessMode: document.getElementById('headlessMode').checked,
        deleteConversation: document.getElementById('deleteConversation').checked,
        perplexityModel: document.getElementById('perplexityModel').value,
        audioNarrationPrompt: document.getElementById('audioNarrationPrompt').value,
        googleStudioModel: document.getElementById('googleStudioModel').value,
        googleStudioVoice: document.getElementById('googleStudioVoice').value,
        googleStudioStyleInstructions: document.getElementById('googleStudioStyleInstructions').value
    };

    try {
        const response = await fetch('/api/save-settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });

        const result = await response.json();
        if (result.success) {
            const msg = document.getElementById('saveCommonMessage');
            if (msg) {
                msg.style.display = 'block';
                setTimeout(() => msg.style.display = 'none', 2000);
            }
            console.log('Common settings saved to:', result.path);
        }
    } catch (e) {
        console.error('Save common settings failed:', e);
    }
}

// Auto-save settings when inputs change
function setupAutoSave() {
    const inputIds = [
        'perplexityChatUrl',
        'promptText',
        'notebookLmChatSettings',
        'notebookLmStyleSettings',
        'stylePrompt',
        'outputDir',
        'sourceFolder',
        'headlessMode',
        'deleteConversation',
        'perplexityModel'
    ];

    inputIds.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            // Save on blur (when user leaves the field)
            element.addEventListener('blur', () => {
                saveSettings();
            });
            // Also save on change for checkboxes
            if (element.type === 'checkbox') {
                element.addEventListener('change', () => {
                    saveSettings();
                });
            }
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
        const activeProfile = document.getElementById('activeProfile').value;
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ profileId: activeProfile })
        });

        const data = await response.json();

        if (response.ok) {
            alert(data.message + '\n\nPlease log into:\n- Perplexity\n- NotebookLM\n- Gemini\n\nYour sessions will be saved automatically.');
            loginBtn.textContent = '🔐 Setup Login';
            loginBtn.disabled = false;  // Re-enable so it can be used again

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

    const sourceFolder = document.getElementById('sourceFolder').value;

    // Accept either uploaded documents OR a local source folder
    if (selectedDocuments.length === 0 && !sourceFolder && selectedLocalFolders.length === 0) {
        alert('Please select at least one folder using "Select Local Folder"');
        return;
    }

    const perplexityChatUrl = document.getElementById('perplexityChatUrl').value;
    const promptText = document.getElementById('promptText').value;

    // Check if there's a pipeline start point dropdown
    const startPointDropdown = document.getElementById('pipelineStartPoint');
    if (startPointDropdown) {
        const startPoint = startPointDropdown.value;

        // Route based on selected starting point
        if (startPoint === 'skip-to-notebooklm') {
            await skipToNotebookLM();
            return;
        } else if (startPoint === 'continue-from-notebook') {
            await continueFromNotebook();
            return;
        } else if (startPoint === 'start-fresh') {
            // Reset progress and continue with full pipeline
            const sourceFolder = document.getElementById('sourceFolder').value || selectedLocalFolders[0];
            if (sourceFolder) {
                await fetch('/api/reset-progress', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        folderPath: sourceFolder,
                        fromStep: 'perplexity'
                    })
                });
                window.currentFolderProgress = null;
            }
            // Continue with normal flow below
        }
    }

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
        const sourceFolder = document.getElementById('sourceFolder').value;

        const headless = document.getElementById('headlessMode').checked;
        const deleteConversation = document.getElementById('deleteConversation').checked;
        const model = document.getElementById('perplexityModel').value;
        const activeProfile = document.getElementById('activeProfile').value;

        formData.append('chatUrl', perplexityChatUrl);
        formData.append('prompt', promptText);
        if (outputDir) formData.append('outputDir', outputDir);
        if (sourceFolder) formData.append('sourceFolder', sourceFolder);
        formData.append('headless', headless);
        formData.append('deleteConversation', deleteConversation);
        if (model) formData.append('model', model);
        formData.append('profileId', activeProfile);

        const response = await fetch('/api/test-perplexity', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        if (data.success) {
            testMessage.innerHTML = `
                <strong>✅ Perplexity Completed!</strong><br><br>
                <strong>📄 Response File:</strong><br>
                <code style="background: var(--bg); padding: 0.5rem; border-radius: 0.25rem; display: block; margin: 0.5rem 0; word-break: break-all;">
                    ${data.details.responseFilePath}
                </code>
                <strong>Response Length:</strong> ${data.details.responseLength} characters<br><br>
                <strong>Steps:</strong><br>
                ${data.details.steps.join('<br>')}
                <br><br>
                <strong>Screenshot:</strong> ${data.details.screenshotPath}
                <br><br>
                <strong style="color: #2196f3;">⏳ Auto-continuing to NotebookLM...</strong>
            `;
            testMessage.style.color = 'var(--success)';

            // Auto-continue to NotebookLM
            testBtn.textContent = '📓 NotebookLM...';
            await testNotebookLM(sourceFolder || selectedLocalFolders[0]);

        } else {
            testMessage.innerHTML = `<strong>❌ Test Failed:</strong> ${data.message}`;
            testMessage.style.color = 'var(--danger)';
        }

        testBtn.textContent = '🧪 Run Pipeline (Perplexity → NotebookLM)';
        testBtn.disabled = false;

    } catch (error) {
        testMessage.innerHTML = `<strong>❌ Error:</strong> ${error.message}`;
        testMessage.style.color = 'var(--danger)';
        testBtn.textContent = '🧪 Run Pipeline (Perplexity → NotebookLM)';
        testBtn.disabled = false;
    }
}

// Test NotebookLM workflow (called after Perplexity or directly)
async function testNotebookLM(folderPath) {
    const testResults = document.getElementById('testResults');
    const testMessage = document.getElementById('testMessage');

    // Get source folder
    const sourceFolder = folderPath || document.getElementById('sourceFolder').value || selectedLocalFolders[0];

    if (!sourceFolder) {
        alert('Please select a folder first');
        return;
    }

    testResults.style.display = 'block';
    testMessage.innerHTML += '<br><br><strong style="color: #2196f3;">📓 Starting NotebookLM workflow...</strong>';

    try {
        const headless = document.getElementById('headlessMode').checked;

        // Check if we have an existing notebook URL from progress
        let existingNotebookUrl = null;
        if (window.currentFolderProgress?.progress?.steps?.notebooklm_notebook_created?.notebookUrl) {
            existingNotebookUrl = window.currentFolderProgress.progress.steps.notebooklm_notebook_created.notebookUrl;
        }

        const response = await fetch('/api/test-notebooklm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sourceFolder,
                headless,
                existingNotebookUrl
            })
        });

        const data = await response.json();

        if (data.success) {
            testMessage.innerHTML += `
                <br><br>
                <strong>✅ NotebookLM Completed!</strong><br><br>
                <strong>📓 Notebook URL:</strong><br>
                <code style="background: var(--bg); padding: 0.5rem; border-radius: 0.25rem; display: block; margin: 0.5rem 0; word-break: break-all;">
                    ${data.details.notebookUrl || 'Not captured'}
                </code>
                <strong>Sources Uploaded:</strong> ${data.details.sourceCount}<br><br>
                <strong>Steps:</strong><br>
                ${data.details.steps.join('<br>')}
            `;
        } else {
            testMessage.innerHTML += `<br><br><strong>❌ NotebookLM Failed:</strong> ${data.message}`;
        }

        // Refresh folder to show updated progress
        if (sourceFolder) {
            await loadFilesFromFolder(sourceFolder);
        }

    } catch (error) {
        testMessage.innerHTML += `<br><br><strong>❌ NotebookLM Error:</strong> ${error.message}`;
    }
}

// Test Audio Pipeline (Google AI Studio TTS)
async function testAudioPipeline() {
    const sourceFolder = document.getElementById('sourceFolder').value;

    if (!sourceFolder) {
        alert('Please select a source folder first');
        return;
    }

    // Show progress section
    const progressSection = document.getElementById('progressSection');
    const progressLog = document.getElementById('progressLog');
    progressSection.style.display = 'block';
    progressLog.innerHTML = '';
    addLogEntry('🎙️ Starting Audio Pipeline test...');
    updateStatus('testing');

    try {
        const activeProfile = document.getElementById('activeProfile').value;
        const audioStartPoint = document.getElementById('audioStartPoint').value;
        const googleStudioModel = document.getElementById('googleStudioModel').value;
        const googleStudioVoice = document.getElementById('googleStudioVoice').value;
        const googleStudioStyleInstructions = document.getElementById('googleStudioStyleInstructions').value;

        // Check if audio is already complete
        if (audioStartPoint === 'audio-complete') {
            addLogEntry('✅ Audio generation is already complete for this folder!', 'success');
            addLogEntry('💡 Select "Regenerate All" or "Regenerate Audio Files" to run again.');
            updateStatus('idle');
            return;
        }

        const response = await fetch('/api/generate-audio', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sourceFolder,
                headless: document.getElementById('headlessMode').checked,
                profileId: activeProfile,
                audioStartPoint,
                googleStudioModel,
                googleStudioVoice,
                googleStudioStyleInstructions
            })
        });

        const result = await response.json();

        if (result.success) {
            addLogEntry('✅ Audio Pipeline completed!', 'success');
            if (result.details?.steps) {
                result.details.steps.forEach(step => addLogEntry(step));
            }
            if (result.details?.audioFiles) {
                addLogEntry(`📁 Generated ${result.details.audioFiles.length} audio files`);
            }
        } else {
            addLogEntry(`❌ Error: ${result.message}`, 'error');
            if (result.details?.steps) {
                result.details.steps.forEach(step => addLogEntry(step));
            }
        }

        updateStatus('idle');

    } catch (error) {
        addLogEntry(`❌ Audio Pipeline Error: ${error.message}`, 'error');
        updateStatus('idle');
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


// Browse folder using native picker
async function browseFolder() {
    const btn = document.querySelector('button[onclick="browseFolder()"]');
    const originalText = btn.textContent;
    btn.textContent = 'Scanning...';
    btn.disabled = true;

    try {
        const response = await fetch('/api/browse-folder');
        const data = await response.json();

        if (data.path) {
            const input = document.getElementById('sourceFolder');
            input.value = data.path;
            // Trigger auto-save
            saveSettings();
        }
    } catch (error) {
        console.error('Browse error:', error);
        alert('Failed to open folder picker: ' + error.message);
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

// Skip Perplexity and go directly to NotebookLM
async function skipToNotebookLM() {
    const sourceFolder = document.getElementById('sourceFolder').value || selectedLocalFolders[0];

    if (!sourceFolder) {
        alert('Please select a folder first');
        return;
    }

    // Show test results section
    const testResults = document.getElementById('testResults');
    const testMessage = document.getElementById('testMessage');
    testResults.style.display = 'block';
    testMessage.innerHTML = '<strong style="color: #2196f3;">📓 Skipping Perplexity, starting NotebookLM...</strong>';

    // Call NotebookLM directly
    await testNotebookLM(sourceFolder);
}

// Continue from existing notebook (don't create new one)
async function continueFromNotebook() {
    const sourceFolder = document.getElementById('sourceFolder').value || selectedLocalFolders[0];

    if (!sourceFolder) {
        alert('Please select a folder first');
        return;
    }

    // Get the existing notebook URL from progress
    const notebookUrl = window.currentFolderProgress?.progress?.steps?.notebooklm_notebook_created?.notebookUrl;

    if (!notebookUrl) {
        alert('No saved notebook URL found. Please create a new notebook.');
        return;
    }

    // Show test results section
    const testResults = document.getElementById('testResults');
    const testMessage = document.getElementById('testMessage');
    testResults.style.display = 'block';
    testMessage.innerHTML = `<strong style="color: #2196f3;">📂 Opening existing notebook...</strong><br>
        <code style="font-size: 0.85em;">${notebookUrl}</code>`;

    try {
        const headless = document.getElementById('headlessMode').checked;

        const response = await fetch('/api/test-notebooklm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sourceFolder,
                headless,
                existingNotebookUrl: notebookUrl
            })
        });

        const data = await response.json();

        if (data.success) {
            testMessage.innerHTML += `<br><br><strong>✅ NotebookLM Completed!</strong><br>
                <strong>Steps:</strong><br>${data.details.steps.join('<br>')}`;
        } else {
            testMessage.innerHTML += `<br><br><strong>❌ Failed:</strong> ${data.message}`;
        }

        // Refresh folder to show updated progress
        await loadFilesFromFolder(sourceFolder);

    } catch (error) {
        testMessage.innerHTML += `<br><br><strong>❌ Error:</strong> ${error.message}`;
    }
}

// Reset progress and run full pipeline from scratch
async function resetAndRunFull() {
    const sourceFolder = document.getElementById('sourceFolder').value || selectedLocalFolders[0];

    if (!sourceFolder) {
        alert('Please select a folder first');
        return;
    }

    if (!confirm('This will reset all progress and start from Perplexity. Continue?')) {
        return;
    }

    try {
        // Reset progress from the first step
        await fetch('/api/reset-progress', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                folderPath: sourceFolder,
                fromStep: 'perplexity'
            })
        });

        // Clear stored progress
        window.currentFolderProgress = null;

        // Refresh folder display
        await loadFilesFromFolder(sourceFolder);

        // Run full pipeline
        testPerplexity();

    } catch (error) {
        alert('Failed to reset progress: ' + error.message);
    }
}

// Update audio start options based on folder progress
async function updateAudioStartOptions(folderPath) {
    const container = document.getElementById('audioStartContainer');
    const dropdown = document.getElementById('audioStartPoint');

    if (!dropdown || !container) {
        return;
    }

    if (!folderPath) {
        container.style.display = 'none';
        return;
    }

    try {
        // Fetch progress for the folder
        const response = await fetch(`/api/folder-progress?path=${encodeURIComponent(folderPath)}`);
        const data = await response.json();

        // Clear current options
        dropdown.innerHTML = '';

        // Check progress
        const progress = data.progress || {};
        const audioNarrationDone = progress.audio_narration_generated?.completed || false;
        const audioFilesDone = progress.audio_files_generated?.completed || false;

        // Build valid options based on progress

        // Option 1: Always allow starting fresh (Generate Narration + Audio)
        const startFreshOption = document.createElement('option');
        startFreshOption.value = 'start-fresh';
        startFreshOption.textContent = audioNarrationDone ? 'Regenerate Narration + Audio' : 'Generate Narration + Audio';
        dropdown.appendChild(startFreshOption);

        // Option 2: Skip to Audio Generation (ONLY if narration exists)
        if (audioNarrationDone) {
            const skipOption = document.createElement('option');
            skipOption.value = 'skip-to-audio-generation';
            skipOption.textContent = audioFilesDone ? 'Regenerate Audio Files' : 'Skip to Audio Generation';
            // Default to this if narration is done but files aren't
            if (!audioFilesDone) {
                skipOption.selected = true;
                skipOption.textContent += ' ✓';
            }
            dropdown.appendChild(skipOption);
        }

        // Option 3: Audio Complete State (if everything is done)
        if (audioFilesDone) {
            const completeOption = document.createElement('option');
            completeOption.value = 'audio-complete';
            completeOption.textContent = '✅ Audio Complete';
            completeOption.selected = true;
            dropdown.appendChild(completeOption);
        }

        // Show the container now that we have options
        container.style.display = 'flex';

    } catch (error) {
        console.error('Failed to update audio start options:', error);
        container.style.display = 'none'; // Hide on error
    }
}

// Save common settings (non-profile specific)
async function saveCommonSettings() {
    const settings = {
        sourceFolder: document.getElementById('sourceFolder').value,
        headlessMode: document.getElementById('headlessMode').checked,
        deleteConversation: document.getElementById('deleteConversation').checked,
        perplexityModel: document.getElementById('perplexityModel').value,
        audioNarrationPerplexityModel: document.getElementById('audioNarrationPerplexityModel').value,
        promptText: document.getElementById('promptText').value,
        notebookLmChatSettings: document.getElementById('notebookLmChatSettings').value,
        notebookLmStyleSettings: document.getElementById('notebookLmStyleSettings').value,
        stylePrompt: document.getElementById('stylePrompt').value,
        audioNarrationPrompt: document.getElementById('audioNarrationPrompt').value,
        googleStudioModel: document.getElementById('googleStudioModel').value,
        googleStudioVoice: document.getElementById('googleStudioVoice').value,
        googleStudioStyleInstructions: document.getElementById('googleStudioStyleInstructions').value,
        outputDir: document.getElementById('outputDir').value
    };

    try {
        const response = await fetch('/api/save-settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });
        const result = await response.json();
        if (result.success) {
            console.log('Settings saved');
            // Show success message
            const message = document.getElementById('saveCommonMessage');
            if (message) {
                message.style.display = 'block';
                setTimeout(() => {
                    message.style.display = 'none';
                }, 3000);
            }
        } else {
            console.error('Failed to save settings:', result.message);
            alert('Failed to save settings: ' + result.message);
        }
    } catch (error) {
        console.error('Error saving settings:', error);
        alert('Error saving settings: ' + error.message);
    }
}

// Keep saveSettings as an alias for compatibility
async function saveSettings() {
    await saveCommonSettings();
}

