import * as fs from 'fs';
import * as path from 'path';

/**
 * Pipeline step names in order of execution.
 * When resetting from a step, all steps after it are also reset.
 */
export const PIPELINE_STEPS = [
    'perplexity',                     // DEPRECATED: Video prompt now from VideoFolderCreator
    'notebooklm_notebook_created',    // Create notebook
    'notebooklm_sources_uploaded',    // Upload sources
    'notebooklm_video_1_started',     // FIRE: First video generation started
    'notebooklm_video_2_started',     // FIRE: Second video generation started
    // While videos generate, do audio:
    'perplexity_narration',           // Generate narration text
    'audio_generated',                // Generate audio files
    // COLLECT: Download videos after audio is done
    'notebooklm_video_1_downloaded',  // First video downloaded
    'notebooklm_video_2_downloaded',  // Second video downloaded
    // POST-PROCESSING:
    'notebooklm_video_1_logo_removed', // Logo removed from first video
    'notebooklm_video_2_logo_removed', // Logo removed from second video
    'video_processed',                // Final video processing complete
    'pipeline_completed'              // Pipeline fully completed
] as const;

/**
 * Start points for UI dropdown.
 * Each maps to the pipeline step it resumes FROM.
 * Order matters - determines which options to show based on progress.
 */
export const START_POINTS = [
    { key: 'start-fresh', label: 'Start Fresh', resumeFrom: 'perplexity', description: 'Clear all, regenerate everything' },
    { key: 'create-notebook', label: 'Create Notebook', resumeFrom: 'notebooklm_notebook_created', description: 'Skip perplexity, create new notebook with fresh sources' },
    { key: 'update-sources', label: 'Update Sources', resumeFrom: 'notebooklm_sources_uploaded', description: 'Reuse notebook, re-upload sources' },
    { key: 'fire-video-1', label: 'Fire Video 1', resumeFrom: 'notebooklm_video_1_started', description: 'Assumes notebook exists, fire video 1' },
    { key: 'fire-video-2', label: 'Fire Video 2', resumeFrom: 'notebooklm_video_2_started', description: 'Fire video 2' },
    { key: 'audio-prompt', label: 'Audio Prompt', resumeFrom: 'perplexity_narration', description: 'Skip to audio narration generation' },
    { key: 'generate-audio', label: 'Generate Audio', resumeFrom: 'audio_generated', description: 'Skip to TTS' },
    { key: 'collect-videos', label: 'Collect Videos', resumeFrom: 'notebooklm_video_1_downloaded', description: 'Skip to video download' },
    { key: 'remove-logo', label: 'Remove Logo', resumeFrom: 'notebooklm_video_1_logo_removed', description: 'Remove branding from downloaded videos' },
    { key: 'process-video', label: 'Process Video', resumeFrom: 'video_processed', description: 'Final processing' },
    { key: 'completed', label: '✓ Completed', resumeFrom: 'pipeline_completed', description: 'Skip - folder already complete' },
] as const;

export type StartPointKey = typeof START_POINTS[number]['key'];
export type VideoBehavior = 'skip' | 'if-needed' | 'force';

export interface StartPointConfig {
    key: StartPointKey;
    label: string;
    description: string;
    // Configuration Flags
    clearProgress: boolean;         // Start Fresh: Clear all progress
    skipPerplexity: boolean;        // DEPRECATED: Video prompt now from VideoFolderCreator
    skipNotebookCreation: boolean;  // Skip creating new notebook (reuse existing)
    skipSourcesUpload: boolean;     // Skip uploading sources (reuse existing)
    video1Behavior: VideoBehavior;  // Behavior for first video
    video2Behavior: VideoBehavior;  // Behavior for second video
    forceRegenerateNarration: boolean; // Force regeneration of narration prompt
    skipNarrationGeneration: boolean;  // Skip narration prompt generation (direct to TTS)
    skipAudioGeneration: boolean;   // Skip audio generation entirely
    skipLogoRemoval: boolean;       // Skip logo removal
    skipVideoProcessing: boolean;   // Skip final video processing
}

export const START_POINT_CONFIGS: Record<StartPointKey, StartPointConfig> = {
    'start-fresh': {
        key: 'start-fresh', label: 'Start Fresh', description: 'Clear all, regenerate everything',
        clearProgress: true, skipPerplexity: true, skipNotebookCreation: false, skipSourcesUpload: false,
        video1Behavior: 'force', video2Behavior: 'force', forceRegenerateNarration: true, skipNarrationGeneration: false, skipAudioGeneration: false,
        skipLogoRemoval: false, skipVideoProcessing: false
    },
    'create-notebook': {
        key: 'create-notebook', label: 'Create Notebook', description: 'Skip perplexity, create new notebook with fresh sources',
        clearProgress: false, skipPerplexity: true, skipNotebookCreation: false, skipSourcesUpload: false,
        video1Behavior: 'force', video2Behavior: 'force', forceRegenerateNarration: true, skipNarrationGeneration: false, skipAudioGeneration: false,
        skipLogoRemoval: false, skipVideoProcessing: false
    },
    'update-sources': {
        key: 'update-sources', label: 'Update Sources', description: 'Reuse notebook, re-upload sources',
        clearProgress: false, skipPerplexity: true, skipNotebookCreation: true, skipSourcesUpload: false,
        video1Behavior: 'force', video2Behavior: 'force', forceRegenerateNarration: true, skipNarrationGeneration: false, skipAudioGeneration: false,
        skipLogoRemoval: false, skipVideoProcessing: false
    },
    'fire-video-1': {
        key: 'fire-video-1', label: 'Fire Video 1', description: 'Assumes notebook exists, fire video 1',
        clearProgress: false, skipPerplexity: true, skipNotebookCreation: true, skipSourcesUpload: true,
        video1Behavior: 'force', video2Behavior: 'force', forceRegenerateNarration: true, skipNarrationGeneration: false, skipAudioGeneration: false,
        skipLogoRemoval: false, skipVideoProcessing: false
    },
    'fire-video-2': {
        key: 'fire-video-2', label: 'Fire Video 2', description: 'Fire video 2',
        clearProgress: false, skipPerplexity: true, skipNotebookCreation: true, skipSourcesUpload: true,
        video1Behavior: 'skip', video2Behavior: 'force', forceRegenerateNarration: true, skipNarrationGeneration: false, skipAudioGeneration: false,
        skipLogoRemoval: false, skipVideoProcessing: false
    },
    'audio-prompt': {
        key: 'audio-prompt', label: 'Audio Prompt', description: 'Skip to audio narration generation',
        clearProgress: false, skipPerplexity: true, skipNotebookCreation: true, skipSourcesUpload: true,
        video1Behavior: 'skip', video2Behavior: 'skip', forceRegenerateNarration: true, skipNarrationGeneration: false, skipAudioGeneration: false,
        skipLogoRemoval: false, skipVideoProcessing: false
    },
    'generate-audio': {
        key: 'generate-audio', label: 'Generate Audio', description: 'Skip to TTS',
        clearProgress: false, skipPerplexity: true, skipNotebookCreation: true, skipSourcesUpload: true,
        video1Behavior: 'skip', video2Behavior: 'skip', forceRegenerateNarration: false, skipNarrationGeneration: true, skipAudioGeneration: false,
        skipLogoRemoval: false, skipVideoProcessing: false
    },
    'collect-videos': {
        key: 'collect-videos', label: 'Collect Videos', description: 'Skip to video download',
        clearProgress: false, skipPerplexity: true, skipNotebookCreation: true, skipSourcesUpload: true,
        video1Behavior: 'skip', video2Behavior: 'skip', forceRegenerateNarration: false, skipNarrationGeneration: true, skipAudioGeneration: true,
        skipLogoRemoval: false, skipVideoProcessing: false
    },
    'remove-logo': {
        key: 'remove-logo', label: 'Remove Logo', description: '[FUTURE] Remove branding',
        clearProgress: false, skipPerplexity: true, skipNotebookCreation: true, skipSourcesUpload: true,
        video1Behavior: 'skip', video2Behavior: 'skip', forceRegenerateNarration: false, skipNarrationGeneration: true, skipAudioGeneration: true,
        skipLogoRemoval: false, skipVideoProcessing: false
    },
    'process-video': {
        key: 'process-video', label: 'Process Video', description: 'Final processing',
        clearProgress: false, skipPerplexity: true, skipNotebookCreation: true, skipSourcesUpload: true,
        video1Behavior: 'skip', video2Behavior: 'skip', forceRegenerateNarration: false, skipNarrationGeneration: true, skipAudioGeneration: true,
        skipLogoRemoval: true, skipVideoProcessing: false
    },
    'completed': {
        key: 'completed', label: '✓ Completed', description: 'Skip - folder already complete',
        clearProgress: false, skipPerplexity: true, skipNotebookCreation: true, skipSourcesUpload: true,
        video1Behavior: 'skip', video2Behavior: 'skip', forceRegenerateNarration: false, skipNarrationGeneration: true, skipAudioGeneration: true,
        skipLogoRemoval: true, skipVideoProcessing: true
    }
};

export type StaticPipelineStep = typeof PIPELINE_STEPS[number];
export type PipelineStepName = StaticPipelineStep | `audio_slide_${number}` | string;

export interface StepProgress {
    completed: boolean;
    timestamp?: string;
    outputFile?: string;
    notebookUrl?: string;
    sourceCount?: number;
    steeringPrompt?: string;  // Generated by Perplexity for NotebookLM
    visualStyle?: string;     // Visual style for video generation
    textHash?: string;        // Hash of slide text for change detection
    slideCount?: number;      // Number of slides processed
    audioFiles?: string[];    // List of generated audio files
    videoStartedAt?: string;  // ISO timestamp when video generation was started
    videoFilePath?: string;   // Path to downloaded video file
    cleanVideoPath?: string;  // Path to video with logo removed
    error?: string;
}

export interface FolderProgress {
    folderPath: string;
    profileId?: string;  // Browser profile used for this folder
    steps: Record<string, StepProgress>;  // Dynamic keys for audio_slide_N
    lastUpdated: string;
}

/**
 * Utility class for tracking pipeline progress per folder.
 * Progress is stored in [folder]/output/progress.json
 */
export class ProgressTracker {
    private static PROGRESS_FILE = 'progress.json';

    /**
     * Get the progress file path for a folder.
     */
    public static getProgressFilePath(folderPath: string): string {
        return path.join(folderPath, 'output', ProgressTracker.PROGRESS_FILE);
    }

    /**
     * Load progress for a folder. Returns null if no progress exists.
     */
    public static getProgress(folderPath: string): FolderProgress | null {
        const progressPath = ProgressTracker.getProgressFilePath(folderPath);

        if (!fs.existsSync(progressPath)) {
            return null;
        }

        try {
            const content = fs.readFileSync(progressPath, 'utf-8');
            return JSON.parse(content) as FolderProgress;
        } catch (error) {
            console.error(`Failed to read progress file: ${progressPath}`, error);
            return null;
        }
    }

    /**
     * Initialize or get existing progress for a folder.
     */
    public static initProgress(folderPath: string): FolderProgress {
        const existing = ProgressTracker.getProgress(folderPath);
        if (existing) {
            return existing;
        }

        const progress: FolderProgress = {
            folderPath,
            steps: {},
            lastUpdated: new Date().toISOString()
        };

        ProgressTracker.saveProgress(folderPath, progress);
        return progress;
    }

    /**
     * Save progress to file.
     */
    public static saveProgress(folderPath: string, progress: FolderProgress): void {
        const progressPath = ProgressTracker.getProgressFilePath(folderPath);
        const outputDir = path.dirname(progressPath);

        // Ensure output directory exists
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        progress.lastUpdated = new Date().toISOString();
        fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2), 'utf-8');
    }

    /**
     * Update a specific step's status.
     */
    public static updateStep(
        folderPath: string,
        stepName: PipelineStepName,
        data: Partial<StepProgress>
    ): FolderProgress {
        const progress = ProgressTracker.initProgress(folderPath);

        progress.steps[stepName] = {
            ...progress.steps[stepName],
            ...data,
            completed: data.completed ?? progress.steps[stepName]?.completed ?? false,
            timestamp: data.completed ? new Date().toISOString() : progress.steps[stepName]?.timestamp
        };

        ProgressTracker.saveProgress(folderPath, progress);
        return progress;
    }

    /**
     * Mark a step as complete.
     */
    public static markStepComplete(
        folderPath: string,
        stepName: PipelineStepName,
        additionalData?: Partial<StepProgress>
    ): FolderProgress {
        return ProgressTracker.updateStep(folderPath, stepName, {
            ...additionalData,
            completed: true
        });
    }

    /**
     * Reset from a specific step. Clears this step and all steps after it.
     * Returns the updated progress.
     */
    public static resetFromStep(folderPath: string, stepName: StaticPipelineStep): FolderProgress {
        const progress = ProgressTracker.initProgress(folderPath);
        const stepIndex = PIPELINE_STEPS.indexOf(stepName);

        if (stepIndex === -1) {
            console.warn(`Unknown step: ${stepName}`);
            return progress;
        }

        // Clear this step and all steps after it
        for (let i = stepIndex; i < PIPELINE_STEPS.length; i++) {
            const step = PIPELINE_STEPS[i];
            if (progress.steps[step]) {
                progress.steps[step] = { completed: false };
            }
        }

        ProgressTracker.saveProgress(folderPath, progress);
        return progress;
    }

    /**
     * Check if a step is completed.
     */
    public static isStepComplete(folderPath: string, stepName: PipelineStepName): boolean {
        const progress = ProgressTracker.getProgress(folderPath);
        return progress?.steps[stepName]?.completed ?? false;
    }

    /**
     * Get the next incomplete step, or null if all are complete.
     */
    public static getNextIncompleteStep(folderPath: string): PipelineStepName | null {
        const progress = ProgressTracker.getProgress(folderPath);

        for (const step of PIPELINE_STEPS) {
            if (!progress?.steps[step]?.completed) {
                return step;
            }
        }

        return null;
    }

    /**
     * Get summary of completed steps for UI display.
     */
    public static getCompletionSummary(folderPath: string): {
        completedSteps: PipelineStepName[];
        nextStep: PipelineStepName | null;
        notebookUrl?: string;
    } {
        const progress = ProgressTracker.getProgress(folderPath);
        const completedSteps: PipelineStepName[] = [];
        let notebookUrl: string | undefined;

        for (const step of PIPELINE_STEPS) {
            if (progress?.steps[step]?.completed) {
                completedSteps.push(step);
                if (step === 'notebooklm_notebook_created' && progress.steps[step]?.notebookUrl) {
                    notebookUrl = progress.steps[step]!.notebookUrl;
                }
            }
        }

        return {
            completedSteps,
            nextStep: ProgressTracker.getNextIncompleteStep(folderPath),
            notebookUrl
        };
    }

    /**
     * Set the profile ID for a folder (persists across sessions).
     */
    public static setFolderProfile(folderPath: string, profileId: string): FolderProgress {
        const progress = ProgressTracker.initProgress(folderPath);
        progress.profileId = profileId;
        ProgressTracker.saveProgress(folderPath, progress);
        return progress;
    }

    /**
     * Get the profile ID assigned to a folder, or null if none assigned.
     */
    public static getFolderProfile(folderPath: string): string | null {
        const progress = ProgressTracker.getProgress(folderPath);
        return progress?.profileId ?? null;
    }

    /**
     * Get available start points for a folder based on completed steps.
     * Returns all start points where the previous step is complete.
     * "Start Fresh" and "Completed" are always available.
     */
    public static getAvailableStartPoints(folderPath: string): typeof START_POINTS[number][] {
        const available: typeof START_POINTS[number][] = [];

        for (const startPoint of START_POINTS) {
            if (startPoint.key === 'start-fresh') {
                // Always available
                available.push(startPoint);
            } else if (startPoint.key === 'completed') {
                // Only show if actually completed
                if (ProgressTracker.isStepComplete(folderPath, 'pipeline_completed')) {
                    available.push(startPoint);
                }
            } else {
                // Check if the step BEFORE this start point is complete
                const stepIndex = PIPELINE_STEPS.indexOf(startPoint.resumeFrom as StaticPipelineStep);
                if (stepIndex > 0) {
                    const previousStep = PIPELINE_STEPS[stepIndex - 1];
                    if (ProgressTracker.isStepComplete(folderPath, previousStep)) {
                        available.push(startPoint);
                    }
                }
            }
        }

        return available;
    }

    /**
     * Clear all progress for a folder (used when "Start Fresh" is selected).
     */
    public static clearProgress(folderPath: string): void {
        const progressPath = ProgressTracker.getProgressFilePath(folderPath);
        if (fs.existsSync(progressPath)) {
            fs.unlinkSync(progressPath);
        }
    }
}
