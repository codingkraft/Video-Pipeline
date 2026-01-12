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
            const successUpload = await this.browser.performAction(
                'Upload Video for Cleaning',
                async () => {
                    const fileInputSelector = 'input[type="file"]';
                    const fileInput = await page.$(fileInputSelector);
                    if (!fileInput) throw new Error('File input not found');
                    await fileInput.uploadFile(videoPath);
                },
                async () => {
                    // Start button usually appears after upload
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
                async () => {
                    // Check if button is gone or "Processing" state appears
                    // Hard to know exact state change without inspecting live, but assuming button disappears or changes state
                    return true;
                },
                { maxRetries: 5, retryDelay: 2000 }
            );
            console.log('[LogoRemover] Start button clicked, waiting for processing...');

            // 4. Monitor Progress and Wait for Download Link
            const successProcessing = await this.browser.performAction(
                'Wait for Processing',
                async () => {
                    await this.browser.randomDelay(2000, 3000);
                },
                async () => {
                    const downloadLink = await page.$('a[download]');
                    if (downloadLink) {
                        const text = await page.evaluate(el => el.innerText, downloadLink);
                        return text.includes('Download');
                    }
                    return false;
                },
                { maxRetries: 30, retryDelay: 2000 } // up to 60s
            );

            if (!successProcessing) {
                return { success: false, message: 'Timeout waiting for processing to complete' };
            }
            console.log('[LogoRemover] Processing complete, downloading...');

            // 5. Download the file
            // Capture file state before download
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

                // Close the page as requested
                await this.browser.closePage('notebooklm-remover');

                return { success: true, cleanVideoPath: cleanPath };
            } catch (err: any) {
                return { success: false, message: `Failed to move/rename file: ${err.message}` };
            }

        } catch (error: any) {
            return { success: false, message: `Unexpected error: ${error.message}` };
        }
    }
}
