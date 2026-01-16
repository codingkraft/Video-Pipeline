import { CaptiveBrowser } from '../browser/CaptiveBrowser';
import * as path from 'path';
import * as fs from 'fs';

export interface LogoRemovalResult {
    success: boolean;
    cleanVideoPath?: string;
    message?: string;
}

export class NotebookLMRemoverTester {
    private browser: CaptiveBrowser;
    private baseUrl = 'https://notebooklmremover.com/en';

    constructor() {
        this.browser = CaptiveBrowser.getInstance();
    }

    /**
     * MODULE: Logo Removal
     * Uploads a video to notebooklmremover.com and downloads the clean version.
     * Uses modular recovery: Open → Process → Close with 3 retries.
     */
    public async removeLogo(videoPath: string, profileId?: string): Promise<LogoRemovalResult> {
        if (!fs.existsSync(videoPath)) {
            return { success: false, message: `Video file not found: ${videoPath}` };
        }

        try {
            if (profileId) {
                await this.browser.initialize({ profileId });
            }

            console.log(`[LogoRemover] Processing: ${path.basename(videoPath)}`);

            return await this.browser.withModularRecovery(
                'notebooklm-remover',
                this.baseUrl,
                async (page) => {
                    return await this.executeLogoRemoval(page, videoPath);
                }
            );
        } catch (error: any) {
            return { success: false, message: `Logo removal failed after retries: ${error.message}` };
        }
    }

    /**
     * Internal: Execute the actual logo removal workflow on a page
     */
    private async executeLogoRemoval(page: import('puppeteer').Page, videoPath: string): Promise<LogoRemovalResult> {
        await page.setViewport({ width: 1280, height: 900 });

        // 2. Upload File
        const successUpload = await this.browser.performAction(
            'Upload Video for Cleaning',
            async () => {
                const fileInputSelector = 'input[type="file"]';
                const fileInput = await page.$(fileInputSelector);
                if (!fileInput) throw new Error('File input not found');
                await fileInput.uploadFile(videoPath);
            },
            async () => {
                const startBtn = await page.evaluate(() => {
                    const buttons = Array.from(document.querySelectorAll('button'));
                    return buttons.some(b => b.innerText && b.innerText.includes('Start Removing Watermark')) ||
                        !!document.querySelector('.bg-primary:not(:disabled)');
                });
                return startBtn;
            },
            { maxRetries: 3 }
        );

        if (!successUpload) throw new Error('Failed to upload video');
        console.log('[LogoRemover] File uploaded successfully');

        // 3. Wait for "Start Removing Watermark" button and click
        await this.browser.performAction(
            'Click Start Removing',
            async () => {
                const clicked = await page.evaluate(() => {
                    const buttons = Array.from(document.querySelectorAll('button'));
                    const btn = buttons.find(b => b.innerText && b.innerText.includes('Start Removing Watermark')) ||
                        document.querySelector('.bg-primary:not(:disabled)');
                    if (btn) {
                        (btn as HTMLElement).click();
                        return true;
                    }
                    return false;
                });
                if (!clicked) throw new Error('Start removing button not found');
            },
            async () => true,
            { maxRetries: 5, retryDelay: 2000 }
        );
        console.log('[LogoRemover] Start button clicked, waiting for processing...');

        // 4. Monitor Progress and Wait for Download Link (may take several minutes)
        console.log('[LogoRemover] Waiting for video processing (this may take several minutes)...');
        const successProcessing = await this.browser.performAction(
            'Wait for Processing',
            async () => {
                await this.browser.randomDelay(3000, 4000);
            },
            async () => {
                // Check if still processing (progress bar visible)
                const processingStatus = await page.evaluate(() => {
                    // Look for progress bar with data-slot="progress"
                    const progressBar = document.querySelector('[data-slot="progress"]');
                    if (progressBar) {
                        // Get progress percentage from text
                        const progressText = document.body.innerText.match(/(\d+)%/);
                        if (progressText) {
                            return { processing: true, percent: parseInt(progressText[1]) };
                        }
                        return { processing: true, percent: 0 };
                    }

                    // Check for "Processing..." text
                    if (document.body.innerText.includes('Processing...')) {
                        return { processing: true, percent: 0 };
                    }

                    return { processing: false, percent: 100 };
                });

                if (processingStatus.processing) {
                    console.log(`[LogoRemover] Processing: ${processingStatus.percent}%`);
                    return false; // Still processing, keep waiting
                }

                // Processing done - check for download link
                const downloadLink = await page.$('a[download]');
                if (downloadLink) {
                    const text = await page.evaluate(el => el.innerText, downloadLink);
                    if (text.includes('Download')) return true;
                }

                // Check for error state
                const hasError = await page.evaluate(() => {
                    const errorText = document.body.innerText.toLowerCase();
                    return errorText.includes('error') || errorText.includes('failed') || errorText.includes('try again');
                });
                if (hasError) {
                    throw new Error('Logo removal service reported an error');
                }

                return false;
            },
            { maxRetries: 150, retryDelay: 3000 } // Up to ~7.5 minutes wait
        );

        if (!successProcessing) {
            throw new Error('Timeout waiting for processing to complete (5 mins)');
        }
        console.log('[LogoRemover] Processing complete, downloading...');

        // 5. Download the file
        const outputDir = path.dirname(videoPath);
        const existingFiles = new Set(fs.readdirSync(outputDir));

        const client = await page.createCDPSession();
        await client.send('Page.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: outputDir
        });

        await this.browser.performAction(
            'Click Download Link',
            async () => {
                await page.evaluate(() => {
                    const link = document.querySelector('a[download]') as HTMLElement;
                    if (link) link.click();
                });
            }
        );

        // Wait for download to complete
        console.log('[LogoRemover] Download initiated, waiting for file...');
        let newFile: string | undefined;
        const maxWaitTime = 60000;
        const pollInterval = 2000;
        const startTime = Date.now();

        while (Date.now() - startTime < maxWaitTime) {
            await this.browser.randomDelay(pollInterval, pollInterval + 500);

            if (fs.existsSync(outputDir)) {
                const currentFiles = fs.readdirSync(outputDir);
                const candidates = currentFiles.filter(f =>
                    !existingFiles.has(f) &&
                    (f.endsWith('.mp4') || f.endsWith('.webm') || f.endsWith('.mov'))
                );

                if (candidates.length > 0) {
                    const candidate = candidates[0];
                    if (!candidate.endsWith('.crdownload') && !candidate.endsWith('.tmp')) {
                        newFile = candidate;
                        break;
                    }
                }
            }
        }

        if (!newFile) {
            throw new Error('Timeout waiting for download file to appear');
        }

        // Renaming logic
        const ext = path.extname(videoPath);
        const base = path.basename(videoPath, ext);
        const cleanPath = path.join(outputDir, `${base}_clean${ext}`);
        const downloadFilePath = path.join(outputDir, newFile);

        console.log(`[LogoRemover] Found downloaded file: ${newFile}, renaming to: ${path.basename(cleanPath)}`);

        await new Promise(r => setTimeout(r, 2000));

        if (fs.existsSync(cleanPath)) {
            try { fs.unlinkSync(cleanPath); } catch (e) { /* ignore */ }
        }

        if (downloadFilePath !== cleanPath) {
            fs.renameSync(downloadFilePath, cleanPath);
        }

        return { success: true, cleanVideoPath: cleanPath };
    }
}
