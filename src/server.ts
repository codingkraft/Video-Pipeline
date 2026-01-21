import express, { Request, Response } from 'express';
import { VideoPipeline, PipelineInput } from './workflow/VideoPipeline';
import * as fs from 'fs';
import * as path from 'path';
import { Server as SocketIOServer } from 'socket.io';
import { createServer } from 'http';
import multer from 'multer';

const app = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer);

const PORT = 3002;

// Configure multer for file uploads
// Configure multer with disk storage to preserve filenames
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(process.cwd(), 'temp_uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        // Use original filename so Perplexity sees the correct context
        cb(null, file.originalname);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit
});

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Store active pipeline
let pipeline: VideoPipeline | null = null;
let isProcessing = false;

// Initialize pipeline
async function initPipeline() {
    if (!pipeline) {
        pipeline = new VideoPipeline(2);
        await pipeline.initialize();
    }
}

// API: Get documents from folder
app.post('/api/scan-folder', (req: Request, res: Response) => {
    try {
        const { folderPath } = req.body;

        if (!fs.existsSync(folderPath)) {
            return res.status(400).json({ error: 'Folder does not exist' });
        }

        const files = fs.readdirSync(folderPath);
        const documents = files
            .filter(file => {
                const ext = path.extname(file).toLowerCase();
                return ['.pdf', '.txt', '.md', '.doc', '.docx'].includes(ext);
            })
            .map(file => ({
                name: file,
                path: path.join(folderPath, file),
                size: fs.statSync(path.join(folderPath, file)).size,
            }));

        res.json({ documents });
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

// API: Start video generation
app.post('/api/generate-video', upload.array('documents', 50), async (req: Request, res: Response) => {
    try {
        if (isProcessing) {
            return res.status(400).json({ error: 'Already processing a video' });
        }

        const files = req.files as Express.Multer.File[];
        if (!files || files.length === 0) {
            return res.status(400).json({ error: 'No documents uploaded' });
        }

        const {
            perplexityChatUrl,
            promptText,
            notebookLmChatSettings,
            notebookLmStyleSettings,
            stylePrompt,
            outputDir
        } = req.body;

        isProcessing = true;
        const jobId = `video_${Date.now()}`;

        // Send immediate response
        res.json({ jobId, message: 'Video generation started' });

        // Initialize pipeline if needed
        await initPipeline();

        const input: PipelineInput = {
            id: jobId,
            documentPaths: files.map(f => f.path),
            stylePrompt: stylePrompt || 'Professional with smooth transitions',
            customVideoPrompt: promptText || undefined,
            chatSettings: {
                customInstructions: notebookLmChatSettings || 'Focus on key concepts and provide clear explanations',
            },
            outputDir: outputDir || path.join(process.cwd(), 'output', jobId),
        };

        // Add perplexity URL and notebookLM style to input if needed
        (input as any).perplexityChatUrl = perplexityChatUrl;
        (input as any).notebookLmStyleSettings = notebookLmStyleSettings;

        // Emit progress updates via Socket.IO
        io.emit('progress', { jobId, step: 'started', message: 'Initializing pipeline...' });

        // Process video
        const result = await pipeline!.processVideo(input);

        // Cleanup uploaded files
        files.forEach(f => {
            try {
                fs.unlinkSync(f.path);
            } catch (e) {
                console.error('Failed to delete temp file:', f.path);
            }
        });

        if (result.success) {
            io.emit('progress', { jobId, step: 'completed', outputPath: result.outputVideoPath });
        } else {
            io.emit('progress', { jobId, step: 'failed', error: result.error });
        }

        isProcessing = false;

    } catch (error) {
        isProcessing = false;
        io.emit('progress', {
            jobId: 'unknown',
            step: 'failed',
            error: (error as Error).message
        });
    }
});

// API: Get processing status
app.get('/api/status', (req: Request, res: Response) => {
    res.json({ isProcessing });
});

// API: Open browser for login
app.post('/api/login', async (req: Request, res: Response) => {
    try {
        const { profileId } = req.body;

        if (!pipeline) {
            pipeline = new VideoPipeline(2);
        }

        // Initialize with the selected profile
        await pipeline.initialize({ profileId: profileId || 'default' });

        // Give browser a moment to fully initialize after profile switch
        await new Promise(resolve => setTimeout(resolve, 500));

        const services = {
            perplexity: 'https://www.perplexity.ai/',
            notebooklm: 'https://notebooklm.google.com/',
            gemini: 'https://gemini.google.com/',
        };

        const browser = (pipeline as any).browser;

        // Open each service
        for (const [name, url] of Object.entries(services)) {
            await browser.getPage(name, url);
            await browser.randomDelay(1000, 2000);
        }

        res.json({ message: `Browser opened for login with ${profileId || 'default'} profile. Please log into all services.` });

        // Notify via socket
        io.emit('login-status', { status: 'opened', message: 'Browser opened. Please log in to all services.' });

    } catch (error) {
        console.error('Error in /api/login:', error);
        res.status(500).json({ error: (error as Error).message });
    }
});

// API: Verify sessions
app.get('/api/verify-sessions', async (req: Request, res: Response) => {
    try {
        if (!pipeline) {
            return res.json({
                verified: false,
                message: 'Pipeline not initialized. Click "Setup Login" first.',
                sessions: {}
            });
        }

        const browser = (pipeline as any).browser;

        // Check if browser is still connected
        if (!browser || !browser.getBrowser() || !browser.getBrowser().isConnected()) {
            return res.json({
                verified: false,
                message: 'Browser closed. Sessions saved but need to restart pipeline.',
                sessions: {},
                needsRestart: true
            });
        }

        const sessionStatus: any = {};

        // Check each service
        const services = {
            perplexity: 'https://www.perplexity.ai/',
            notebooklm: 'https://notebooklm.google.com/',
            gemini: 'https://gemini.google.com/',
        };

        for (const [name, url] of Object.entries(services)) {
            try {
                const page = await browser.getPage(name, url);
                await browser.randomDelay(1000, 1500);

                // Check for login indicators
                const currentUrl = page.url();
                const hasLoginKeywords = currentUrl.includes('login') ||
                    currentUrl.includes('signin') ||
                    currentUrl.includes('auth') ||
                    currentUrl.includes('accounts.google');

                sessionStatus[name] = {
                    loggedIn: !hasLoginKeywords,
                    url: currentUrl
                };
            } catch (error) {
                sessionStatus[name] = {
                    loggedIn: false,
                    error: (error as Error).message
                };
            }
        }

        const allLoggedIn = Object.values(sessionStatus).every((s: any) => s.loggedIn);

        res.json({
            verified: allLoggedIn,
            sessions: sessionStatus,
            message: allLoggedIn ? 'All sessions verified!' : 'Some services require login'
        });

    } catch (error) {
        res.status(500).json({
            verified: false,
            message: 'Error checking sessions: ' + (error as Error).message,
            sessions: {}
        });
    }
});

// API: Open Folder Picker (Windows - MODERN dialog with Quick Access)
app.get('/api/browse-folder', async (req: Request, res: Response) => {
    try {
        const { exec } = require('child_process');

        // Use OpenFileDialog which shows the MODERN Windows Explorer UI with Quick Access
        // User navigates to folder, sees "Select This Folder" in filename, clicks Open
        // We extract the directory path from the selected "file"
        const cmd = `powershell -STA -NoProfile -ExecutionPolicy Bypass -Command "& { Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::EnableVisualStyles(); $d = New-Object System.Windows.Forms.OpenFileDialog; $d.Title = 'Navigate to folder - then click Open'; $d.CheckFileExists = $false; $d.CheckPathExists = $true; $d.FileName = 'Select This Folder'; $d.Filter = 'Folders|*.*'; $d.ValidateNames = $false; $d.InitialDirectory = [Environment]::GetFolderPath('Desktop'); if ($d.ShowDialog() -eq 'OK') { Split-Path -Parent $d.FileName } }"`;

        console.log('Opening modern folder picker...');

        exec(cmd, { timeout: 120000 }, (error: any, stdout: string, stderr: string) => {
            if (error) {
                console.error('Picker error:', error.message);
                console.error('Picker stderr:', stderr);
                return res.json({ path: null, cancelled: true });
            }
            const selectedPath = stdout.trim();
            console.log('Selected folder:', selectedPath || '(empty - user cancelled?)');
            res.json({ path: selectedPath || null });
        });
    } catch (e) {
        console.error('Browse folder error:', e);
        res.status(500).json({ error: (e as Error).message });
    }
});

// API: Open File Picker (for selecting .md or .docx files)
app.get('/api/browse-file', async (req: Request, res: Response) => {
    try {
        const { exec } = require('child_process');

        // Open file dialog for markdown and docx files
        const cmd = `powershell -STA -NoProfile -ExecutionPolicy Bypass -Command "& { Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::EnableVisualStyles(); $d = New-Object System.Windows.Forms.OpenFileDialog; $d.Title = 'Select Script File'; $d.Filter = 'Script Files|*.md;*.docx|Markdown Files|*.md|Word Documents|*.docx|All Files|*.*'; $d.InitialDirectory = [Environment]::GetFolderPath('Desktop'); if ($d.ShowDialog() -eq 'OK') { $d.FileName } }"`;

        console.log('Opening file picker...');

        exec(cmd, { timeout: 120000 }, (error: any, stdout: string, stderr: string) => {
            if (error) {
                console.error('Picker error:', error.message);
                return res.json({ path: null, cancelled: true });
            }
            const selectedPath = stdout.trim();
            console.log('Selected file:', selectedPath || '(empty - user cancelled?)');
            res.json({ path: selectedPath || null });
        });
    } catch (e) {
        console.error('Browse file error:', e);
        res.status(500).json({ error: (e as Error).message });
    }
});

// API: Open folder in Windows Explorer
app.post('/api/open-folder', async (req: Request, res: Response) => {
    try {
        const { exec } = require('child_process');
        const { path: folderPath } = req.body;

        if (!folderPath) {
            return res.status(400).json({ error: 'path is required' });
        }

        // Open folder in Explorer
        exec(`explorer "${folderPath}"`, (error: any) => {
            if (error) {
                console.warn('Could not open folder:', error.message);
            }
        });

        res.json({ success: true });
    } catch (e) {
        console.error('Open folder error:', e);
        res.status(500).json({ error: (e as Error).message });
    }
});

// API: List files in a folder
app.get('/api/list-folder', (req: Request, res: Response) => {
    const folderPath = req.query.path as string;

    if (!folderPath) {
        return res.status(400).json({ error: 'Path is required' });
    }

    if (!fs.existsSync(folderPath)) {
        return res.status(404).json({ error: 'Folder not found' });
    }

    try {
        const files = fs.readdirSync(folderPath)
            .filter(f => /\.(pdf|txt|md|docx?|jpe?g|png|gif|webp|bmp)$/i.test(f));

        // Check if perplexity output already exists
        const outputDir = path.join(folderPath, 'output');
        const perplexityOutputExists = fs.existsSync(path.join(outputDir, 'perplexity_response.txt'));

        res.json({
            files,
            perplexityOutputExists,
            warning: perplexityOutputExists ? 'Perplexity prompt already generated for this folder' : null
        });
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

// API: Test Perplexity workflow
app.post('/api/test-perplexity', upload.array('files', 10), async (req: Request, res: Response) => {
    try {
        const { PerplexityTester } = await import('./services/PerplexityTester');

        const files = req.files as Express.Multer.File[];
        const { chatUrl, prompt, outputDir, sourceFolder, headless, deleteConversation, model } = req.body;

        console.log(`Received test request. Files: ${files ? files.length : 0}. Model: ${model || 'Default'}`);

        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }

        const tester = new PerplexityTester();

        // ... (file resolution logic is unchanged, keeping this concise in thought, but I must replace correctly) ...
        // Since I can't skip lines in replacement, I'll target the surrounding block.

        // Resolve files:
        // 1. If files uploaded, use them (temp paths)
        // 2. If sourceFolder provided, list files from there
        let targetFiles: string[] = [];

        if (files && files.length > 0) {
            targetFiles = files.map(f => f.path);
        } else if (sourceFolder) {
            // Local Mode: Read files from source folder
            if (fs.existsSync(sourceFolder)) {
                targetFiles = fs.readdirSync(sourceFolder)
                    .filter(f => /\.(pdf|txt|md|docx?|jpe?g|png|gif|webp|bmp)$/i.test(f))
                    .map(f => path.join(sourceFolder, f));
                console.log(`Found ${targetFiles.length} files in source folder`);
            } else {
                return res.status(400).json({ error: `Source folder not found: ${sourceFolder}` });
            }
        }

        const result = await tester.testWorkflow({
            chatUrl: chatUrl || undefined,
            files: targetFiles,
            prompt,
            outputDir: outputDir || undefined,
            sourceFolder: sourceFolder || undefined,
            headless: headless === 'true' || headless === true,
            shouldDeleteConversation: deleteConversation === 'true' || deleteConversation === true,
            model: model || undefined
        });

        // Cleanup uploaded files
        if (files) {
            files.forEach(f => {
                try {
                    fs.unlinkSync(f.path);
                } catch (e) {
                    console.error('Failed to delete temp file:', f.path);
                }
            });
        }

        res.json(result);

    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Test failed: ' + (error as Error).message
        });
    }
});

// API: Save settings to file
app.post('/api/save-settings', (req: Request, res: Response) => {
    try {
        const settings = req.body;
        const settingsPath = path.join(process.cwd(), 'config', 'settings.json');

        // Create config directory if it doesn't exist
        const configDir = path.join(process.cwd(), 'config');
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
        }

        // Load existing settings to preserve arrays and profiles
        let existingSettings: any = {};
        if (fs.existsSync(settingsPath)) {
            existingSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        }

        // Merge settings, preserving configuration arrays and profiles
        const mergedSettings = {
            ...existingSettings,
            ...settings,
            // Always preserve these configuration arrays
            googleStudioModels: existingSettings.googleStudioModels || [],
            googleStudioVoices: existingSettings.googleStudioVoices || [],
            // Preserve profiles structure
            profiles: existingSettings.profiles || {}
        };

        // Save merged settings to file
        fs.writeFileSync(settingsPath, JSON.stringify(mergedSettings, null, 2), 'utf-8');

        res.json({
            success: true,
            message: 'Settings saved successfully',
            path: settingsPath
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to save settings: ' + (error as Error).message
        });
    }
});

// API: Save profile-specific settings (merges with existing settings)
app.post('/api/save-profile-settings', (req: Request, res: Response) => {
    try {
        const { activeProfile, profiles } = req.body;
        const settingsPath = path.join(process.cwd(), 'config', 'settings.json');

        // Load existing settings
        let settings: any = {};
        if (fs.existsSync(settingsPath)) {
            settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        }

        // Update active profile
        if (activeProfile) {
            settings.activeProfile = activeProfile;
        }

        // Merge profile settings
        if (profiles) {
            settings.profiles = settings.profiles || {};
            for (const [profileId, profileSettings] of Object.entries(profiles)) {
                settings.profiles[profileId] = {
                    ...(settings.profiles[profileId] || {}),
                    ...(profileSettings as object)
                };
            }
        }

        // Save settings to file
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');

        res.json({
            success: true,
            message: 'Profile settings saved successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to save profile settings: ' + (error as Error).message
        });
    }
});

// API: Load settings from file
app.get('/api/load-settings', (req: Request, res: Response) => {
    try {
        const settingsPath = path.join(process.cwd(), 'config', 'settings.json');

        if (fs.existsSync(settingsPath)) {
            const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
            res.json({
                success: true,
                settings
            });
        } else {
            // Return default settings
            res.json({
                success: true,
                settings: {
                    perplexityChatUrl: '',
                    promptText: '',
                    notebookLmChatSettings: 'Focus on key concepts and provide clear explanations',
                    notebookLmStyleSettings: 'Modern, engaging, educational style',
                    stylePrompt: 'Professional with smooth transitions',
                    outputDir: ''
                }
            });
        }
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to load settings: ' + (error as Error).message
        });
    }
});

// API: Get folder progress
app.get('/api/folder-progress', (req: Request, res: Response) => {
    try {
        const { ProgressTracker } = require('./services/ProgressTracker');
        const folderPath = req.query.path as string;

        if (!folderPath) {
            return res.status(400).json({ error: 'Path is required' });
        }

        const progress = ProgressTracker.getProgress(folderPath);
        const summary = ProgressTracker.getCompletionSummary(folderPath);
        const availableStartPoints = ProgressTracker.getAvailableStartPoints(folderPath);

        res.json({
            success: true,
            progress,
            summary,
            availableStartPoints
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to get progress: ' + (error as Error).message
        });
    }
});

// API: Reset progress from a specific step
app.post('/api/reset-progress', (req: Request, res: Response) => {
    try {
        const { ProgressTracker } = require('./services/ProgressTracker');
        const { folderPath, fromStep } = req.body;

        if (!folderPath || !fromStep) {
            return res.status(400).json({ error: 'folderPath and fromStep are required' });
        }

        const progress = ProgressTracker.resetFromStep(folderPath, fromStep);

        res.json({
            success: true,
            progress,
            message: `Progress reset from step: ${fromStep}`
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to reset progress: ' + (error as Error).message
        });
    }
});

// API: Check audio progress for folders
app.post('/api/check-audio-progress', (req: Request, res: Response) => {
    try {
        const { ProgressTracker } = require('./services/ProgressTracker');
        const { folders } = req.body; // Array of folder paths

        if (!folders || !Array.isArray(folders)) {
            return res.status(400).json({ error: 'folders array is required' });
        }

        const results = folders.map((folderPath: string) => {
            const progress = ProgressTracker.getProgress(folderPath);
            const summary = ProgressTracker.getCompletionSummary(folderPath);

            // Get list of files in the folder
            let files: string[] = [];
            try {
                if (fs.existsSync(folderPath)) {
                    files = fs.readdirSync(folderPath)
                        .filter(f => !f.startsWith('.') && !fs.statSync(path.join(folderPath, f)).isDirectory())
                        .slice(0, 10); // Limit to 10 files for UI
                }
            } catch (e) {
                // Ignore file read errors
            }

            return {
                folderPath,
                folderName: path.basename(folderPath),
                progress,
                summary,
                files,
                audioStage: getAudioStage(progress, folderPath)
            };
        });

        res.json({
            success: true,
            folders: results
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to check audio progress: ' + (error as Error).message
        });
    }
});

// Helper function to determine audio stage
function getAudioStage(progress: any, folderPath: string): string {
    // 1. Check ProgressTracker state first
    if (progress && progress.steps) {
        if (progress.steps['audio_generated']?.completed) return 'complete'; // Audio generation complete
        if (progress.steps['perplexity_narration']?.completed) return 'narration-generated';
    }

    // 2. Fallback: Check for physical files if progress is missing or incomplete
    try {
        const outputDir = path.join(folderPath, 'output');

        // Check for audio files (simplistic check: if audio_narration.txt exists AND some mp3s exist)
        // Actually, we can just check if we have the narration file
        const narrationPath = path.join(outputDir, 'audio_narration.txt');
        if (fs.existsSync(narrationPath)) {
            // If we have narration, check if we also have the final audio marker or files
            // For now, let's just return narration-generated if the file exists
            // This ensures "Skip to Audio Generation" appears even if progress.json is stale
            return 'narration-generated';
        }
    } catch (e) {
        // Ignore errors
    }

    return 'not-started';
}

// API: Test NotebookLM workflow
app.post('/api/test-notebooklm', async (req: Request, res: Response) => {
    try {
        const { NotebookLMTester } = await import('./services/NotebookLMTester');
        const { sourceFolder, headless, existingNotebookUrl } = req.body;

        if (!sourceFolder) {
            return res.status(400).json({ error: 'sourceFolder is required' });
        }

        if (!fs.existsSync(sourceFolder)) {
            return res.status(400).json({ error: `Source folder not found: ${sourceFolder}` });
        }

        console.log(`Starting NotebookLM test for folder: ${sourceFolder}`);

        // Load visual style from global settings
        let visualStyle: string | undefined;
        const settingsPath = path.join(process.cwd(), 'config', 'settings.json');
        if (fs.existsSync(settingsPath)) {
            try {
                const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
                visualStyle = settings.notebookLmStyleSettings;
            } catch (e) {
                console.warn('Could not read settings for visual style:', e);
            }
        }

        const tester = new NotebookLMTester();
        const result = await tester.testWorkflow({
            sourceFolder,
            headless: headless === true || headless === 'true',
            existingNotebookUrl: existingNotebookUrl || undefined,
            visualStyle  // From global settings
            // steeringPrompt will be loaded from per-folder progress.json automatically
        });

        res.json(result);

    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'NotebookLM test failed: ' + (error as Error).message
        });
    }
});

// API: Generate audio using Google AI Studio
app.post('/api/generate-audio', async (req: Request, res: Response) => {
    try {
        const { AudioGenerator } = await import('./services/AudioGenerator');
        const { PerplexityTester } = await import('./services/PerplexityTester');
        const { sourceFolder, headless, audioStartPoint, profileId } = req.body;

        if (!sourceFolder) {
            return res.status(400).json({ error: 'sourceFolder is required' });
        }

        if (!fs.existsSync(sourceFolder)) {
            return res.status(400).json({ error: `Source folder not found: ${sourceFolder}` });
        }

        console.log(`Starting audio generation for folder: ${sourceFolder}`);
        console.log(`Audio start point: ${audioStartPoint || 'start-fresh'}`);

        // Load settings
        const settingsPath = path.join(process.cwd(), 'config', 'settings.json');
        let googleStudioModel = req.body.googleStudioModel || '';
        let googleStudioVoice = req.body.googleStudioVoice || '';
        let googleStudioStyleInstructions = req.body.googleStudioStyleInstructions || '';
        let audioNarrationPerplexityUrl = '';
        let audioNarrationPerplexityModel = '';
        let audioNarrationPrompt = '';
        let activeProfileId = profileId || 'default';

        if (fs.existsSync(settingsPath)) {
            try {
                const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
                if (!googleStudioModel) googleStudioModel = settings.googleStudioModel || '';
                if (!googleStudioVoice) googleStudioVoice = settings.googleStudioVoice || '';
                if (!googleStudioStyleInstructions) googleStudioStyleInstructions = settings.googleStudioStyleInstructions || '';
                audioNarrationPerplexityModel = settings.perplexityModel || '';
                audioNarrationPrompt = settings.audioNarrationPrompt || '   ';

                // Get profile-specific audio narration URL
                activeProfileId = settings.activeProfile || profileId || 'default';
                const currentProfile = settings.profiles?.[activeProfileId];
                audioNarrationPerplexityUrl = currentProfile?.audioNarrationPerplexityUrl || '';
            } catch (e) {
                console.warn('Could not read settings for audio generation:', e);
            }
        }

        const steps: string[] = [];

        // Check if user wants to skip processing (audio already complete)
        if (audioStartPoint === 'do-not-process') {
            return res.json({
                success: true,
                message: 'Audio generation skipped - already complete',
                details: { steps: ['✓ Audio already complete, no processing needed'] }
            });
        }

        // Step 1: Generate narration via Perplexity (if not skipping)
        if (audioStartPoint !== 'skip-to-audio-generation') {
            if (!audioNarrationPerplexityUrl) {
                return res.status(400).json({
                    error: 'Audio Narration Perplexity URL not configured for active profile. Please set it in profile settings.'
                });
            }

            const perplexityTester = new PerplexityTester();
            const narrationResult = await perplexityTester.generateAudioNarration({
                sourceFolder,
                audioNarrationPerplexityUrl,
                headless: headless === true || headless === 'true',
                profileId: activeProfileId,
                model: audioNarrationPerplexityModel,
                prompt: audioNarrationPrompt
            });

            if (!narrationResult.success) {
                return res.json(narrationResult);
            }

            steps.push(...(narrationResult.details?.steps || []));
        } else {
            steps.push('⏭ Skipped to audio generation (using existing narration)');
        }

        // Step 2: Generate audio files
        const generator = new AudioGenerator();
        const audioResult = await generator.generateAudio({
            sourceFolder,
            headless: headless === true || headless === 'true',
            googleStudioModel,
            googleStudioVoice,
            googleStudioStyleInstructions,
            profileId: activeProfileId
        });

        // Combine steps
        if (audioResult.details) {
            audioResult.details.steps = [...steps, ...(audioResult.details.steps || [])];
        }

        res.json(audioResult);

    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Audio generation failed: ' + (error as Error).message
        });
    }
});

// API: Get settings from settings.json
app.get('/api/get-settings', (req: Request, res: Response) => {
    try {
        const settingsPath = path.join(process.cwd(), 'config', 'settings.json');

        if (fs.existsSync(settingsPath)) {
            const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
            res.json({ success: true, settings });
        } else {
            res.json({ success: true, settings: {} });
        }
    } catch (error) {
        console.error('Error reading settings:', error);
        res.status(500).json({ success: false, message: (error as Error).message });
    }
});

// API: Save common settings to settings.json
app.post('/api/save-settings', (req: Request, res: Response) => {
    try {
        const settingsPath = path.join(process.cwd(), 'config', 'settings.json');

        // Read existing settings
        let existingSettings: any = {};
        if (fs.existsSync(settingsPath)) {
            try {
                existingSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
            } catch (e) {
                console.warn('Could not read existing settings, creating new file');
            }
        }

        // Merge with new settings from request
        const updatedSettings = {
            ...existingSettings,
            ...req.body
        };

        // Write to file
        fs.writeFileSync(settingsPath, JSON.stringify(updatedSettings, null, 2), 'utf-8');

        res.json({ success: true, message: 'Settings saved successfully' });
    } catch (error) {
        console.error('Error saving settings:', error);
        res.status(500).json({ success: false, message: (error as Error).message });
    }
});

// API: Scan subdirectories of a parent folder
app.post('/api/scan-subdirectories', async (req: Request, res: Response) => {
    try {
        const { parentPath } = req.body;

        if (!parentPath) {
            return res.status(400).json({
                success: false,
                message: 'parentPath is required'
            });
        }

        if (!fs.existsSync(parentPath)) {
            return res.status(404).json({
                success: false,
                message: 'Parent folder not found'
            });
        }

        const subdirs: string[] = [];

        // Read all subdirectories (one level deep)
        const entries = fs.readdirSync(parentPath, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory()) {
                const subPath = path.join(parentPath, entry.name);
                subdirs.push(subPath);
            }
        }

        res.json({
            success: true,
            parentPath,
            subdirectories: subdirs
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to scan subdirectories: ' + (error as Error).message
        });
    }
});

// API: Get available start points for each folder based on completed steps
app.post('/api/folder-start-points', async (req: Request, res: Response) => {
    try {
        const { ProgressTracker, START_POINTS } = await import('./services/ProgressTracker');
        const { folders } = req.body;

        if (!folders || !Array.isArray(folders)) {
            return res.status(400).json({
                success: false,
                message: 'folders array is required'
            });
        }

        const result: { [folderPath: string]: any[] } = {};

        for (const folderPath of folders) {
            const availableStartPoints = ProgressTracker.getAvailableStartPoints(folderPath);
            result[folderPath] = availableStartPoints;
        }

        res.json({
            success: true,
            startPoints: result,
            allStartPoints: START_POINTS
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to get start points: ' + (error as Error).message
        });
    }
});

// Store batch processor instance
let batchProcessor: any = null;

// API: Start batch processing
app.post('/api/batch/start', async (req: Request, res: Response) => {
    try {
        const { BatchProcessor } = await import('./services/BatchProcessor');
        const { folders, selectedProfiles } = req.body;

        if (!folders || !Array.isArray(folders) || folders.length === 0) {
            return res.status(400).json({ error: 'folders array is required' });
        }

        if (!selectedProfiles || !Array.isArray(selectedProfiles) || selectedProfiles.length === 0) {
            return res.status(400).json({ error: 'selectedProfiles array is required' });
        }

        // Check for existing batch
        if (batchProcessor && batchProcessor.isRunning()) {
            return res.status(400).json({ error: 'Batch processing already in progress' });
        }

        // Load visual style from settings
        let visualStyle: string | undefined;
        const settingsPath = path.join(process.cwd(), 'config', 'settings.json');
        if (fs.existsSync(settingsPath)) {
            const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
            visualStyle = settings.notebookLmStyleSettings;
        }

        // Create batch processor
        batchProcessor = new BatchProcessor();

        // Set up event handlers for Socket.IO updates
        batchProcessor.onStatusChange = (statuses: any[]) => {
            io.emit('batch-status', { statuses });
        };

        batchProcessor.onLog = (message: string) => {
            io.emit('batch-log', { message, timestamp: new Date().toISOString() });
        };

        // Normalize folders to FolderConfig format
        // Support both: simple strings (legacy) and {path, startPoint} objects (new)
        const normalizedFolders = folders.map((f: any) => {
            if (typeof f === 'string') {
                return { path: f, startPoint: 'start-fresh' as const };
            }
            return {
                path: f.path,
                startPoint: f.startPoint || 'start-fresh',
                skipTTSGeneration: f.skipTTSGeneration
            };
        });

        // Start processing in background
        res.json({
            success: true,
            message: 'Batch processing started',
            folderCount: normalizedFolders.length,
            profiles: selectedProfiles
        });

        // Run the full batch process
        try {
            const { selectedProfile } = req.body;
            const result = await batchProcessor.processAll({
                folders: normalizedFolders,
                selectedProfiles,
                selectedProfile: selectedProfile || selectedProfiles[0],
                visualStyle
            });

            io.emit('batch-complete', result);
        } catch (error) {
            io.emit('batch-error', { error: (error as Error).message });
        }

    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to start batch processing: ' + (error as Error).message
        });
    }
});

// API: Get batch processing status
app.get('/api/batch/status', (req: Request, res: Response) => {
    try {
        if (!batchProcessor) {
            return res.json({
                isRunning: false,
                statuses: []
            });
        }

        res.json({
            isRunning: batchProcessor.isRunning(),
            statuses: batchProcessor.getStatus()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to get batch status: ' + (error as Error).message
        });
    }
});

// API: Abort batch processing
app.post('/api/batch/abort', (req: Request, res: Response) => {
    try {
        if (!batchProcessor) {
            return res.json({ success: true, message: 'No batch processing to abort' });
        }

        batchProcessor.abort();
        res.json({ success: true, message: 'Abort requested' });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to abort batch: ' + (error as Error).message
        });
    }
});

// API: Force reset batch processing state (recovery from stuck state)
app.post('/api/batch/reset', (req: Request, res: Response) => {
    try {
        if (!batchProcessor) {
            return res.json({ success: true, message: 'No batch processor to reset' });
        }

        batchProcessor.forceReset();
        res.json({ success: true, message: 'Batch processing state reset successfully' });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to reset batch: ' + (error as Error).message
        });
    }
});

// API: Fire videos only (no collect or audio)
app.post('/api/batch/fire', async (req: Request, res: Response) => {
    try {
        const { BatchProcessor } = await import('./services/BatchProcessor');
        const { folders, selectedProfiles } = req.body;

        if (!folders || !Array.isArray(folders) || folders.length === 0) {
            return res.status(400).json({ error: 'folders array is required' });
        }

        if (!selectedProfiles || !Array.isArray(selectedProfiles) || selectedProfiles.length === 0) {
            return res.status(400).json({ error: 'selectedProfiles array is required' });
        }

        // Check for existing batch
        if (batchProcessor && batchProcessor.isRunning()) {
            return res.status(400).json({ error: 'Batch processing already in progress' });
        }

        // Load visual style
        let visualStyle: string | undefined;
        const settingsPath = path.join(process.cwd(), 'config', 'settings.json');
        if (fs.existsSync(settingsPath)) {
            const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
            visualStyle = settings.notebookLmStyleSettings;
        }

        batchProcessor = new BatchProcessor();

        batchProcessor.onStatusChange = (statuses: any[]) => {
            io.emit('batch-status', { statuses });
        };

        batchProcessor.onLog = (message: string) => {
            io.emit('batch-log', { message, timestamp: new Date().toISOString() });
        };

        res.json({
            success: true,
            message: 'Fire phase started',
            folderCount: folders.length
        });

        // Run only fire phase
        try {
            const { selectedProfile } = req.body;
            await batchProcessor.fireAllVideos({
                folders,
                selectedProfiles,
                selectedProfile: selectedProfile || selectedProfiles[0],
                visualStyle
            });

            io.emit('batch-fire-complete', { message: 'Fire phase complete' });
        } catch (error) {
            io.emit('batch-error', { error: (error as Error).message });
        }

    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to start fire phase: ' + (error as Error).message
        });
    }
});

// API: Collect videos only (download ready videos)
app.post('/api/batch/collect', async (req: Request, res: Response) => {
    try {
        if (!batchProcessor) {
            const { BatchProcessor } = await import('./services/BatchProcessor');
            batchProcessor = new BatchProcessor();
        }

        if (batchProcessor.isRunning()) {
            return res.status(400).json({ error: 'Batch processing already in progress' });
        }

        batchProcessor.onStatusChange = (statuses: any[]) => {
            io.emit('batch-status', { statuses });
        };

        batchProcessor.onLog = (message: string) => {
            io.emit('batch-log', { message, timestamp: new Date().toISOString() });
        };

        // Get folders from request body (required for collect to work)
        const { folders } = req.body;

        res.json({ success: true, message: 'Collect phase started' });

        // Run only collect phase (will auto-discover pending from ProgressTracker)
        try {
            await batchProcessor.collectAllVideos(folders);
            io.emit('batch-collect-complete', { message: 'Collect phase complete' });
        } catch (error) {
            io.emit('batch-error', { error: (error as Error).message });
        }

    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to start collect phase: ' + (error as Error).message
        });
    }
});

// API: Get list of available profiles
app.get('/api/profiles', (req: Request, res: Response) => {
    try {
        const settingsPath = path.join(process.cwd(), 'config', 'settings.json');

        if (fs.existsSync(settingsPath)) {
            const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
            const profiles = Object.keys(settings.profiles || {});
            res.json({ success: true, profiles });
        } else {
            res.json({ success: true, profiles: [] });
        }
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to get profiles: ' + (error as Error).message
        });
    }
});

// API: Discover pending folders (videos started but not downloaded)
app.post('/api/batch/pending', (req: Request, res: Response) => {
    try {
        const { ProgressTracker } = require('./services/ProgressTracker');
        const { folders } = req.body; // Optional: specific folders to check

        const foldersToCheck = folders || [];
        const pending: any[] = [];

        for (const folderPath of foldersToCheck) {
            const progress = ProgressTracker.getProgress(folderPath);
            if (!progress) continue;

            const videoStarted = progress.steps['notebooklm_video_started']?.completed;
            const videoDownloaded = progress.steps['notebooklm_video_downloaded']?.completed;

            if (videoStarted && !videoDownloaded) {
                pending.push({
                    folderPath,
                    folderName: path.basename(folderPath),
                    notebookUrl: progress.steps['notebooklm_video_started']?.notebookUrl,
                    videoStartedAt: progress.steps['notebooklm_video_started']?.videoStartedAt,
                    profileId: progress.profileId
                });
            }
        }

        res.json({ success: true, pending, count: pending.length });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to get pending folders: ' + (error as Error).message
        });
    }
});

// API: Create timeline from video/audio with scene and silence detection
// Supports multiple videos and audios - each on its own track
app.post('/api/create-timeline', async (req: Request, res: Response) => {
    try {
        const { TimelineProcessor } = await import('./processing/TimelineProcessor');
        const {
            videoPaths,      // Array of video file paths
            audioPaths,      // Array of audio file paths
            outputDir,
            exportFormat = 'edl',
            sceneThreshold,
            silenceDuration,
            silenceThreshold,
            reducedPauseDuration,
            projectName,
            frameRate
        } = req.body;

        if (!outputDir) {
            return res.status(400).json({ error: 'outputDir is required' });
        }

        const videoArr = Array.isArray(videoPaths) ? videoPaths : (videoPaths ? [videoPaths] : []);
        const audioArr = Array.isArray(audioPaths) ? audioPaths : (audioPaths ? [audioPaths] : []);

        if (videoArr.length === 0 && audioArr.length === 0) {
            return res.status(400).json({ error: 'At least one video or audio path is required' });
        }

        console.log(`Creating timeline: ${videoArr.length} videos, ${audioArr.length} audios, format=${exportFormat}`);

        const processor = new TimelineProcessor();
        const result = await processor.createTimeline({
            videoPaths: videoArr,
            audioPaths: audioArr,
            outputDir,
            exportFormat,
            sceneThreshold: sceneThreshold || undefined,
            silenceDuration: silenceDuration || undefined,
            silenceThreshold: silenceThreshold || undefined,
            reducedPauseDuration: reducedPauseDuration || undefined,
            projectName: projectName || undefined,
            frameRate: frameRate || undefined
        });

        res.json(result);

    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Timeline creation failed: ' + (error as Error).message
        });
    }
});

// ============================================
// SCRIPT PARSER ENDPOINTS
// ============================================

// API: Parse markdown/docx script and preview extracted videos
app.post('/api/parse-script', async (req: Request, res: Response) => {
    try {
        const { scriptPath } = req.body;

        if (!scriptPath) {
            return res.status(400).json({ error: 'scriptPath is required' });
        }

        if (!fs.existsSync(scriptPath)) {
            return res.status(404).json({ error: `Script file not found: ${scriptPath}` });
        }

        console.log(`[ScriptParser] Parsing: ${scriptPath}`);

        // Auto-detect file type and use appropriate parser
        const ext = path.extname(scriptPath).toLowerCase();
        let result;

        if (ext === '.docx') {
            const { DocxScriptParser } = await import('./services/DocxScriptParser');
            result = await DocxScriptParser.parseFile(scriptPath);
            console.log(`[ScriptParser] Using DOCX parser`);
        } else {
            const { MarkdownScriptParser } = await import('./services/MarkdownScriptParser');
            result = MarkdownScriptParser.parseFile(scriptPath);
            console.log(`[ScriptParser] Using Markdown parser`);
        }

        // Return preview information
        const videoSummaries = result.videos.map(v => ({
            videoNumber: v.videoNumber,
            title: v.title,
            duration: v.duration,
            concept: v.concept,
            slideCount: v.slides.length,
            codeBlockCount: v.allCodeBlocks.length,
            narrationPreview: v.fullNarration.substring(0, 200) + (v.fullNarration.length > 200 ? '...' : '')
        }));

        res.json({
            success: true,
            scriptPath,
            fileType: ext === '.docx' ? 'docx' : 'markdown',
            chapterTitle: result.chapterTitle,
            totalVideos: result.totalVideos,
            videos: videoSummaries
        });

    } catch (error) {
        console.error('[ScriptParser] Error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to parse script: ' + (error as Error).message
        });
    }
});

// API: Generate video input folders from parsed script
app.post('/api/generate-video-folders', async (req: Request, res: Response) => {
    try {
        const { getVideoFolderCreator } = await import('./services/VideoFolderCreator');
        const { scriptPath, outputBaseDir } = req.body;

        if (!scriptPath) {
            return res.status(400).json({ error: 'scriptPath is required' });
        }

        if (!fs.existsSync(scriptPath)) {
            return res.status(404).json({ error: `Script file not found: ${scriptPath}` });
        }

        // Determine output directory
        const scriptDir = path.dirname(scriptPath);
        const baseOutputDir = outputBaseDir || path.join(scriptDir, 'Per Video Input');

        console.log(`[ScriptParser] Generating folders with screenshots in: ${baseOutputDir}`);

        // Initialize VideoFolderCreator with Puppeteer for screenshots
        const folderCreator = getVideoFolderCreator();

        // Initialize Puppeteer for screenshot generation
        const puppeteer = require('puppeteer');
        const browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();

        // Set high-resolution viewport (2x scale for Retina-quality screenshots)
        await page.setViewport({
            width: 1920,
            height: 1080,
            deviceScaleFactor: 2  // 2x resolution (3840x2160 effective)
        });

        await folderCreator.initialize(page);

        try {
            // Generate all folders with screenshots and DOCX
            const result = await folderCreator.generateAll({
                sourceMarkdownPath: scriptPath,
                outputBaseDir: baseOutputDir,
                chapterPrefix: 'chapter',
                generateScreenshots: true,
                generateDocx: true,
                generateNarration: true
            });

            await browser.close();

            // Format response
            const folders = result.results.map(r => ({
                videoNumber: r.videoNumber,
                title: '', // Not available in result
                folderPath: r.folderPath,
                files: [
                    ...(r.narrationPath ? ['narration.txt'] : []),
                    ...(r.docxPath ? [path.basename(r.docxPath)] : []),
                    ...r.screenshotPaths.map(p => path.basename(p))
                ],
                screenshotCount: r.screenshotPaths.length
            }));

            res.json({
                success: result.failCount === 0,
                outputDir: baseOutputDir,
                totalGenerated: result.successCount,
                totalErrors: result.failCount,
                folders,
                errors: result.results.filter(r => !r.success).map(r => `Video ${r.videoNumber}: ${r.error}`)
            });

        } catch (error: any) {
            await browser.close();
            throw error;
        }

    } catch (error) {
        console.error('[ScriptParser] Error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to generate folders: ' + (error as Error).message
        });
    }
});

// Socket.IO connection
io.on('connection', (socket) => {
    console.log('Client connected');
    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});

// API: Manual Upscale (Batch)
app.post('/api/manual-upscale', upload.array('images', 50), async (req: Request, res: Response) => {
    try {
        const files = req.files as Express.Multer.File[];
        if (!files || files.length === 0) {
            return res.status(400).json({ error: 'No images uploaded' });
        }

        const { UpscaleService } = await import('./services/UpscaleService');

        // Ensure service is running
        const started = await UpscaleService.instance.ensureStarted();
        if (!started) {
            return res.status(500).json({ error: 'Failed to start Upscale Service' });
        }

        const results: { original: string, upscaled: string, status: string }[] = [];
        const scale = 1.5; // Fixed for now, or get from req.body

        for (const file of files) {
            const inputPath = file.path;
            const originalName = file.originalname;
            const ext = path.extname(originalName);
            const baseName = path.basename(originalName, ext);

            // Output path: suffix usually attached
            const outputPath = path.join(path.dirname(inputPath), `${baseName}_upscaled${ext}`);

            const success = await UpscaleService.instance.upscale(inputPath, outputPath, scale);

            if (success) {
                // Return relative path for frontend access (assuming served from temp_uploads?)
                // Actually server static is public. Temp uploads aren't served by default unless we add a route.
                // We should serve temp_uploads via a specific route for preview.
                results.push({
                    original: originalName,
                    upscaled: `/uploads/${path.basename(outputPath)}`, // We need to serve this
                    status: 'success'
                });
            } else {
                results.push({
                    original: originalName,
                    upscaled: '',
                    status: 'failed'
                });
            }
        }

        res.json({ results });

    } catch (error) {
        console.error('Upscale error:', error);
        res.status(500).json({ error: (error as Error).message });
    }
});

// Serve temp_uploads for previewing upscaled images
app.use('/uploads', express.static(path.join(process.cwd(), 'temp_uploads')));

// Start server
httpServer.listen(PORT, () => {
    console.log(`\n=================================`);
    console.log(`  Video Creator UI`);
    console.log(`=================================`);
    console.log(`\n🌐 Open in browser: http://localhost:${PORT}`);
    console.log(`\nReady to process videos!\n`);
});

// API: Analyze audio with Whisper
app.post('/api/audio/analyze', async (req: Request, res: Response) => {
    try {
        const { audioPath, markerPhrase = 'next slide please' } = req.body;

        if (!audioPath) {
            return res.status(400).json({ error: 'audioPath is required' });
        }

        if (!fs.existsSync(audioPath)) {
            return res.status(400).json({ error: `Audio file not found: ${audioPath}` });
        }

        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);

        // Find Python script and venv
        const scriptPath = path.join(__dirname, '../scripts/audio_transcribe.py');
        const venvPython = path.join(__dirname, '../scripts/venv/Scripts/python.exe');
        const pythonCmd = fs.existsSync(venvPython) ? `"${venvPython}"` : 'python';

        const command = `${pythonCmd} "${scriptPath}" "${audioPath}" -m "${markerPhrase}"`;
        console.log(`[AudioAnalyze] Running: ${command}`);

        const { stdout, stderr } = await execAsync(command, { maxBuffer: 50 * 1024 * 1024 });

        try {
            const result = JSON.parse(stdout);
            res.json(result);
        } catch (parseError) {
            res.status(500).json({
                error: 'Failed to parse Whisper output',
                stdout,
                stderr
            });
        }
    } catch (error) {
        console.error('[AudioAnalyze] Error:', error);
        res.status(500).json({ error: (error as Error).message });
    }
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    if (pipeline) {
        await pipeline.shutdown();
    }
    process.exit(0);
});
