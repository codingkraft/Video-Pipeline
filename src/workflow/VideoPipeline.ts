import { CaptiveBrowser } from '../browser/CaptiveBrowser';
import { PerplexityService, PerplexityResult } from '../services/PerplexityService';
import { NotebookLMService, NotebookLMConfig, NotebookLMResult } from '../services/NotebookLMService';
import { GeminiService, GeminiVideoConfig, GeminiVideoResult } from '../services/GeminiService';
import { TTSService, TTSConfig, TTSResult } from '../services/TTSService';
import { VideoProcessor, VideoProcessingConfig, VideoProcessingResult } from '../processing/VideoProcessor';
import PQueue from 'p-queue';
import * as fs from 'fs';
import * as path from 'path';

export interface PipelineInput {
    id: string;
    documentPaths: string[];
    customVideoPrompt?: string;
    stylePrompt?: string;
    chatSettings?: NotebookLMConfig['chatSettings'];
    outputDir: string;
}

export interface PipelineResult {
    id: string;
    success: boolean;
    outputVideoPath?: string;
    error?: string;
    steps: {
        perplexity?: PerplexityResult;
        notebookLM?: NotebookLMResult;
        gemini?: GeminiVideoResult;
        tts?: TTSResult;
        processing?: VideoProcessingResult;
    };
}

export class VideoPipeline {
    private browser: CaptiveBrowser;
    private perplexityService: PerplexityService;
    private notebookLMService: NotebookLMService;
    private geminiService: GeminiService;
    private ttsService: TTSService;
    private videoProcessor: VideoProcessor;
    private queue: PQueue;

    constructor(concurrency: number = 2) {
        this.browser = CaptiveBrowser.getInstance();
        this.perplexityService = new PerplexityService();
        this.notebookLMService = new NotebookLMService();
        this.geminiService = new GeminiService();
        this.ttsService = new TTSService();
        this.videoProcessor = new VideoProcessor();

        // Queue with concurrency limit for processing multiple videos
        this.queue = new PQueue({ concurrency });
    }

    /**
     * Initialize the browser and all services.
     */
    public async initialize(): Promise<void> {
        console.log('Initializing Video Pipeline...');
        await this.browser.initialize();
        console.log('Video Pipeline initialized.');
    }

    /**
     * Process a single video through the entire pipeline.
     */
    public async processVideo(input: PipelineInput): Promise<PipelineResult> {
        const result: PipelineResult = {
            id: input.id,
            success: false,
            steps: {},
        };

        try {
            console.log(`\n=== Processing video: ${input.id} ===\n`);

            // Ensure output directory exists
            if (!fs.existsSync(input.outputDir)) {
                fs.mkdirSync(input.outputDir, { recursive: true });
            }

            // Step 1: Read document content
            console.log('Step 1: Reading documents...');
            const documentContent = this.readDocuments(input.documentPaths);
            await this.browser.randomDelay(1000, 2000);

            // Step 2: Generate video prompt using Perplexity
            console.log('Step 2: Generating video prompt via Perplexity...');
            result.steps.perplexity = await this.perplexityService.generateVideoPrompt(
                documentContent,
                input.customVideoPrompt
            );
            await this.browser.randomDelay(2000, 4000);

            // Step 3: Create notebook and generate video via NotebookLM
            console.log('Step 3: Creating notebook and generating video via NotebookLM...');
            await this.notebookLMService.createNotebook(input.documentPaths);

            if (input.chatSettings) {
                await this.notebookLMService.configureChatSettings(input.chatSettings);
            }

            const notebookLMConfig: NotebookLMConfig = {
                videoPrompt: result.steps.perplexity.response,
                stylePrompt: input.stylePrompt || 'Modern, engaging, educational style',
            };

            result.steps.notebookLM = await this.notebookLMService.generateVideo(notebookLMConfig);
            await this.browser.randomDelay(2000, 4000);

            // Step 4: Generate additional video via Gemini
            console.log('Step 4: Generating video via Gemini...');
            const geminiConfig: GeminiVideoConfig = {
                prompt: result.steps.perplexity.response,
                stylePrompt: input.stylePrompt,
            };

            result.steps.gemini = await this.geminiService.generateVideo(geminiConfig, input.outputDir);
            await this.browser.randomDelay(2000, 4000);

            // Step 5: Generate TTS audio from script
            console.log('Step 5: Generating TTS audio...');
            if (result.steps.notebookLM.scriptContent) {
                const ttsConfig: TTSConfig = {
                    text: result.steps.notebookLM.scriptContent,
                    languageCode: 'en-US',
                };

                result.steps.tts = await this.ttsService.generateSpeech(ttsConfig, input.outputDir);
                await this.browser.randomDelay(2000, 4000);
            } else {
                console.log('No script content available, skipping TTS...');
            }

            // Step 6: Combine videos and add TTS audio
            console.log('Step 6: Processing final video...');
            if (result.steps.gemini && result.steps.tts) {
                // Download NotebookLM video
                const notebookLMVideoPath = await this.notebookLMService.downloadVideo(
                    path.join(input.outputDir, 'notebooklm_video.mp4')
                );

                const processingConfig: VideoProcessingConfig = {
                    notebookLMVideoPath,
                    geminiVideoPath: result.steps.gemini.videoPath,
                    ttsAudioPath: result.steps.tts.audioPath,
                    outputPath: path.join(input.outputDir, `final_${input.id}.mp4`),
                };

                result.steps.processing = await this.videoProcessor.processVideos(processingConfig);
                result.outputVideoPath = result.steps.processing.outputPath;
            }

            result.success = true;
            console.log(`\n=== Completed video: ${input.id} ===\n`);

        } catch (error) {
            result.error = error instanceof Error ? error.message : String(error);
            console.error(`Error processing video ${input.id}:`, result.error);
        }

        return result;
    }

    /**
     * Add a video to the processing queue.
     */
    public addToQueue(input: PipelineInput): Promise<PipelineResult> {
        return this.queue.add(() => this.processVideo(input)) as Promise<PipelineResult>;
    }

    /**
     * Process multiple videos concurrently (respecting queue concurrency limit).
     */
    public async processMultiple(inputs: PipelineInput[]): Promise<PipelineResult[]> {
        const promises = inputs.map(input => this.addToQueue(input));
        return Promise.all(promises);
    }

    /**
     * Read content from multiple document files.
     */
    private readDocuments(documentPaths: string[]): string {
        const contents: string[] = [];

        for (const docPath of documentPaths) {
            try {
                const content = fs.readFileSync(docPath, 'utf-8');
                contents.push(`--- ${path.basename(docPath)} ---\n${content}`);
            } catch (error) {
                console.error(`Failed to read document: ${docPath}`);
            }
        }

        return contents.join('\n\n');
    }

    /**
     * Shutdown the pipeline and close all services.
     */
    public async shutdown(): Promise<void> {
        console.log('Shutting down Video Pipeline...');

        await this.perplexityService.close();
        await this.notebookLMService.close();
        await this.geminiService.close();
        await this.ttsService.close();
        await this.browser.close();

        console.log('Video Pipeline shutdown complete.');
    }
}
