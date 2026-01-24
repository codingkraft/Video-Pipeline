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
     * Splits by 'next slide please' and 'next video please' markers
     */
    public parseSlideText(narrationText: string): SlideData[] {
        const slides: SlideData[] = [];

        // Split by 'next slide please' or 'next video please' markers
        const slideRegex = /next\s+(slide|video)\s+please/gi;
        const parts = narrationText.split(slideRegex);

        // Each part is the text for one slide (filter out the captured groups from split)
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            // Skip the captured group words ('slide' or 'video')
            if (part && part.toLowerCase() !== 'slide' && part.toLowerCase() !== 'video') {
                const text = part.trim();
                if (text) {
                    slides.push({
                        slideNumber: slides.length,
                        text,
                        textHash: this.hashText(text)
                    });
                }
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
     * Generate audio for narration with chunked processing.
     * Splits slides into chunks of max 3 to avoid Google Studio TTS issues with longer text.
     * Each chunk is processed separately, then Whisper splits into individual slide files.
     */
    public async generateAudio(config: AudioGeneratorConfig): Promise<AudioGeneratorResult> {
        const steps: string[] = [];
        const audioFiles: string[] = [];
        let skipped = 0;

        // Maximum slides per TTS chunk - Google Studio has issues with longer text
        const MAX_SLIDES_PER_CHUNK = 3;

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

            // Parse slides
            const slides = this.parseSlideText(narrationText);
            const totalSlides = slides.length;
            steps.push(`📊 Found ${totalSlides} slides total`);

            // Extract video number from narration file path if it's an individual video file
            const narrationFileName = path.basename(narrationPath);
            let videoNumMatch = narrationFileName.match(/video(\d+)_narration_individual/);

            // Also check for Perplexity output format: perplexity_audio_response_v{N}.txt
            if (!videoNumMatch) {
                videoNumMatch = narrationFileName.match(/perplexity_audio_response_v(\d+)/);
            }

            const videoPrefix = videoNumMatch ? `v${videoNumMatch[1]}_` : '';
            if (videoPrefix) {
                steps.push(`📹 Processing individual video ${videoNumMatch![1]} narration`);
            }

            // Chunk slides into groups of max MAX_SLIDES_PER_CHUNK
            const chunks: SlideData[][] = [];
            for (let i = 0; i < slides.length; i += MAX_SLIDES_PER_CHUNK) {
                chunks.push(slides.slice(i, i + MAX_SLIDES_PER_CHUNK));
            }
            steps.push(`📦 Split into ${chunks.length} chunks (max ${MAX_SLIDES_PER_CHUNK} slides each)`);

            // Check if Whisper is available
            const whisperAvailable = await checkWhisperInstalled();
            if (!whisperAvailable) {
                steps.push(`⚠️ Whisper not available - chunked processing requires Whisper for splitting`);
            }

            // Output directory for split audio clips
            const timelineAudioDir = path.join(config.sourceFolder, 'output', 'timeline', 'audio_clips');
            if (!fs.existsSync(timelineAudioDir)) {
                fs.mkdirSync(timelineAudioDir, { recursive: true });
            }

            const folderName = path.basename(config.sourceFolder);
            let allSlidesGenerated = 0;

            // Process all chunks in PARALLEL using Promise.all
            steps.push(`\n🚀 Processing ${chunks.length} chunks in parallel...`);

            // Create chunk processing tasks
            const chunkPromises = chunks.map(async (chunk, chunkIndex) => {
                const chunkNum = chunkIndex + 1;
                const slideOffset = chunkIndex * MAX_SLIDES_PER_CHUNK;
                const chunkSteps: string[] = [];
                let chunkSlidesGenerated = 0;

                chunkSteps.push(`🎬 Chunk ${chunkNum}/${chunks.length} (slides ${slideOffset + 1}-${slideOffset + chunk.length})`);

                // Build chunk text with markers between slides
                const chunkTextParts: string[] = [];
                for (let i = 0; i < chunk.length; i++) {
                    if (i > 0) {
                        chunkTextParts.push('next slide please');
                    }
                    chunkTextParts.push(chunk[i].text);
                }
                const chunkText = chunkTextParts.join('\n\n');
                const chunkTextHash = this.hashText(chunkText);

                // Skip TTS if requested
                if (config.skipTTSGeneration) {
                    chunkSteps.push(`⏭️ Skipping TTS for chunk ${chunkNum}`);
                    return { steps: chunkSteps, slides: 0, audioFile: null };
                }

                // Generate audio for this chunk with retry and Whisper verification
                const chunkAudioPath = path.join(audioDir, `narration_${videoPrefix}chunk_${chunkNum}.wav`);
                let chunkSplitSuccess = false;
                let chunkTakeNumber = 0;
                const maxChunkRetries = 2;

                while (!chunkSplitSuccess && chunkTakeNumber < maxChunkRetries) {
                    chunkTakeNumber++;
                    const takeAudioPath = chunkTakeNumber === 1
                        ? chunkAudioPath
                        : path.join(audioDir, `narration_${videoPrefix}chunk_${chunkNum}_take${chunkTakeNumber}.wav`);

                    chunkSteps.push(`🎙️ Chunk ${chunkNum} take ${chunkTakeNumber}...`);

                    try {
                        await this.browser.withModularRecovery(
                            `google-studio-audio-${folderName}-chunk-${chunkNum}-take-${chunkTakeNumber}`,
                            'https://aistudio.google.com/generate-speech',
                            async (page) => {
                                const slideConfig: SlideAudioConfig = {
                                    slideNumber: chunkNum,
                                    text: chunkText,
                                    textHash: chunkTextHash,
                                    outputPath: takeAudioPath
                                };

                                const localSteps: string[] = [];
                                const success = await this.googleStudio.generateSlideAudio(
                                    page,
                                    slideConfig,
                                    studioConfig,
                                    localSteps
                                );

                                if (!success) {
                                    throw new Error(`Audio gen failed chunk ${chunkNum}`);
                                }
                                return true;
                            }
                        );

                        chunkSteps.push(`✓ Chunk ${chunkNum} audio done`);
                    } catch (error) {
                        chunkSteps.push(`✗ Chunk ${chunkNum} take ${chunkTakeNumber} failed`);
                        continue;
                    }

                    // Whisper split and verify
                    if (whisperAvailable) {
                        const markerResult = await splitAudioByMarkers({
                            audioFile: takeAudioPath,
                            outputDir: timelineAudioDir,
                            markerPhrases: ['next slide please', 'next video please'],
                            whisperModel: 'base',
                            expectedParts: chunk.length,
                            slidePrefix: `${videoPrefix}chunk${chunkNum}_`
                        });

                        chunkSteps.push(`🔍 Whisper: ${markerResult.slideFiles.length}/${chunk.length} slides`);

                        if (markerResult.success && markerResult.slideFiles.length === chunk.length) {
                            chunkSteps.push(`✅ Chunk ${chunkNum} verified`);
                            chunkSplitSuccess = true;

                            // Rename to correct global slide numbers
                            for (let i = 0; i < markerResult.slideFiles.length; i++) {
                                const oldPath = markerResult.slideFiles[i];
                                const globalSlideNum = slideOffset + i + 1;
                                const newPath = path.join(timelineAudioDir, `${videoPrefix}slide_${globalSlideNum}.wav`);
                                if (fs.existsSync(oldPath) && oldPath !== newPath) {
                                    fs.renameSync(oldPath, newPath);
                                }
                                chunkSlidesGenerated++;
                            }
                        } else {
                            chunkSteps.push(`⚠️ Chunk ${chunkNum} mismatch, retrying...`);
                        }
                    } else {
                        chunkSteps.push(`⚠️ No Whisper - unverified`);
                        chunkSplitSuccess = true;
                    }
                }

                if (!chunkSplitSuccess && whisperAvailable) {
                    throw new Error(`Chunk ${chunkNum} failed verification`);
                }

                return { steps: chunkSteps, slides: chunkSlidesGenerated, audioFile: chunkAudioPath };
            });

            // Wait for all chunks to complete
            const chunkResults = await Promise.all(chunkPromises);

            // Collect all results
            for (const result of chunkResults) {
                steps.push(...result.steps);
                allSlidesGenerated += result.slides;
                if (result.audioFile) {
                    audioFiles.push(result.audioFile);
                }
            }

            steps.push(`\n✅ Generated ${allSlidesGenerated}/${totalSlides} slide audio files`);

            // Mark overall audio generation as complete
            ProgressTracker.markStepComplete(config.sourceFolder, 'audio_generated' as any, {
                audioFiles: audioFiles.map(f => path.basename(f))
            });

            return {
                success: allSlidesGenerated === totalSlides,
                message: `Generated ${allSlidesGenerated}/${totalSlides} slide audio files from ${chunks.length} chunks`,
                details: {
                    steps,
                    slidesProcessed: allSlidesGenerated,
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

    /**
     * Initialize the browser for audio generation
     */
    public async initialize(config: { headless?: boolean; profileId?: string } = {}): Promise<void> {
        await this.browser.initialize({
            headless: config.headless,
            profileId: config.profileId || 'audio'
        });
    }

    /**
     * Shutdown the browser
     */
    public async shutdown(): Promise<void> {
        // CaptiveBrowser manages its own lifecycle, but we can close if needed
        // For now, just a no-op since CaptiveBrowser is a singleton
    }

    /**
     * Generate audio for a specific video (and optionally a specific chunk).
     * Used by the audio regeneration UI for selective regeneration.
     */
    public async generateAudioForVideo(config: {
        narrationPath: string;
        outputDir: string;
        videoIndex: number;
        chunkIndex?: number;
        model?: string;
        voice?: string;
        styleInstructions?: string;
    }): Promise<{ success: boolean; message: string; error?: string; audioFiles?: string[] }> {
        const steps: string[] = [];
        const audioFiles: string[] = [];
        const MAX_SLIDES_PER_CHUNK = 3;

        try {
            // Read narration
            if (!fs.existsSync(config.narrationPath)) {
                return {
                    success: false,
                    message: `Narration file not found: ${config.narrationPath}`,
                    error: 'Narration file not found'
                };
            }

            const narrationText = fs.readFileSync(config.narrationPath, 'utf-8');
            steps.push(`✓ Loaded narration file (${narrationText.length} chars)`);

            // Parse slides
            const slides = this.parseSlideText(narrationText);
            steps.push(`✓ Found ${slides.length} slides`);

            // Create chunks
            const chunks: SlideData[][] = [];
            for (let i = 0; i < slides.length; i += MAX_SLIDES_PER_CHUNK) {
                chunks.push(slides.slice(i, i + MAX_SLIDES_PER_CHUNK));
            }

            // Prepare timeline output directory
            const timelineDir = path.join(config.outputDir, 'timeline');
            const audioClipsDir = path.join(timelineDir, 'audio_clips');
            if (!fs.existsSync(audioClipsDir)) {
                fs.mkdirSync(audioClipsDir, { recursive: true });
            }

            // Determine which chunks to process
            let chunksToProcess: { chunkIdx: number; slides: SlideData[] }[] = [];
            if (config.chunkIndex !== undefined) {
                // Regenerate specific chunk
                if (config.chunkIndex < 0 || config.chunkIndex >= chunks.length) {
                    return {
                        success: false,
                        message: `Invalid chunk index: ${config.chunkIndex}`,
                        error: 'Invalid chunk index'
                    };
                }
                chunksToProcess.push({ chunkIdx: config.chunkIndex, slides: chunks[config.chunkIndex] });
            } else {
                // Regenerate all chunks for this video
                chunksToProcess = chunks.map((slides, idx) => ({ chunkIdx: idx, slides }));
            }

            steps.push(`📊 Processing ${chunksToProcess.length} chunk(s)`);

            // Studio configuration
            const studioConfig: GoogleStudioConfig = {
                sourceFolder: path.dirname(config.outputDir),
                model: config.model,
                voice: config.voice,
                styleInstructions: config.styleInstructions,
                headless: false
            };

            let slidesGenerated = 0;

            for (const { chunkIdx, slides } of chunksToProcess) {
                steps.push(`\n🎙️ Processing Chunk ${chunkIdx + 1}/${chunks.length} (${slides.length} slides)`);

                // Build combined text for TTS
                const combinedText = slides.map(s => s.text).join('\n\nnext slide please\n\n');

                // Generate audio via Google Studio
                const result = await this.googleStudio.generateAudio({
                    ...studioConfig,
                    text: combinedText,
                    outputPath: path.join(audioClipsDir, `v${config.videoIndex}_chunk${chunkIdx}_combined.mp3`)
                });

                if (!result.success || !result.audioPath) {
                    steps.push(`✗ TTS failed for chunk ${chunkIdx + 1}`);
                    continue;
                }

                steps.push(`✓ Generated combined audio for chunk ${chunkIdx + 1}`);

                // Split with Whisper
                const whisperAvailable = await checkWhisperInstalled();
                if (whisperAvailable) {
                    const splitResult = await splitAudioByMarkers({
                        audioFile: result.audioPath,
                        outputDir: audioClipsDir,
                        markerPhrases: ['next slide please'],
                        slidePrefix: `v${config.videoIndex}_chunk${chunkIdx}_`
                    });

                    if (splitResult.success && splitResult.slideFiles.length > 0) {
                        // Rename split files to proper naming convention
                        for (let i = 0; i < splitResult.slideFiles.length && i < slides.length; i++) {
                            const slideFile = splitResult.slideFiles[i];
                            const newName = `v${config.videoIndex}_chunk${chunkIdx}_slide${slides[i].slideNumber}.mp3`;
                            const newPath = path.join(audioClipsDir, newName);

                            if (fs.existsSync(slideFile) && slideFile !== newPath) {
                                fs.renameSync(slideFile, newPath);
                            }

                            audioFiles.push(newName);
                            slidesGenerated++;
                        }
                        steps.push(`✓ Split into ${splitResult.slideFiles.length} slide clips`);
                    } else {
                        steps.push(`⚠ Whisper split failed for chunk ${chunkIdx + 1}`);
                    }
                } else {
                    steps.push(`⚠ Whisper not available, keeping combined audio`);
                    audioFiles.push(path.basename(result.audioPath));
                }
            }

            return {
                success: slidesGenerated > 0,
                message: `Generated ${slidesGenerated} slide audio files`,
                audioFiles
            };

        } catch (error) {
            return {
                success: false,
                message: (error as Error).message,
                error: (error as Error).message
            };
        }
    }
}
