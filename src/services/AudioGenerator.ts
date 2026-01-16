import { CaptiveBrowser } from '../browser/CaptiveBrowser';
import { GoogleStudioTester, GoogleStudioConfig, SlideAudioConfig } from './GoogleStudioTester';
import { ProgressTracker } from './ProgressTracker';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';

export interface AudioGeneratorConfig {
    sourceFolder: string;
    narrationFilePath?: string;  // Path to narration text file
    headless?: boolean;
    // Google Studio settings
    googleStudioModel?: string;
    googleStudioVoice?: string;
    googleStudioStyleInstructions?: string;
    profileId?: string;          // Browser profile to use
}

export interface AudioGeneratorResult {
    success: boolean;
    message: string;
    details?: {
        steps: string[];
        slidesProcessed: number;
        audioFiles: string[];
        skipped: number;
    };
}

interface SlideData {
    slideNumber: number;
    text: string;
    textHash: string;
}

export class AudioGenerator {
    private browser: CaptiveBrowser;
    private googleStudio: GoogleStudioTester;

    constructor() {
        this.browser = CaptiveBrowser.getInstance();
        this.googleStudio = new GoogleStudioTester();
    }

    /**
     * Generate hash for text content
     */
    private hashText(text: string): string {
        return crypto.createHash('md5').update(text).digest('hex');
    }

    /**
     * Parse slide-by-slide narration from text file
     * Expected format:
     * [SLIDE 1]
     * Text for slide 1...
     * 
     * [SLIDE 2]
     * Text for slide 2...
     */
    public parseSlideText(narrationText: string): SlideData[] {
        const slides: SlideData[] = [];

        // Split by [SLIDE N] markers
        const slideRegex = /\[SLIDE\s*(\d+)\]/gi;
        const parts = narrationText.split(slideRegex);

        // parts[0] is text before first slide marker (usually empty)
        // parts[1] is slide number, parts[2] is text, parts[3] is slide number, parts[4] is text, etc.
        for (let i = 1; i < parts.length; i += 2) {
            const slideNumber = parseInt(parts[i], 10);
            const text = (parts[i + 1] || '').trim();

            if (text) {
                slides.push({
                    slideNumber,
                    text,
                    textHash: this.hashText(text)
                });
            }
        }

        return slides;
    }

    /**
     * Check if slide audio needs regeneration
     */
    private needsRegeneration(
        sourceFolder: string,
        slideNumber: number,
        currentHash: string
    ): boolean {
        const progress = ProgressTracker.getProgress(sourceFolder);
        const stepKey = `audio_slide_${slideNumber}` as any;
        const slideProgress = progress?.steps[stepKey];

        if (!slideProgress?.completed) {
            return true; // Not generated yet
        }

        // Check if text has changed
        if (slideProgress.textHash !== currentHash) {
            return true; // Text changed, regenerate
        }

        // Check if audio file exists
        const audioPath = path.join(sourceFolder, 'output', 'audio', `slide_${slideNumber}.wav`);
        if (!fs.existsSync(audioPath)) {
            return true; // File missing
        }

        return false;
    }

    /**
     * Generate audio for entire narration (two files)
     * Each audio file uses modular recovery: Open → Generate → Close
     */
    public async generateAudio(config: AudioGeneratorConfig): Promise<AudioGeneratorResult> {
        const steps: string[] = [];
        const audioFiles: string[] = [];
        let skipped = 0;

        try {
            await this.browser.initialize({
                headless: config.headless,
                profileId: config.profileId || 'default'
            });

            // Determine narration file path
            let narrationPath = config.narrationFilePath;

            if (!narrationPath) {
                const defaultPath = path.join(config.sourceFolder, 'output', 'perplexity_audio_response.txt');
                const legacyPath1 = path.join(config.sourceFolder, 'output', 'audio_narration.txt');
                const legacyPath2 = path.join(config.sourceFolder, 'output', 'audio_narration.md');

                if (fs.existsSync(defaultPath)) narrationPath = defaultPath;
                else if (fs.existsSync(legacyPath1)) narrationPath = legacyPath1;
                else if (fs.existsSync(legacyPath2)) narrationPath = legacyPath2;
                else narrationPath = defaultPath;
            }

            if (!fs.existsSync(narrationPath)) {
                return {
                    success: false,
                    message: `Narration file not found: ${narrationPath}`,
                    details: { steps, slidesProcessed: 0, audioFiles: [], skipped: 0 }
                };
            }

            // Read entire narration text
            const narrationText = fs.readFileSync(narrationPath, 'utf-8');
            const textHash = this.hashText(narrationText);
            steps.push(`✓ Loaded narration file (${narrationText.length} characters)`);

            // Create output directory
            const audioDir = path.join(config.sourceFolder, 'output', 'audio');
            if (!fs.existsSync(audioDir)) {
                fs.mkdirSync(audioDir, { recursive: true });
            }
            steps.push(`✓ Output directory: ${audioDir}`);

            // Studio configuration
            const studioConfig: GoogleStudioConfig = {
                sourceFolder: config.sourceFolder,
                model: config.googleStudioModel,
                voice: config.googleStudioVoice,
                styleInstructions: config.googleStudioStyleInstructions,
                headless: config.headless
            };

            // Generate TWO audio files - each as a separate module
            for (let fileNumber = 1; fileNumber <= 2; fileNumber++) {
                const outputPath = path.join(audioDir, `narration_take_${fileNumber}.wav`);
                steps.push(`🎙️ Generating audio file ${fileNumber}/2...`);

                try {
                    // Each audio file is its own modular recovery module
                    await this.browser.withModularRecovery(
                        `google-studio-audio-${fileNumber}`,
                        'https://aistudio.google.com/generate-speech',
                        async (page) => {
                            const slideConfig: SlideAudioConfig = {
                                slideNumber: fileNumber,
                                text: narrationText,
                                textHash: textHash,
                                outputPath
                            };

                            const localSteps: string[] = [];
                            const success = await this.googleStudio.generateSlideAudio(
                                page,
                                slideConfig,
                                studioConfig,
                                localSteps
                            );

                            // Add local steps to main steps
                            steps.push(...localSteps);

                            if (!success) {
                                throw new Error(`Audio generation failed for file ${fileNumber}`);
                            }

                            return true;
                        }
                    );

                    audioFiles.push(outputPath);
                    steps.push(`✓ Audio file ${fileNumber} generated: ${path.basename(outputPath)}`);
                } catch (error) {
                    const errorMsg = (error as Error).message;
                    steps.push(`✗ Audio file ${fileNumber} failed: ${errorMsg}`);
                    // Don't continue to next audio - stop processing on error
                    throw error;
                }

                // Small delay between generations
                if (fileNumber < 2) {
                    await this.browser.randomDelay(1000, 2000);
                }
            }

            // Mark overall audio generation as complete
            ProgressTracker.markStepComplete(config.sourceFolder, 'audio_generated' as any, {
                audioFiles: audioFiles.map(f => path.basename(f))
            });

            return {
                success: audioFiles.length === 2,
                message: `Generated ${audioFiles.length} audio files from narration`,
                details: {
                    steps,
                    slidesProcessed: 1,
                    audioFiles,
                    skipped
                }
            };

        } catch (error) {
            steps.push(`✗ Error: ${(error as Error).message}`);
            return {
                success: false,
                message: (error as Error).message,
                details: { steps, slidesProcessed: 0, audioFiles, skipped }
            };
        }
    }
}
