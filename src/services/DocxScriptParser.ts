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
        // Pattern: <strong>Video X: Title</strong> or **Video X: Title**
        const videoRegex = /<strong>Video\s+([\d.]+):\s*([^<]+)<\/strong>/gi;
        const videoMatches = [...cleanHtml.matchAll(videoRegex)];

        for (let i = 0; i < videoMatches.length; i++) {
            const match = videoMatches[i];
            const videoNumber = match[1];
            const videoTitle = match[2].trim();

            // Get content for this video (until next video or end)
            const startIndex = match.index!;
            const endIndex = i < videoMatches.length - 1
                ? videoMatches[i + 1].index!
                : cleanHtml.length;

            const videoContent = cleanHtml.substring(startIndex, endIndex);

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
        const slideRegex = /<strong>\[SLIDE\s+(\d+):\s*([^\]]+)\]<\/strong>/gi;
        const slideMatches = [...content.matchAll(slideRegex)];

        for (let i = 0; i < slideMatches.length; i++) {
            const match = slideMatches[i];
            const slideNumber = parseInt(match[1]);
            const slideTitle = match[2].trim();

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
        let expectedOutput: string | undefined;

        // Split content at Output: to separate code from output
        // Both may use the same styling, so we need to distinguish by position
        const outputIndex = content.search(/\bOutput:/i);
        const codeContent = outputIndex > 0 ? content.substring(0, outputIndex) : content;
        const outputContent = outputIndex > 0 ? content.substring(outputIndex) : '';

        // Extract styled code - look for <code> tags and content between them
        // Replace <br/> with newlines to preserve empty lines
        const codeSection = codeContent
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/code>\s*<code>/gi, '\n')  // Join adjacent code tags
            .replace(/<\/code>\s*\n\s*<code>/gi, '\n\n');  // Preserve paragraph breaks

        // Extract all code content from tags
        const codeTagMatches = [...codeSection.matchAll(/<code>([^<]*)<\/code>/gi)];
        const preTagMatches = [...codeSection.matchAll(/<pre>([^<]*)<\/pre>/gi)];

        // Combine all styled code content, preserving empty entries for blank lines
        const styledCodeParts: string[] = [];
        for (const match of codeTagMatches) {
            // Keep empty strings to preserve blank lines
            styledCodeParts.push(match[1]);
        }
        for (const match of preTagMatches) {
            styledCodeParts.push(match[1]);
        }

        // Extract styled output from AFTER Output section
        if (outputContent) {
            const cleanedOutput = outputContent
                .replace(/<br\s*\/?>/gi, '\n')
                .replace(/<\/code>\s*<code>/gi, '\n');
            const outputCodeMatches = [...cleanedOutput.matchAll(/<code>([^<]*)<\/code>/gi)];
            const outputPreMatches = [...cleanedOutput.matchAll(/<pre>([^<]*)<\/pre>/gi)];
            const outputParts: string[] = [];
            for (const match of outputCodeMatches) {
                outputParts.push(match[1]);
            }
            for (const match of outputPreMatches) {
                outputParts.push(match[1]);
            }
            if (outputParts.length > 0) {
                expectedOutput = outputParts.join('\n').trim();
            }
        }

        // If we found styled code, create a code block from it
        if (styledCodeParts.length > 0) {
            // Join with newlines and clean up while preserving intentional blank lines
            const code = styledCodeParts.join('\n')
                .replace(/\n{3,}/g, '\n\n')  // Max 2 consecutive newlines
                .trim();
            if (code) {
                codeBlocks.push({
                    code,
                    language: 'python',
                    slideNumber: number,
                    slideTitle: title,
                    expectedOutput
                });
            }
        }

        // Remove HTML tags for text extraction
        const textContent = content
            .replace(/<[^>]+>/g, '')
            .replace(/\n{3,}/g, '\n\n');

        // Extract visual description
        const visualMatch = textContent.match(/Visual:\s*([^\n]+(?:\n(?!Audio:|Code:|\[SLIDE|\[\d+\s*seconds?\]).*)*)/i);
        let visual = visualMatch ? visualMatch[1].trim() : undefined;

        // Extract audio/narration
        const audioMatch = textContent.match(/Audio:\s*\n?"?([^"]+)"?/i);
        let audio = audioMatch ? this.cleanNarration(audioMatch[1]) : '';

        // Extract duration
        const durationMatch = textContent.match(/\[(\d+)\s*seconds?\]/i);
        const duration = durationMatch ? parseInt(durationMatch[1]) : undefined;

        // Fallback: Extract code from visual using pattern matching
        // Only if style-based detection didn't find code (mammoth style mapping may not work for all documents)
        if (codeBlocks.length === 0 && visual) {
            // Filter out obvious false positives before pattern matching
            const isNotCode =
                /^"?Video\s+\d+/i.test(visual) ||           // Video title references
                /^"?[A-Z][a-z]+\s+\d+:/i.test(visual) ||    // Section headers like "Slide 1:"
                visual.length < 10 ||                        // Too short to be code
                !/[=()[\]{}:#]/.test(visual);              // No code-like characters

            if (!isNotCode) {
                const codeLines = this.extractCodeFromVisual(visual);
                if (codeLines) {
                    codeBlocks.push({
                        code: codeLines.code,
                        language: 'python',
                        slideNumber: number,
                        slideTitle: title,
                        expectedOutput: codeLines.output
                    });
                    visual = codeLines.remainingVisual?.trim() || visual;
                }
            }
        }

        // Also check for explicit Code: section
        const codeMatch = textContent.match(/Code:\s*\n([\s\S]*?)(?=\nAudio:|\nOutput:|\n\[|\n\*\*|$)/i);
        if (codeMatch && codeMatch[1].trim()) {
            const code = codeMatch[1].trim();
            if (!codeBlocks.some(cb => cb.code === code)) {
                codeBlocks.push({
                    code,
                    language: 'python',
                    slideNumber: number,
                    slideTitle: title
                });
            }
        }

        // Extract output
        const outputMatch = textContent.match(/Output:\s*\n([\s\S]*?)(?=\nAudio:|\n\[|\n\*\*|$)/i);
        if (outputMatch && codeBlocks.length > 0) {
            codeBlocks[codeBlocks.length - 1].expectedOutput = outputMatch[1].trim();
        }

        return {
            number,
            title,
            visual: visual?.split('\n')[0], // First line of visual only
            audio,
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
            .replace(/^["']|["']$/g, '')  // Remove surrounding quotes
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
