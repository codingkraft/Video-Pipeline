import { Page } from 'puppeteer';
import { CaptiveBrowser } from '../browser/CaptiveBrowser';
import * as fs from 'fs';
import * as path from 'path';

const NOTEBOOKLM_URL = 'https://notebooklm.google.com/';

export interface NotebookLMConfig {
    videoPrompt: string;
    stylePrompt: string;
    chatSettings?: {
        temperature?: number;
        customInstructions?: string;
    };
}

export interface NotebookLMResult {
    notebookUrl: string;
    videoUrl?: string;
    scriptContent?: string;
}

export class NotebookLMService {
    private browser: CaptiveBrowser;
    private page: Page | null = null;

    constructor() {
        this.browser = CaptiveBrowser.getInstance();
    }

    /**
     * Initialize the NotebookLM page.
     */
    public async initialize(): Promise<void> {
        this.page = await this.browser.getPage('notebooklm', NOTEBOOKLM_URL);
        await this.browser.randomDelay(2000, 4000);
    }

    /**
     * Create a new notebook and upload source documents.
     * @param documents Array of file paths to upload
     */
    public async createNotebook(documents: string[]): Promise<string> {
        if (!this.page) {
            await this.initialize();
        }

        const page = this.page!;

        // Click "New Notebook" or "Create" button
        // Note: Selectors may need adjustment based on actual NotebookLM UI
        const createButtonSelector = 'button[aria-label*="Create"], button:has-text("New notebook")';

        try {
            await page.waitForSelector(createButtonSelector, { timeout: 10000 });
            await page.click(createButtonSelector);
            await this.browser.randomDelay(1000, 2000);
        } catch {
            console.log('Create button not found, may already be on creation page');
        }

        // Upload each document
        for (const docPath of documents) {
            await this.uploadDocument(docPath);
            await this.browser.randomDelay(2000, 4000);
        }

        // Get the current URL as the notebook identifier
        const notebookUrl = page.url();
        console.log(`Notebook created: ${notebookUrl}`);

        return notebookUrl;
    }

    /**
     * Upload a single document to the current notebook.
     */
    private async uploadDocument(filePath: string): Promise<void> {
        if (!this.page) {
            throw new Error('Page not initialized');
        }

        const page = this.page;

        // Look for upload button or file input
        const uploadButtonSelector = 'button[aria-label*="Upload"], button:has-text("Add source")';

        try {
            await page.waitForSelector(uploadButtonSelector, { timeout: 5000 });
            await page.click(uploadButtonSelector);
            await this.browser.randomDelay(500, 1000);
        } catch {
            console.log('Looking for file input directly');
        }

        // Find file input and upload
        const fileInput = await page.$('input[type="file"]');
        if (fileInput) {
            await fileInput.uploadFile(filePath);
            console.log(`Uploaded: ${path.basename(filePath)}`);
            await this.browser.randomDelay(2000, 4000);
        } else {
            throw new Error('Could not find file input for upload');
        }
    }

    /**
     * Configure chat settings for the notebook.
     */
    public async configureChatSettings(config: NotebookLMConfig['chatSettings']): Promise<void> {
        if (!this.page || !config) {
            return;
        }

        const page = this.page;

        // Open settings panel
        const settingsButtonSelector = 'button[aria-label*="Settings"], button[aria-label*="Customize"]';

        try {
            await page.waitForSelector(settingsButtonSelector, { timeout: 5000 });
            await page.click(settingsButtonSelector);
            await this.browser.randomDelay(500, 1000);

            // Apply custom instructions if provided
            if (config.customInstructions) {
                const instructionsInput = await page.$('textarea[aria-label*="instructions"]');
                if (instructionsInput) {
                    await instructionsInput.click({ clickCount: 3 }); // Select all
                    await this.browser.humanType(page, 'textarea[aria-label*="instructions"]', config.customInstructions);
                }
            }

            // Save settings
            const saveButtonSelector = 'button:has-text("Save"), button:has-text("Apply")';
            await page.click(saveButtonSelector);
            await this.browser.randomDelay(500, 1000);

        } catch (error) {
            console.log('Settings configuration skipped:', error);
        }
    }

    /**
     * Generate video using NotebookLM Studio's video generation feature.
     * @param config Video and style prompts
     */
    public async generateVideo(config: NotebookLMConfig): Promise<NotebookLMResult> {
        if (!this.page) {
            throw new Error('Page not initialized. Call createNotebook first.');
        }

        const page = this.page;

        // Navigate to video generation (Studio tab or similar)
        // Note: Selectors based on assumed UI structure
        const studioTabSelector = 'button:has-text("Studio"), [role="tab"]:has-text("Studio"), button[aria-label*="Studio"]';

        try {
            await page.waitForSelector(studioTabSelector, { timeout: 10000 });
            await page.click(studioTabSelector);
            await this.browser.randomDelay(1000, 2000);
        } catch {
            console.log('Studio tab not found, looking for video generation option directly');
        }

        // Look for video generation option
        const videoGenSelector = 'button:has-text("Video"), [data-testid*="video"], button[aria-label*="Generate video"]';
        await page.waitForSelector(videoGenSelector, { timeout: 10000 });
        await page.click(videoGenSelector);
        await this.browser.randomDelay(1000, 2000);

        // Enter video prompt
        const promptInputSelector = 'textarea[placeholder*="prompt"], input[placeholder*="prompt"]';
        try {
            await page.waitForSelector(promptInputSelector, { timeout: 5000 });
            await this.browser.humanType(page, promptInputSelector, config.videoPrompt);
            await this.browser.randomDelay(500, 1000);
        } catch {
            console.log('Video prompt input not found');
        }

        // Enter style prompt if there's a separate field
        const styleInputSelector = 'textarea[placeholder*="style"], input[placeholder*="style"]';
        try {
            const styleInput = await page.$(styleInputSelector);
            if (styleInput) {
                await this.browser.humanType(page, styleInputSelector, config.stylePrompt);
                await this.browser.randomDelay(500, 1000);
            }
        } catch {
            console.log('Style input not found, may be combined with main prompt');
        }

        // Click generate button
        const generateButtonSelector = 'button:has-text("Generate"), button[type="submit"]';
        await page.click(generateButtonSelector);

        // Wait for video generation (this could take a while)
        console.log('Video generation started. This may take several minutes...');
        await this.browser.randomDelay(5000, 10000);

        // Poll for completion
        const maxWaitTime = 10 * 60 * 1000; // 10 minutes
        const pollInterval = 10000; // 10 seconds
        const startTime = Date.now();

        while (Date.now() - startTime < maxWaitTime) {
            // Check for completion indicators
            const downloadButton = await page.$('button:has-text("Download"), a[download]');
            if (downloadButton) {
                console.log('Video generation complete!');
                break;
            }

            // Check for error
            const errorIndicator = await page.$('[class*="error"], [role="alert"]');
            if (errorIndicator) {
                const errorText = await page.evaluate(el => el?.textContent, errorIndicator);
                throw new Error(`Video generation failed: ${errorText}`);
            }

            await this.browser.randomDelay(pollInterval - 2000, pollInterval + 2000);
        }

        // Get the video URL or download it
        const videoUrl = page.url();

        // Try to get the narration script if available
        let scriptContent: string | undefined;
        try {
            const scriptSelector = '[class*="script"], [class*="transcript"]';
            const scriptElement = await page.$(scriptSelector);
            if (scriptElement) {
                scriptContent = await page.evaluate(el => el?.textContent || '', scriptElement);
            }
        } catch {
            console.log('Could not extract script content');
        }

        return {
            notebookUrl: page.url(),
            videoUrl,
            scriptContent,
        };
    }

    /**
     * Download the generated video to a local path.
     */
    public async downloadVideo(outputPath: string): Promise<string> {
        if (!this.page) {
            throw new Error('Page not initialized');
        }

        const page = this.page;

        // Set up download behavior
        const client = await page.createCDPSession();
        const downloadDir = path.dirname(outputPath);

        await client.send('Page.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: downloadDir,
        });

        // Click download button
        const downloadButtonSelector = 'button:has-text("Download"), a[download]';
        await page.click(downloadButtonSelector);

        // Wait for download to complete
        console.log(`Downloading video to ${outputPath}...`);
        await this.browser.randomDelay(5000, 10000);

        // Note: In production, you'd want to monitor the download directory
        // for the actual file and rename it appropriately

        return outputPath;
    }

    /**
     * Close the NotebookLM page.
     */
    public async close(): Promise<void> {
        await this.browser.closePage('notebooklm');
        this.page = null;
    }
}
