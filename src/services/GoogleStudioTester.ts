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
        // const steps: string[] = []; // steps is now passed in
        try {
            steps.push(`🎬 Processing slide ${config.slideNumber}...`);

            // Reload page to ensure fresh state (avoid downloading cached files from previous runs)
            steps.push('🔄 Reloading page to clear previous state...');
            await page.reload({ waitUntil: 'networkidle2' });
            await this.browser.randomDelay(2000, 3000);

            // Wait for text area to be available
            await page.waitForSelector('textarea', { timeout: 10000 });

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

            // CRITICAL: Set to "Single speaker audio" mode FIRST before changing any settings
            await this.browser.performAction(
                'Set Single-speaker audio mode',
                async () => {
                    const modeResult = await page.evaluate(() => {
                        const toggleButtons = Array.from(document.querySelectorAll('ms-toggle-button'));
                        const singleSpeakerButton = toggleButtons.find(btn =>
                            btn.textContent?.includes('Single-speaker audio')
                        );

                        if (singleSpeakerButton) {
                            const button = singleSpeakerButton.querySelector('button');
                            if (button) {
                                if (button.classList.contains('ms-button-active')) {
                                    return 'already_active';
                                }
                                button.click();
                                return 'clicked';
                            }
                        }
                        return 'not_found';
                    });
                    if (modeResult === 'not_found') throw new Error('Single-speaker audio button not found');
                },
                async () => {
                    const isActive = await page.evaluate(() => {
                        const toggleButtons = Array.from(document.querySelectorAll('ms-toggle-button'));
                        const singleSpeakerButton = toggleButtons.find(btn =>
                            btn.textContent?.includes('Single-speaker audio')
                        );
                        return singleSpeakerButton?.querySelector('button')?.classList.contains('ms-button-active');
                    });
                    return !!isActive;
                }
            );
            steps.push('✓ Checked/Set mode to Single speaker audio');

            // Set style instructions if provided
            if (studioConfig.styleInstructions) {
                await this.browser.performAction(
                    'Set Style Instructions',
                    async () => {
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
                        }, studioConfig.styleInstructions || '');
                    }
                ); // No strict validation because it might be optional or hidden
                steps.push(`✓ Set style instructions`);
            }

            // Set model if provided
            if (studioConfig.model) {
                const successModel = await this.browser.performAction(
                    `Select Model: ${studioConfig.model}`,
                    async () => {
                        // Click the model selector
                        const modelSelector = await page.$('ms-model-selector button');
                        if (!modelSelector) throw new Error('Model selector button not found');
                        await modelSelector.click();

                        await this.browser.randomDelay(1000, 2000);
                        await page.waitForSelector('ms-model-carousel', { timeout: 5000 });

                        // Click "Audio" category
                        await page.evaluate(() => {
                            const buttons = Array.from(document.querySelectorAll('ms-model-carousel button'));
                            const audioBtn = buttons.find(b => b.textContent?.trim() === 'Audio');
                            if (audioBtn && !audioBtn.classList.contains('ms-button-active')) {
                                (audioBtn as HTMLElement).click();
                            }
                        });

                        await this.browser.randomDelay(1000, 2000);

                        // Select Model
                        const modelSelected = await page.evaluate((targetModel) => {
                            const buttons = Array.from(document.querySelectorAll('ms-model-carousel-row button.content-button'));
                            const searchStr = (targetModel || '').trim().toLowerCase();
                            for (let i = 0; i < buttons.length; i++) {
                                const btn = buttons[i];
                                const title = btn.querySelector('.model-title-text')?.textContent?.trim();
                                const subtitle = btn.querySelector('.model-subtitle')?.textContent?.trim();
                                if ((title && title.toLowerCase().includes(searchStr)) ||
                                    (subtitle && subtitle.toLowerCase().includes(searchStr))) {
                                    // @ts-ignore
                                    btn.click();
                                    return true;
                                }
                            }
                            return false;
                        }, studioConfig.model || '');

                        if (!modelSelected) throw new Error(`Model ${studioConfig.model} not found in carousel`);
                    },
                    async () => {
                        // Validate carousel is closed
                        const carousel = await page.$('ms-model-carousel');
                        return !carousel;
                    }
                );

                if (successModel) steps.push(`✓ Selected model: ${studioConfig.model}`);
                else steps.push(`⚠ Model selection failed (check logs)`);
            }

            // Set voice if provided
            if (studioConfig.voice) {
                await this.browser.performAction(
                    `Select Voice: ${studioConfig.voice}`,
                    async () => {
                        const voiceSelector = await page.waitForSelector('ms-voice-selector mat-select', { timeout: 3000 });
                        if (!voiceSelector) throw new Error('Voice selector not found');
                        await voiceSelector.click();
                        await this.browser.randomDelay(500, 1000);

                        const optionClicked = await page.evaluate((voiceName) => {
                            const options = Array.from(document.querySelectorAll('mat-option'));
                            const target = options.find(opt =>
                                opt.textContent?.includes(voiceName) ||
                                opt.querySelector('.mat-option-text')?.textContent?.includes(voiceName)
                            );
                            if (target) {
                                (target as HTMLElement).click();
                                return true;
                            }
                            return false;
                        }, studioConfig.voice || '');

                        if (!optionClicked) {
                            await page.keyboard.press('Escape'); // Close dropdown
                            throw new Error(`Voice ${studioConfig.voice} not found`);
                        }
                    },
                    async () => {
                        // Check if dropdown closed
                        const overlay = await page.$('.cdk-overlay-pane');
                        return !overlay;
                    }
                );
                steps.push(`✓ Selected voice: ${studioConfig.voice}`);
            }

            // Text Input
            const successText = await this.browser.performAction(
                'Enter Slide Text',
                async () => {
                    const textEntered = await page.evaluate((text) => {
                        const textareas = Array.from(document.querySelectorAll('textarea'));
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
                    if (!textEntered) throw new Error('Text input not found');
                },
                async () => {
                    const val = await page.evaluate(() => {
                        const textareas = Array.from(document.querySelectorAll('textarea'));
                        const mainInput = textareas.find(t =>
                            t.placeholder?.toLowerCase().includes('text') ||
                            t.rows > 3
                        ) || textareas[0];
                        return mainInput ? mainInput.value : '';
                    });
                    return val === config.text;
                }
            );

            if (successText) steps.push(`✓ Entered slide text`);
            else throw new Error('Failed to enter text');

            await this.browser.randomDelay(500, 1000);

            // Click Run/Generate button
            await this.browser.performAction(
                'Click Run Button',
                async () => {
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
                    if (!runClicked) throw new Error('Run button not found');
                },
                async () => {
                    // Check if downloading started or button disabled? 
                    // Hard to validate generically, so we rely on the next waiting step.
                    // But we can check if button enters loading state if applicable.
                    return true;
                }
            );
            steps.push(`✓ Clicked Run button`);

            // Wait for audio generation (this may take a while)
            steps.push(`⏳ Waiting for audio generation...`);


            // Helper to check if generation is in progress
            const isGenerating = async (): Promise<boolean> => {
                return await page.evaluate(() => {
                    // Check for spinning progress indicator or Stop button
                    const spinningIcon = document.querySelector('ms-run-button .spin');
                    const stopButton = document.querySelector('ms-run-button button');
                    if (stopButton) {
                        const text = stopButton.textContent?.toLowerCase() || '';
                        if (text.includes('stop')) return true;
                    }
                    return !!spinningIcon;
                });
            };

            // Phase 1a: Wait for the Stop/progress button to APPEAR (generation started)
            // Give it up to 10 seconds for the button to change to Stop state
            let generationStarted = false;
            for (let attempt = 0; attempt < 10; attempt++) {
                if (await isGenerating()) {
                    generationStarted = true;
                    steps.push(`✓ Generation started...`);
                    break;
                }
                await this.browser.randomDelay(1000, 1500);
            }

            if (!generationStarted) {
                // Check if maybe it completed super fast (rare for audio)
                const hasDownload = await page.evaluate(() => {
                    const downloadBtn = document.querySelector('button[aria-label*="download"], button[aria-label*="Download"]');
                    const audioElement = document.querySelector('audio[src]');
                    return !!(downloadBtn || audioElement);
                });
                if (!hasDownload) {
                    throw new Error('Generation did not start - Run button may have failed');
                }
                // If download is already available, skip waiting
            } else {
                // Phase 1b: Wait for the Stop/progress button to DISAPPEAR (generation complete)
                let generationComplete = false;
                for (let attempt = 0; attempt < 300; attempt++) { // 10 to 12.5 mins before give up
                    if (!(await isGenerating())) {
                        generationComplete = true;
                        break;
                    }
                    await this.browser.randomDelay(2000, 2500);
                }

                if (!generationComplete) {
                    throw new Error('Audio generation timed out (Stop button still present after 4 mins)');
                }
            }

            steps.push(`✓ Generation finished, looking for download...`);

            // Phase 2: Check for download button with max 2 retries
            let downloadReady = false;
            for (let attempt = 0; attempt < 2; attempt++) {
                downloadReady = await page.evaluate(() => {
                    // Look for download button or audio element
                    const downloadBtn = document.querySelector('button[aria-label*="download"], button[aria-label*="Download"], button[title*="download"], a[download]');
                    const audioElement = document.querySelector('audio[src]');
                    // Also check for download icon in button
                    const downloadIcon = document.querySelector('button .material-symbols-outlined');
                    const hasDownloadIcon = downloadIcon && downloadIcon.textContent?.includes('download');
                    return !!(downloadBtn || audioElement || hasDownloadIcon);
                });

                if (downloadReady) break;
                await this.browser.randomDelay(2000, 3000);
            }

            if (!downloadReady) {
                throw new Error('Audio generation failed - download button not found after generation completed');
            }

            steps.push(`✓ Audio generated`);

            // Download the audio file
            const downloaded = await this.downloadAudio(page, config.outputPath, steps);

            await this.browser.randomDelay(2000, 3000);

            // Generate timestamp for unique screenshot names
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

            if (downloaded) {
                steps.push(`✓ Saved: ${path.basename(config.outputPath)}`);

                // Take success screenshot with timestamp
                const screenshotPath = path.join(
                    path.dirname(config.outputPath),
                    `audio_${config.slideNumber}_success_${timestamp}.png`
                );
                await page.screenshot({ path: screenshotPath, fullPage: false });
                steps.push(`📸 Screenshot saved: ${path.basename(screenshotPath)}`);

                return true;
            }

            // Take failure screenshot (download failed) with timestamp
            const failScreenshotPath = path.join(
                path.dirname(config.outputPath),
                `audio_${config.slideNumber}_failed_${timestamp}.png`
            );
            await page.screenshot({ path: failScreenshotPath, fullPage: false });
            steps.push(`📸 Failure screenshot: ${path.basename(failScreenshotPath)}`);

            return false;

        } catch (error) {
            steps.push(`✗ Error: ${(error as Error).message}`);

            // Take error screenshot with timestamp
            try {
                const errorTimestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                const errorScreenshotPath = path.join(
                    path.dirname(config.outputPath),
                    `audio_${config.slideNumber}_error_${errorTimestamp}.png`
                );
                await page.screenshot({ path: errorScreenshotPath, fullPage: false });
                steps.push(`📸 Error screenshot: ${path.basename(errorScreenshotPath)}`);
            } catch (screenshotError) {
                steps.push(`⚠ Could not save error screenshot`);
            }

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

            // Snapshot existing files before download
            const existingFiles = new Set(fs.readdirSync(downloadDir));

            // Click download button
            const downloadClicked = await page.evaluate(() => {
                // Try download button with various selectors
                const downloadBtn = document.querySelector(
                    'button[aria-label*="download"], button[aria-label*="Download"], button[title*="download"], button[title*="Download"]'
                ) as HTMLElement;
                if (downloadBtn) {
                    downloadBtn.click();
                    return true;
                }

                // Try finding any button with download icon
                const buttons = Array.from(document.querySelectorAll('button'));
                const dlBtn = buttons.find(b => {
                    const icon = b.querySelector('.material-symbols-outlined');
                    return icon && icon.textContent?.toLowerCase().includes('download');
                });
                if (dlBtn) {
                    dlBtn.click();
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

            steps.push(`✓ Download clicked, waiting for file...`);

            // Wait for download to complete - poll for new file and size stability
            let downloadedFile: string | null = null;
            let lastSize = 0;
            let stableCount = 0;
            const maxWaitMs = 120000; // 2 minutes max
            const startTime = Date.now();
            const downloadStartTime = Date.now(); // Timestamp when we clicked download

            while (Date.now() - startTime < maxWaitMs) {
                await this.browser.randomDelay(2000, 2500);

                // Find new audio files
                const currentFiles = fs.readdirSync(downloadDir);
                const newFiles = currentFiles.filter(f => {
                    if (existingFiles.has(f)) return false;
                    if (!(f.endsWith('.wav') || f.endsWith('.mp3'))) return false;
                    if (f.endsWith('.crdownload') || f.endsWith('.tmp')) return false;

                    // Additional safeguard: check file creation time to avoid picking up
                    // files from parallel downloads (file should be created after we clicked download)
                    try {
                        const filePath = path.join(downloadDir, f);
                        const stats = fs.statSync(filePath);
                        const fileCreatedTime = stats.birthtimeMs || stats.mtimeMs;
                        // File should be created within 5 seconds before download click to 2 mins after
                        return fileCreatedTime >= (downloadStartTime - 5000);
                    } catch {
                        return false;
                    }
                });

                if (newFiles.length > 0) {
                    // Sort by creation time to get the most recent file (in case multiple match)
                    newFiles.sort((a, b) => {
                        const statsA = fs.statSync(path.join(downloadDir, a));
                        const statsB = fs.statSync(path.join(downloadDir, b));
                        return (statsB.birthtimeMs || statsB.mtimeMs) - (statsA.birthtimeMs || statsA.mtimeMs);
                    });

                    const filePath = path.join(downloadDir, newFiles[0]);
                    const currentSize = fs.statSync(filePath).size;

                    if (currentSize > 0 && currentSize === lastSize) {
                        stableCount++;
                        // File size stable for 3 checks (6+ seconds) = download complete
                        if (stableCount >= 3) {
                            downloadedFile = filePath;
                            break;
                        }
                    } else {
                        stableCount = 0;
                        lastSize = currentSize;
                    }
                }
            }

            if (!downloadedFile) {
                steps.push(`⚠ Download timed out or file not found`);
                return false;
            }

            // Validate minimum file size (at least 10KB for a real audio file)
            const finalSize = fs.statSync(downloadedFile).size;
            if (finalSize < 10000) {
                steps.push(`⚠ Downloaded file too small (${finalSize} bytes) - may be corrupted`);
                return false;
            }

            // Rename to target path
            if (downloadedFile !== outputPath) {
                if (fs.existsSync(outputPath)) {
                    fs.unlinkSync(outputPath);
                }
                fs.renameSync(downloadedFile, outputPath);
            }

            steps.push(`✓ Download complete (${Math.round(finalSize / 1024)}KB)`);
            return true;

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

    /**
     * Generate audio for text - convenience method that handles page setup.
     * Used by the audio regeneration UI endpoint.
     */
    public async generateAudio(config: GoogleStudioConfig & {
        text: string;
        outputPath: string;
    }): Promise<{ success: boolean; audioPath?: string; message?: string }> {
        const steps: string[] = [];

        try {
            // Get or create Google Studio page
            const page = await this.browser.getPage('google-studio', GOOGLE_STUDIO_URL);
            await this.browser.randomDelay(1500, 2500);

            // Create slide config
            const slideConfig: SlideAudioConfig = {
                slideNumber: 1, // For regeneration, we use slide 1 as placeholder
                text: config.text,
                textHash: this.hashText(config.text),
                outputPath: config.outputPath
            };

            // Generate audio
            const success = await this.generateSlideAudio(page, slideConfig, config, steps);

            if (success && fs.existsSync(config.outputPath)) {
                return {
                    success: true,
                    audioPath: config.outputPath,
                    message: steps.join('\n')
                };
            }

            return {
                success: false,
                message: steps.join('\n') || 'Audio generation failed'
            };

        } catch (error) {
            return {
                success: false,
                message: (error as Error).message
            };
        }
    }
}
