import * as fs from 'fs';
import * as path from 'path';
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import {
    MarkdownScriptParser,
    VideoSection,
    CodeBlock,
    ParseResult
} from './MarkdownScriptParser';
import { DocxScriptParser } from './DocxScriptParser';
import { CodeScreenshotService, getCodeScreenshotService } from './CodeScreenshotService';

/**
 * Configuration for video folder generation
 */
export interface VideoFolderConfig {
    sourceMarkdownPath: string;
    outputBaseDir: string;
    chapterPrefix?: string;  // e.g., "chapter" 
    startVideoNumber?: number;  // Generate from this video onwards
    endVideoNumber?: number;    // Generate up to this video
    generateScreenshots?: boolean;  // Whether to generate code screenshots
    generateDocx?: boolean;     // Whether to generate DOCX files
    generateNarration?: boolean; // Whether to generate narration TXT files
    generateVideoResponse?: boolean; // Whether to generate video_response.txt with image mappings
}

/**
 * Result of generating a single video folder
 */
export interface VideoFolderResult {
    videoNumber: string;
    folderPath: string;
    narrationPath?: string;
    docxPath?: string;
    videoResponsePath?: string;
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
 * Service for creating video input folders from markdown/docx scripts.
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
     * Generate all video folders from a markdown or docx script
     */
    async generateAll(config: VideoFolderConfig): Promise<BatchResult> {
        const results: VideoFolderResult[] = [];
        let successCount = 0;
        let failCount = 0;

        // Auto-detect file type and use appropriate parser
        const ext = path.extname(config.sourceMarkdownPath).toLowerCase();
        console.log(`[VideoFolderCreator] Parsing: ${config.sourceMarkdownPath}`);

        let parseResult: ParseResult;
        if (ext === '.docx') {
            parseResult = await DocxScriptParser.parseFile(config.sourceMarkdownPath);
            console.log(`[VideoFolderCreator] Using DOCX parser`);
        } else {
            parseResult = MarkdownScriptParser.parseFile(config.sourceMarkdownPath);
            console.log(`[VideoFolderCreator] Using Markdown parser`);
        }
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

        // Generate video_response.txt with image mappings
        if (config.generateVideoResponse !== false) {
            const narrationFilename = result.narrationPath ? path.basename(result.narrationPath) : `video${video.videoNumber}_narration.txt`;
            result.videoResponsePath = await this.generateVideoResponseFile(video, folderPath, narrationFilename, result.screenshotPaths);
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
     * Generate video_response.txt with narration filename and slide-to-image mappings
     */
    private async generateVideoResponseFile(
        video: VideoSection,
        folderPath: string,
        narrationFilename: string,
        screenshotPaths: string[]
    ): Promise<string> {
        // Create output subfolder
        const outputFolder = path.join(folderPath, 'output');
        if (!fs.existsSync(outputFolder)) {
            fs.mkdirSync(outputFolder, { recursive: true });
        }

        const filename = `video${video.videoNumber}_response.txt`;
        const filePath = path.join(outputFolder, filename);

        // Build screenshot map by slide number
        const screenshotsBySlide = new Map<number, string[]>();
        for (const screenshotPath of screenshotPaths) {
            const basename = path.basename(screenshotPath);
            const match = basename.match(/slide(\d+)/);
            if (match) {
                const slideNum = parseInt(match[1]);
                if (!screenshotsBySlide.has(slideNum)) {
                    screenshotsBySlide.set(slideNum, []);
                }
                screenshotsBySlide.get(slideNum)!.push(basename);
            }
        }

        // Build content with full prompt template
        const lines: string[] = [];

        // Header and instructions
        lines.push(`Create a Video Overview using the DOCX as the single source.`);
        lines.push(`CRITICAL: SINGLE-VOICE NARRATION ONLY`);
        lines.push(`The narration file (${narrationFilename}) is the SOLE source of all audio content. JACK is the only voice. There is NO second speaker, NO dialogue, NO host interruptions, NO banter.`);
        lines.push(`ABSOLUTE RULES:`);
        lines.push(``);
        lines.push(`Read ONLY the exact text in the narration file—verbatim, word-for-word.`);
        lines.push(``);
        lines.push(`JACK narrates every single line. Do NOT introduce a second voice, character, or host.`);
        lines.push(``);
        lines.push(`Do NOT add intro/outro, transitions, filler words ("So," "Okay," "Well"), definitions, or summaries.`);
        lines.push(``);
        lines.push(`ALWAYS complete full narration for every segment—even if images are missing.`);
        lines.push(``);

        // Slide timing section
        const timingParts: string[] = [];
        let totalSeconds = 0;
        for (const slide of video.slides) {
            // Use slide duration if available, otherwise default to 15s
            const duration = slide.duration ?? 15;
            totalSeconds += duration;
            timingParts.push(`Slide ${slide.number} (${duration}s)`);
        }
        lines.push(`SLIDE TIMING (EXACT):`);
        lines.push(`${timingParts.join(', ')}. Total: ~${totalSeconds} seconds.`);

        // Visual assets section - only slides with images
        lines.push(`VISUAL ASSETS TO FEATURE:`);
        for (const slide of video.slides) {
            const images = screenshotsBySlide.get(slide.number) || [];
            if (images.length > 0) {
                lines.push(`Slide ${slide.number}: ${images.join(', ')}`);
            }
        }
        lines.push(``);

        fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
        console.log(`[VideoFolderCreator] Generated: ${filePath}`);

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

        // Create a map of screenshots by slide number and code block index
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

        // Build document children - faithfully reproducing source content
        const children: any[] = [];

        // ===== VIDEO HEADER =====
        // Video Title
        children.push(new Paragraph({
            text: `Video ${video.videoNumber}: ${video.title}`,
            heading: HeadingLevel.HEADING_1
        }));
        children.push(new Paragraph({ text: '' }));

        // Duration (if present)
        if (video.duration) {
            children.push(new Paragraph({
                children: [
                    new TextRun({ text: 'Duration: ', bold: true }),
                    new TextRun({ text: video.duration })
                ]
            }));
        }

        // Concept (if present)
        if (video.concept) {
            children.push(new Paragraph({
                children: [
                    new TextRun({ text: 'Concept: ', bold: true }),
                    new TextRun({ text: video.concept })
                ]
            }));
        }

        if (video.duration || video.concept) {
            children.push(new Paragraph({ text: '' }));
        }

        // ===== SLIDES =====
        for (const slide of video.slides) {
            const slideScreenshots = screenshotsBySlide.get(slide.number) || [];
            let screenshotIndex = 0;

            // Slide Header with duration
            const slideHeader = slide.duration
                ? `[SLIDE ${slide.number}: ${slide.title}] **[${slide.duration} seconds]**`
                : `[SLIDE ${slide.number}: ${slide.title}]`;

            children.push(new Paragraph({
                text: slideHeader,
                heading: HeadingLevel.HEADING_2
            }));
            children.push(new Paragraph({ text: '' }));

            // Visual (if present)
            if (slide.visual) {
                children.push(new Paragraph({
                    children: [
                        new TextRun({ text: 'Visual: ', bold: true }),
                        new TextRun({ text: slide.visual })
                    ]
                }));
                children.push(new Paragraph({ text: '' }));
            }

            // Code blocks with screenshots
            for (const codeBlock of slide.codeBlocks) {
                // Get screenshot for this code block
                const screenshotPath = slideScreenshots[screenshotIndex];
                screenshotIndex++;

                if (screenshotPath && fs.existsSync(screenshotPath)) {
                    const screenshotFilename = path.basename(screenshotPath);

                    try {
                        const imageBuffer = fs.readFileSync(screenshotPath);

                        // Screenshot filename label
                        children.push(new Paragraph({
                            children: [
                                new TextRun({
                                    text: `[Code Screenshot: ${screenshotFilename}]`,
                                    bold: true,
                                    color: '4472C4'
                                })
                            ]
                        }));

                        // Embedded screenshot image
                        children.push(new Paragraph({
                            children: [
                                new ImageRun({
                                    data: imageBuffer,
                                    transformation: {
                                        width: 550,
                                        height: 350
                                    },
                                    type: 'png'
                                } as any)
                            ]
                        }));
                        children.push(new Paragraph({ text: '' }));

                        // Add original code as text (for reference/copy-paste)
                        children.push(new Paragraph({
                            children: [
                                new TextRun({ text: 'Original Code:', bold: true, italics: true, color: '808080' })
                            ]
                        }));

                        // Split code by lines and create TextRuns with breaks
                        const codeLines = codeBlock.code.split('\n');
                        const codeTextRuns: any[] = [];
                        codeLines.forEach((line, idx) => {
                            if (idx > 0) {
                                codeTextRuns.push(new TextRun({ break: 1 }));
                            }
                            codeTextRuns.push(new TextRun({
                                text: line || ' ', // Use space for empty lines to preserve them
                                font: 'Consolas',
                                size: 18,
                                color: '666666'
                            }));
                        });
                        children.push(new Paragraph({ children: codeTextRuns }));
                        children.push(new Paragraph({ text: '' }));

                        // Add expected output if present
                        if (codeBlock.expectedOutput) {
                            children.push(new Paragraph({
                                children: [
                                    new TextRun({ text: 'Expected Output:', bold: true, italics: true, color: '808080' })
                                ]
                            }));

                            // Split output by lines and create TextRuns with breaks
                            const outputLines = codeBlock.expectedOutput.split('\n');
                            const outputTextRuns: any[] = [];
                            outputLines.forEach((line, idx) => {
                                if (idx > 0) {
                                    outputTextRuns.push(new TextRun({ break: 1 }));
                                }
                                outputTextRuns.push(new TextRun({
                                    text: line || ' ',
                                    font: 'Consolas',
                                    size: 18,
                                    color: '666666'
                                }));
                            });
                            children.push(new Paragraph({ children: outputTextRuns }));
                            children.push(new Paragraph({ text: '' }));
                        }

                    } catch (err) {
                        console.warn(`[VideoFolderCreator] Could not embed image: ${screenshotPath}`);
                        // Fallback: show code as text
                        children.push(new Paragraph({
                            children: [
                                new TextRun({ text: 'Code:', bold: true })
                            ]
                        }));
                        children.push(new Paragraph({
                            children: [
                                new TextRun({
                                    text: codeBlock.code,
                                    font: 'Consolas',
                                    size: 20 // 10pt
                                })
                            ]
                        }));
                        children.push(new Paragraph({ text: '' }));
                    }
                } else {
                    // No screenshot - show code as text
                    children.push(new Paragraph({
                        children: [
                            new TextRun({ text: 'Code:', bold: true })
                        ]
                    }));
                    children.push(new Paragraph({
                        children: [
                            new TextRun({
                                text: codeBlock.code,
                                font: 'Consolas',
                                size: 20
                            })
                        ]
                    }));

                    // Show expected output if present
                    if (codeBlock.expectedOutput) {
                        children.push(new Paragraph({
                            children: [
                                new TextRun({ text: 'Output:', bold: true })
                            ]
                        }));
                        children.push(new Paragraph({
                            children: [
                                new TextRun({
                                    text: codeBlock.expectedOutput,
                                    font: 'Consolas',
                                    size: 20
                                })
                            ]
                        }));
                    }
                    children.push(new Paragraph({ text: '' }));
                }
            }

            // Audio/Narration
            if (slide.audio) {
                children.push(new Paragraph({
                    children: [
                        new TextRun({ text: 'Audio: ', bold: true }),
                        new TextRun({ text: `"${slide.audio}"`, italics: true })
                    ]
                }));
                children.push(new Paragraph({ text: '' }));
            }

            // Separator between slides
            children.push(new Paragraph({ text: '─'.repeat(50) }));
            children.push(new Paragraph({ text: '' }));
        }

        const doc = new Document({
            sections: [{
                properties: {},
                children
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
                        { filename: 'main.py' }
                    );
                    screenshotPaths.push(codePath);
                } else {
                    // Try to execute and capture
                    const result = await this.screenshotService.executeAndCapture(
                        block.code,
                        folderPath,
                        baseName,
                        { filename: 'main.py' }
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
