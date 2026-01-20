import { CaptiveBrowser } from '../browser/CaptiveBrowser';
import { GoogleStudioTester, GoogleStudioConfig, SlideAudioConfig } from './GoogleStudioTester';
import { ProgressTracker } from './ProgressTracker';
import { TimelineProcessor } from '../processing/TimelineProcessor';
import { splitAudioByMarkers, checkWhisperInstalled } from '../processing/MarkerSplitter';
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
    skipTTSGeneration?: boolean; // Skip TTS, only run Whisper check on existing audio
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

        // Split by 'next slide please' markers (spoken phrase for Whisper detection)
        const slideRegex = /next slide please/gi;
        const parts = narrationText.split(slideRegex);

        // Each part is the text for one slide
        for (let i = 0; i < parts.length; i++) {
            const slideNumber = i;
            const text = (parts[i] || '').trim();

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
     * Generate audio for narration with smart regeneration.
     * Generates one audio file first, checks if segment count matches slide count,
     * and only regenerates if there's a mismatch.
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

            // Parse slides to know expected segment count
            const slides = this.parseSlideText(narrationText);
            const expectedSegments = slides.length;
            steps.push(`📊 Expecting ${expectedSegments} audio segments (based on ${slides.length} slides)`);

            // Helper to generate a single audio file
            const generateAudioFile = async (fileNumber: number): Promise<string> => {
                const outputPath = path.join(audioDir, `narration_take_${fileNumber}.wav`);
                steps.push(`🎙️ Generating audio file ${fileNumber}...`);

                try {
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

                            steps.push(...localSteps);

                            if (!success) {
                                throw new Error(`Audio generation failed for file ${fileNumber}`);
                            }
                            return true;
                        }
                    );

                    audioFiles.push(outputPath);
                    steps.push(`✓ Audio file ${fileNumber} generated: ${path.basename(outputPath)}`);
                    return outputPath;
                } catch (error) {
                    const errorMsg = (error as Error).message;
                    steps.push(`✗ Audio file ${fileNumber} failed: ${errorMsg}`);
                    // Don't continue to next audio - stop processing on error
                    throw error;
                }
            };

            let firstAudioPath: string;

            // Check if we should skip TTS and use existing audio
            if (config.skipTTSGeneration) {
                steps.push(`⏭️ Skipping TTS generation (skipTTSGeneration=true)`);

                // Find existing audio file
                const existingAudio = fs.readdirSync(audioDir)
                    .filter(f => f.endsWith('.wav') || f.endsWith('.mp3'))
                    .sort()
                    .find(f => f.includes('narration') || f.includes('take'));

                if (existingAudio) {
                    firstAudioPath = path.join(audioDir, existingAudio);
                    audioFiles.push(firstAudioPath);
                    steps.push(`✓ Using existing audio file: ${existingAudio}`);
                } else {
                    throw new Error(`No existing audio file found in ${audioDir}. Cannot skip TTS.`);
                }
            } else {
                // Generate first audio file
                firstAudioPath = await generateAudioFile(1);
            }

            // Use Whisper to detect 'next slide please' markers and count segments
            steps.push(`🔍 Analyzing audio with Whisper to detect slide markers...`);

            let detectedSegments = 0;
            let markerDetectionSuccess = false;

            // Check if Whisper is available
            const whisperAvailable = await checkWhisperInstalled();

            // Output directory for split audio clips - use timeline folder
            const timelineAudioDir = path.join(config.sourceFolder, 'output', 'timeline', 'audio_clips');
            if (!fs.existsSync(timelineAudioDir)) {
                fs.mkdirSync(timelineAudioDir, { recursive: true });
            }

            // Helper function to run marker splitting
            const runMarkerSplit = async (audioPath: string, takeNumber: number): Promise<{ success: boolean, segments: number, markers: number }> => {
                if (!whisperAvailable) {
                    steps.push(`⚠️ Whisper not available, falling back to silence detection...`);
                    const timelineProcessor = new TimelineProcessor();
                    const silenceResult = await timelineProcessor.detectSilences(audioPath, 2, -30);
                    steps.push(`🔍 Take ${takeNumber}: Silence detection found ${silenceResult.clips.length} segments`);
                    return { success: silenceResult.success, segments: silenceResult.clips.length, markers: 0 };
                }

                const markerResult = await splitAudioByMarkers({
                    audioFile: audioPath,
                    outputDir: timelineAudioDir,
                    markerPhrase: 'next slide please',
                    whisperModel: 'base',
                    expectedParts: expectedSegments
                });

                steps.push(`🔍 Take ${takeNumber}: Whisper detected ${markerResult.markerCount} markers, created ${markerResult.slideFiles.length} segments`);
                return {
                    success: markerResult.success && markerResult.slideFiles.length === expectedSegments,
                    segments: markerResult.slideFiles.length,
                    markers: markerResult.markerCount
                };
            };

            // Try first audio
            const firstResult = await runMarkerSplit(firstAudioPath, 1);
            detectedSegments = firstResult.segments;
            markerDetectionSuccess = firstResult.success;

            // Check if segment count matches
            if (markerDetectionSuccess && detectedSegments === expectedSegments) {
                steps.push(`✅ Segment count matches! Skipping second audio generation.`);
            } else {
                // Segment count mismatch - generate second audio
                const reason = `Expected ${expectedSegments} segments, got ${detectedSegments}`;

                if (config.skipTTSGeneration) {
                    steps.push(`⚠️ ${reason}. Skipping regeneration because skipTTSGeneration=true.`);
                    steps.push(`⚠️ Audio analysis check complete.`);
                } else {
                    steps.push(`⚠️ ${reason}. Generating second audio take...`);

                    await this.browser.randomDelay(1000, 2000);
                    const secondAudioPath = await generateAudioFile(2);

                    // Process second audio through marker split too
                    steps.push(`🔍 Processing second audio through marker detection...`);
                    const secondResult = await runMarkerSplit(secondAudioPath, 2);

                    if (secondResult.success && secondResult.segments === expectedSegments) {
                        steps.push(`✅ Second audio segment count matches!`);
                        markerDetectionSuccess = true;
                        detectedSegments = secondResult.segments;
                    } else {
                        // Both attempts failed
                        const errorMsg = `Audio marker detection failed on both takes. Expected ${expectedSegments} segments, Take 1 got ${detectedSegments}, Take 2 got ${secondResult.segments}. Check that narration contains "next slide please" markers.`;
                        steps.push(`❌ ${errorMsg}`);
                        throw new Error(errorMsg);
                    }
                }
            }

            // Mark overall audio generation as complete
            ProgressTracker.markStepComplete(config.sourceFolder, 'audio_generated' as any, {
                audioFiles: audioFiles.map(f => path.basename(f))
            });

            return {
                success: audioFiles.length >= 1,
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
