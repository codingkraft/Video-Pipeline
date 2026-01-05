import { Page } from 'puppeteer';
import { CaptiveBrowser } from '../browser/CaptiveBrowser';
import * as path from 'path';

const GEMINI_URL = 'https://gemini.google.com/';

export interface GeminiVideoConfig {
    prompt: string;
    stylePrompt?: string;
    duration?: number; // in seconds
}

export interface GeminiVideoResult {
    videoPath: string;
    metadata?: {
        duration: number;
        resolution: string;
    };
}

export class GeminiService {
    private browser: CaptiveBrowser;
    private page: Page | null = null;

    constructor() {
        this.browser = CaptiveBrowser.getInstance();
    }

    /**
     * Initialize the Gemini page.
     */
    public async initialize(): Promise<void> {
        this.page = await this.browser.getPage('gemini', GEMINI_URL);
        await this.browser.randomDelay(2000, 4000);
    }

    /**
     * Generate a video using Gemini's video generation capabilities.
     * @param config Video generation configuration
     * @param outputDir Directory to save the generated video
     */
    public async generateVideo(
        config: GeminiVideoConfig,
        outputDir: string
    ): Promise<GeminiVideoResult> {
        if (!this.page) {
            await this.initialize();
        }

        const page = this.page!;

        // Construct the full prompt
        let fullPrompt = config.prompt;
        if (config.stylePrompt) {
            fullPrompt += `\n\nStyle: ${config.stylePrompt}`;
        }
        if (config.duration) {
            fullPrompt += `\n\nDuration: approximately ${config.duration} seconds`;
        }

        // Find the input area
        const inputSelector = 'textarea[aria-label*="prompt"], div[contenteditable="true"], textarea';
        await page.waitForSelector(inputSelector, { timeout: 10000 });

        await this.browser.randomDelay(500, 1000);

        // Type the prompt
        await this.browser.humanType(page, inputSelector, `Generate a video: ${fullPrompt}`);

        await this.browser.randomDelay(500, 1000);

        // Submit the prompt
        const submitSelector = 'button[aria-label*="Send"], button[type="submit"]';
        await page.click(submitSelector);

        // Wait for video generation to start
        console.log('Gemini video generation started...');
        await this.browser.randomDelay(5000, 10000);

        // Poll for completion (video generation can take minutes)
        const maxWaitTime = 15 * 60 * 1000; // 15 minutes
        const startTime = Date.now();

        while (Date.now() - startTime < maxWaitTime) {
            // Check for video element or download option
            const videoElement = await page.$('video, [class*="video-player"]');
            const downloadLink = await page.$('a[download], button:has-text("Download")');

            if (videoElement || downloadLink) {
                console.log('Video generation complete!');
                break;
            }

            // Check for error messages
            const errorElement = await page.$('[class*="error"], [role="alert"]');
            if (errorElement) {
                const errorText = await page.evaluate(el => el?.textContent, errorElement);
                throw new Error(`Gemini video generation failed: ${errorText}`);
            }

            await this.browser.randomDelay(8000, 12000);
        }

        // Download the video
        const videoPath = await this.downloadVideo(outputDir);

        return {
            videoPath,
            metadata: {
                duration: config.duration || 30,
                resolution: '1080p', // Assumed
            },
        };
    }

    /**
     * Download the generated video.
     */
    private async downloadVideo(outputDir: string): Promise<string> {
        if (!this.page) {
            throw new Error('Page not initialized');
        }

        const page = this.page;
        const outputPath = path.join(outputDir, `gemini_video_${Date.now()}.mp4`);

        // Set up download behavior
        const client = await page.createCDPSession();
        await client.send('Page.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: outputDir,
        });

        // Try to find and click download button
        const downloadSelector = 'a[download], button:has-text("Download"), [aria-label*="Download"]';

        try {
            await page.click(downloadSelector);
            console.log(`Downloading video to ${outputDir}...`);
            await this.browser.randomDelay(10000, 20000); // Wait for download
        } catch {
            // If no download button, try to extract video URL and download programmatically
            console.log('No download button found, attempting to extract video URL...');

            const videoUrl = await page.evaluate(() => {
                const video = document.querySelector('video');
                return video?.src || video?.querySelector('source')?.src;
            });

            if (videoUrl) {
                console.log(`Video URL found: ${videoUrl}`);
                // In production, you'd download this URL using fetch/axios
            }
        }

        return outputPath;
    }

    /**
     * Close the Gemini page.
     */
    public async close(): Promise<void> {
        await this.browser.closePage('gemini');
        this.page = null;
    }
}
