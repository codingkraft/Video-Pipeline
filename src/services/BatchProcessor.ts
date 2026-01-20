import { ProgressTracker, PIPELINE_STEPS, START_POINTS, StartPointKey, START_POINT_CONFIGS } from './ProgressTracker';
import { NotebookLMTester, NotebookLMTestConfig } from './NotebookLMTester';
import { PerplexityTester } from './PerplexityTester';
import { GoogleStudioTester } from './GoogleStudioTester';
import { NotebookLMRemoverTester } from './NotebookLMRemoverTester';
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
    startPoint: StartPointKey;
    skipTTSGeneration?: boolean;  // Skip audio generation, only run Whisper check
}

/**
 * Batch processing configuration
 */
export interface BatchConfig {
    folders: FolderConfig[];            // Folders with their start points
    selectedProfiles: string[];         // DEPRECATED: Use selectedProfile instead
    selectedProfile?: string;           // Single profile to use for all processing
    concurrencyLimit?: number;          // Max folders to process in parallel (default: 5)
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
    startPoint?: string;
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
    private logoRemoverTester: NotebookLMRemoverTester;
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
        this.logoRemoverTester = new NotebookLMRemoverTester();
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
     * Process items in parallel with concurrency limit
     */
    private async processInParallel<T, R>(
        items: T[],
        processor: (item: T) => Promise<R>,
        concurrencyLimit: number = 5
    ): Promise<R[]> {
        const results: R[] = [];
        const executing: Promise<void>[] = [];

        for (const item of items) {
            if (this.abortRequested) break;

            const promise = (async () => {
                try {
                    const result = await processor(item);
                    results.push(result);
                } catch (error) {
                    // Error is already logged in processor, just continue
                    console.error(`[BatchProcessor] Parallel task error:`, error);
                }
            })();

            executing.push(promise);

            // If we've reached concurrency limit, wait for one to complete
            if (executing.length >= concurrencyLimit) {
                await Promise.race(executing);
                // Remove completed promises
                for (let i = executing.length - 1; i >= 0; i--) {
                    const p = executing[i];
                    // Check if promise is settled by racing with immediate resolve
                    const settled = await Promise.race([p.then(() => true), Promise.resolve(false)]);
                    if (settled) {
                        executing.splice(i, 1);
                    }
                }
            }
        }

        // Wait for remaining tasks
        await Promise.all(executing);
        return results;
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
     * Uses modular approach: setupNotebook (once) + generateVideo (per video)
     * On error after retries, stops processing this folder.
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
        let notebookUrl: string | undefined;

        // Step 1: Setup notebook (only for video 1 if needed)
        const needsSetup = !spConfig.skipNotebookCreation &&
            !ProgressTracker.isStepComplete(folderPath, 'notebooklm_notebook_created');

        if (needsSetup || startPoint === 'update-sources') {
            try {
                const profileId = this.assignProfile(folderPath, config.selectedProfiles, currentProfileIndex);
                currentProfileIndex++;

                this.log(`${folderName}: Setting up notebook with profile ${profileId}...`);
                this.updateFolderStatus(folderPath, { status: 'video_generating', profileId });

                notebookUrl = await this.notebookLMTester.setupNotebook({
                    sourceFolder: folderPath,
                    headless: false,
                    profileId,
                    visualStyle: config.visualStyle,
                    forceSourceUpload: startPoint === 'update-sources'
                });

                this.log(`${folderName}: Notebook setup complete: ${notebookUrl}`);
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                this.updateFolderStatus(folderPath, { status: 'error', error: errorMsg });
                this.log(`${folderName}: Notebook setup failed - ${errorMsg}. Stopping folder processing.`);
                return currentProfileIndex;  // Stop processing this folder
            }
        } else {
            // Get existing notebook URL
            const progress = ProgressTracker.getProgress(folderPath);
            notebookUrl = progress?.steps.notebooklm_notebook_created?.notebookUrl ||
                progress?.steps.notebooklm_video_1_started?.notebookUrl;
        }

        if (!notebookUrl) {
            this.updateFolderStatus(folderPath, { status: 'error', error: 'No notebook URL available' });
            this.log(`${folderName}: No notebook URL found. Stopping folder processing.`);
            return currentProfileIndex;
        }

        // Step 2: Generate videos
        for (let videoNum = 1; videoNum <= 2; videoNum++) {
            if (this.abortRequested) break;

            const behavior = videoNum === 1 ? spConfig.video1Behavior : spConfig.video2Behavior;
            const videoStepName = `notebooklm_video_${videoNum}_started` as const;

            // Evaluate Behavior
            if (behavior === 'skip') {
                this.log(`${folderName}: Video ${videoNum} behavior is 'skip', skipping`);
                continue;
            }

            const isComplete = ProgressTracker.isStepComplete(folderPath, videoStepName);
            if (behavior === 'if-needed' && isComplete) {
                this.log(`${folderName}: Video ${videoNum} already started, skipping`);
                continue;
            }

            try {
                const profileId = this.assignProfile(folderPath, config.selectedProfiles, currentProfileIndex);
                currentProfileIndex++;

                this.updateFolderStatus(folderPath, {
                    status: 'video_generating',
                    profileId,
                    notebookUrl
                });

                this.log(`${folderName}: Starting video ${videoNum}/2 generation with profile ${profileId}`);

                const result = await this.notebookLMTester.generateVideo(notebookUrl, {
                    sourceFolder: folderPath,
                    headless: false,
                    visualStyle: config.visualStyle,
                    profileId,
                    existingNotebookUrl: notebookUrl
                });

                // Update progress
                ProgressTracker.updateStep(folderPath, videoStepName, {
                    completed: true,
                    videoStartedAt: new Date().toISOString(),
                    notebookUrl: result.details?.notebookUrl || notebookUrl
                });

                this.updateFolderStatus(folderPath, {
                    status: 'video_generating',
                    videoStartedAt: new Date().toISOString(),
                    notebookUrl: result.details?.notebookUrl || notebookUrl
                });

                this.log(`${folderName}: Video ${videoNum}/2 generation started successfully`);

                if (!this.abortRequested && videoNum < 2) {
                    const delayMs = this.delays.betweenVideoStartsMs;
                    this.log(`Waiting ${delayMs / 1000}s before next video (rate limiting)...`);
                    await this.sleep(delayMs);
                }
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                this.updateFolderStatus(folderPath, { status: 'error', error: errorMsg });
                this.log(`${folderName}: Video ${videoNum}/2 failed - ${errorMsg}. Stopping folder processing.`);
                return currentProfileIndex;  // Stop processing this folder on error
            }
        }
        return currentProfileIndex;
    }

    /**
     * Load pending folders from ProgressTracker (for resume after restart)
     * Now checks for both video_1 and video_2
     */
    /**
     * Load pending folders from ProgressTracker (for resume after restart)
     * Returns unique folders that have ANY video started but not downloaded.
     */
    private loadPendingFoldersFromProgress(providedFolders?: string[]): FolderBatchStatus[] {
        const foldersToCheck = providedFolders || this.currentBatch.map(f => f.folderPath);
        // Use Set to ensure uniqueness of folder paths to check
        const uniquePaths = [...new Set(foldersToCheck)];
        const pending: FolderBatchStatus[] = [];

        for (const folderPath of uniquePaths) {
            const progress = ProgressTracker.getProgress(folderPath);
            if (!progress) continue;

            const isV1Pending = progress.steps['notebooklm_video_1_started']?.completed &&
                !progress.steps['notebooklm_video_1_downloaded']?.completed;
            const isV2Pending = progress.steps['notebooklm_video_2_started']?.completed &&
                !progress.steps['notebooklm_video_2_downloaded']?.completed;

            if (isV1Pending || isV2Pending) {
                // Check if we already have this folder in currentBatch
                const existing = this.currentBatch.find(f => f.folderPath === folderPath);

                if (existing) {
                    pending.push(existing);
                } else {
                    // Create new status entry
                    // Try to find a valid notebook URL from any completed step
                    const notebookUrl = progress.steps.notebooklm_notebook_created?.notebookUrl ||
                        progress.steps.notebooklm_video_1_started?.notebookUrl ||
                        progress.steps.notebooklm_video_2_started?.notebookUrl;

                    pending.push({
                        folderPath,
                        folderName: path.basename(folderPath),
                        status: 'video_generating',
                        profileId: progress.profileId,
                        notebookUrl,
                        videoStartedAt: progress.lastUpdated // Approximate
                    });
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

        // Force reset download status for folders that requested collection
        // This ensures they are picked up by the filter and the loop
        const foldersToReset = providedFolders || this.currentBatch.map(f => f.folderPath);
        for (const folderPath of foldersToReset) {
            const status = this.currentBatch.find(f => f.folderPath === folderPath);
            if (status?.startPoint === 'collect-videos') {
                // Clear download steps so the filter and loop treat them as pending
                ProgressTracker.updateStep(folderPath, 'notebooklm_video_1_downloaded', { completed: false });
                ProgressTracker.updateStep(folderPath, 'notebooklm_video_2_downloaded', { completed: false });
                this.log(`Forced re-download enabled for ${path.basename(folderPath)}`);
            }
        }

        // Load pending folders (unique entries)
        let pendingFolders = this.loadPendingFoldersFromProgress(providedFolders);

        // Merge updated pending objects into currentBatch
        if (this.currentBatch.length > 0) {
            for (const pending of pendingFolders) {
                const existing = this.currentBatch.find(f => f.folderPath === pending.folderPath);
                if (existing) {
                    Object.assign(existing, pending);
                } else {
                    this.currentBatch.push(pending);
                }
            }
        } else {
            this.currentBatch = pendingFolders;
        }

        // Re-filter to get active pending folders (refresh from source of truth)
        // We filter out folders where ALL started videos are downloaded
        pendingFolders = this.currentBatch.filter(f => {
            const progress = ProgressTracker.getProgress(f.folderPath);
            if (!progress) return false;

            // Check if "Collect Videos" mode is forced for this folder
            const isCollectForce = f.startPoint === 'collect-videos';
            // We can collect if we have a notebook URL (created or from manual/previous steps)
            const hasNotebook = !!(progress.steps['notebooklm_notebook_created']?.notebookUrl || f.notebookUrl || progress.steps['notebooklm_video_1_started']?.notebookUrl);

            // V1 Pending: Started OR (Force Mode & Notebook exists) AND Not Downloaded
            const isV1Pending = (progress.steps['notebooklm_video_1_started']?.completed || (isCollectForce && hasNotebook)) &&
                !progress.steps['notebooklm_video_1_downloaded']?.completed;

            // V2 Pending: Same logic
            const isV2Pending = (progress.steps['notebooklm_video_2_started']?.completed || (isCollectForce && hasNotebook)) &&
                !progress.steps['notebooklm_video_2_downloaded']?.completed;

            return isV1Pending || isV2Pending;
        });

        if (pendingFolders.length === 0) {
            this.log('No pending videos to collect');
            return this.currentBatch;
        }

        this.log(`Found ${pendingFolders.length} folders with videos in progress`);
        this.onStatusChange?.(this.currentBatch);

        const startTime = Date.now();

        while (pendingFolders.length > 0 && !this.abortRequested) {
            // Check max wait time
            if (Date.now() - startTime > this.delays.maxWaitForVideoMs) {
                this.log('Max wait time exceeded, stopping collect phase');
                break;
            }

            let anyStillGenerating = false; // Track if we need to wait

            // Iterate over a copy to safe-delete
            for (const folder of [...pendingFolders]) {
                if (this.abortRequested) break;

                const folderName = path.basename(folder.folderPath);
                const progress = ProgressTracker.getProgress(folder.folderPath);
                if (!progress) continue;

                // Get notebook URL
                const notebookUrl = progress.steps['notebooklm_video_1_started']?.notebookUrl ||
                    folder.notebookUrl ||
                    progress.steps.notebooklm_notebook_created?.notebookUrl;

                if (!notebookUrl) {
                    this.log(`${folderName}: No Notebook URL found, cannot collect videos`);
                    this.updateFolderStatus(folder.folderPath, { status: 'error' });
                    const idx = pendingFolders.indexOf(folder);
                    if (idx > -1) pendingFolders.splice(idx, 1);
                    continue;
                }

                // Determine expected video count (2 by default, or check how many were started)
                const v1Started = progress.steps['notebooklm_video_1_started']?.completed;
                const v2Started = progress.steps['notebooklm_video_2_started']?.completed;
                const expectedVideos = (v1Started && v2Started) ? 2 : (v1Started ? 1 : 2);

                try {
                    // Initialize browser with profile
                    const profileId = folder.profileId || ProgressTracker.getFolderProfile(folder.folderPath) || undefined;

                    this.log(`${folderName}: Checking video status...`);
                    this.updateFolderStatus(folder.folderPath, { status: 'video_generating' });

                    // Use the modular collectVideos method
                    const outputDir = path.join(folder.folderPath, 'output');
                    const result = await this.notebookLMTester.collectVideos(
                        notebookUrl,
                        outputDir,
                        expectedVideos,
                        profileId
                    );

                    if (result.status === 'generating') {
                        // Still generating - wait
                        const startedAt = progress.steps['notebooklm_video_1_started']?.videoStartedAt;
                        const elapsed = startedAt ? Math.round((Date.now() - new Date(startedAt).getTime()) / 60000) : 0;
                        this.log(`${folderName}: Videos still generating... (${elapsed}m)`);
                        anyStillGenerating = true;
                    } else if (result.status === 'ready' && result.downloaded.length > 0) {
                        // Downloaded successfully
                        this.log(`${folderName}: Downloaded ${result.downloaded.length} video(s)`);

                        // Mark progress for each downloaded video
                        result.downloaded.forEach((videoPath, idx) => {
                            const downloadedKey = `notebooklm_video_${idx + 1}_downloaded` as any;
                            ProgressTracker.markStepComplete(folder.folderPath, downloadedKey, {
                                videoFilePath: videoPath
                            });
                        });

                        this.updateFolderStatus(folder.folderPath, { status: 'complete' });
                        const idx = pendingFolders.indexOf(folder);
                        if (idx > -1) pendingFolders.splice(idx, 1);
                    } else {
                        // Error status
                        this.log(`${folderName}: Video collection failed`);
                        this.updateFolderStatus(folder.folderPath, { status: 'error' });
                        const idx = pendingFolders.indexOf(folder);
                        if (idx > -1) pendingFolders.splice(idx, 1);
                    }
                } catch (e) {
                    // Error after retries - stop processing this folder
                    this.log(`${folderName}: Error - ${(e as Error).message}`);
                    this.updateFolderStatus(folder.folderPath, { status: 'error' });
                    const idx = pendingFolders.indexOf(folder);
                    if (idx > -1) pendingFolders.splice(idx, 1);
                }
            }

            // Only wait if something is actually generating (not if downloads complete/fail)
            if (anyStillGenerating && pendingFolders.length > 0 && !this.abortRequested) {
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
        config: BatchConfig,
        folderConfig?: FolderConfig
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
                const settingsPath = path.join(process.cwd(), 'config', 'settings.json');
                const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));

                // Find narration input file in source folder
                let contextFile = '';
                try {
                    const filesInFolder = fs.readdirSync(folderPath);
                    const narrationFile = filesInFolder.find(f =>
                        f.toLowerCase().includes('narration') && f.toLowerCase().endsWith('.txt')
                    );

                    if (narrationFile) {
                        contextFile = path.join(folderPath, narrationFile);
                        this.log(`${folderName}: Found narration input file: ${narrationFile}`);
                    } else {
                        throw new Error(`No narration input file found in folder. Expected a .txt file with "narration" in the filename.`);
                    }
                } catch (error) {
                    // Re-throw the error to stop execution
                    throw new Error(`Failed to find narration input file: ${(error as Error).message}`);
                }

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

                    // Replace [PAUSE] markers with 'next slide please' for Whisper-based splitting
                    const outputPath = path.join(outputDir, 'perplexity_audio_response.txt');
                    if (fs.existsSync(outputPath)) {
                        let content = fs.readFileSync(outputPath, 'utf-8');
                        const originalLength = content.length;
                        content = content.replace(/\[PAUSE\]/gi, 'next slide please');
                        fs.writeFileSync(outputPath, content, 'utf-8');
                        this.log(`${folderName}: Replaced [PAUSE] markers with 'next slide please' in narration file`);
                    }

                    await this.sleep(2000);
                } else {
                    throw new Error(`Narration generation failed: ${genResult.message}`);
                }
            }

            if (!hasNarration) {
                throw new Error(`No narration file found. Cannot proceed with audio generation.`);
            }

            // Generate audio from narration
            const { AudioGenerator } = await import('./AudioGenerator');
            const audioGen = new AudioGenerator();
            let finalNarrationPath = narrationPath;
            if (!fs.existsSync(finalNarrationPath)) {
                finalNarrationPath = fs.existsSync(legacyPath1) ? legacyPath1 : legacyPath2;
            }

            // Read settings for Google Studio configuration
            const settingsPath = path.join(process.cwd(), 'config', 'settings.json');
            const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));

            const skipTTS = folderConfig?.skipTTSGeneration ?? false;
            this.log(`${folderName}: skipTTSGeneration=${skipTTS} (folderConfig=${JSON.stringify(folderConfig)})`);

            await audioGen.generateAudio({
                sourceFolder: folderPath,
                profileId: profileId,
                narrationFilePath: finalNarrationPath,
                googleStudioModel: settings.googleStudioModel,
                googleStudioVoice: settings.googleStudioVoice,
                googleStudioStyleInstructions: settings.googleStudioStyleInstructions,
                skipTTSGeneration: skipTTS
            });

            ProgressTracker.markStepComplete(folderPath, 'audio_generated');
            this.updateFolderStatus(folderPath, { status: 'complete' });
            this.log(`${folderName}: Audio generation complete`);
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.updateFolderStatus(folderPath, { status: 'error', error: errorMsg });
            this.log(`${folderName}: Audio error - ${errorMsg}`);
        }

        await this.sleep(this.delays.betweenAudioSlidesMs);
    }

    /**
     * Full batch processing workflow with parallel phases:
     * 1. Generate prompts (sequential - lightweight)
     * 2. Fire videos (parallel with concurrency limit)
     * 3. Generate audio (parallel with concurrency limit)
     * 4. Collect, Remove Logos, Create Timelines (batch operations)
     */
    public async processAll(config: BatchConfig): Promise<BatchResult> {
        if (this.isProcessing) {
            throw new Error('Batch processing already in progress');
        }

        this.isProcessing = true;
        this.abortRequested = false;

        // Use single profile or first from array for backward compatibility
        const profileId = config.selectedProfile || config.selectedProfiles?.[0] || 'default';
        const concurrencyLimit = config.concurrencyLimit ?? 5;

        this.log(`Starting parallel batch processing with profile: ${profileId}, concurrency: ${concurrencyLimit}`);

        this.currentBatch = config.folders.map(folder => ({
            folderPath: folder.path,
            folderName: path.basename(folder.path),
            status: 'pending' as FolderStatus,
            profileId: profileId,
            startPoint: folder.startPoint
        }));
        this.onStatusChange?.(this.currentBatch);

        try {
            // PHASE 1: Generate PROMPTS (sequential - quick operation)
            this.log(`📄 Phase 1: Generating prompts for ${config.folders.length} folders...`);
            for (const folderConfig of config.folders) {
                if (this.abortRequested) break;
                await this.processFolderPrompts(folderConfig, config, 0);
            }

            // PHASE 2: FIRE all videos in parallel
            if (!this.abortRequested) {
                this.log(`🚀 Phase 2: Firing videos in parallel (${concurrencyLimit} at a time)...`);
                await this.processInParallel(
                    config.folders,
                    async (folderConfig) => {
                        await this.processFolderVideos(folderConfig, config, 0);
                        return folderConfig.path;
                    },
                    concurrencyLimit
                );
            }

            // PHASE 3: Generate AUDIO in parallel
            if (!this.abortRequested) {
                this.log(`🎙️ Phase 3: Generating audio in parallel (${concurrencyLimit} at a time)...`);
                await this.processInParallel(
                    config.folders,
                    async (folderConfig) => {
                        await this.processFolderAudio(folderConfig.path, folderConfig.startPoint, config, folderConfig);
                        return folderConfig.path;
                    },
                    concurrencyLimit
                );
            }

            // PHASE 4: COLLECT all videos that were fired
            if (!this.abortRequested) {
                this.log(`📥 Phase 4: Collecting completed videos...`);
                await this.collectAllVideos();

                // PHASE 5: Remove Logos
                if (!this.abortRequested) {
                    this.log(`✨ Phase 5: Removing logos...`);
                    await this.removeLogosForAll();
                }

                // PHASE 6: Create Timelines
                if (!this.abortRequested) {
                    this.log(`🎬 Phase 6: Creating timelines...`);
                    await this.createTimelinesForAll();
                }
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

    /**
     * Force reset the processing state (for recovery from stuck state)
     */
    public forceReset(): void {
        this.log('Force reset requested - clearing processing state');
        this.isProcessing = false;
        this.abortRequested = false;
        this.currentBatch = [];
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Process prompt generation for a single folder
     * NOTE: Video prompt (video_response.txt) is now generated by VideoFolderCreator,
     * so this step is deprecated. Keeping method for compatibility but it just logs and returns.
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

        // Video prompt is now generated by VideoFolderCreator (video_response.txt)
        // This step is no longer needed - just log and return
        this.log(`${folderName}: Video prompt generated by VideoFolderCreator (skipping Perplexity)`);

        // Mark as complete for backwards compatibility
        if (!ProgressTracker.isStepComplete(folderPath, 'perplexity')) {
            ProgressTracker.markStepComplete(folderPath, 'perplexity');
        }

        return profileIndex;
    }


    /**
     * PHASE 3: Remove logos from all collected videos
     */
    public async removeLogosForAll(): Promise<void> {
        this.log('Starting PHASE 3: Remove logos');

        for (const folderStatus of this.currentBatch) {
            if (this.abortRequested) break;

            // Re-constitute minimal config for the method
            const folderConfig: FolderConfig = {
                path: folderStatus.folderPath,
                startPoint: (folderStatus.startPoint as any) || 'start-fresh'
            };

            await this.processFolderLogoRemoval(folderConfig, {
                folders: [],
                selectedProfiles: [],
                // We don't really need full batch config here for this specific method
                notebookLmChatSettings: ''
            });
        }
    }

    /**
     * PHASE 4: Create Timelines for all folders
     */
    public async createTimelinesForAll(): Promise<void> {
        this.log('Starting PHASE 4: Create Timelines');

        // Dynamic import to avoid circular dependencies
        const { TimelineProcessor } = await import('../processing/TimelineProcessor');
        const timelineProcessor = new TimelineProcessor();

        for (const folderStatus of this.currentBatch) {
            if (this.abortRequested) break;

            const folderPath = folderStatus.folderPath;
            const folderName = path.basename(folderPath);
            const outputDir = path.join(folderPath, 'output');
            const timelineOutputDir = path.join(outputDir, 'timeline');

            // 1. Identify Videos (prefer clean versions)
            const videoPaths: string[] = [];

            // Check Video 1
            const v1Clean = path.join(outputDir, 'notebooklm_video_1_clean.mp4');
            const v1Raw = path.join(outputDir, 'notebooklm_video_1.mp4');
            if (fs.existsSync(v1Clean)) videoPaths.push(v1Clean);
            else if (fs.existsSync(v1Raw)) videoPaths.push(v1Raw);

            // Check Video 2
            const v2Clean = path.join(outputDir, 'notebooklm_video_2_clean.mp4');
            const v2Raw = path.join(outputDir, 'notebooklm_video_2.mp4');
            if (fs.existsSync(v2Clean)) videoPaths.push(v2Clean);
            else if (fs.existsSync(v2Raw)) videoPaths.push(v2Raw);

            if (videoPaths.length === 0) {
                this.log(`${folderName}: No videos found for timeline, skipping`);
                continue;
            }

            // 2. Identify Audio - prefer pre-split audio clips from timeline folder
            const audioPaths: string[] = [];
            let usingPreSplitAudio = false;

            // First, check for pre-split slide files in timeline/audio_clips (new location)
            const timelineAudioDir = path.join(outputDir, 'timeline', 'audio_clips');
            if (fs.existsSync(timelineAudioDir)) {
                const slideFiles = fs.readdirSync(timelineAudioDir)
                    .filter(f => f.startsWith('slide_') && f.endsWith('.wav'))
                    .sort((a, b) => {
                        const numA = parseInt(a.match(/slide_(\d+)/)?.[1] || '0');
                        const numB = parseInt(b.match(/slide_(\d+)/)?.[1] || '0');
                        return numA - numB;
                    })
                    .map(f => path.join(timelineAudioDir, f));

                if (slideFiles.length > 0) {
                    this.log(`${folderName}: Found ${slideFiles.length} pre-split audio clips in timeline folder`);
                    audioPaths.push(...slideFiles);
                    usingPreSplitAudio = true;
                }
            }

            // Fall back to old location (audio/*_slides) for backwards compatibility
            const audioDir = path.join(outputDir, 'audio');
            if (audioPaths.length === 0 && fs.existsSync(audioDir)) {
                const slideDirs = fs.readdirSync(audioDir)
                    .filter(d => d.endsWith('_slides'))
                    .map(d => path.join(audioDir, d))
                    .filter(p => fs.statSync(p).isDirectory());

                if (slideDirs.length > 0) {
                    const slideDir = slideDirs[0];
                    const slideFiles = fs.readdirSync(slideDir)
                        .filter(f => f.startsWith('slide_') && f.endsWith('.wav'))
                        .sort((a, b) => {
                            const numA = parseInt(a.match(/slide_(\d+)/)?.[1] || '0');
                            const numB = parseInt(b.match(/slide_(\d+)/)?.[1] || '0');
                            return numA - numB;
                        })
                        .map(f => path.join(slideDir, f));

                    if (slideFiles.length > 0) {
                        this.log(`${folderName}: Found ${slideFiles.length} pre-split audio slides (legacy location)`);
                        audioPaths.push(...slideFiles);
                        usingPreSplitAudio = true;
                    }
                }

                // Fall back to raw narration files if no pre-split slides found
                if (audioPaths.length === 0) {
                    const a1 = path.join(audioDir, 'narration_take_1.wav');
                    const a2 = path.join(audioDir, 'narration_take_2.wav');

                    if (fs.existsSync(a1)) audioPaths.push(a1);
                    if (fs.existsSync(a2)) audioPaths.push(a2);
                }
            }

            if (audioPaths.length === 0) {
                this.log(`${folderName}: No audio found for timeline (continuing with video only)`);
            }

            // 3. Create Timeline
            this.log(`${folderName}: Creating timeline with ${videoPaths.length} videos and ${audioPaths.length} audios...`);

            try {
                const result = await timelineProcessor.createTimeline({
                    videoPaths,
                    audioPaths,
                    outputDir: timelineOutputDir,
                    exportFormat: 'xml',
                    sceneThreshold: 0.02, // Optimized for slideshows
                    reducedPauseDuration: 1,
                    projectName: folderName,
                    skipAudioSilenceDetection: usingPreSplitAudio  // Skip silence detection for pre-split audio
                });

                if (result.success) {
                    this.log(`${folderName}: Timeline created successfully at ${result.timelinePath}`);
                    // Optional: Update progress/status if we tracked timeline step
                } else {
                    this.log(`${folderName}: Timeline creation failed: ${result.message}`);
                }
            } catch (error) {
                this.log(`${folderName}: Timeline creation error: ${(error as Error).message}`);
            }
        }
    }

    /**
     * Process logo removal for a folder
     */
    private async processFolderLogoRemoval(
        folderConfig: FolderConfig,
        config: BatchConfig
    ): Promise<void> {
        const folderPath = folderConfig.path;
        const folderName = path.basename(folderPath);
        const startPoint = folderConfig.startPoint;
        const spConfig = START_POINT_CONFIGS[startPoint] || START_POINT_CONFIGS['start-fresh'];

        if (spConfig.skipLogoRemoval) {
            this.log(`${folderName}: Logo removal skipped by configuration`);
            return;
        }

        // Initialize browser for logo removal (once per folder)
        const profileId = ProgressTracker.getFolderProfile(folderPath);
        if (profileId) {
            await this.browser.initialize({ profileId });
        }

        // Check both video 1 and video 2
        for (let i = 1; i <= 2; i++) {
            if (this.abortRequested) break;

            const stepName = `notebooklm_video_${i}_logo_removed` as const;

            // Force removal if start point is 'remove-logo'
            const shouldForce = startPoint === 'remove-logo';

            if (!shouldForce && ProgressTracker.isStepComplete(folderPath, stepName)) {
                this.log(`${folderName}: Logo removal for video ${i} already complete`);
                continue;
            }

            // Check if downloaded video exists
            const progress = ProgressTracker.getProgress(folderPath);
            const downloadStepName = `notebooklm_video_${i}_downloaded` as const;
            const downloadedPath = progress?.steps[downloadStepName]?.videoFilePath
                || (progress?.steps[downloadStepName] as any)?.videoPath; // Handle legacy prop safely

            let targetPath = downloadedPath;

            if (!downloadedPath) {
                this.log(`${folderName}: Video ${i} skipped (No download path recorded in progress.json). Run 'Collect Videos' first?`);
                continue;
            }

            if (!fs.existsSync(downloadedPath)) {
                // FALLBACK: Try to find a candidate file if the user renamed it
                const outputDir = path.dirname(downloadedPath);
                if (fs.existsSync(outputDir)) {
                    this.log(`${folderName}: Video ${i} file missing at ${path.basename(downloadedPath)}. Searching for candidate...`);

                    const candidates = fs.readdirSync(outputDir).filter(f =>
                        f.toLowerCase().endsWith('.mp4') &&
                        !f.toLowerCase().includes('clean') && // Not a clean version
                        f !== path.basename(progress?.steps[`notebooklm_video_${i === 1 ? 2 : 1}_downloaded`]?.videoFilePath || 'xxx') // Not the other video
                    );

                    // If we found candidates, verify they aren't the *other* video logic specifically
                    // actually checking strict filename against other video is safer
                    const otherVideoStep = `notebooklm_video_${i === 1 ? 2 : 1}_downloaded` as const;
                    const otherVideoPath = progress?.steps[otherVideoStep]?.videoFilePath;
                    const otherVideoName = otherVideoPath ? path.basename(otherVideoPath) : null;

                    const validCandidates = candidates.filter(f => f !== otherVideoName);

                    if (validCandidates.length === 1) {
                        targetPath = path.join(outputDir, validCandidates[0]);
                        this.log(`${folderName}: Found candidate file for Video ${i}: ${validCandidates[0]}`);
                    } else {
                        // Ambiguous or none
                        this.log(`${folderName}: Video ${i} skipped (File not found and no single unique candidate found). Candidates: ${validCandidates.join(', ')}`);
                        continue;
                    }
                } else {
                    this.log(`${folderName}: Video ${i} skipped (File not found at: ${downloadedPath})`);
                    continue;
                }
            }

            this.log(`${folderName}: Removing logo from video ${i} (${path.basename(targetPath)})...`);

            const result = await this.logoRemoverTester.removeLogo(targetPath);

            if (result.success && result.cleanVideoPath) {
                ProgressTracker.updateStep(folderPath, stepName, {
                    completed: true,
                    cleanVideoPath: result.cleanVideoPath
                });
                this.log(`${folderName}: Logo removal for video ${i} successful`);
            } else {
                this.log(`${folderName}: Logo removal for video ${i} failed: ${result.message}`);
                this.updateFolderStatus(folderPath, { error: `Logo removal failed for video ${i}` });
            }
        }
    }
}
