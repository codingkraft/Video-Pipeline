import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Configuration for code screenshots
 */
export interface CodeScreenshotConfig {
    filename?: string;           // e.g., "main.py"
    showLineNumbers?: boolean;   // Default: true
    showCommand?: boolean;       // Show "python main.py" in terminal
    mode?: 'code-output' | 'code-only' | 'output-only';
}

/**
 * Result of code execution
 */
export interface CodeExecutionResult {
    stdout: string;
    stderr: string;
    success: boolean;
}

/**
 * Service for capturing styled screenshots of code and output.
 * Uses a local HTML tool with Puppeteer for rendering.
 */
export class CodeScreenshotService {
    private page: any = null;  // Puppeteer page
    private htmlPath: string;

    constructor() {
        // Path to the HTML screenshot tool
        this.htmlPath = path.join(__dirname, '../../public/code-screenshot.html');
    }

    /**
     * Initialize with a Puppeteer page instance
     */
    async initialize(page: any): Promise<void> {
        this.page = page;

        // Navigate to the screenshot tool
        const fileUrl = `file:///${this.htmlPath.replace(/\\/g, '/')}?mode=puppeteer`;
        await this.page.goto(fileUrl, { waitUntil: 'networkidle0' });

        console.log('[CodeScreenshot] Initialized with HTML tool');
    }

    /**
     * Execute Python code and capture output
     */
    async executePython(code: string): Promise<CodeExecutionResult> {
        // Create temp file for the code
        const tempDir = path.join(__dirname, '../../temp_code');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        const tempFile = path.join(tempDir, 'temp_script.py');
        fs.writeFileSync(tempFile, code, 'utf-8');

        try {
            const { stdout, stderr } = await execAsync(`python "${tempFile}"`, {
                timeout: 10000, // 10 second timeout
                cwd: tempDir
            });

            return {
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                success: true
            };
        } catch (error: any) {
            return {
                stdout: error.stdout?.trim() || '',
                stderr: error.stderr?.trim() || error.message,
                success: false
            };
        } finally {
            // Cleanup temp file
            try {
                fs.unlinkSync(tempFile);
            } catch { }
        }
    }

    /**
     * Capture a screenshot of code (without output)
     */
    async captureCode(
        code: string,
        outputPath: string,
        config: CodeScreenshotConfig = {}
    ): Promise<string> {
        return this.capture(code, '', outputPath, { ...config, mode: 'code-only' });
    }

    /**
     * Capture a screenshot of output only
     */
    async captureOutput(
        output: string,
        outputPath: string,
        config: CodeScreenshotConfig = {}
    ): Promise<string> {
        return this.capture('', output, outputPath, { ...config, mode: 'output-only' });
    }

    /**
     * Capture a screenshot of code with output
     */
    async captureCodeWithOutput(
        code: string,
        output: string,
        outputPath: string,
        config: CodeScreenshotConfig = {}
    ): Promise<string> {
        return this.capture(code, output, outputPath, { ...config, mode: 'code-output' });
    }

    // Maximum lines before output is automatically generated separately
    private static readonly MAX_LINES_WITH_OUTPUT = 15;

    /**
     * Execute Python code and capture screenshots.
     * If code has <= 15 lines AND has output: captures combined screenshot
     * If code has > 15 lines OR no output: captures code-only (and output separately if exists)
     */
    async executeAndCapture(
        code: string,
        outputDir: string,
        baseName: string,
        config: CodeScreenshotConfig = {}
    ): Promise<{ codePath: string; outputPath?: string; combinedPath?: string }> {
        // Execute the Python code
        const result = await this.executePython(code);
        const hasOutput = result.success && result.stdout.trim().length > 0;
        const output = result.success
            ? (result.stdout || '')
            : `Error: ${result.stderr}`;

        const codeLines = code.split('\n').length;
        const codeTooBig = codeLines > CodeScreenshotService.MAX_LINES_WITH_OUTPUT;

        // Decide whether to combine or separate
        if (hasOutput && !codeTooBig) {
            // Small code with output: capture combined screenshot
            const combinedPath = path.join(outputDir, `${baseName}.png`);
            await this.captureCodeWithOutput(code, output, combinedPath, config);
            return { codePath: combinedPath, combinedPath };
        } else {
            // Large code or no output: capture separately
            const codePath = path.join(outputDir, `${baseName}.png`);
            await this.captureCode(code, codePath, config);

            if (hasOutput) {
                // Capture output separately
                const outputPath = path.join(outputDir, `${baseName}_OUTPUT.png`);
                await this.captureOutput(output, outputPath, config);
                console.log(`[CodeScreenshot] Code too big (${codeLines} lines), generated output separately`);
                return { codePath, outputPath };
            }

            return { codePath };
        }
    }

    /**
     * Core capture function using Puppeteer
     */
    private async capture(
        code: string,
        output: string,
        outputPath: string,
        config: CodeScreenshotConfig = {}
    ): Promise<string> {
        if (!this.page) {
            throw new Error('CodeScreenshotService not initialized. Call initialize() first.');
        }

        const {
            filename = 'main.py',
            showLineNumbers = true,
            showCommand = true,
            mode = 'code-output'
        } = config;

        // Set values in the page
        await this.page.evaluate((params: any) => {
            (window as any).setCode(params.code);
            (window as any).setOutput(params.output);
            (window as any).setFilename(params.filename);
            (window as any).setScreenshotMode(params.mode);

            // Set checkboxes
            (document.getElementById('show-line-numbers') as HTMLInputElement).checked = params.showLineNumbers;
            (document.getElementById('show-command') as HTMLInputElement).checked = params.showCommand;

            // Render
            (window as any).render();
        }, { code, output, filename, showLineNumbers, showCommand, mode });

        // Wait for rendering and ensure element is visible
        await this.page.waitForSelector('#screenshot-target', { visible: true, timeout: 5000 });
        await new Promise(resolve => setTimeout(resolve, 300)); // Additional wait for animations

        // Get the screenshot element
        const element = await this.page.$('#screenshot-target');
        if (!element) {
            throw new Error('Screenshot target element not found');
        }

        // Ensure output directory exists
        const dir = path.dirname(outputPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        // Capture screenshot
        await element.screenshot({
            path: outputPath,
            type: 'png'
        });

        console.log(`[CodeScreenshot] Saved: ${outputPath}`);
        return outputPath;
    }

    /**
     * Capture multiple code blocks from a video section
     */
    async captureVideoCodeBlocks(
        codeBlocks: Array<{ code: string; name: string; hasOutput: boolean }>,
        outputDir: string,
        chapterPrefix: string,
        videoNumber: number
    ): Promise<string[]> {
        const capturedPaths: string[] = [];

        for (let i = 0; i < codeBlocks.length; i++) {
            const block = codeBlocks[i];
            const baseName = `${chapterPrefix}_video${videoNumber}_example${i + 1}_${block.name}`;

            if (block.hasOutput) {
                const { codePath, outputPath } = await this.executeAndCapture(
                    block.code,
                    outputDir,
                    baseName
                );
                capturedPaths.push(codePath);
                if (outputPath) {
                    capturedPaths.push(outputPath);
                }
            } else {
                const codePath = path.join(outputDir, `${baseName}.png`);
                await this.captureCode(block.code, codePath);
                capturedPaths.push(codePath);
            }
        }

        return capturedPaths;
    }
}

// Export singleton for convenience
let instance: CodeScreenshotService | null = null;

export function getCodeScreenshotService(): CodeScreenshotService {
    if (!instance) {
        instance = new CodeScreenshotService();
    }
    return instance;
}
