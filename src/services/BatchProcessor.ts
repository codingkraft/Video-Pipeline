import { ProgressTracker, FolderProgress } from './ProgressTracker';
import { NotebookLMTester, NotebookLMTestConfig } from './NotebookLMTester';
import { PerplexityTester } from './PerplexityTester';
import { GoogleStudioTester } from './GoogleStudioTester';
import { CaptiveBrowser } from '../browser/CaptiveBrowser';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Status of a folder in batch processing
 */
export type FolderStatus =
    | 'pending'           // Not started
    | 'video_generating'  // Video generation started, waiting
    | 'video_ready'       // Video generation complete, not downloaded
    | 'downloading'       // Currently downloading
    | 'audio_generating'  // Generating audio slides
    | 'complete'          // All done
    | 'error';            // Error occurred

/**
 * Batch processing configuration
 */
export interface BatchConfig {
    folders: string[];              // List of folder paths to process
    selectedProfiles: string[];     // Profiles selected by user for rotation
    visualStyle?: string;           // Global visual style setting
    notebookLmChatSettings?: string;
    operation?: 'fire' | 'collect' | 'audio';
}

/**
 * Status of a single folder in the batch
 */
export interface FolderBatchStatus {
    folderPath: string;
    folderName: string;
    status: FolderStatus;
    profileId?: string;
    videoStartedAt?: string;
    elapsedMs?: number;
    error?: string;
    notebookUrl?: string;
}

/**
 * Overall batch processing result
 */
export interface BatchResult {
    totalFolders: number;
    completed: number;
    failed: number;
    folderStatuses: FolderBatchStatus[];
}

/**
 * Delay settings loaded from config
 */
interface DelaySettings {
    betweenVideoStartsMs: number;
    betweenAudioSlidesMs: number;
    videoCheckIntervalMs: number;
    maxWaitForVideoMs: number;
}

/**
 * BatchProcessor orchestrates async video generation across multiple folders.
 * Implements "Fire-and-Collect" pattern with profile rotation.
 */
export class BatchProcessor {
    private notebookLMTester: NotebookLMTester;
    private googleStudioTester: GoogleStudioTester;
    private perplexityTester: PerplexityTester;
    private browser: CaptiveBrowser;
    private delays: DelaySettings;
    private currentBatch: FolderBatchStatus[] = [];
    private isProcessing = false;
    private abortRequested = false;

    // Event callbacks for UI updates
    public onStatusChange?: (statuses: FolderBatchStatus[]) => void;
    public onLog?: (message: string) => void;

    constructor() {
        this.notebookLMTester = new NotebookLMTester();
        this.googleStudioTester = new GoogleStudioTester();
        this.perplexityTester = new PerplexityTester();
        this.browser = CaptiveBrowser.getInstance();
        this.delays = this.loadDelaySettings();
    }

    /**
     * Load delay settings from config file
     */
    private loadDelaySettings(): DelaySettings {
        const settingsPath = path.join(__dirname, '../../config/settings.json');
        try {
            const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
            return {
                betweenVideoStartsMs: settings.delays?.betweenVideoStartsMs ?? 300000,
                betweenAudioSlidesMs: settings.delays?.betweenAudioSlidesMs ?? 120000,
                videoCheckIntervalMs: settings.delays?.videoCheckIntervalMs ?? 300000,
                maxWaitForVideoMs: settings.delays?.maxWaitForVideoMs ?? 3600000
            };
        } catch {
            // Return defaults
            return {
                betweenVideoStartsMs: 300000,   // 5 min
                betweenAudioSlidesMs: 120000,   // 2 min
                videoCheckIntervalMs: 300000,   // 5 min
                maxWaitForVideoMs: 3600000      // 1 hour
            };
        }
    }

    /**
     * Log a message and notify listeners
     */
    private log(message: string): void {
        console.log(`[BatchProcessor] ${message}`);
        this.onLog?.(message);
    }

    /**
     * Update folder status and notify listeners
     */
    private updateFolderStatus(folderPath: string, updates: Partial<FolderBatchStatus>): void {
        const folder = this.currentBatch.find(f => f.folderPath === folderPath);
        if (folder) {
            Object.assign(folder, updates);
            // Calculate elapsed time if video is generating
            if (folder.videoStartedAt && folder.status === 'video_generating') {
                folder.elapsedMs = Date.now() - new Date(folder.videoStartedAt).getTime();
            }
            this.onStatusChange?.(this.currentBatch);
        }
    }

    /**
     * Assign a profile to a folder using round-robin from selected profiles.
     * Respects existing profile assignments (persistence).
     */
    private assignProfile(folderPath: string, selectedProfiles: string[], profileIndex: number): string {
        // Check if folder already has a profile assigned
        const existingProfile = ProgressTracker.getFolderProfile(folderPath);
        if (existingProfile && selectedProfiles.includes(existingProfile)) {
            this.log(`Folder ${path.basename(folderPath)} using existing profile: ${existingProfile}`);
            return existingProfile;
        }

        // Round-robin assignment
        const profile = selectedProfiles[profileIndex % selectedProfiles.length];
        ProgressTracker.setFolderProfile(folderPath, profile);
        this.log(`Folder ${path.basename(folderPath)} assigned new profile: ${profile}`);
        return profile;
    }

    /**
     * PHASE 1: Fire video generation for all folders (2 videos per folder)
     */
    public async fireAllVideos(config: BatchConfig): Promise<FolderBatchStatus[]> {
        this.log(`Starting PHASE 1: Fire video generation for ${config.folders.length} folders (2 videos each)`);

        let profileIndex = 0;

        for (let i = 0; i < config.folders.length; i++) {
            if (this.abortRequested) {
                this.log('Abort requested, stopping fire phase');
                break;
            }

            const folderPath = config.folders[i];
            const folderName = path.basename(folderPath);

            // Generate 2 videos per folder
            for (let videoNum = 1; videoNum <= 2; videoNum++) {
                if (this.abortRequested) break;

                const videoStepName = `notebooklm_video_${videoNum}_started` as const;

                // Check if this video already started
                if (ProgressTracker.isStepComplete(folderPath, videoStepName)) {
                    this.log(`${folderName}: Video ${videoNum} already started, skipping`);
                    continue;
                }

                try {
                    // Assign profile
                    const profileId = this.assignProfile(folderPath, config.selectedProfiles, profileIndex);
                    profileIndex++;

                    this.updateFolderStatus(folderPath, {
                        status: 'video_generating',
                        profileId
                    });

                    // Initialize browser with this profile
                    await this.browser.initialize({ profileId });

                    // Run NotebookLM workflow (creates notebook, uploads, starts video)
                    const testConfig: NotebookLMTestConfig = {
                        sourceFolder: folderPath,
                        headless: false,
                        visualStyle: config.visualStyle,
                        profileId
                    };

                    this.log(`${folderName}: Starting video ${videoNum}/2 generation with profile ${profileId}`);
                    const result = await this.notebookLMTester.testWorkflow(testConfig);

                    if (result.success) {
                        // Mark video started with timestamp
                        ProgressTracker.updateStep(folderPath, videoStepName, {
                            completed: true,
                            videoStartedAt: new Date().toISOString(),
                            notebookUrl: result.details?.notebookUrl
                        });

                        this.updateFolderStatus(folderPath, {
                            status: 'video_generating',
                            videoStartedAt: new Date().toISOString(),
                            notebookUrl: result.details?.notebookUrl
                        });

                        this.log(`${folderName}: Video ${videoNum}/2 generation started successfully`);
                    } else {
                        this.updateFolderStatus(folderPath, {
                            status: 'error',
                            error: result.message
                        });
                        this.log(`${folderName}: Failed to start video ${videoNum}/2 - ${result.message}`);
                    }

                    // Wait before next video (rate limiting)
                    if (!(i === config.folders.length - 1 && videoNum === 2)) {
                        const delayMs = this.delays.betweenVideoStartsMs;
                        this.log(`Waiting ${delayMs / 1000}s before next video (rate limiting)...`);
                        await this.sleep(delayMs);
                    }

                } catch (error) {
                    const errorMsg = error instanceof Error ? error.message : String(error);
                    this.updateFolderStatus(folderPath, { status: 'error', error: errorMsg });
                    this.log(`${folderName}: Error on video ${videoNum}/2 - ${errorMsg}`);
                }
            }
        }

        return this.currentBatch;
    }

    /**
     * Load pending folders from ProgressTracker (for resume after restart)
     * Now checks for both video_1 and video_2
     */
    private loadPendingFoldersFromProgress(providedFolders?: string[]): FolderBatchStatus[] {
        const foldersToCheck = providedFolders || this.currentBatch.map(f => f.folderPath);
        const pending: FolderBatchStatus[] = [];

        for (const folderPath of foldersToCheck) {
            const progress = ProgressTracker.getProgress(folderPath);
            if (!progress) continue;

            // Check both video_1 and video_2
            for (let videoNum = 1; videoNum <= 2; videoNum++) {
                const videoStartedStep = `notebooklm_video_${videoNum}_started`;
                const videoDownloadedStep = `notebooklm_video_${videoNum}_downloaded`;

                const videoStarted = progress.steps[videoStartedStep]?.completed;
                const videoDownloaded = progress.steps[videoDownloadedStep]?.completed;

                if (videoStarted && !videoDownloaded) {
                    const notebookUrl = progress.steps[videoStartedStep]?.notebookUrl;
                    const videoStartedAt = progress.steps[videoStartedStep]?.videoStartedAt;
                    const profileId = progress.profileId;

                    if (notebookUrl) {
                        pending.push({
                            folderPath,
                            folderName: `${path.basename(folderPath)} (Video ${videoNum})`,
                            status: 'video_generating',
                            profileId,
                            notebookUrl,
                            videoStartedAt,
                            error: `video_${videoNum}` // Store which video this is
                        });
                    }
                }
            }
        }

        return pending;
    }

    /**
     * PHASE 2: Collect completed videos (check status and download)
     * Can be called standalone after restart - will auto-discover pending folders
     */
    public async collectAllVideos(providedFolders?: string[]): Promise<FolderBatchStatus[]> {
        this.log('Starting PHASE 2: Collect completed videos');

        // Load pending folders from ProgressTracker (supports resume after restart)
        let pendingFolders = this.loadPendingFoldersFromProgress(providedFolders);

        // Merge with currentBatch if it exists
        if (this.currentBatch.length > 0) {
            // Update currentBatch with loaded folders
            for (const pending of pendingFolders) {
                const existing = this.currentBatch.find(f => f.folderPath === pending.folderPath);
                if (existing) {
                    Object.assign(existing, pending);
                } else {
                    this.currentBatch.push(pending);
                }
            }
        } else {
            // No currentBatch, use loaded folders
            this.currentBatch = pendingFolders;
        }

        // Re-filter to get actual pending folders
        pendingFolders = this.currentBatch.filter(
            f => f.status === 'video_generating' && !ProgressTracker.isStepComplete(f.folderPath, 'notebooklm_video_downloaded')
        );

        if (pendingFolders.length === 0) {
            this.log('No pending videos to collect');
            return this.currentBatch;
        }

        this.log(`Found ${pendingFolders.length} folders with videos in progress`);
        this.onStatusChange?.(this.currentBatch);

        const startTime = Date.now();

        while (pendingFolders.length > 0 && !this.abortRequested) {
            // Check if we've exceeded max wait time
            if (Date.now() - startTime > this.delays.maxWaitForVideoMs) {
                this.log('Max wait time exceeded, stopping collect phase');
                break;
            }

            for (const folder of [...pendingFolders]) {
                if (this.abortRequested) break;

                // Extract video number from folder.error field (hacky but works)
                const videoNum = folder.error?.replace('video_', '') || '1';
                const folderName = path.basename(folder.folderPath);
                this.log(`Checking ${folderName} (Video ${videoNum}) for completion...`);

                try {
                    // Initialize browser with the folder's profile
                    const profileId = folder.profileId || ProgressTracker.getFolderProfile(folder.folderPath);
                    if (profileId) {
                        await this.browser.initialize({ profileId });
                    }

                    // Check video status
                    const status = await this.notebookLMTester.checkVideoStatus(folder.notebookUrl!);

                    if (status === 'ready') {
                        this.log(`${folderName} (Video ${videoNum}): Video ready, downloading...`);
                        this.updateFolderStatus(folder.folderPath, { status: 'downloading' });

                        // Download video with unique filename
                        const outputPath = path.join(folder.folderPath, 'output', `notebooklm_video_${videoNum}.mp4`);
                        const success = await this.notebookLMTester.downloadVideo(folder.notebookUrl!, outputPath);

                        if (success) {
                            const downloadedStepName = `notebooklm_video_${videoNum}_downloaded`;
                            ProgressTracker.markStepComplete(folder.folderPath, downloadedStepName, {
                                videoFilePath: outputPath
                            });
                            this.updateFolderStatus(folder.folderPath, { status: 'complete' });
                            this.log(`${folderName} (Video ${videoNum}): Downloaded successfully`);

                            // Remove from pending
                            const idx = pendingFolders.indexOf(folder);
                            if (idx > -1) pendingFolders.splice(idx, 1);
                        } else {
                            this.log(`${folderName} (Video ${videoNum}): Download failed, will retry`);
                        }
                    } else if (status === 'error') {
                        this.updateFolderStatus(folder.folderPath, {
                            status: 'error',
                            error: `Video ${videoNum} generation failed`
                        });
                        const idx = pendingFolders.indexOf(folder);
                        if (idx > -1) pendingFolders.splice(idx, 1);
                    } else {
                        // Still generating
                        const elapsed = folder.videoStartedAt
                            ? Math.round((Date.now() - new Date(folder.videoStartedAt).getTime()) / 60000)
                            : 0;
                        this.log(`${folderName} (Video ${videoNum}): Still generating (${elapsed} min elapsed)`);
                    }

                } catch (error) {
                    const errorMsg = error instanceof Error ? error.message : String(error);
                    this.log(`${folderName} (Video ${videoNum}): Error checking status - ${errorMsg}`);
                }
            }

            // Wait before next check round
            if (pendingFolders.length > 0 && !this.abortRequested) {
                const waitMs = this.delays.videoCheckIntervalMs;
                this.log(`Waiting ${waitMs / 1000}s before next status check...`);
                await this.sleep(waitMs);
            }
        }

        return this.currentBatch;
    }

    /**
     * Generate audio for all folders that have videos but no audio
     */
    public async generateAudioForAll(): Promise<void> {
        this.log('Starting audio generation (while videos generate on NotebookLM)');

        const foldersNeedingAudio = this.currentBatch.filter(f => {
            // Check if videos have been STARTED (fired) - audio runs while videos generate
            const hasVideoStarted1 = ProgressTracker.isStepComplete(f.folderPath, 'notebooklm_video_1_started');
            const hasVideoStarted2 = ProgressTracker.isStepComplete(f.folderPath, 'notebooklm_video_2_started');
            const hasAudio = ProgressTracker.isStepComplete(f.folderPath, 'audio_generated');
            // Generate audio if at least one video has started generating AND audio not done
            return (hasVideoStarted1 || hasVideoStarted2) && !hasAudio && f.status !== 'error';
        });

        if (foldersNeedingAudio.length === 0) {
            this.log('No folders need audio generation');
            return;
        }

        this.log(`${foldersNeedingAudio.length} folder(s) need audio generation`);

        for (const folder of foldersNeedingAudio) {
            if (this.abortRequested) break;

            const folderName = path.basename(folder.folderPath);
            this.log(`${folderName}: Generating audio...`);

            try {
                this.updateFolderStatus(folder.folderPath, { status: 'audio_generating' });

                // Initialize browser with folder's profile
                const profileId = folder.profileId || ProgressTracker.getFolderProfile(folder.folderPath);
                if (profileId) {
                    await this.browser.initialize({ profileId });
                }

                // Check if narration file exists
                const outputDir = path.join(folder.folderPath, 'output');
                const narrationPath = path.join(outputDir, 'perplexity_audio_response.txt');
                const legacyNarrationPath1 = path.join(outputDir, 'audio_narration.txt');
                const legacyNarrationPath2 = path.join(outputDir, 'audio_narration.md');

                let hasNarration = fs.existsSync(narrationPath) || fs.existsSync(legacyNarrationPath1) || fs.existsSync(legacyNarrationPath2);

                // If no narration, generate it via Perplexity
                if (!hasNarration) {
                    this.log(`${folderName}: No narration file found, generating via Perplexity...`);

                    // Load settings
                    const settingsPath = path.join(process.cwd(), 'config', 'settings.json');
                    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));

                    // Identify input file (perplexity response)
                    const videoResponsePath = path.join(folder.folderPath, 'output', 'perplexity_video_response.txt');
                    const legacyVideoResponsePath = path.join(folder.folderPath, 'perplexity_response.txt');
                    const legacyVideoResponsePath2 = path.join(folder.folderPath, 'output', 'perplexity_response.txt'); // Just in case

                    let contextFile = '';
                    if (fs.existsSync(videoResponsePath)) contextFile = videoResponsePath;
                    else if (fs.existsSync(legacyVideoResponsePath)) contextFile = legacyVideoResponsePath;
                    else if (fs.existsSync(legacyVideoResponsePath2)) contextFile = legacyVideoResponsePath2;

                    if (contextFile) {
                        this.updateFolderStatus(folder.folderPath, { status: 'audio_generating' });

                        const genResult = await this.perplexityTester.testWorkflow({
                            chatUrl: settings.audioNarrationPerplexityUrl || 'https://www.perplexity.ai/',
                            files: [contextFile],
                            prompt: settings.audioNarrationPrompt || 'Create a voiceover script based on this.',
                            sourceFolder: folder.folderPath,
                            headless: settings.headlessMode,
                            shouldDeleteConversation: settings.deleteConversation,
                            model: (settings.audioNarrationPerplexityModel || settings.perplexityModel) || undefined,
                            profileId: profileId || undefined,
                            outputFilename: 'perplexity_audio_response'
                        });

                        if (genResult.success) {
                            hasNarration = true;
                            this.log(`${folderName}: Narration script generated successfully`);
                            // Wait a bit to ensure FS sync
                            await this.sleep(2000);
                        } else {
                            this.log(`${folderName}: Failed to generate narration - ${genResult.message}`);
                            this.updateFolderStatus(folder.folderPath, { status: 'error', error: 'Narration generation failed' });
                            continue;
                        }
                    } else {
                        this.log(`${folderName}: No input content (perplexity_video_response.txt) found for narration`);
                        // Can't generate without input
                        continue;
                    }
                }

                if (hasNarration) {
                    // Use AudioGenerator which handles the full audio pipeline
                    const { AudioGenerator } = await import('./AudioGenerator');
                    const audioGen = new AudioGenerator();

                    let finalNarrationPath = narrationPath;
                    if (fs.existsSync(legacyNarrationPath1)) finalNarrationPath = legacyNarrationPath1;
                    if (fs.existsSync(legacyNarrationPath2)) finalNarrationPath = legacyNarrationPath2;

                    // Load settings for audio generation
                    const settingsPath = path.join(process.cwd(), 'config', 'settings.json');
                    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
                    const audioProfileId = profileId || 'profile1';

                    await audioGen.generateAudio({
                        sourceFolder: folder.folderPath,
                        profileId: audioProfileId,
                        narrationFilePath: finalNarrationPath
                    });

                    ProgressTracker.markStepComplete(folder.folderPath, 'audio_generated');
                    this.log(`${folderName}: Audio generation complete`);
                    this.updateFolderStatus(folder.folderPath, { status: 'complete' });
                }

            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                this.updateFolderStatus(folder.folderPath, { status: 'error', error: errorMsg });
                this.log(`${folderName}: Audio error - ${errorMsg}`);
            }

            // Rate limiting between audio generations
            await this.sleep(this.delays.betweenAudioSlidesMs);
        }
    }

    /**
     * Full batch processing workflow: Fire → Collect → Audio
     */
    public async processAll(config: BatchConfig): Promise<BatchResult> {
        if (this.isProcessing) {
            throw new Error('Batch processing already in progress');
        }

        this.isProcessing = true;
        this.abortRequested = false;

        // Initialize batch status
        this.currentBatch = config.folders.map(folderPath => ({
            folderPath,
            folderName: path.basename(folderPath),
            status: 'pending' as FolderStatus,
            profileId: ProgressTracker.getFolderProfile(folderPath) ?? undefined
        }));
        this.onStatusChange?.(this.currentBatch);

        try {
            if (config.operation === 'fire') {
                await this.fireAllVideos(config);
            } else if (config.operation === 'collect') {
                await this.collectAllVideos();
            } else if (config.operation === 'audio') {
                await this.generateAudioForAll();
            } else {
                // DEFAULT FULL BATCH
                // Phase 0: Generate PROMPTS for all folders (via Perplexity)
                await this.generatePromptsForAll(config);

                // Phase 1: FIRE all videos
                await this.fireAllVideos(config);

                // Phase 2: Generate AUDIO
                await this.generateAudioForAll();

                // Phase 3: COLLECT videos
                await this.collectAllVideos();
            }

        } finally {
            this.isProcessing = false;
        }

        // Compile results
        return {
            totalFolders: config.folders.length,
            completed: this.currentBatch.filter(f => f.status === 'complete').length,
            failed: this.currentBatch.filter(f => f.status === 'error').length,
            folderStatuses: this.currentBatch
        };
    }

    /**
     * Request abort of current processing
     */
    public abort(): void {
        this.log('Abort requested');
        this.abortRequested = true;
    }

    /**
     * Get current batch status
     */
    public getStatus(): FolderBatchStatus[] {
        // Update elapsed times
        for (const folder of this.currentBatch) {
            if (folder.videoStartedAt && folder.status === 'video_generating') {
                folder.elapsedMs = Date.now() - new Date(folder.videoStartedAt).getTime();
            }
        }
        return this.currentBatch;
    }

    /**
     * Check if processing is in progress
     */
    public isRunning(): boolean {
        return this.isProcessing;
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Phase 0: Generate prompts via Perplexity for all folders
     * Skips folders that already have the perplexity step completed
     */
    private async generatePromptsForAll(config: BatchConfig): Promise<void> {
        if (this.abortRequested) return;

        this.log('PHASE 0: Generating prompts via Perplexity (if needed)...');
        let profileIndex = 0;

        for (let i = 0; i < config.folders.length; i++) {
            if (this.abortRequested) break;

            const folderPath = config.folders[i];
            const folderName = path.basename(folderPath);

            // Check if Perplexity already done
            if (ProgressTracker.isStepComplete(folderPath, 'perplexity')) {
                this.log(`${folderName}: Perplexity prompt already generated, skipping`);
                continue;
            }

            try {
                // Assign profile
                const profileId = this.assignProfile(folderPath, config.selectedProfiles, profileIndex);
                profileIndex++;

                this.updateFolderStatus(folderPath, {
                    status: 'pending' // Still pending video generation, but doing prompt
                });

                this.log(`${folderName}: Generating prompt with Perplexity (Profile: ${profileId})...`);

                // Initialize browser
                await this.browser.initialize({ profileId });

                // Load settings for additional config
                const settingsPath = path.join(process.cwd(), 'config', 'settings.json');
                const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
                const profileSettings = settings.profiles?.[profileId] || {};

                // Get files
                const files = fs.readdirSync(folderPath)
                    .filter(f => /\.(pdf|txt|md|docx?|jpe?g|png)$/i.test(f))
                    .map(f => path.join(folderPath, f));

                const result = await this.perplexityTester.testWorkflow({
                    chatUrl: profileSettings.perplexityChatUrl || settings.perplexityChatUrl,
                    files: files,
                    prompt: settings.promptText,
                    sourceFolder: folderPath,
                    headless: config.visualStyle ? false : (settings.headlessMode ?? false), // visualStyle usually implies not headless? No, keeping default
                    shouldDeleteConversation: settings.deleteConversation,
                    model: settings.perplexityModel,
                    profileId: profileId
                });

                if (result.success) {
                    ProgressTracker.markStepComplete(folderPath, 'perplexity');
                    this.log(`${folderName}: Perplexity prompt generated successfully`);
                } else {
                    this.log(`${folderName}: Perplexity failed - ${result.message}`);
                    this.updateFolderStatus(folderPath, { status: 'error', error: `Perplexity failed: ${result.message}` });
                }

                // Add delay between Perplexity runs
                await this.sleep(3000);

            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                this.updateFolderStatus(folderPath, { status: 'error', error: errorMsg });
                this.log(`${folderName}: Error in Perplexity phase - ${errorMsg}`);
            }
        }
    }
}
