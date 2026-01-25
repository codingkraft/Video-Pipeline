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
    batchSize?: number; // Number of videos to batch together (default: 3)
}

/**
 * Result of generating a single video folder
 */
export interface VideoFolderResult {
    videoNumber: string;
    folderPath: string;
    narrationPath?: string;
    perVideoNarrationPaths?: string[];  // Individual narration files for batched videos
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

        let videos = parseResult.videos;
        const batchSize = config.batchSize ?? 3;

        if (batchSize > 1) {
            console.log(`[VideoFolderCreator] Batching videos (size: ${batchSize})...`);
            videos = this.consolidateVideos(videos, batchSize);
            console.log(`[VideoFolderCreator] Created ${videos.length} batched videos`);
        }

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
     * Consolidate multiple videos into batched videos
     */
    private consolidateVideos(videos: VideoSection[], batchSize: number): VideoSection[] {
        const batchedVideos: VideoSection[] = [];

        for (let i = 0; i < videos.length; i += batchSize) {
            const batch = videos.slice(i, i + batchSize);
            const firstVideo = batch[0];
            const lastVideo = batch[batch.length - 1];

            // Create combined video number string "1,2,3"
            const videoNumbers = batch.map(v => v.videoNumber).join(',');

            // Calculate total duration (if available) - parse "180 seconds" -> 180
            let totalSeconds = 0;

            // Collect all slides with renumbering
            const allSlides: any[] = [];
            const allCodeBlocks: CodeBlock[] = [];
            let currentSlideNumber = 1;

            const narrationParts: string[] = [];

            for (const v of batch) {
                // Add separator between videos in narration (except first)
                if (batchedVideos.length > 0 || v !== batch[0]) {
                    // This "next video please" separates distinct videos within the batch
                    // note: logic check - do we want this separator even for first video of valid batch? 
                    // No, only between videos *within* the batch.
                }

                // Append full narration of this video
                /* 
                   Logic:
                   Video 1 Narration: "Slide 1 Audio. [next slide please] Slide 2 Audio."
                   If we just join Video 1 and Video 2 with "next video please", 
                   we get: "...Slide 2 Audio. [next video please] Slide 1 Audio (Video 2)..."
                   This works with the splitter logic if splitter treats 'next video please' as a cut.
                */
                narrationParts.push(v.fullNarration);

                // Process slides
                for (const slide of v.slides) {
                    // Update slide number
                    const newSlide = { ...slide, number: currentSlideNumber, originalVideoNumber: v.videoNumber };

                    // Update code blocks
                    for (const block of newSlide.codeBlocks) {
                        block.slideNumber = currentSlideNumber;
                        allCodeBlocks.push(block);
                    }

                    allSlides.push(newSlide);
                    currentSlideNumber++;

                    // Add duration
                    if (slide.duration) {
                        totalSeconds += slide.duration;
                    }
                }
            }

            const combinedNarration = narrationParts.join('\n\nnext video please\n\n');
            const totalDurationStr = `${totalSeconds} seconds`;

            batchedVideos.push({
                videoNumber: videoNumbers,
                title: firstVideo.title, // Use title of first video as metadata base
                duration: totalDurationStr,
                concept: firstVideo.concept,
                slides: allSlides,
                allCodeBlocks: allCodeBlocks,
                fullNarration: combinedNarration,
                originalVideos: batch  // Store original videos for per-video audio generation
            });
        }

        return batchedVideos;
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

        // Generate narration TXT (combined narration for batched videos)
        if (config.generateNarration !== false) {
            result.narrationPath = await this.generateNarrationFile(video, folderPath);

            // For batched videos, also generate individual narration files per original video
            // This enables per-video audio generation to stay within Google Studio's 10-minute limit
            result.perVideoNarrationPaths = await this.generatePerVideoNarrationFiles(video, folderPath);
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
     * Generate narration TXT file (combined narration for NotebookLM upload)
     * Uses [slide_number] markers for easy reference
     */
    private async generateNarrationFile(video: VideoSection, folderPath: string): Promise<string> {
        const filename = `video${video.videoNumber}_narration.txt`;
        const filePath = path.join(folderPath, filename);

        // Use NotebookLM format with [slide_number] markers for the combined narration
        const content = MarkdownScriptParser.generateNarrationFileForNotebookLM(video);
        fs.writeFileSync(filePath, content, 'utf-8');

        return filePath;
    }

    /**
     * Generate individual narration files for each original video in a batch.
     * These go to a separate 'audio_narration' folder to avoid being uploaded to NotebookLM.
     * Uses 'next slide please' markers for TTS/Whisper processing.
     * @returns Array of generated narration file paths
     */
    private async generatePerVideoNarrationFiles(video: VideoSection, folderPath: string): Promise<string[]> {
        const filePaths: string[] = [];

        // Only generate individual files if this is a batched video with originalVideos
        if (!video.originalVideos || video.originalVideos.length <= 1) {
            console.log(`[VideoFolderCreator] Single video, skipping per-video narration generation`);
            return filePaths;
        }

        // Create separate folder for audio narration files (won't be uploaded to NotebookLM)
        const audioNarrationDir = path.join(folderPath, 'audio_narration');
        if (!fs.existsSync(audioNarrationDir)) {
            fs.mkdirSync(audioNarrationDir, { recursive: true });
        }

        console.log(`[VideoFolderCreator] Generating ${video.originalVideos.length} per-video narration files in audio_narration/`);

        for (const originalVideo of video.originalVideos) {
            const filename = `video${originalVideo.videoNumber}_narration_individual.txt`;
            const filePath = path.join(audioNarrationDir, filename);

            // Use TTS format with 'next slide please' markers
            const content = MarkdownScriptParser.generateNarrationFile(originalVideo);
            fs.writeFileSync(filePath, content, 'utf-8');
            filePaths.push(filePath);

            console.log(`[VideoFolderCreator] Generated: audio_narration/${filename}`);
        }

        return filePaths;
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

        const filename = `perplexity_video_response.txt`;
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

        // Slide timing section - calculate total from slides
        const timingParts: string[] = [];
        let totalSeconds = 0;
        for (const slide of video.slides) {
            // Use slide duration if available, otherwise default to 15s
            const duration = slide.duration ?? 15;
            totalSeconds += duration;
            timingParts.push(`Slide ${slide.number} (${duration}s)`);
        }

        // Header and instructions
        // Use calculated totalSeconds if video.duration is missing or "0 seconds"
        let durationText = video.duration || '';
        if (!durationText || durationText === '0 seconds' || durationText.startsWith('0 ')) {
            durationText = `${totalSeconds} seconds`;
        }
        lines.push(`Create a Video Overview (~${durationText}) using the DOCX as the source.`);
        lines.push(``);
        lines.push(`CRITICAL INSTRUCTION FOR DOCX INTERPRETATION:`);
        lines.push(`1. IGNORE HEADERS: Do NOT generate slides that display the text "[SLIDE X]" or "Video 0". Treat all bracketed text [ ] as invisible instructions.`);
        lines.push(`2. USE SUPPORTING VISUALS: When the DOCX has a section labeled "Supporting Visuals" (e.g., "Split screen: Person at desk vs Code running"), you must GENERATE that exact image. Do NOT just write the text of the description on screen.`);
        lines.push(`3. NO CHAPTER CARDS: The video must flow continuously. Do not insert "Chapter 1" or "Part 1" title cards between segments.`);

        lines.push(``);
        lines.push(`AUDIO RULE:`);
        lines.push(`- Source: Use 'video0,1,2_narration.txt' exclusively.`);
        lines.push(`- Read VERBATIM. Do not ad-lib. Do not read visual descriptions.`);

        lines.push(``);
        lines.push(`ABSOLUTE RULES:`);
        lines.push(`1. FULL IMMERSION: The entire slide is the screen. Do not place a "computer monitor" on a desk. The viewer IS the computer.`);
        lines.push(`2. DARK MODE ENFORCEMENT: The background of every single slide must be black pixels (#000000) or a dark grid.`);

        lines.push(``);

        lines.push(`SLIDE TIMING (EXACT):`);
        lines.push(`${timingParts.join(', ')}. Total: ~${totalSeconds} seconds.`);
        lines.push(``);

        // Visual assets section - only slides with images
        lines.push(`VISUAL ASSETS TO FEATURE:`);
        for (const slide of video.slides) {
            const images = screenshotsBySlide.get(slide.number) || [];
            if (images.length > 0) {
                lines.push(`Slide ${slide.number}: ${images.join(', ')}`);
            }
        }
        lines.push(`- Do not obscure the code text with other graphics.`);

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
        let currentOriginalVideo = ''; // Track video changes
        let isFirstVideoHeader = true; // Track if we've added the first video header

        for (const slide of video.slides) {
            const slideScreenshots = screenshotsBySlide.get(slide.number) || [];
            let screenshotIndex = 0;

            // Video Demarcation Check
            if (slide.originalVideoNumber && slide.originalVideoNumber !== currentOriginalVideo) {
                currentOriginalVideo = slide.originalVideoNumber;

                // Add explicit Video Header (Visual Demarcation) - ONLY for the first video in the batch
                if (isFirstVideoHeader) {
                    children.push(new Paragraph({
                        text: `[[Video: ${currentOriginalVideo}]]`, // Wrapped in [[]]
                        heading: HeadingLevel.HEADING_1,
                        spacing: { before: 400, after: 200 }
                    }));
                    isFirstVideoHeader = false;
                }
                // Subsequent video headers are skipped as per requirement
            }

            // Slide Header with duration
            const slideHeader = slide.duration
                ? `[[SLIDE ${slide.number}: ${slide.title}]] **[${slide.duration} seconds]**`
                : `[[SLIDE ${slide.number}: ${slide.title}]]`;

            children.push(new Paragraph({
                text: slideHeader,
                heading: HeadingLevel.HEADING_2
            }));
            children.push(new Paragraph({ text: '' }));

            // Visual (if present) - preserve newlines
            if (slide.visual) {
                // Split visual by newlines to preserve line breaks
                const visualLines = slide.visual.split('\n');
                const visualRuns: any[] = [
                    new TextRun({ text: 'Visual: ', bold: true })
                ];
                visualLines.forEach((line, idx) => {
                    if (idx > 0) {
                        visualRuns.push(new TextRun({ break: 1 }));
                    }
                    visualRuns.push(new TextRun({ text: line || ' ' }));
                });
                children.push(new Paragraph({ children: visualRuns }));
                children.push(new Paragraph({ text: '' }));
            }

            // Supporting Visuals (if present) - output as-is in DOCX
            if (slide.supportingVisual) {
                children.push(new Paragraph({
                    children: [
                        new TextRun({ text: 'Supporting Visuals: ', bold: true })
                    ]
                }));
                // Split by newlines to preserve formatting
                const supportingLines = slide.supportingVisual.split('\n');
                const supportingRuns: any[] = [];
                supportingLines.forEach((line, idx) => {
                    if (idx > 0) {
                        supportingRuns.push(new TextRun({ break: 1 }));
                    }
                    supportingRuns.push(new TextRun({ text: line || ' ' }));
                });
                children.push(new Paragraph({ children: supportingRuns }));
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
                        // Fallback: show code as text with preserved line breaks
                        children.push(new Paragraph({
                            children: [
                                new TextRun({ text: 'Code:', bold: true })
                            ]
                        }));

                        // Split code by lines to preserve newlines
                        const fallbackCodeLines = codeBlock.code.split('\n');
                        const fallbackCodeRuns: any[] = [];
                        fallbackCodeLines.forEach((line, idx) => {
                            if (idx > 0) {
                                fallbackCodeRuns.push(new TextRun({ break: 1 }));
                            }
                            fallbackCodeRuns.push(new TextRun({
                                text: line || ' ',
                                font: 'Consolas',
                                size: 20
                            }));
                        });
                        children.push(new Paragraph({ children: fallbackCodeRuns }));
                        children.push(new Paragraph({ text: '' }));
                    }
                } else {
                    // No screenshot - show code as text with preserved line breaks
                    children.push(new Paragraph({
                        children: [
                            new TextRun({ text: 'Code:', bold: true })
                        ]
                    }));

                    // Split code by lines to preserve newlines and empty lines
                    const codeLines = codeBlock.code.split('\n');
                    const codeTextRuns: any[] = [];
                    codeLines.forEach((line, idx) => {
                        if (idx > 0) {
                            codeTextRuns.push(new TextRun({ break: 1 }));
                        }
                        codeTextRuns.push(new TextRun({
                            text: line || ' ', // Use space for empty lines to preserve them
                            font: 'Consolas',
                            size: 20
                        }));
                    });
                    children.push(new Paragraph({ children: codeTextRuns }));

                    // Show expected output if present
                    if (codeBlock.expectedOutput) {
                        children.push(new Paragraph({
                            children: [
                                new TextRun({ text: 'Output:', bold: true })
                            ]
                        }));

                        // Split output by lines to preserve newlines
                        const outputLines = codeBlock.expectedOutput.split('\n');
                        const outputTextRuns: any[] = [];
                        outputLines.forEach((line, idx) => {
                            if (idx > 0) {
                                outputTextRuns.push(new TextRun({ break: 1 }));
                            }
                            outputTextRuns.push(new TextRun({
                                text: line || ' ',
                                font: 'Consolas',
                                size: 20
                            }));
                        });
                        children.push(new Paragraph({ children: outputTextRuns }));
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
                } else if (block.produceOutput === false) {
                    // PRODUCE OUTPUT: FALSE - capture code-only screenshot
                    // If there's an error, we only show the code (no console/output)
                    const codePath = path.join(folderPath, `${baseName}.png`);

                    // Try executing to see if there's an error
                    const result = await this.screenshotService.executePython(block.code);

                    if (!result.success) {
                        // Error case with PRODUCE OUTPUT: FALSE - capture code-only
                        console.log(`[VideoFolderCreator] PRODUCE OUTPUT: FALSE with error, capturing code-only for ${baseName}`);
                        await this.screenshotService.captureCode(block.code, codePath, { filename: 'main.py' });
                    } else {
                        // Success case - capture code with output normally
                        await this.screenshotService.captureCodeWithOutput(
                            block.code,
                            result.stdout || '',
                            codePath,
                            { filename: 'main.py' }
                        );
                    }
                    screenshotPaths.push(codePath);
                } else {
                    // Normal case: Try to execute and capture (produceOutput is true or undefined)
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
