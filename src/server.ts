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

const PORT = 3000;

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
        if (!pipeline) {
            pipeline = new VideoPipeline(2);
        }

        await pipeline.initialize();

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

        res.json({ message: 'Browser opened for login. Please log into all services.' });

        // Notify via socket
        io.emit('login-status', { status: 'opened', message: 'Browser opened. Please log in to all services.' });

    } catch (error) {
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
        res.json({ files });
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

// API: Test Perplexity workflow
app.post('/api/test-perplexity', upload.array('files', 10), async (req: Request, res: Response) => {
    try {
        const { PerplexityTester } = await import('./services/PerplexityTester');

        const files = req.files as Express.Multer.File[];
        const { chatUrl, prompt, outputDir, sourceFolder } = req.body;

        console.log(`Received test request with ${files ? files.length : 0} files. SourceFolder: ${sourceFolder}`);

        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }

        const tester = new PerplexityTester();

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
            sourceFolder: sourceFolder || undefined
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

        // Save settings to file
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');

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

// Socket.IO connection
io.on('connection', (socket) => {
    console.log('Client connected');
    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});

// Start server
httpServer.listen(PORT, () => {
    console.log(`\n=================================`);
    console.log(`  Video Creator UI`);
    console.log(`=================================`);
    console.log(`\n🌐 Open in browser: http://localhost:${PORT}`);
    console.log(`\nReady to process videos!\n`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    if (pipeline) {
        await pipeline.shutdown();
    }
    process.exit(0);
});
