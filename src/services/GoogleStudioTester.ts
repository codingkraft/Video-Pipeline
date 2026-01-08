import { Page } from 'puppeteer';
import { CaptiveBrowser } from '../browser/CaptiveBrowser';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';

const GOOGLE_STUDIO_URL = 'https://aistudio.google.com/generate-speech';

export interface GoogleStudioConfig {
    sourceFolder: string;
    model?: string;
    voice?: string;
    styleInstructions?: string;
    headless?: boolean;
}

export interface SlideAudioConfig {
    slideNumber: number;
    text: string;
    textHash: string;
    outputPath: string;
}

export interface GoogleStudioResult {
    success: boolean;
    message: string;
    details?: {
        steps: string[];
        audioFiles: string[];
        slidesProcessed: number;
    };
}

export class GoogleStudioTester {
    private browser: CaptiveBrowser;

    constructor() {
        this.browser = CaptiveBrowser.getInstance();
    }

    /**
     * Generate hash of text content to detect changes
     */
    private hashText(text: string): string {
        return crypto.createHash('md5').update(text).digest('hex');
    }

    /**
     * Generate audio for a single slide
     */
    public async generateSlideAudio(
        page: Page,
        config: SlideAudioConfig,
        studioConfig: GoogleStudioConfig,
        steps: string[]
    ): Promise<boolean> {
        try {
            steps.push(`⏳ Processing Slide ${config.slideNumber}...`);

            // Navigate to Google Studio if not already there
            const currentUrl = page.url();
            if (!currentUrl.includes('aistudio.google.com')) {
                await page.goto(GOOGLE_STUDIO_URL, { waitUntil: 'networkidle2' });
                await this.browser.randomDelay(2000, 3000);
            }

            // Mute the tab to prevent auto-play audio
            await page.evaluate(() => {
                const videos = document.querySelectorAll('video, audio');
                videos.forEach(v => {
                    (v as HTMLMediaElement).muted = true;
                    (v as HTMLMediaElement).volume = 0;
                });
            });
            steps.push(`✓ Tab muted`);

            // Wait for page to be ready
            await this.browser.randomDelay(1000, 2000);

            // Set style instructions if provided
            if (studioConfig.styleInstructions) {
                const styleSet = await page.evaluate((instructions) => {
                    // Find style/instructions textarea
                    const textareas = Array.from(document.querySelectorAll('textarea'));
                    const styleInput = textareas.find(t =>
                        t.placeholder?.toLowerCase().includes('style') ||
                        t.placeholder?.toLowerCase().includes('instruction')
                    );
                    if (styleInput) {
                        styleInput.value = instructions;
                        styleInput.dispatchEvent(new Event('input', { bubbles: true }));
                        return true;
                    }
                    return false;
                }, studioConfig.styleInstructions);

                if (styleSet) {
                    steps.push(`✓ Set style instructions`);
                }
            }

            // Set model if provided
            if (studioConfig.model) {
                // This will need to be customized based on Google Studio UI
                steps.push(`⚠ Model selection: ${studioConfig.model} (manual selection may be needed)`);
            }

            // Set voice if provided
            if (studioConfig.voice) {
                // This will need to be customized based on Google Studio UI
                steps.push(`⚠ Voice selection: ${studioConfig.voice} (manual selection may be needed)`);
            }

            // Find and fill the main text input
            const textEntered = await page.evaluate((text) => {
                const textareas = Array.from(document.querySelectorAll('textarea'));
                // Find the main text input (usually the largest or primary one)
                const mainInput = textareas.find(t =>
                    t.placeholder?.toLowerCase().includes('text') ||
                    t.placeholder?.toLowerCase().includes('enter') ||
                    t.classList.contains('main-input') ||
                    t.rows > 3
                ) || textareas[0];

                if (mainInput) {
                    mainInput.value = text;
                    mainInput.dispatchEvent(new Event('input', { bubbles: true }));
                    mainInput.dispatchEvent(new Event('change', { bubbles: true }));
                    return true;
                }
                return false;
            }, config.text);

            if (textEntered) {
                steps.push(`✓ Entered slide ${config.slideNumber} text (${config.text.length} chars)`);
            } else {
                steps.push(`⚠ Could not find text input field`);
                return false;
            }

            await this.browser.randomDelay(500, 1000);

            // Click Run/Generate button
            const runClicked = await page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('button'));
                const runBtn = buttons.find(b => {
                    const text = b.textContent?.toLowerCase() || '';
                    return text.includes('run') || text.includes('generate') || text.includes('create');
                });
                if (runBtn) {
                    runBtn.click();
                    return true;
                }
                return false;
            });

            if (runClicked) {
                steps.push(`✓ Clicked Run button`);
            } else {
                steps.push(`⚠ Could not find Run button`);
                return false;
            }

            // Wait for audio generation (this may take a while)
            steps.push(`⏳ Waiting for audio generation...`);
            await this.browser.randomDelay(5000, 10000);

            // Wait for download button or audio element to appear
            let downloadReady = false;
            for (let attempt = 0; attempt < 30; attempt++) {
                downloadReady = await page.evaluate(() => {
                    // Look for download button or audio element
                    const downloadBtn = document.querySelector('button[aria-label*="download"], button[title*="download"], a[download]');
                    const audioElement = document.querySelector('audio[src]');
                    return !!(downloadBtn || audioElement);
                });

                if (downloadReady) break;
                await this.browser.randomDelay(2000, 3000);
            }

            if (!downloadReady) {
                steps.push(`⚠ Audio generation timed out`);
                return false;
            }

            steps.push(`✓ Audio generated`);

            // Download the audio file
            const downloaded = await this.downloadAudio(page, config.outputPath, steps);

            if (downloaded) {
                steps.push(`✓ Saved: ${path.basename(config.outputPath)}`);
                return true;
            }

            return false;

        } catch (error) {
            steps.push(`✗ Error: ${(error as Error).message}`);
            return false;
        }
    }

    /**
     * Download audio from Google Studio
     */
    private async downloadAudio(page: Page, outputPath: string, steps: string[]): Promise<boolean> {
        try {
            // Set up download behavior
            const client = await page.createCDPSession();
            const downloadDir = path.dirname(outputPath);

            await client.send('Page.setDownloadBehavior', {
                behavior: 'allow',
                downloadPath: downloadDir
            });

            // Click download button
            const downloadClicked = await page.evaluate(() => {
                const downloadBtn = document.querySelector('button[aria-label*="download"], button[title*="download"]') as HTMLElement;
                if (downloadBtn) {
                    downloadBtn.click();
                    return true;
                }

                // Try finding download link
                const downloadLink = document.querySelector('a[download]') as HTMLAnchorElement;
                if (downloadLink) {
                    downloadLink.click();
                    return true;
                }

                return false;
            });

            if (!downloadClicked) {
                // Try to get audio source directly
                const audioSrc = await page.evaluate(() => {
                    const audio = document.querySelector('audio[src]') as HTMLAudioElement;
                    return audio?.src;
                });

                if (audioSrc) {
                    // Download via fetch
                    const response = await page.evaluate(async (url) => {
                        const resp = await fetch(url);
                        const blob = await resp.blob();
                        const reader = new FileReader();
                        return new Promise<string>((resolve) => {
                            reader.onload = () => resolve(reader.result as string);
                            reader.readAsDataURL(blob);
                        });
                    }, audioSrc);

                    // Convert base64 to file
                    const base64Data = response.split(',')[1];
                    const buffer = Buffer.from(base64Data, 'base64');
                    fs.writeFileSync(outputPath, buffer);
                    return true;
                }

                steps.push(`⚠ Could not find download option`);
                return false;
            }

            // Wait for download to complete
            await this.browser.randomDelay(3000, 5000);

            // Find the downloaded file and rename it
            const files = fs.readdirSync(downloadDir)
                .filter(f => f.endsWith('.wav') || f.endsWith('.mp3'))
                .map(f => ({
                    name: f,
                    time: fs.statSync(path.join(downloadDir, f)).mtime.getTime()
                }))
                .sort((a, b) => b.time - a.time);

            if (files.length > 0) {
                const latestFile = path.join(downloadDir, files[0].name);
                if (latestFile !== outputPath) {
                    fs.renameSync(latestFile, outputPath);
                }
                return true;
            }

            return false;

        } catch (error) {
            steps.push(`✗ Download error: ${(error as Error).message}`);
            return false;
        }
    }

    /**
     * Close the Google Studio page
     */
    public async closePage(serviceKey: string = 'google-studio'): Promise<void> {
        await this.browser.closePage(serviceKey);
    }
}
