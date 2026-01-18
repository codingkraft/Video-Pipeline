import * as fs from 'fs';
import * as path from 'path';
import * as mammoth from 'mammoth';
import { VideoSection, Slide, CodeBlock, ParseResult } from './MarkdownScriptParser';

/**
 * Parser for extracting video sections, slides, code blocks, and narration
 * from DOCX script files.
 * 
 * Uses mammoth to convert DOCX to HTML, then parses the HTML structure.
 * Detects code blocks by their styling (monospace/Verbatim Char) not just patterns.
 */
export class DocxScriptParser {

    /**
     * Parse a DOCX file and extract all video sections
     */
    static async parseFile(filePath: string): Promise<ParseResult> {
        const buffer = fs.readFileSync(filePath);

        // Use style mapping to detect code blocks by their formatting
        // Try multiple variations of code style names
        const result = await mammoth.convertToHtml({
            buffer,
            styleMap: [
                // Common code style names
                "r[style-name='Verbatim Char'] => code",
                "r[style-name='VerbatimChar'] => code",
                "r[style-name='verbatim char'] => code",
                "r[style-name='Code'] => code",
                "r[style-name='Source Code'] => code",
                "r[style-name='HTML Code'] => code",
                // Paragraph styles
                "p[style-name='Code Block'] => pre",
                "p[style-name='Source Code'] => pre"
            ]
        } as any);
        const html = result.value;

        // Log any warnings about unrecognized styles
        if (result.messages.length > 0) {
            console.log('[DocxParser] Mammoth messages:', result.messages.map(m => m.message).join('; '));
        }

        return this.parseHtmlContent(html);
    }

    /**
     * Parse HTML content (from mammoth conversion)
     */
    static parseHtmlContent(html: string): ParseResult {
        const videos: VideoSection[] = [];

        // Clean up HTML - remove tags but keep structure markers
        const cleanHtml = html
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/p>/gi, '\n\n')
            .replace(/<p[^>]*>/gi, '')
            .replace(/<a[^>]*>/gi, '')
            .replace(/<\/a>/gi, '')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");

        // Extract chapter title (e.g., "Arc 2: Memory & Storage")
        const chapterMatch = cleanHtml.match(/<strong>Arc\s+\d+[^<]*<\/strong>/i);
        const chapterTitle = chapterMatch
            ? chapterMatch[0].replace(/<\/?strong>/gi, '').trim()
            : undefined;

        // Split by video sections
        // Pattern: <strong>Video X: Title</strong> or <h2>Video X: Title</h2>
        // Match both patterns:
        // 1. <strong>Video X: Title</strong>
        // 2. <h2><a id="..."></a>Video X: Title</h2>
        const videoRegex = /(?:<strong>Video\s+([\d.]+):\s*([^<]+)<\/strong>|<h2>(?:<a[^>]*><\/a>)?Video\s+([\d.]+):\s*([^<]+)<\/h2>)/gi;
        const videoMatches = [...html.matchAll(videoRegex)];

        for (let i = 0; i < videoMatches.length; i++) {
            const match = videoMatches[i];
            // For alternation regex: either groups 1,2 (strong) or groups 3,4 (h2) are populated
            const videoNumber = match[1] || match[3];
            const videoTitle = (match[2] || match[4]).trim();

            // Get content for this video (until next video or end)
            const startIndex = match.index!;
            const endIndex = i < videoMatches.length - 1
                ? videoMatches[i + 1].index!
                : html.length;

            const videoContent = html.substring(startIndex, endIndex);

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

        // Remove HTML tags for text extraction
        const textContent = content.replace(/<[^>]+>/g, '');

        // Extract duration and concept
        const durationMatch = textContent.match(/Duration:\s*([^\n]+)/i);
        const conceptMatch = textContent.match(/Concept:\s*([^\n]+)/i);

        // Split by slides - pattern: [SLIDE N: Title]
        // Match both formats:
        // 1. <strong>[SLIDE N: Title]</strong>
        // 2. <h3><a id="..."></a>[SLIDE N: Title]</h3>
        const slideRegex = /(?:<strong>\[SLIDE\s+(\d+):\s*([^\]]+)\]<\/strong>|<h3>(?:<a[^>]*><\/a>)?\[SLIDE\s+(\d+):\s*([^\]]+)\]<\/h3>)/gi;
        const slideMatches = [...content.matchAll(slideRegex)];

        for (let i = 0; i < slideMatches.length; i++) {
            const match = slideMatches[i];
            // For alternation regex: either groups 1,2 (strong) or groups 3,4 (h3) are populated
            const slideNumber = parseInt(match[1] || match[3]);
            const slideTitle = (match[2] || match[4]).trim();

            // Get content for this slide
            const startIndex = match.index!;
            const endIndex = i < slideMatches.length - 1
                ? slideMatches[i + 1].index!
                : content.length;

            const slideContent = content.substring(startIndex, endIndex);

            // Parse slide
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
        let visual: string | undefined;
        let audio: string | undefined;
        let expectedOutput: string | undefined;
        let duration: number | undefined;

        // For h3 format: sections are marked by <strong>Visual:</strong>, <strong>Audio:</strong>, etc.
        // Extract visual section (between Visual: and Audio: or Output: or [seconds])
        const visualMatch = content.match(/<strong>Visual:<\/strong>(?:<\/p>)?(?:<p>)?([\s\S]*?)(?=<strong>(?:Audio:|Output:|\[\d+\s*seconds?\]))/i);
        if (visualMatch) {
            // Clean the visual content - this contains the code
            let visualContent = visualMatch[1]
                .replace(/<br\s*\/?>/gi, '\n')
                .replace(/<\/?p>/gi, '\n')
                .replace(/<[^>]+>/g, '')
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .trim();

            // Check if this looks like code (requires stronger Python patterns)
            // Must have common Python patterns, not just colons (which appear in titles like "Video 6:")
            const hasCodePatterns =
                /print\s*\(/.test(visualContent) ||         // print function
                /=\s*["']/.test(visualContent) ||           // string assignment
                /=\s*\d/.test(visualContent) ||             // number assignment
                /def\s+\w+\s*\(/.test(visualContent) ||     // function definition
                /import\s+\w/.test(visualContent) ||        // import statement
                /^\s*#/.test(visualContent) ||              // Comment at start
                /\n\s*#/.test(visualContent) ||             // Comment on any line
                /\[\s*\d/.test(visualContent) ||            // List with numbers
                /for\s+\w+\s+in/.test(visualContent) ||     // for loop
                /if\s+\w/.test(visualContent) ||            // if statement
                /\w+\s*\(.*\)/.test(visualContent);         // function call with args

            if (hasCodePatterns && visualContent.length > 15) {
                // This is code content
                codeBlocks.push({
                    code: visualContent,
                    language: 'python',
                    slideNumber: number,
                    slideTitle: title
                });
                // For visual, just use the title or first short description
                visual = title;
            } else {
                // Not code, use as visual description (first line only)
                visual = visualContent.split('\n')[0];
            }
        }

        // Extract output section (between Output: and Audio: or [seconds])
        const outputMatch = content.match(/<strong>Output:<\/strong>(?:<\/p>)?(?:<p>)?([\s\S]*?)(?=<strong>(?:Audio:|\[\d+\s*seconds?\]))/i);
        if (outputMatch && codeBlocks.length > 0) {
            expectedOutput = outputMatch[1]
                .replace(/<br\s*\/?>/gi, '\n')
                .replace(/<\/?p>/gi, '\n')
                .replace(/<[^>]+>/g, '')
                .trim();
            codeBlocks[codeBlocks.length - 1].expectedOutput = expectedOutput;
        }

        // Extract audio/narration section (between Audio: and [seconds] or end)
        const audioMatch = content.match(/<strong>Audio:<\/strong>(?:<br\s*\/?>)?"?([\s\S]*?)(?="?<\/p>\s*<p>\s*<strong>\[\d+|"?<\/p>\s*$)/i);
        if (audioMatch) {
            audio = audioMatch[1]
                .replace(/<br\s*\/?>/gi, ' ')
                .replace(/<[^>]+>/g, '')
                .replace(/["""'']/g, '')  // Remove all types of quotes
                .replace(/\s+/g, ' ')
                .trim();
            audio = this.cleanNarration(audio);
        }

        // Extract duration
        const durationMatch = content.match(/<strong>\[(\d+)\s*seconds?\]<\/strong>/i);
        if (durationMatch) {
            duration = parseInt(durationMatch[1]);
        }

        // Fallback: If no code found via Visual section, try looking for code patterns directly
        if (codeBlocks.length === 0) {
            const textContent = content
                .replace(/<br\s*\/?>/gi, '\n')
                .replace(/<[^>]+>/g, '')
                .trim();

            // Look for explicit Code: section
            const codeMatch = textContent.match(/Code:\s*\n([\s\S]*?)(?=\nAudio:|\nOutput:|\n\[|$)/i);
            if (codeMatch && codeMatch[1].trim()) {
                codeBlocks.push({
                    code: codeMatch[1].trim(),
                    language: 'python',
                    slideNumber: number,
                    slideTitle: title
                });
            }
        }

        return {
            number,
            title,
            visual,
            audio: audio || '',
            codeBlocks,
            duration
        };
    }

    /**
     * Extract Python code from visual description
     * Code blocks in DOCX appear inline in the Visual section
     */
    private static extractCodeFromVisual(visual: string): { code: string; output?: string; remainingVisual?: string } | null {
        const lines = visual.split('\n');
        const codeLines: string[] = [];
        const outputLines: string[] = [];
        const visualLines: string[] = [];
        let inOutput = false;

        for (const line of lines) {
            const trimmed = line.trim();

            // Check if it's a code line (Python patterns)
            const isCodeLine =
                /^[a-z_][a-z0-9_]*\s*=\s*.+/i.test(trimmed) ||  // assignment: variable = value
                /^print\s*\(/.test(trimmed) ||                    // print statement
                /^#\s/.test(trimmed) ||                           // comment at start
                /^[a-z_][a-z0-9_]*\s*\+\s*=/.test(trimmed) ||    // augmented assignment
                /^[a-z_][a-z0-9_]*\s*-\s*=/.test(trimmed) ||
                /^import\s/.test(trimmed) ||
                /^from\s/.test(trimmed) ||
                /^def\s/.test(trimmed) ||
                /^class\s/.test(trimmed) ||
                /^if\s/.test(trimmed) ||
                /^for\s/.test(trimmed) ||
                /^while\s/.test(trimmed) ||
                // NEW: Standalone values with inline comments
                /^-?\d+(\.\d+)?\s+#/.test(trimmed) ||             // number with comment: 42 # int, 3.14 # float
                /^["'][^"']*["']\s+#/.test(trimmed) ||            // string with comment: "42" # string
                /^(True|False|None)\s*(#|$)/i.test(trimmed) ||    // boolean/None values
                // NEW: Just a value (when we're already collecting code)
                /^-?\d+(\.\d+)?$/.test(trimmed) ||                // plain number
                /^["'][^"']*["']$/.test(trimmed);                  // plain string literal

            // Check if it's output (after Output: or just numbers/simple text)
            if (/^Output:/i.test(trimmed)) {
                inOutput = true;
                continue;
            }

            if (inOutput) {
                outputLines.push(trimmed);
            } else if (isCodeLine) {
                codeLines.push(trimmed);
            } else if (codeLines.length > 0 && trimmed === '') {
                // Preserve empty lines within code blocks
                codeLines.push('');
            } else if (codeLines.length > 0 && !trimmed.includes(':') && trimmed) {
                // Continue collecting code if it looks like code continuation
                codeLines.push(trimmed);
            } else if (!inOutput) {
                visualLines.push(line);
            }
        }

        if (codeLines.length > 0) {
            return {
                code: codeLines.join('\n'),
                output: outputLines.length > 0 ? outputLines.join('\n') : undefined,
                remainingVisual: visualLines.join('\n')
            };
        }

        return null;
    }

    /**
     * Clean narration text
     */
    private static cleanNarration(text: string): string {
        return text
            .replace(/^["""'']+|["""'']+$/g, '')  // Remove surrounding quotes (all types)
            .replace(/\s+/g, ' ')          // Normalize whitespace
            .replace(/\n+/g, ' ')          // Remove line breaks
            .trim();
    }

    /**
     * Generate narration file content for a video
     * Starts with narration directly, with slide markers between slides
     */
    static generateNarrationFile(video: VideoSection): string {
        const parts: string[] = [];
        let isFirst = true;

        for (const slide of video.slides) {
            if (slide.audio) {
                if (isFirst) {
                    // First slide: just the narration, no header
                    parts.push(slide.audio);
                    isFirst = false;
                } else {
                    // Subsequent slides: add slide marker before narration
                    parts.push(`[Slide ${slide.number}: ${slide.title}]`);
                    parts.push(slide.audio);
                }
            }
        }

        // Join with double newlines for paragraph separation
        return parts.join('\n\n');
    }
}

// Export convenience function
export async function parseDocxScript(filePath: string): Promise<ParseResult> {
    return DocxScriptParser.parseFile(filePath);
}
