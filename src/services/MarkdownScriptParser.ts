import * as fs from 'fs';
import * as path from 'path';

/**
 * Represents a code block extracted from the markdown
 */
export interface CodeBlock {
    code: string;
    language: string;
    slideNumber: number;
    slideTitle: string;
    expectedOutput?: string;
}

/**
 * Represents a slide within a video
 */
export interface Slide {
    number: number;
    title: string;
    visual?: string;
    audio: string;
    codeBlocks: CodeBlock[];
    expectedOutput?: string;
    duration?: number;  // in seconds
}

/**
 * Represents a complete video section
 */
export interface VideoSection {
    videoNumber: string;
    title: string;
    duration?: string;
    concept?: string;
    slides: Slide[];
    allCodeBlocks: CodeBlock[];
    fullNarration: string;  // Combined audio from all slides
}

/**
 * Result of parsing a markdown script
 */
export interface ParseResult {
    videos: VideoSection[];
    chapterTitle?: string;
    totalVideos: number;
}

/**
 * Parser for extracting video sections, slides, code blocks, and narration
 * from markdown script files (Perplexity format).
 */
export class MarkdownScriptParser {

    /**
     * Parse a markdown file and extract all video sections
     */
    static parseFile(filePath: string): ParseResult {
        const content = fs.readFileSync(filePath, 'utf-8');
        return this.parseContent(content);
    }

    /**
     * Parse markdown content string
     */
    static parseContent(content: string): ParseResult {
        const videos: VideoSection[] = [];

        // Extract chapter title (e.g., "Arc 2: Memory & Storage")
        const chapterMatch = content.match(/^#\s+Arc\s+\d+[^#\n]*/m);
        const chapterTitle = chapterMatch ? chapterMatch[0].replace('#', '').trim() : undefined;

        // Split content by video sections (## Video X: Title)
        const videoRegex = /^##\s+Video\s+([\d\.]+):\s*(.+)$/gm;
        const videoMatches = [...content.matchAll(videoRegex)];

        for (let i = 0; i < videoMatches.length; i++) {
            const match = videoMatches[i];
            const videoNumber = match[1]; // Keep as string to support decimals like "9.1"
            const videoTitle = match[2].trim();

            // Get content for this video (until next video or end)
            const startIndex = match.index!;
            const endIndex = i < videoMatches.length - 1
                ? videoMatches[i + 1].index!
                : content.length;

            const videoContent = content.substring(startIndex, endIndex);

            // Parse this video section
            const videoSection = this.parseVideoSection(videoContent, videoNumber, videoTitle);
            videos.push(videoSection);
        }

        return {
            videos,
            chapterTitle,
            totalVideos: videos.length
        };
    }

    /**
     * Parse a single video section
     */
    private static parseVideoSection(content: string, videoNumber: string, title: string): VideoSection {
        const slides: Slide[] = [];
        const allCodeBlocks: CodeBlock[] = [];
        const narrationParts: string[] = [];

        // Extract duration and concept from header
        const durationMatch = content.match(/\*\*Duration:\*\*\s*([^\n]+)/);
        const conceptMatch = content.match(/\*\*Concept:\*\*\s*([^\n]+)/);

        // Split by slides (### [SLIDE N: Title])
        const slideRegex = /^###\s+\[SLIDE\s+(\d+):\s*([^\]]+)\]/gm;
        const slideMatches = [...content.matchAll(slideRegex)];

        for (let i = 0; i < slideMatches.length; i++) {
            const match = slideMatches[i];
            const slideNumber = parseInt(match[1]);
            const slideTitle = match[2].trim();

            // Get content for this slide (until next slide or end of video section)
            const startIndex = match.index!;
            const endIndex = i < slideMatches.length - 1
                ? slideMatches[i + 1].index!
                : content.length;

            const slideContent = content.substring(startIndex, endIndex);

            // Parse slide content
            const slide = this.parseSlide(slideContent, slideNumber, slideTitle);
            slides.push(slide);

            // Collect code blocks
            allCodeBlocks.push(...slide.codeBlocks);

            // Collect narration
            if (slide.audio) {
                narrationParts.push(slide.audio);
            }
        }

        return {
            videoNumber,
            title,
            duration: durationMatch ? durationMatch[1].trim() : undefined,
            concept: conceptMatch ? conceptMatch[1].trim() : undefined,
            slides,
            allCodeBlocks,
            fullNarration: narrationParts.join('\n\n')
        };
    }

    /**
     * Parse a single slide
     */
    private static parseSlide(content: string, number: number, title: string): Slide {
        const codeBlocks: CodeBlock[] = [];

        // Extract audio/narration
        const audioMatch = content.match(/\*\*Audio:\*\*\s*\n?"?([^"]+)"?/);
        const audio = audioMatch ? this.cleanNarration(audioMatch[1]) : '';

        // Extract visual description
        const visualMatch = content.match(/\*\*Visual:\*\*\s*([^\n]+(?:\n(?!\*\*).*)*)/);
        const visual = visualMatch ? visualMatch[1].trim() : undefined;

        // Extract duration
        const durationMatch = content.match(/\*\*\[(\d+)\s*seconds?\]\*\*/);
        const duration = durationMatch ? parseInt(durationMatch[1]) : undefined;

        // Extract code blocks
        const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
        let codeMatch;
        while ((codeMatch = codeBlockRegex.exec(content)) !== null) {
            const language = codeMatch[1] || 'python';
            const code = codeMatch[2].trim();

            // Skip output blocks (they usually follow a code block)
            if (this.isOutputBlock(content, codeMatch.index!, code)) {
                continue;
            }

            codeBlocks.push({
                code,
                language,
                slideNumber: number,
                slideTitle: title
            });
        }

        // Extract expected output
        const outputMatch = content.match(/\*\*Output:\*\*\s*\n```[\w]*\n([\s\S]*?)```/);
        const expectedOutput = outputMatch ? outputMatch[1].trim() : undefined;

        // Link output to corresponding code block
        if (expectedOutput && codeBlocks.length > 0) {
            codeBlocks[codeBlocks.length - 1].expectedOutput = expectedOutput;
        }

        return {
            number,
            title,
            visual,
            audio,
            codeBlocks,
            expectedOutput,
            duration
        };
    }

    /**
     * Check if a code block is actually an output block
     */
    private static isOutputBlock(content: string, blockIndex: number, code: string): boolean {
        // Check if this block is preceded by **Output:**
        const beforeBlock = content.substring(Math.max(0, blockIndex - 50), blockIndex);
        if (beforeBlock.includes('**Output:**')) {
            return true;
        }

        // Check if code looks like pure output (numbers only, no Python syntax)
        const lines = code.split('\n').filter(l => l.trim());
        const allNumbers = lines.every(l => /^-?\d+(\.\d+)?$/.test(l.trim()));
        if (allNumbers && lines.length > 0 && lines.length <= 5) {
            return true;
        }

        return false;
    }

    /**
     * Clean narration text (remove quotes, extra whitespace)
     */
    private static cleanNarration(text: string): string {
        return text
            .replace(/^["']|["']$/g, '')  // Remove surrounding quotes
            .replace(/\s+/g, ' ')          // Normalize whitespace
            .trim();
    }

    /**
     * Get all code blocks for a specific video
     */
    static getCodeBlocksForVideo(result: ParseResult, videoNumber: string): CodeBlock[] {
        const video = result.videos.find(v => v.videoNumber === videoNumber);
        return video ? video.allCodeBlocks : [];
    }

    /**
     * Get full narration for a specific video
     */
    static getNarrationForVideo(result: ParseResult, videoNumber: string): string {
        const video = result.videos.find(v => v.videoNumber === videoNumber);
        return video ? video.fullNarration : '';
    }

    /**
     * Generate narration file content for a video (for TTS)
     * Uses spoken "MARKER" word between slides for Whisper-based splitting
     */
    static generateNarrationFile(video: VideoSection): string {
        const parts: string[] = [];
        let isFirst = true;

        for (const slide of video.slides) {
            if (slide.audio) {
                if (isFirst) {
                    // First slide: just the narration, no marker
                    parts.push(slide.audio);
                    isFirst = false;
                } else {
                    // Subsequent slides: add spoken 'next slide please' before narration
                    // This phrase will be detected by Whisper and used to split the audio
                    parts.push('next slide please');
                    parts.push(slide.audio);
                }
            }
        }

        // Join with double newlines for natural pausing
        return parts.join('\n\n');
    }
}

// Export convenience function
export function parseMarkdownScript(filePath: string): ParseResult {
    return MarkdownScriptParser.parseFile(filePath);
}
