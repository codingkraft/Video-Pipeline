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
     * Uploads a video to notebooklmremover.com and downloads the clean version
     */
    public async removeLogo(videoPath: string): Promise<LogoRemovalResult> {
        if (!fs.existsSync(videoPath)) {
            return { success: false, message: `Video file not found: ${videoPath}` };
        }

        try {
            console.log(`[LogoRemover] Processing: ${path.basename(videoPath)}`);

            // 1. Get Page and Navigate
            const page = await this.browser.getPage('notebooklm-remover');
            await page.setViewport({ width: 1280, height: 900 });
            await page.goto(this.baseUrl, { waitUntil: 'networkidle2' });

            // 2. Upload File
            // We need to find the input[type="file"] and upload
            // Selector from previous analysis: input[type="file"]
            const fileInputSelector = 'input[type="file"]';
            try {
                await page.waitForSelector(fileInputSelector, { timeout: 10000 });
            } catch (e) {
                return { success: false, message: 'Failed to find file input element' };
            }

            const fileInput = await page.$(fileInputSelector);
            if (!fileInput) {
                return { success: false, message: 'Failed to find file input element instance' };
            }

            await fileInput.uploadFile(videoPath);
            console.log('[LogoRemover] File uploaded successfully');

            // 3. Wait for "Start Removing Watermark" button and click
            // Using a broad selector strategy as the button appears dynamically
            // Wait for button to be visible and clickable
            const startButtonFound = await page.evaluate(async () => {
                const findButton = () => {
                    // Look for specific text or class
                    const buttons = Array.from(document.querySelectorAll('button'));
                    return buttons.find(b => b.innerText && b.innerText.includes('Start Removing Watermark')) ||
                        document.querySelector('.bg-primary:not(:disabled)');
                };

                return new Promise<boolean>((resolve) => {
                    let attempts = 0;
                    const interval = setInterval(() => {
                        const btn = findButton();
                        if (btn) {
                            (btn as HTMLElement).click();
                            clearInterval(interval);
                            resolve(true);
                        }
                        attempts++;
                        if (attempts > 50) { // 5 seconds timeout
                            clearInterval(interval);
                            resolve(false);
                        }
                    }, 100);
                });
            });

            if (!startButtonFound) {
                return { success: false, message: 'Failed to find/click Start button' };
            }
            console.log('[LogoRemover] Start button clicked, waiting for processing...');

            // 4. Monitor Progress and Wait for Download Link
            // Monitor for download link
            const downloadSuccess = await page.evaluate(async () => {
                return new Promise<boolean>((resolve) => {
                    let attempts = 0;
                    const interval = setInterval(() => {
                        // Check for download link
                        const downloadLink = document.querySelector('a[download]');
                        if (downloadLink && (downloadLink as HTMLElement).innerText.includes('Download')) {
                            clearInterval(interval);
                            resolve(true);
                            return;
                        }
                        attempts++;
                        if (attempts > 600) { // 60 seconds timeout (processing can be slow)
                            clearInterval(interval);
                            resolve(false);
                        }
                    }, 100);
                });
            });

            if (!downloadSuccess) {
                return { success: false, message: 'Timeout waiting for processing to complete' };
            }
            console.log('[LogoRemover] Processing complete, downloading...');

            // 5. Download the file
            // Capture file state before download
            const outputDir = path.dirname(videoPath);
            const existingFiles = new Set(fs.readdirSync(outputDir));

            // Set specific download path for this page
            const client = await page.createCDPSession();
            await client.send('Page.setDownloadBehavior', {
                behavior: 'allow',
                downloadPath: outputDir
            });

            try {
                await page.evaluate(() => {
                    const link = document.querySelector('a[download]') as HTMLElement;
                    if (link) link.click();
                });
            } catch (e) {
                return { success: false, message: 'Failed to click download link' };
            }

            // Wait for download to complete - polling for new file
            console.log('[LogoRemover] Download initiated, waiting for file...');
            let newFile: string | undefined;
            const maxWaitTime = 60000; // 60s max wait for download
            const pollInterval = 2000;
            const startTime = Date.now();

            while (Date.now() - startTime < maxWaitTime) {
                await this.browser.randomDelay(pollInterval, pollInterval + 500);

                if (fs.existsSync(outputDir)) {
                    const currentFiles = fs.readdirSync(outputDir);
                    const candidates = currentFiles.filter(f => !existingFiles.has(f) && (f.endsWith('.mp4') || f.endsWith('.webm') || f.endsWith('.mov')));

                    if (candidates.length > 0) {
                        // Found a new file!
                        const candidate = candidates[0];
                        if (!candidate.endsWith('.crdownload') && !candidate.endsWith('.tmp')) {
                            newFile = candidate;
                            break;
                        }
                    }
                }
            }

            if (!newFile) {
                return { success: false, message: 'Timeout waiting for download file to appear' };
            }

            // Renaming logic
            const ext = path.extname(videoPath);
            const base = path.basename(videoPath, ext); // "video1"
            const cleanPath = path.join(outputDir, `${base}_clean${ext}`); // "video1_clean.mp4"
            const downloadFilePath = path.join(outputDir, newFile);

            console.log(`[LogoRemover] Found downloaded file: ${newFile}, renaming to: ${path.basename(cleanPath)}`);

            // Wait a moment for file lock to release
            await new Promise(r => setTimeout(r, 2000));

            try {
                if (fs.existsSync(cleanPath)) {
                    try { fs.unlinkSync(cleanPath); } catch (e) { /* ignore */ }
                }

                if (downloadFilePath !== cleanPath) {
                    fs.renameSync(downloadFilePath, cleanPath);
                }

                return { success: true, cleanVideoPath: cleanPath };
            } catch (err: any) {
                return { success: false, message: `Failed to move/rename file: ${err.message}` };
            }

        } catch (error: any) {
            return { success: false, message: `Unexpected error: ${error.message}` };
        }
    }
}
