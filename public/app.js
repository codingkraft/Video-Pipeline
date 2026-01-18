// Socket.IO connection
const socket = io();

let selectedDocuments = [];
let allFolders = []; // Store multiple folders
let selectedLocalFolders = []; // Array of absolute paths of selected local folders
let folderStartPoints = {}; // Map of folderPath -> selected startPoint key

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
            if (s.keepOpen !== undefined) document.getElementById('keepOpen').checked = s.keepOpen;

            // Delays (convert ms to seconds for UI)
            if (s.delays) {
                if (s.delays.betweenVideoStartsMs) document.getElementById('betweenVideoStartsMs').value = s.delays.betweenVideoStartsMs / 1000;
                if (s.delays.betweenAudioSlidesMs) document.getElementById('betweenAudioSlidesMs').value = s.delays.betweenAudioSlidesMs / 1000;
                if (s.delays.videoCheckIntervalMs) document.getElementById('videoCheckIntervalMs').value = s.delays.videoCheckIntervalMs / 1000;
                if (s.delays.maxWaitForVideoMs) document.getElementById('maxWaitForVideoMs').value = s.delays.maxWaitForVideoMs / 1000;
            }

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

            // Reload all folders with collapsible sections
            for (let i = 0; i < selectedLocalFolders.length; i++) {
                await loadFilesFromFolder(selectedLocalFolders[i], i);
            }

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
        // Clear document list
        document.getElementById('documentList').innerHTML = '';
    } else if (selectedLocalFolders.length === 1) {
        folderPathEl.textContent = selectedLocalFolders[0];
        outputPreviewEl.textContent = selectedLocalFolders[0] + '\\output\\';
    } else {
        folderPathEl.innerHTML = `${selectedLocalFolders.length} folders selected`;
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

// Remove folder at specific index
async function removeFolderAt(index) {
    selectedLocalFolders.splice(index, 1);
    updateLocalFolderDisplay();

    // Reload all remaining folders
    for (let i = 0; i < selectedLocalFolders.length; i++) {
        await loadFilesFromFolder(selectedLocalFolders[i], i);
    }

    saveSettings();
}

// Run pipeline for a specific folder (uses batch/start endpoint for consistency)
async function runPipelineForFolder(folderPath, dropdownId) {
    const dropdown = document.getElementById(dropdownId);
    if (!dropdown) {
        alert('Error: Dropdown not found');
        return;
    }
    const startPoint = dropdown.value;
    const profileId = document.getElementById('activeProfile').value || 'profile1';

    // UI Feedback
    const btn = dropdown.nextElementSibling;
    const originalText = btn ? btn.textContent : '▶ Run';
    if (btn) {
        btn.textContent = '⏱ Starting...';
        btn.disabled = true;
    }

    try {
        // Use batch/start endpoint with single folder
        const response = await fetch('/api/batch/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                folders: [{ path: folderPath, startPoint }],
                selectedProfiles: [profileId]
            })
        });

        const data = await response.json();

        if (data.success) {
            // Log to batch log if available
            if (typeof addBatchLog === 'function') {
                addBatchLog(`Started ${startPoint} for ${folderPath.split('\\').pop()}`);
            }
            // Show batch status container
            const batchStatusContainer = document.getElementById('batchStatusContainer');
            if (batchStatusContainer) batchStatusContainer.style.display = 'block';
            const batchLogContainer = document.getElementById('batchLogContainer');
            if (batchLogContainer) batchLogContainer.style.display = 'block';

            setTimeout(() => {
                if (btn) {
                    btn.textContent = originalText;
                    btn.disabled = false;
                }
            }, 3000);
        } else {
            alert(`Error: ${data.error || data.message}`);
            if (btn) {
                btn.textContent = originalText;
                btn.disabled = false;
            }
        }
    } catch (err) {
        alert('Network error: ' + err.message);
        if (btn) {
            btn.textContent = originalText;
            btn.disabled = false;
        }
    }
}

// Scan parent folder for subdirectories
async function scanParentFolder() {
    const parentPath = document.getElementById('parentFolderPath').value.trim();
    const subdirList = document.getElementById('subdirectoryList');

    if (!parentPath) {
        subdirList.innerHTML = '<p style="color: var(--danger); margin: 0;">Please enter a parent folder path</p>';
        return;
    }

    subdirList.innerHTML = '<p style="color: var(--text-muted); margin: 0;">Scanning...</p>';

    try {
        const response = await fetch('/api/scan-subdirectories', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ parentPath })
        });

        const data = await response.json();

        if (!data.success) {
            subdirList.innerHTML = `<p style="color: var(--danger); margin: 0;">${data.message}</p>`;
            return;
        }

        if (data.subdirectories.length === 0) {
            subdirList.innerHTML = '<p style="color: var(--text-muted); margin: 0;">No subdirectories found</p>';
            return;
        }

        // Display subdirectories with checkboxes
        subdirList.innerHTML = `
            <div style="margin-bottom: 8px;">
                <strong>${data.subdirectories.length} subdirectories found</strong>
            </div>
            ${data.subdirectories.map((subdir, index) => {
            const folderName = subdir.split('\\').pop();
            const isAlreadyAdded = selectedLocalFolders.includes(subdir);
            return `
                    <label style="display: flex; align-items: center; padding: 6px; border-bottom: 1px solid var(--border); cursor: pointer;">
                        <input 
                            type="checkbox" 
                            class="subdir-checkbox" 
                            value="${subdir}"
                            ${isAlreadyAdded ? 'checked disabled' : ''}
                            style="margin-right: 8px;"
                        >
                        <span style="${isAlreadyAdded ? 'color: var(--text-muted); opacity: 0.6;' : ''}">
                            📁 ${folderName}
                            ${isAlreadyAdded ? '<span style="margin-left: 8px; font-size: 0.85em;">(already added)</span>' : ''}
                        </span>
                    </label>
                `;
        }).join('')}
            <button 
                onclick="addSelectedSubdirectories()" 
                class="btn btn-primary" 
                style="width: 100%; margin-top: 12px;"
            >
                Add Selected Folders
            </button>
        `;
    } catch (error) {
        subdirList.innerHTML = `<p style="color: var(--danger); margin: 0;">Error: ${error.message}</p>`;
    }
}

// Add selected subdirectories to folder list
async function addSelectedSubdirectories() {
    const checkboxes = document.querySelectorAll('.subdir-checkbox:checked:not([disabled])');
    const newFolders = Array.from(checkboxes).map(cb => cb.value);

    if (newFolders.length === 0) {
        return;
    }

    // Add to selectedLocalFolders
    newFolders.forEach(folder => {
        if (!selectedLocalFolders.includes(folder)) {
            selectedLocalFolders.push(folder);
        }
    });

    // Update display and reload all folders
    updateLocalFolderDisplay();
    for (let i = 0; i < selectedLocalFolders.length; i++) {
        await loadFilesFromFolder(selectedLocalFolders[i], i);
    }

    saveSettings();

    // Clear the subdirectory list and show success
    document.getElementById('subdirectoryList').innerHTML = `
        <p style="color: var(--success); margin: 0;">
            ✓ Added ${newFolders.length} folder${newFolders.length !== 1 ? 's' : ''}
        </p>
    `;

    // Clear parent path input
    document.getElementById('parentFolderPath').value = '';
    saveSettings();
}



// Load and display files from a local folder (creates collapsible sections)
async function loadFilesFromFolder(folderPath, folderIndex) {
    const docList = document.getElementById('documentList');

    // If first folder, clear the list
    if (folderIndex === 0) {
        docList.innerHTML = '';
    }

    try {
        const response = await fetch('/api/list-folder?path=' + encodeURIComponent(folderPath));
        const data = await response.json();

        // Also load progress for this folder
        const progressResponse = await fetch('/api/folder-progress?path=' + encodeURIComponent(folderPath));
        const progressData = await progressResponse.json();

        const folderName = folderPath.split('\\').pop() || folderPath;
        const fileCount = data.files ? data.files.length : 0;

        // Create collapsible folder section
        const folderSection = document.createElement('details');
        folderSection.className = 'folder-section';
        folderSection.open = selectedLocalFolders.length === 1; // Auto-open if only one folder
        folderSection.style.cssText = 'border: 1px solid var(--border); border-radius: 8px; margin-bottom: 12px; padding: 0;';

        // Create folder header
        const folderHeader = document.createElement('summary');
        folderHeader.style.cssText = 'padding: 12px; cursor: pointer; font-weight: 600; background: var(--bg-alt); border-radius: 8px; user-select: none; display: flex; justify-content: space-between; align-items: center;';
        folderHeader.innerHTML = `
            <div>
                📁 ${folderName}
                <span style="color: var(--text-muted); font-weight: normal; margin-left: 8px; font-size: 0.9em;">
                    (${fileCount} file${fileCount !== 1 ? 's' : ''})
                </span>
            </div>
            <button onclick="removeFolderAt(${folderIndex}); event.stopPropagation();" 
                    style="background: var(--danger); color: white; border: none; border-radius: 4px; padding: 4px 12px; cursor: pointer; font-size: 0.85em;">
                ✕ Remove
            </button>
        `;

        // Create folder content container
        const folderContent = document.createElement('div');
        folderContent.style.cssText = 'padding: 12px;';

        if (data.files && data.files.length > 0) {
            // Always show pipeline control section
            const pipelineDiv = document.createElement('div');
            pipelineDiv.className = 'pipeline-control';
            pipelineDiv.style.cssText = 'background: linear-gradient(135deg, #1e293b 0%, #334155 100%); border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; margin-bottom: 12px;';

            const completedSteps = progressData.success && progressData.summary ? progressData.summary.completedSteps : [];

            // Show progress checkmarks if any steps are complete
            let progressHtml = '';
            if (completedSteps.length > 0) {
                const stepLabels = {
                    'perplexity': '✅ Perplexity',
                    'perplexity_narration': '✅ Narration',
                    'audio_slides_parsed': '✅ Slides Parsed',
                    'audio_generated': '✅ Audio',
                    'notebooklm_notebook_created': '✅ Notebook',
                    'notebooklm_sources_uploaded': '✅ Sources',
                    'notebooklm_video_1_started': '✅ Video 1 Started',
                    'notebooklm_video_2_started': '✅ Video 2 Started',
                    'notebooklm_video_1_downloaded': '✅ Video 1 Done',
                    'notebooklm_video_2_downloaded': '✅ Video 2 Done'
                };
                progressHtml = completedSteps
                    .map(step => `<span style="color: #4caf50; font-size: 0.85em; margin-right: 8px;">${stepLabels[step] || step}</span>`)
                    .join('');
            } else {
                progressHtml = '<span style="color: var(--text-muted); font-size: 0.85em;">No progress yet - ready to start</span>';
            }

            // Build dropdown options based on server-provided available start points
            const availableStartPoints = progressData.availableStartPoints || [
                { key: 'start-fresh', label: '🚀 Start Fresh (Full Pipeline)' }
            ];
            const dropdownOptions = getStartPointOptionsHTML(availableStartPoints);
            const lastOption = availableStartPoints[availableStartPoints.length - 1].key;

            const dropdownId = `pipelineStartPoint_${folderIndex}`;
            pipelineDiv.innerHTML = `
                <div style="font-size: 0.9em; margin-bottom: 8px;">
                    <strong style="color: var(--text);">Pipeline Progress:</strong><br>
                    ${progressHtml}
                </div>
                <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                    <select id="${dropdownId}" data-folder="${folderPath}" onchange="syncDropdowns(this)" class="pipeline-start-point" style="flex: 1; min-width: 200px; padding: 8px; border-radius: 4px; border: 1px solid var(--primary); background: var(--bg); color: var(--text); font-size: 0.9em;">
                        ${dropdownOptions}
                    </select>
                    <button onclick="runPipelineForFolder('${folderPath.replace(/\\/g, '\\\\')}', '${dropdownId}')" class="btn btn-primary btn-small" style="white-space: nowrap;">
                        ▶ Run
                    </button>
                </div>
            `;
            folderContent.appendChild(pipelineDiv);

            // Set dropdown to last option after render (or sync with stored choice)
            setTimeout(() => {
                const dropdown = document.getElementById(dropdownId);
                if (dropdown) {
                    if (folderStartPoints[folderPath]) {
                        dropdown.value = folderStartPoints[folderPath];
                    } else {
                        dropdown.value = lastOption;
                        folderStartPoints[folderPath] = lastOption;
                    }
                }
            }, 50);

            // Show warning if perplexity output already exists
            if (data.warning) {
                const warningDiv = document.createElement('div');
                warningDiv.className = 'warning-banner';
                warningDiv.style.cssText = 'background: rgba(255, 193, 7, 0.15); border: 1px solid #ffc107; border-radius: 8px; padding: 10px 14px; margin-bottom: 12px; color: #ffc107; font-size: 0.9em;';
                warningDiv.innerHTML = `⚠ ${data.warning}`;
                folderContent.appendChild(warningDiv);
            }

            // File list (show first 5, sleeker display)
            const filesToShow = data.files.slice(0, 5);
            filesToShow.forEach(file => {
                const item = document.createElement('div');
                item.style.cssText = 'padding: 2px 0; color: var(--text-muted); font-size: 0.85em; font-family: monospace;';
                item.innerHTML = `<span style="opacity: 0.5;">•</span> ${file}`;
                folderContent.appendChild(item);
            });

            if (data.files.length > 5) {
                const moreItem = document.createElement('div');
                moreItem.style.cssText = 'padding: 4px 0; color: var(--text-muted); font-size: 0.9em; font-style: italic;';
                moreItem.textContent = `... and ${data.files.length - 5} more files`;
                folderContent.appendChild(moreItem);
            }
        } else {
            folderContent.innerHTML = '<p style="color: var(--text-muted); margin: 0;">No supported files found</p>';
        }

        folderSection.appendChild(folderHeader);
        folderSection.appendChild(folderContent);
        docList.appendChild(folderSection);

    } catch (error) {
        console.error('Error loading files:', error);
        const errorDiv = document.createElement('div');
        errorDiv.style.cssText = 'padding: 12px; color: var(--danger); border: 1px solid var(--danger); border-radius: 8px; margin-bottom: 12px;';
        errorDiv.textContent = `Error loading ${folderPath}: ${error.message}`;
        docList.appendChild(errorDiv);
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
        const response = await fetch('/api/get-settings');
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
            document.getElementById('outputDir').value = settings.outputDir || '';
            document.getElementById('headlessMode').checked = settings.headlessMode === true;
            document.getElementById('deleteConversation').checked = settings.deleteConversation === true;
            document.getElementById('keepOpen').checked = settings.keepOpen === true;
            document.getElementById('perplexityModel').value = settings.perplexityModel || 'Best';
            document.getElementById('audioNarrationPerplexityModel').value = settings.audioNarrationPerplexityModel || 'Best';

            // Load audio generation settings
            document.getElementById('audioNarrationPrompt').value = settings.audioNarrationPrompt || '';
            document.getElementById('googleStudioModel').value = settings.googleStudioModel || '';
            document.getElementById('googleStudioVoice').value = settings.googleStudioVoice || '';
            document.getElementById('googleStudioStyleInstructions').value = settings.googleStudioStyleInstructions || '';

            // Load delays (convert ms to seconds for UI)
            if (settings.delays) {
                if (settings.delays.betweenVideoStartsMs) document.getElementById('betweenVideoStartsMs').value = settings.delays.betweenVideoStartsMs / 1000;
                if (settings.delays.betweenAudioSlidesMs) document.getElementById('betweenAudioSlidesMs').value = settings.delays.betweenAudioSlidesMs / 1000;
                if (settings.delays.videoCheckIntervalMs) document.getElementById('videoCheckIntervalMs').value = settings.delays.videoCheckIntervalMs / 1000;
                if (settings.delays.maxWaitForVideoMs) document.getElementById('maxWaitForVideoMs').value = settings.delays.maxWaitForVideoMs / 1000;
            }

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
        const response = await fetch('/api/get-settings');
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
        keepOpen: document.getElementById('keepOpen').checked,
        perplexityModel: document.getElementById('perplexityModel').value,
        audioNarrationPerplexityModel: document.getElementById('audioNarrationPerplexityModel').value,
        audioNarrationPrompt: document.getElementById('audioNarrationPrompt').value,
        googleStudioModel: document.getElementById('googleStudioModel').value,
        googleStudioVoice: document.getElementById('googleStudioVoice').value,
        googleStudioStyleInstructions: document.getElementById('googleStudioStyleInstructions').value,
        // Convert seconds from UI to milliseconds for backend
        delays: {
            betweenVideoStartsMs: (parseInt(document.getElementById('betweenVideoStartsMs').value) || 300) * 1000,
            betweenAudioSlidesMs: (parseInt(document.getElementById('betweenAudioSlidesMs').value) || 120) * 1000,
            videoCheckIntervalMs: (parseInt(document.getElementById('videoCheckIntervalMs').value) || 60) * 1000,
            maxWaitForVideoMs: (parseInt(document.getElementById('maxWaitForVideoMs').value) || 600) * 1000
        }
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
        'perplexityModel',
        'betweenVideoStartsMs',
        'betweenAudioSlidesMs',
        'videoCheckIntervalMs',
        'maxWaitForVideoMs'
    ];

    inputIds.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            // Save on blur (when user leaves the field)
            element.addEventListener('blur', () => {
                saveCommonSettings();
            });
            // Also save on change for checkboxes
            if (element.type === 'checkbox') {
                element.addEventListener('change', () => {
                    saveCommonSettings();
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

        // Route based on standardized starting point keys from ProgressTracker.ts
        if (startPoint === 'create-notebook') {
            await skipToNotebookLM();
            return;
        } else if (startPoint === 'fire-video-1' || startPoint === 'fire-video-2') {
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

// Update audio start options based on folder progress (DEPRECATED)
async function updateAudioStartOptions(folderPath) {
    // Logic moved to unified pipeline UI
    return;
}



// Keep saveSettings as an alias for compatibility
async function saveSettings() {
    await saveCommonSettings();
}

// Check audio progress for selected folders
async function checkAudioProgress() {
    const sourceFolderInput = document.getElementById('sourceFolder').value;
    if (!sourceFolderInput) {
        return;
    }

    // Split by semicolon to support multiple folders
    const folders = sourceFolderInput.split(';').map(f => f.trim()).filter(f => f);

    if (folders.length === 0) {
        document.getElementById('audioProgressSection').style.display = 'none';
        return;
    }

    try {
        const response = await fetch('/api/check-audio-progress', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folders })
        });

        const result = await response.json();

        if (result.success && result.folders) {
            displayAudioProgress(result.folders);
        }
    } catch (error) {
        console.error('Failed to check audio progress:', error);
    }
}

// Display audio progress with expandable folders
// NOTE: This is now handled by the unified collapsible folder UI in loadFilesFromFolder
// This function is kept for backward compatibility but doesn't create duplicate displays
function displayAudioProgress(folders) {
    // Skip - the unified folder UI already shows pipeline progress
    // The collapsible folder sections in loadFilesFromFolder handle both video and audio steps
    return;

    folders.forEach((folder, index) => {
        // Create audio progress container for this folder
        const audioProgressDiv = document.createElement('div');
        audioProgressDiv.className = 'audio-pipeline-progress';
        audioProgressDiv.style.cssText = 'background: linear-gradient(135deg, #1e293b 0%, #334155 100%); border: 1px solid var(--border); border-radius: 0.5rem; padding: 1rem; margin-top: 1rem;';

        const audioStartOptions = getAudioStartOptions(folder.audioStage);
        const stageBadge = getAudioStageBadge(folder.audioStage);

        // Build progress checkmarks
        const stages = [
            { label: 'Perplexity Prompt', done: folder.audioStage !== 'not-started' },
            { label: 'NotebookLM Created', done: folder.audioStage !== 'not-started' },
            { label: 'Sources Uploaded', done: folder.audioStage !== 'not-started' },
            { label: 'Video Shared', done: folder.audioStage !== 'not-started' },
            { label: 'Narration Generated', done: folder.audioStage === 'narration-generated' || folder.audioStage === 'audio-generated' || folder.audioStage === 'complete' },
            { label: 'Audio Generated', done: folder.audioStage === 'audio-generated' || folder.audioStage === 'complete' }
        ];

        const stagesHTML = stages.map(stage =>
            `<span style="color: ${stage.done ? 'var(--success)' : 'var(--text-muted)'};">
                ${stage.done ? '✅' : '⬜'} ${stage.label}
            </span>`
        ).join('  ');

        audioProgressDiv.innerHTML = `
            <div style="margin-bottom: 0.75rem;">
                <strong style="color: var(--text); font-size: 0.95rem;">📁 ${folder.folderName}</strong>
                <span style="margin-left: 1rem; padding: 0.25rem 0.75rem; background: var(--${folder.audioStage === 'complete' ? 'success' : folder.audioStage === 'not-started' ? 'border' : 'warning'}); color: white; border-radius: 1rem; font-size: 0.75rem; font-weight: 600;">${stageBadge}</span>
            </div>
            <div style="font-size: 0.85rem; margin-bottom: 0.75rem; line-height: 1.8;">
                ${stagesHTML}
            </div>
            ${folder.audioStage !== 'complete' ? `
                <div style="display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap; padding-top: 0.75rem; border-top: 1px solid var(--border);">
                    <label style="font-size: 0.85rem; font-weight: 500; color: var(--text-muted);">Start pipeline from:</label>
                    <select id="audio-start-${index}" style="flex: 1; min-width: 200px; max-width: 300px; padding: 0.5rem; background: var(--bg-input); border: 1px solid var(--border); border-radius: 0.375rem; color: var(--text);">
                        ${audioStartOptions}
                    </select>
                    <button onclick="testAudioForFolder('${folder.folderPath.replace(/\\/g, '\\\\')}', ${index})" class="btn btn-secondary btn-small">
                        🎙️ Test Audio
                    </button>
                </div>
            ` : `
                <div style="padding-top: 0.75rem; border-top: 1px solid var(--border); color: var(--success); font-weight: 500;">
                    ✅ Audio pipeline complete for this folder
                </div>
            `}
            ${folder.files && folder.files.length > 0 ? `
                <details style="margin-top: 0.75rem;">
                    <summary style="cursor: pointer; font-size: 0.85rem; color: var(--text-muted); user-select: none;">📄 View files (${folder.files.length})</summary>
                    <div style="margin-top: 0.5rem; padding: 0.5rem; background: var(--bg); border-radius: 0.375rem; font-size: 0.8rem;">
                        ${folder.files.map(file => `<div style="padding: 0.25rem 0; color: var(--text-muted);">• ${file}</div>`).join('')}
                    </div>
                </details>
            ` : ''}
        `;

        container.appendChild(audioProgressDiv);
    });
}

// Get audio start options based on current stage
function getAudioStartOptions(stage) {
    const options = [];

    if (stage === 'complete' || stage === 'audio-generated') {
        options.push('<option value="do-not-process" selected>Do Not Process (Already Complete)</option>');
        options.push('<option value="regenerate-all">Regenerate All</option>');
        options.push('<option value="regenerate-audio">Regenerate Audio Files Only</option>');
    } else if (stage === 'narration-generated') {
        options.push('<option value="skip-to-audio-generation" selected>Skip to Audio Generation</option>');
        options.push('<option value="regenerate-all">Regenerate All</option>');
    } else {
        options.push('<option value="generate-narration-audio" selected>Generate Narration + Audio</option>');
    }

    return options.join('');
}

// Test audio pipeline for specific folder
async function testAudioForFolder(folderPath, folderIndex) {
    const audioStartPoint = document.getElementById(`audio-start-${folderIndex}`).value;
    const activeProfile = document.getElementById('activeProfile').value;

    // Show progress section
    document.getElementById('progressSection').style.display = 'block';
    document.getElementById('progressLog').innerHTML = '';

    addLogEntry(`🎙️ Starting Audio Pipeline for: ${folderPath}`);
    addLogEntry(`📍 Start point: ${audioStartPoint}`);
    updateStatus('testing');

    try {
        const googleStudioModel = document.getElementById('googleStudioModel').value;
        const googleStudioVoice = document.getElementById('googleStudioVoice').value;
        const googleStudioStyleInstructions = document.getElementById('googleStudioStyleInstructions').value;

        const response = await fetch('/api/generate-audio', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sourceFolder: folderPath,
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

            // Refresh audio progress
            await checkAudioProgress();
        } else {
            addLogEntry(`❌ Error: ${result.message}`, 'error');
            if (result.details?.steps) {
                result.details.steps.forEach(step => addLogEntry(step));
            }
        }

        updateStatus('idle');

    } catch (error) {
        addLogEntry(`❌ Request failed: ${error.message}`, 'error');
        updateStatus('idle');
    }
}


// Toggle folder expansion
function toggleFolder(index) {
    const content = document.getElementById(`folder-content-${index}`);
    if (content) {
        content.classList.toggle('collapsed');
    }
}

// Get audio stage badge text
function getAudioStageBadge(stage) {
    switch (stage) {
        case 'complete': return 'Complete';
        case 'audio-generated': return 'Audio Generated';
        case 'narration-generated': return 'Narration Ready';
        default: return 'Not Started';
    }
}

// Get audio stage progress elements
function getAudioStageElements(stage) {
    const stages = [
        { id: 'narration', label: '✓ Narration Generated', class: stage === 'not-started' ? 'pending' : 'complete' },
        { id: 'audio', label: stage === 'audio-generated' || stage === 'complete' ? '✓ Audio Generated' : '⏳ Generating Audio...', class: stage === 'complete' || stage === 'audio-generated' ? 'complete' : (stage === 'narration-generated' ? 'in-progress' : 'pending') },
        { id: 'complete', label: stage === 'complete' ? '✓ Audio Complete' : 'Audio Complete', class: stage === 'complete' ? 'complete' : 'pending' }
    ];

    return stages.map(s => `<div class="stage ${s.class}">${s.label}</div>`).join('');
}

// Call checkAudioProgress when source folder changes
const originalUpdateAudioStartOptions = window.updateAudioStartOptions || function () { };
window.updateAudioStartOptions = function (folderPath) {
    originalUpdateAudioStartOptions(folderPath);
    checkAudioProgress();
};

// ========== BATCH PROCESSING FUNCTIONS ==========

// Load available profiles for batch processing
async function loadBatchProfiles() {
    try {
        const response = await fetch('/api/profiles');
        const data = await response.json();

        const container = document.getElementById('batchProfileSelector');
        if (!container) return;

        if (data.success && data.profiles.length > 0) {
            container.innerHTML = data.profiles.map(profile => `
                <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
                    <input type="checkbox" name="batchProfile" value="${profile}" checked>
                    <span>${profile}</span>
                </label>
            `).join('');
        } else {
            container.innerHTML = '<p style="color: var(--text-muted); font-style: italic;">No profiles configured</p>';
        }

        updateBatchButtons();
    } catch (error) {
        console.error('Failed to load profiles:', error);
    }
}

// Helper to generate start point options consistently
function getStartPointOptionsHTML(availablePoints) {
    if (!availablePoints || availablePoints.length === 0) {
        return '<option value="start-fresh">Start Fresh</option>';
    }
    return availablePoints.map(point =>
        `<option value="${point.key}">${point.label}</option>`
    ).join('');
}

// Update batch folder list display with start point dropdowns
function updateBatchFolderList() {
    const container = document.getElementById('batchFolderList');
    if (!container) return;

    if (selectedLocalFolders.length === 0) {
        container.innerHTML = '<p style="color: var(--text-muted); font-style: italic;">Add folders using "📂 Add Folder" above</p>';
    } else {
        container.innerHTML = selectedLocalFolders.map((folder, index) => {
            const folderName = folder.split('\\').pop() || folder;
            return `
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 0.5rem; border-bottom: 1px solid var(--border); gap: 0.5rem;">
                    <span style="flex: 1; overflow: hidden; text-overflow: ellipsis;">📁 ${folderName}</span>
                    <select id="startPoint_${index}" onchange="syncDropdowns(this)" class="batch-start-point" data-folder="${folder}" style="padding: 0.25rem; font-size: 0.8rem; min-width: 140px;">
                        <option value="">⏳ Loading options...</option>
                        <option value="start-fresh">Start Fresh</option>
                    </select>
                    <button onclick="removeBatchFolder(${index})" class="btn btn-danger" style="padding: 0.25rem 0.5rem; font-size: 0.8rem;">✕</button>
                </div>
            `;
        }).join('');

        // Fetch available start points for each folder
        loadFolderStartPoints();
    }

    updateBatchButtons();
}

// Load available start points for each folder based on progress
async function loadFolderStartPoints() {
    try {
        const response = await fetch('/api/folder-start-points', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folders: selectedLocalFolders })
        });

        const data = await response.json();
        if (data.success && data.startPoints) {
            // Update each dropdown with available options
            // Use index to find dropdown since folder paths have backslash escaping issues
            selectedLocalFolders.forEach((folderPath, index) => {
                const availablePoints = data.startPoints[folderPath];
                const dropdown = document.getElementById(`startPoint_${index}`);

                if (dropdown && availablePoints && availablePoints.length > 0) {
                    dropdown.innerHTML = getStartPointOptionsHTML(availablePoints);
                    // Use stored choice if available, otherwise use the last (most advanced) option
                    if (folderStartPoints[folderPath]) {
                        dropdown.value = folderStartPoints[folderPath];
                    } else {
                        const lastKey = availablePoints[availablePoints.length - 1].key;
                        dropdown.value = lastKey;
                        folderStartPoints[folderPath] = lastKey;
                    }
                }
            });
        }
    } catch (error) {
        console.error('Failed to load folder start points:', error);
    }
}

// Sync dropdown values between different sections for the SAME folder
function syncDropdowns(changedEl) {
    const folderPath = changedEl.dataset.folder;
    if (!folderPath) return;

    const newValue = changedEl.value;
    folderStartPoints[folderPath] = newValue; // Save to global state
    console.log(`Syncing dropdowns for ${folderPath} to ${newValue}`);

    // Find all other dropdowns for the same folder
    const selectors = [
        `select.pipeline-start-point`,
        `select.batch-start-point`
    ];

    selectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(dropdown => {
            if (dropdown !== changedEl && dropdown.dataset.folder === folderPath) {
                dropdown.value = newValue;
            }
        });
    });
}

// Remove a folder from batch list
function removeBatchFolder(index) {
    selectedLocalFolders.splice(index, 1);
    updateLocalFolderDisplay();
    updateBatchFolderList();
}

// Get selected profiles for batch
function getSelectedBatchProfiles() {
    const checkboxes = document.querySelectorAll('input[name="batchProfile"]:checked');
    return Array.from(checkboxes).map(cb => cb.value);
}

// Update batch button states
function updateBatchButtons() {
    const selectedProfiles = getSelectedBatchProfiles();
    const hasFolders = selectedLocalFolders.length > 0;
    const hasProfiles = selectedProfiles.length > 0;

    const startBtn = document.getElementById('startBatchBtn');
    const fireBtn = document.getElementById('fireOnlyBtn');

    if (startBtn) startBtn.disabled = !hasFolders || !hasProfiles;
    if (fireBtn) fireBtn.disabled = !hasFolders || !hasProfiles;
}

// Start full batch processing
async function startBatchProcessing() {
    const selectedProfiles = getSelectedBatchProfiles();

    if (selectedLocalFolders.length === 0) {
        alert('Please add at least one folder');
        return;
    }

    if (selectedProfiles.length === 0) {
        alert('Please select at least one profile');
        return;
    }

    // Collect folders with their start points
    const folders = selectedLocalFolders.map((folderPath, index) => {
        const dropdown = document.getElementById(`startPoint_${index}`);
        const startPoint = dropdown ? dropdown.value : 'start-fresh';
        return { path: folderPath, startPoint };
    });

    try {
        document.getElementById('startBatchBtn').disabled = true;
        document.getElementById('fireOnlyBtn').disabled = true;
        document.getElementById('abortBatchBtn').style.display = 'inline-block';
        document.getElementById('batchStatusContainer').style.display = 'block';
        document.getElementById('batchLogContainer').style.display = 'block';

        const response = await fetch('/api/batch/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folders, selectedProfiles })
        });

        const data = await response.json();

        if (data.success) {
            addBatchLog(`Started batch processing: ${data.folderCount} folders with profiles: ${data.profiles.join(', ')}`);
        } else {
            addBatchLog(`Error: ${data.error || data.message}`, 'error');
            resetBatchButtons();
        }
    } catch (error) {
        addBatchLog(`Error: ${error.message}`, 'error');
        resetBatchButtons();
    }
}

// Start fire phase only
async function startFirePhase() {
    const folders = selectedLocalFolders;
    const selectedProfiles = getSelectedBatchProfiles();

    if (folders.length === 0 || selectedProfiles.length === 0) {
        alert('Please add folders and select profiles');
        return;
    }

    try {
        document.getElementById('fireOnlyBtn').disabled = true;
        document.getElementById('abortBatchBtn').style.display = 'inline-block';
        document.getElementById('batchStatusContainer').style.display = 'block';
        document.getElementById('batchLogContainer').style.display = 'block';

        const response = await fetch('/api/batch/fire', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folders, selectedProfiles })
        });

        const data = await response.json();

        if (data.success) {
            addBatchLog(`Fire phase started: ${data.folderCount} folders`);
        } else {
            addBatchLog(`Error: ${data.error || data.message}`, 'error');
            resetBatchButtons();
        }
    } catch (error) {
        addBatchLog(`Error: ${error.message}`, 'error');
        resetBatchButtons();
    }
}

// Start collect phase only
async function startCollectPhase() {
    try {
        document.getElementById('collectOnlyBtn').disabled = true;
        document.getElementById('abortBatchBtn').style.display = 'inline-block';
        document.getElementById('batchStatusContainer').style.display = 'block';
        document.getElementById('batchLogContainer').style.display = 'block';

        const response = await fetch('/api/batch/collect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folders: selectedLocalFolders })
        });

        const data = await response.json();

        if (data.success) {
            addBatchLog('Collect phase started');
        } else {
            addBatchLog(`Error: ${data.error || data.message}`, 'error');
        }
    } catch (error) {
        addBatchLog(`Error: ${error.message}`, 'error');
    } finally {
        document.getElementById('collectOnlyBtn').disabled = false;
    }
}

// Abort batch processing
async function abortBatch() {
    try {
        const response = await fetch('/api/batch/abort', {
            method: 'POST'
        });

        const data = await response.json();
        addBatchLog(`Abort: ${data.message}`);
    } catch (error) {
        addBatchLog(`Error aborting: ${error.message}`, 'error');
    }
}

// Reset batch processing state (for stuck state recovery)
async function resetBatch() {
    if (!confirm('This will reset the batch processing state. Use this if processing got stuck. Continue?')) {
        return;
    }

    try {
        const response = await fetch('/api/batch/reset', {
            method: 'POST'
        });

        const data = await response.json();
        addBatchLog(`Reset: ${data.message}`);
        resetBatchButtons();
    } catch (error) {
        addBatchLog(`Error resetting: ${error.message}`, 'error');
    }
}

// Reset batch button states
function resetBatchButtons() {
    document.getElementById('startBatchBtn').disabled = false;
    document.getElementById('fireOnlyBtn').disabled = false;
    document.getElementById('collectOnlyBtn').disabled = false;
    document.getElementById('abortBatchBtn').style.display = 'none';
    updateBatchButtons();
}

// Add entry to batch log
function addBatchLog(message, type = 'info') {
    const logEl = document.getElementById('batchLog');
    if (!logEl) return;

    const time = new Date().toLocaleTimeString();
    const colorClass = type === 'error' ? 'color: var(--danger);' : '';

    logEl.innerHTML += `<div style="${colorClass}">[${time}] ${message}</div>`;
    logEl.scrollTop = logEl.scrollHeight;
}

// Update batch status table
function updateBatchStatusTable(statuses) {
    const tbody = document.getElementById('batchStatusBody');
    if (!tbody) return;

    const statusIcons = {
        'pending': '⏳',
        'video_generating': '🎬',
        'video_ready': '✅',
        'downloading': '📥',
        'audio_generating': '🎙️',
        'complete': '✓',
        'error': '❌'
    };

    tbody.innerHTML = statuses.map(folder => {
        const elapsed = folder.elapsedMs ? formatElapsedTime(folder.elapsedMs) : '-';
        const icon = statusIcons[folder.status] || '❓';

        return `
            <tr style="border-bottom: 1px solid var(--border);">
                <td style="padding: 0.5rem;">${folder.folderName}</td>
                <td style="padding: 0.5rem;">${folder.profileId || '-'}</td>
                <td style="padding: 0.5rem; text-align: center;">${icon} ${folder.status}</td>
                <td style="padding: 0.5rem; text-align: right;">${elapsed}</td>
            </tr>
        `;
    }).join('');
}

// Format elapsed time
function formatElapsedTime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
        return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    } else {
        return `${seconds}s`;
    }
}

// Socket.IO event listeners for batch processing
socket.on('batch-status', (data) => {
    if (data.statuses) {
        updateBatchStatusTable(data.statuses);
    }
});

socket.on('batch-log', (data) => {
    addBatchLog(data.message);
});

socket.on('batch-complete', (data) => {
    addBatchLog(`Batch complete: ${data.completed}/${data.totalFolders} succeeded, ${data.failed} failed`);
    resetBatchButtons();
});

socket.on('batch-fire-complete', (data) => {
    addBatchLog(`Fire phase complete: ${data.message}`);
    resetBatchButtons();
});

socket.on('batch-collect-complete', (data) => {
    addBatchLog(`Collect phase complete: ${data.message}`);
    resetBatchButtons();
});

socket.on('batch-error', (data) => {
    addBatchLog(`Batch error: ${data.error}`, 'error');
    resetBatchButtons();
});

// Listen for individual pipeline step completion (single folder mode)
socket.on('pipeline-step-complete', async (data) => {
    if (data.folderPath) {
        console.log(`Step ${data.step} completed for ${data.folderPath}`);
        // Find index if needed, but loadFilesFromFolder handles regex ID matching usually
        // We iterate to find the index of this folder in selectedLocalFolders
        const index = selectedLocalFolders.indexOf(data.folderPath);
        if (index !== -1) {
            await loadFilesFromFolder(data.folderPath, index);
        }
    }
});

// Initialize batch processing on page load
document.addEventListener('DOMContentLoaded', () => {
    loadBatchProfiles();

    // Hook into folder selection to update batch list
    const originalUpdateLocalFolderDisplay = window.updateLocalFolderDisplay;
    window.updateLocalFolderDisplay = function () {
        originalUpdateLocalFolderDisplay.call(this);
        updateBatchFolderList();
    };

    // Add change listener to profile checkboxes
    document.getElementById('batchProfileSelector')?.addEventListener('change', updateBatchButtons);
});
