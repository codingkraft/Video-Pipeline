import * as fs from 'fs';
import * as path from 'path';
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import {
    MarkdownScriptParser,
    VideoSection,
    CodeBlock,
    ParseResult
} from './MarkdownScriptParser';
import { CodeScreenshotService, getCodeScreenshotService } from './CodeScreenshotService';

/**
 * Configuration for video folder generation
 */
export interface VideoFolderConfig {
    sourceMarkdownPath: string;
    outputBaseDir: string;
    chapterPrefix?: string;  // e.g., "chapter2" 
    startVideoNumber?: number;  // Generate from this video onwards
    endVideoNumber?: number;    // Generate up to this video
    generateScreenshots?: boolean;  // Whether to generate code screenshots
    generateDocx?: boolean;     // Whether to generate DOCX files
    generateNarration?: boolean; // Whether to generate narration TXT files
}

/**
 * Result of generating a single video folder
 */
export interface VideoFolderResult {
    videoNumber: string;
    folderPath: string;
    narrationPath?: string;
    docxPath?: string;
    screenshotPaths: string[];
    success: boolean;
    error?: string;
}

/**
 * Result of batch generation
 */
export interface BatchResult {
    totalVideos: number;
    successCount: number;
    failCount: number;
    results: VideoFolderResult[];
}

/**
 * Service for creating video input folders from markdown scripts.
 * Generates:
 * - Narration TXT files (for TTS)
 * - DOCX source documents (for NotebookLM)
 * - Code screenshots (CODE.png and OUTPUT.png)
 */
export class VideoFolderCreator {
    private screenshotService: CodeScreenshotService | null = null;
    private puppeteerPage: any = null;

    /**
     * Initialize with optional Puppeteer page for screenshots
     */
    async initialize(puppeteerPage?: any): Promise<void> {
        if (puppeteerPage) {
            this.puppeteerPage = puppeteerPage;
            this.screenshotService = getCodeScreenshotService();
            await this.screenshotService.initialize(puppeteerPage);
            console.log('[VideoFolderCreator] Initialized with screenshot support');
        } else {
            console.log('[VideoFolderCreator] Initialized without screenshot support');
        }
    }

    /**
     * Generate all video folders from a markdown script
     */
    async generateAll(config: VideoFolderConfig): Promise<BatchResult> {
        const results: VideoFolderResult[] = [];
        let successCount = 0;
        let failCount = 0;

        // Parse the markdown
        console.log(`[VideoFolderCreator] Parsing: ${config.sourceMarkdownPath}`);
        const parseResult = MarkdownScriptParser.parseFile(config.sourceMarkdownPath);
        console.log(`[VideoFolderCreator] Found ${parseResult.totalVideos} videos`);

        // Filter videos by number range if specified (commented out - videoNumber is now string)
        let videos = parseResult.videos;
        // if (config.startVideoNumber !== undefined) {
        //     videos = videos.filter(v => parseFloat(v.videoNumber) >= config.startVideoNumber!);
        // }
        // if (config.endVideoNumber !== undefined) {
        //     videos = videos.filter(v => parseFloat(v.videoNumber) <= config.endVideoNumber!);
        // }

        console.log(`[VideoFolderCreator] Generating ${videos.length} video folders`);

        for (const video of videos) {
            try {
                const result = await this.generateVideoFolder(video, config);
                results.push(result);

                if (result.success) {
                    successCount++;
                    console.log(`[VideoFolderCreator] ✅ Video ${video.videoNumber}: ${result.folderPath}`);
                } else {
                    failCount++;
                    console.log(`[VideoFolderCreator] ❌ Video ${video.videoNumber}: ${result.error}`);
                }
            } catch (error: any) {
                failCount++;
                results.push({
                    videoNumber: video.videoNumber,
                    folderPath: '',
                    screenshotPaths: [],
                    success: false,
                    error: error.message
                });
                console.log(`[VideoFolderCreator] ❌ Video ${video.videoNumber}: ${error.message}`);
            }
        }

        return {
            totalVideos: videos.length,
            successCount,
            failCount,
            results
        };
    }

    /**
     * Generate a single video folder
     */
    async generateVideoFolder(video: VideoSection, config: VideoFolderConfig): Promise<VideoFolderResult> {
        const prefix = config.chapterPrefix || 'chapter';
        const folderName = `Video ${video.videoNumber}`;
        const folderPath = path.join(config.outputBaseDir, folderName);

        // Create folder
        if (!fs.existsSync(folderPath)) {
            fs.mkdirSync(folderPath, { recursive: true });
        }

        const result: VideoFolderResult = {
            videoNumber: video.videoNumber,
            folderPath,
            screenshotPaths: [],
            success: true
        };

        // Generate screenshots FIRST (needed for DOCX)
        if (config.generateScreenshots !== false && this.screenshotService) {
            result.screenshotPaths = await this.generateScreenshots(video, folderPath, prefix);
        }

        // Generate narration TXT
        if (config.generateNarration !== false) {
            result.narrationPath = await this.generateNarrationFile(video, folderPath);
        }

        // Generate DOCX with embedded screenshots
        if (config.generateDocx !== false) {
            result.docxPath = await this.generateDocxFile(video, folderPath, result.screenshotPaths);
        }

        return result;
    }

    /**
     * Generate narration TXT file
     */
    private async generateNarrationFile(video: VideoSection, folderPath: string): Promise<string> {
        const filename = `video${video.videoNumber}_narration.txt`;
        const filePath = path.join(folderPath, filename);

        const content = MarkdownScriptParser.generateNarrationFile(video);
        fs.writeFileSync(filePath, content, 'utf-8');

        return filePath;
    }

    /**
     * Generate DOCX file for NotebookLM source with embedded screenshots
     */
    private async generateDocxFile(video: VideoSection, folderPath: string, screenshotPaths: string[] = []): Promise<string> {
        const filename = `video${video.videoNumber}_source.docx`;
        const filePath = path.join(folderPath, filename);

        // Import ImageRun for embedding images
        const { ImageRun } = await import('docx');

        // Create a map of screenshots by slide number for easy lookup
        const screenshotsBySlide = new Map<number, string[]>();
        for (const screenshotPath of screenshotPaths) {
            const match = screenshotPath.match(/slide(\d+)/);
            if (match) {
                const slideNum = parseInt(match[1]);
                if (!screenshotsBySlide.has(slideNum)) {
                    screenshotsBySlide.set(slideNum, []);
                }
                screenshotsBySlide.get(slideNum)!.push(screenshotPath);
            }
        }

        const doc = new Document({
            sections: [{
                properties: {},
                children: [
                    // Title
                    new Paragraph({
                        text: `Video ${video.videoNumber}: ${video.title}`,
                        heading: HeadingLevel.HEADING_1
                    }),
                    new Paragraph({ text: '' }),

                    // Concept
                    ...(video.concept ? [
                        new Paragraph({
                            text: `Concept: ${video.concept}`,
                            heading: HeadingLevel.HEADING_2
                        }),
                        new Paragraph({ text: '' })
                    ] : []),

                    // Slides
                    ...video.slides.flatMap(slide => {
                        const slideScreenshots = screenshotsBySlide.get(slide.number) || [];

                        return [
                            new Paragraph({
                                text: `Slide ${slide.number}: ${slide.title}`,
                                heading: HeadingLevel.HEADING_2
                            }),
                            new Paragraph({
                                children: [new TextRun({ text: slide.audio })]
                            }),
                            new Paragraph({ text: '' }),

                            // Embed screenshots for this slide
                            ...slideScreenshots.flatMap(screenshotPath => {
                                const screenshotFilename = path.basename(screenshotPath);

                                try {
                                    const imageBuffer = fs.readFileSync(screenshotPath);

                                    return [
                                        new Paragraph({
                                            children: [
                                                new TextRun({
                                                    text: `Screenshot: ${screenshotFilename}`,
                                                    bold: true
                                                })
                                            ]
                                        }),
                                        new Paragraph({
                                            children: [
                                                new ImageRun({
                                                    data: imageBuffer,
                                                    transformation: {
                                                        width: 600,
                                                        height: 400
                                                    },
                                                    type: 'png'
                                                } as any) // Type assertion to bypass strict typing
                                            ]
                                        }),
                                        new Paragraph({ text: '' })
                                    ];
                                } catch (err) {
                                    console.warn(`[VideoFolderCreator] Could not embed image: ${screenshotFilename}`);
                                    return [
                                        new Paragraph({
                                            children: [
                                                new TextRun({
                                                    text: `Screenshot: ${screenshotFilename} (file not found)`,
                                                    italics: true
                                                })
                                            ]
                                        }),
                                        new Paragraph({ text: '' })
                                    ];
                                }
                            })
                        ];
                    })
                ]
            }]
        });

        const buffer = await Packer.toBuffer(doc);
        fs.writeFileSync(filePath, buffer);

        return filePath;
    }

    /**
     * Generate code screenshots for all code blocks in a video
     */
    private async generateScreenshots(
        video: VideoSection,
        folderPath: string,
        prefix: string
    ): Promise<string[]> {
        if (!this.screenshotService) {
            return [];
        }

        const screenshotPaths: string[] = [];

        for (let i = 0; i < video.allCodeBlocks.length; i++) {
            const block = video.allCodeBlocks[i];
            const baseName = `${prefix}_video${video.videoNumber}_slide${block.slideNumber}_code${i + 1}`;

            try {
                // If there's expected output, we can use it directly
                // Otherwise, we need to try executing the code
                if (block.expectedOutput) {
                    // Use the provided expected output
                    const codePath = path.join(folderPath, `${baseName}.png`);
                    await this.screenshotService.captureCodeWithOutput(
                        block.code,
                        block.expectedOutput,
                        codePath,
                        { filename: `slide${block.slideNumber}.py` }
                    );
                    screenshotPaths.push(codePath);
                } else {
                    // Try to execute and capture
                    const result = await this.screenshotService.executeAndCapture(
                        block.code,
                        folderPath,
                        baseName,
                        { filename: `slide${block.slideNumber}.py` }
                    );
                    screenshotPaths.push(result.codePath);
                    if (result.outputPath) {
                        screenshotPaths.push(result.outputPath);
                    }
                }
            } catch (error: any) {
                console.warn(`[VideoFolderCreator] Screenshot failed for ${baseName}: ${error.message}`);

                // Fallback: just capture the code without output
                try {
                    const codePath = path.join(folderPath, `${baseName}.png`);
                    await this.screenshotService.captureCode(block.code, codePath);
                    screenshotPaths.push(codePath);
                } catch (e) {
                    // Skip this block if even code capture fails
                }
            }
        }

        return screenshotPaths;
    }
}

// Export singleton
let instance: VideoFolderCreator | null = null;

export function getVideoFolderCreator(): VideoFolderCreator {
    if (!instance) {
        instance = new VideoFolderCreator();
    }
    return instance;
}
