import { ProgressTracker, PIPELINE_STEPS, START_POINTS, StartPointKey, START_POINT_CONFIGS } from './ProgressTracker';
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
 * Configuration for a single folder in the batch
 */
export interface FolderConfig {
    path: string;
    startPoint: 'start-fresh' | 'create-notebook' | 'fire-video-1' | 'fire-video-2' | 'audio-prompt' | 'generate-audio' | 'collect-videos' | 'remove-logo' | 'process-video';
}

/**
 * Batch processing configuration
 */
export interface BatchConfig {
    folders: FolderConfig[];            // Folders with their start points
    selectedProfiles: string[];         // Profiles selected by user for rotation
    visualStyle?: string;               // Global visual style setting
    notebookLmChatSettings?: string;
    // NOTE: operation field removed - startPoint in FolderConfig is now the single source of truth
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
     * Process video generation for a single folder (2 videos)
     */
    private async processFolderVideos(
        folderConfig: FolderConfig,
        config: BatchConfig,
        profileIndex: number
    ): Promise<number> {
        const folderPath = folderConfig.path;
        const folderName = path.basename(folderPath);
        const startPoint = folderConfig.startPoint;
        const spConfig = START_POINT_CONFIGS[startPoint] || START_POINT_CONFIGS['start-fresh'];

        let currentProfileIndex = profileIndex;

        for (let videoNum = 1; videoNum <= 2; videoNum++) {
            if (this.abortRequested) break;

            const behavior = videoNum === 1 ? spConfig.video1Behavior : spConfig.video2Behavior;
            const videoStepName = `notebooklm_video_${videoNum}_started` as const;

            // 1. Evaluate Behavior
            if (behavior === 'skip') {
                this.log(`${folderName}: Video ${videoNum} behavior is 'skip', skipping`);
                continue;
            }

            const isComplete = ProgressTracker.isStepComplete(folderPath, videoStepName);
            if (behavior === 'if-needed' && isComplete) {
                this.log(`${folderName}: Video ${videoNum} already started and behavior is 'if-needed', skipping`);
                continue;
            }

            // If behavior is 'force' or ('if-needed' and !isComplete), we proceed to fire
            if (behavior === 'force') {
                this.log(`${folderName}: Video ${videoNum} behavior is 'force', regenerating...`);
            }

            try {
                const profileId = this.assignProfile(folderPath, config.selectedProfiles, currentProfileIndex);
                currentProfileIndex++;

                this.updateFolderStatus(folderPath, {
                    status: 'video_generating',
                    profileId
                });

                await this.browser.initialize({ profileId });

                const progress = ProgressTracker.getProgress(folderPath);
                const existingNotebookUrl = spConfig.skipNotebookCreation ? progress?.steps.notebooklm_notebook_created?.notebookUrl : undefined;

                const testConfig: NotebookLMTestConfig = {
                    sourceFolder: folderPath,
                    headless: false,
                    visualStyle: config.visualStyle,
                    profileId,
                    existingNotebookUrl,
                    skipSourcesUpload: spConfig.skipSourcesUpload,
                    skipNotebookCreation: spConfig.skipNotebookCreation
                };

                this.log(`${folderName}: Starting video ${videoNum}/2 generation with profile ${profileId}`);
                const result = await this.notebookLMTester.testWorkflow(testConfig);

                if (result.success) {
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
                    this.updateFolderStatus(folderPath, { status: 'error', error: result.message });
                    this.log(`${folderName}: Failed to start video ${videoNum}/2 - ${result.message}`);
                }

                if (!this.abortRequested) {
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
        return currentProfileIndex;
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
     * Process audio generation for a single folder
     */
    private async processFolderAudio(
        folderPath: string,
        startPoint: StartPointKey,
        config: BatchConfig
    ): Promise<void> {
        const folderName = path.basename(folderPath);
        const spConfig = START_POINT_CONFIGS[startPoint] || START_POINT_CONFIGS['start-fresh'];

        if (spConfig.skipAudioGeneration) {
            this.log(`${folderName}: Skipping audio generation`);
            return;
        }

        const hasVideoStarted1 = ProgressTracker.isStepComplete(folderPath, 'notebooklm_video_1_started');
        const hasVideoStarted2 = ProgressTracker.isStepComplete(folderPath, 'notebooklm_video_2_started');
        const hasAudio = ProgressTracker.isStepComplete(folderPath, 'audio_generated');

        const shouldForce = spConfig.forceRegenerateNarration || spConfig.skipNarrationGeneration;
        if (!shouldForce && !((hasVideoStarted1 || hasVideoStarted2) && !hasAudio)) {
            this.log(`${folderName}: Audio not needed or already done`);
            return;
        }

        this.log(`${folderName}: Starting audio generation...`);

        try {
            this.updateFolderStatus(folderPath, { status: 'audio_generating' });

            const profileId = ProgressTracker.getFolderProfile(folderPath) || config.selectedProfiles[0] || 'profile1';
            await this.browser.initialize({ profileId });

            const outputDir = path.join(folderPath, 'output');
            const narrationPath = path.join(outputDir, 'perplexity_audio_response.txt');
            const legacyPath1 = path.join(outputDir, 'audio_narration.txt');
            const legacyPath2 = path.join(outputDir, 'audio_narration.md');

            let hasNarration = fs.existsSync(narrationPath) || fs.existsSync(legacyPath1) || fs.existsSync(legacyPath2);
            const shouldGenerateNarration = spConfig.forceRegenerateNarration || (!hasNarration && !spConfig.skipNarrationGeneration);

            if (shouldGenerateNarration) {
                this.log(`${folderName}: Generating narration via Perplexity...`);
                const settingsPath = path.join(process.cwd(), 'config', 'settings.json');
                const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));

                const videoResponsePath = path.join(folderPath, 'output', 'perplexity_video_response.txt');
                const legacyVR1 = path.join(folderPath, 'perplexity_response.txt');
                const legacyVR2 = path.join(folderPath, 'output', 'perplexity_response.txt');

                let contextFile = '';
                if (fs.existsSync(videoResponsePath)) contextFile = videoResponsePath;
                else if (fs.existsSync(legacyVR1)) contextFile = legacyVR1;
                else if (fs.existsSync(legacyVR2)) contextFile = legacyVR2;

                if (contextFile) {
                    // Get profile-specific audio narration URL
                    const audioNarrationUrl = settings.profiles?.[profileId]?.audioNarrationPerplexityUrl || settings.audioNarrationPerplexityUrl || 'https://www.perplexity.ai/';

                    const genResult = await this.perplexityTester.testWorkflow({
                        chatUrl: audioNarrationUrl,
                        files: [contextFile],
                        prompt: settings.audioNarrationPrompt || 'Create a voiceover script based on this.',
                        sourceFolder: folderPath,
                        headless: settings.headlessMode,
                        shouldDeleteConversation: settings.deleteConversation,
                        model: (settings.audioNarrationPerplexityModel || settings.perplexityModel) || undefined,
                        profileId: profileId,
                        outputFilename: 'perplexity_audio_response'
                    });

                    if (genResult.success) {
                        hasNarration = true;
                        // Mark the audio narration step as complete
                        ProgressTracker.markStepComplete(folderPath, 'perplexity_narration');
                        await this.sleep(2000);
                    } else {
                        throw new Error(`Narration failed: ${genResult.message}`);
                    }
                }
            }

            if (hasNarration) {
                const { AudioGenerator } = await import('./AudioGenerator');
                const audioGen = new AudioGenerator();
                let finalNarrationPath = narrationPath;
                if (!fs.existsSync(finalNarrationPath)) {
                    finalNarrationPath = fs.existsSync(legacyPath1) ? legacyPath1 : legacyPath2;
                }

                await audioGen.generateAudio({
                    sourceFolder: folderPath,
                    profileId: profileId,
                    narrationFilePath: finalNarrationPath
                });

                ProgressTracker.markStepComplete(folderPath, 'audio_generated');
                this.updateFolderStatus(folderPath, { status: 'complete' });
                this.log(`${folderName}: Audio generation complete`);
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.updateFolderStatus(folderPath, { status: 'error', error: errorMsg });
            this.log(`${folderName}: Audio error - ${errorMsg}`);
        }

        await this.sleep(this.delays.betweenAudioSlidesMs);
    }

    /**
     * Full batch processing workflow: Sequential Folder Processing (Prompt -> Fire -> Audio) then Batch Collect
     */
    public async processAll(config: BatchConfig): Promise<BatchResult> {
        if (this.isProcessing) {
            throw new Error('Batch processing already in progress');
        }

        this.isProcessing = true;
        this.abortRequested = false;

        this.currentBatch = config.folders.map(folder => ({
            folderPath: folder.path,
            folderName: path.basename(folder.path),
            status: 'pending' as FolderStatus,
            profileId: ProgressTracker.getFolderProfile(folder.path) ?? undefined
        }));
        this.onStatusChange?.(this.currentBatch);

        try {
            let profileIndex = 0;

            // Process folders ONE BY ONE: Prompt -> Fire Videos -> Audio
            for (const folderConfig of config.folders) {
                if (this.abortRequested) break;

                const folderPath = folderConfig.path;

                // 1. Generate PROMPT
                profileIndex = await this.processFolderPrompts(folderConfig, config, profileIndex);

                // 2. FIRE videos
                profileIndex = await this.processFolderVideos(folderConfig, config, profileIndex);

                // 3. Generate AUDIO
                await this.processFolderAudio(folderPath, folderConfig.startPoint, config);

                this.log(`Completed primary processing for folder: ${path.basename(folderPath)}`);
            }

            // Final Phase: COLLECT all videos that were fired
            if (!this.abortRequested) {
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
     * Process Perplexity prompt generation for a single folder
     */
    private async processFolderPrompts(
        folderConfig: FolderConfig,
        config: BatchConfig,
        profileIndex: number
    ): Promise<number> {
        const folderPath = folderConfig.path;
        const folderName = path.basename(folderPath);
        const startPoint = folderConfig.startPoint;
        const spConfig = START_POINT_CONFIGS[startPoint] || START_POINT_CONFIGS['start-fresh'];

        if (spConfig.clearProgress) {
            this.log(`${folderName}: Start Fresh - clearing progress`);
            ProgressTracker.clearProgress(folderPath);
        }

        if (spConfig.skipPerplexity) {
            this.log(`${folderName}: Skipping Perplexity`);
            return profileIndex;
        }

        if (startPoint !== 'start-fresh' && ProgressTracker.isStepComplete(folderPath, 'perplexity')) {
            this.log(`${folderName}: Perplexity already done`);
            return profileIndex;
        }

        try {
            const profileId = this.assignProfile(folderPath, config.selectedProfiles, profileIndex);
            this.updateFolderStatus(folderPath, { status: 'pending' });

            await this.browser.initialize({ profileId });

            const settingsPath = path.join(process.cwd(), 'config', 'settings.json');
            const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
            const profileSettings = settings.profiles?.[profileId] || {};

            const files = fs.readdirSync(folderPath)
                .filter(f => /\.(pdf|txt|md|docx?|jpe?g|png)$/i.test(f))
                .map(f => path.join(folderPath, f));

            this.log(`${folderName}: Generating prompt (Profile: ${profileId})...`);
            const result = await this.perplexityTester.testWorkflow({
                chatUrl: profileSettings.perplexityChatUrl || settings.perplexityChatUrl,
                files,
                prompt: settings.promptText,
                sourceFolder: folderPath,
                headless: settings.headlessMode ?? false,
                shouldDeleteConversation: settings.deleteConversation,
                model: settings.perplexityModel,
                profileId
            });

            if (result.success) {
                ProgressTracker.markStepComplete(folderPath, 'perplexity');
            } else {
                throw new Error(`Perplexity failed: ${result.message}`);
            }

            await this.sleep(3000);
            return profileIndex + 1;
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.updateFolderStatus(folderPath, { status: 'error', error: errorMsg });
            this.log(`${folderName}: Perplexity error - ${errorMsg}`);
            return profileIndex + 1;
        }
    }
}
