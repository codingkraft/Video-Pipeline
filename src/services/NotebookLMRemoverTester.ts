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

            // Use video filename in service key for parallel processing support
            const videoName = path.basename(videoPath, path.extname(videoPath));
            const serviceKey = `notebooklm-remover-${videoName}`;

            return await this.browser.withModularRecovery(
                serviceKey,
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
        // Apply anti-detection measures BEFORE navigation
        await page.evaluateOnNewDocument(() => {
            // Override webdriver detection
            Object.defineProperty(navigator, 'webdriver', {
                get: () => false,
            });
            // Override plugins to appear as regular browser
            Object.defineProperty(navigator, 'plugins', {
                get: () => [
                    { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
                    { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
                    { name: 'Native Client', filename: 'internal-nacl-plugin' }
                ],
            });
            // Override languages
            Object.defineProperty(navigator, 'languages', {
                get: () => ['en-US', 'en'],
            });
            // Override hardwareConcurrency
            Object.defineProperty(navigator, 'hardwareConcurrency', {
                get: () => 8,
            });
            // Override deviceMemory
            Object.defineProperty(navigator, 'deviceMemory', {
                get: () => 8,
            });
            // Override platform
            Object.defineProperty(navigator, 'platform', {
                get: () => 'Win32',
            });
        });

        // Reload the page to apply anti-detection measures
        console.log('[LogoRemover] Reloading page to apply anti-detection measures...');
        await page.reload({ waitUntil: 'networkidle2' });

        // Wait for page to fully load
        await this.browser.randomDelay(3000, 4000);

        // Wait for "Loading Core" to disappear with retry mechanism
        let coreLoaded = false;
        for (let attempt = 1; attempt <= 2 && !coreLoaded; attempt++) {
            try {
                console.log(`[LogoRemover] Waiting for core to load (attempt ${attempt}/2)...`);
                await page.waitForFunction(() => {
                    const buttons = Array.from(document.querySelectorAll('button'));
                    // Core is loaded when either:
                    // 1. There's a button with "Start Removing" text
                    // 2. There's no button with "Loading Core" text
                    const hasLoadingCore = buttons.some(b => b.textContent?.includes('Loading Core'));
                    const hasStartRemoving = buttons.some(b => b.textContent?.includes('Start Removing'));
                    return !hasLoadingCore || hasStartRemoving;
                }, { timeout: 30000 });
                coreLoaded = true;
                console.log('[LogoRemover] Core loaded successfully');
            } catch (e) {
                console.log(`[LogoRemover] Core loading timed out on attempt ${attempt}, refreshing...`);
                if (attempt < 2) {
                    await page.reload({ waitUntil: 'networkidle2' });
                    await this.browser.randomDelay(3000, 4000);
                }
            }
        }

        if (!coreLoaded) {
            console.log('[LogoRemover] Core never loaded, proceeding with upload anyway...');
        }

        // 2. Upload File using CDP (more reliable, bypasses some detection)
        const successUpload = await this.browser.performAction(
            'Upload Video for Cleaning',
            async () => {
                // Try multiple selectors for file input (website may have changed)
                const fileInputSelectors = [
                    'input[type="file"]',
                    'input[accept*="video"]',
                    'input[accept*="mp4"]',
                    '.upload-area input',
                    '[data-testid="file-input"]'
                ];

                let fileInput = null;
                for (const selector of fileInputSelectors) {
                    fileInput = await page.$(selector);
                    if (fileInput) break;
                }

                // If no file input found, try clicking on upload area to trigger it
                if (!fileInput) {
                    // Look for upload area/button that might create the file input
                    const uploadTriggerClicked = await page.evaluate(() => {
                        const uploadArea = document.querySelector('.upload-area, [class*="upload"], [class*="dropzone"], label[for]');
                        if (uploadArea) {
                            (uploadArea as HTMLElement).click();
                            return true;
                        }
                        // Also try any button that mentions upload
                        const buttons = Array.from(document.querySelectorAll('button'));
                        const uploadBtn = buttons.find(b => b.innerText?.toLowerCase().includes('upload') || b.innerText?.toLowerCase().includes('choose') || b.innerText?.toLowerCase().includes('select'));
                        if (uploadBtn) {
                            uploadBtn.click();
                            return true;
                        }
                        return false;
                    });

                    if (uploadTriggerClicked) {
                        await this.browser.randomDelay(1000, 1500);
                        // Try to find file input again after clicking
                        for (const selector of fileInputSelectors) {
                            fileInput = await page.$(selector);
                            if (fileInput) break;
                        }
                    }
                }

                if (!fileInput) {
                    // Last resort: make hidden file inputs visible
                    await page.evaluate(() => {
                        const inputs = document.querySelectorAll('input[type="file"]');
                        inputs.forEach(input => {
                            (input as HTMLElement).style.display = 'block';
                            (input as HTMLElement).style.visibility = 'visible';
                            (input as HTMLElement).style.opacity = '1';
                        });
                    });
                    await this.browser.randomDelay(500, 1000);
                    fileInput = await page.$('input[type="file"]');
                }

                if (!fileInput) throw new Error('File input not found');

                // Advanced Strategy: Simulate Drag and Drop with DataTransfer
                // This bypasses file input detection by mimicking a user drop action
                try {
                    console.log('[LogoRemover] Attempting advanced Drag & Drop simulation...');
                    const fileBuffer = fs.readFileSync(videoPath);
                    const base64Data = fileBuffer.toString('base64');
                    const fileName = path.basename(videoPath);
                    const mimeType = 'video/mp4';

                    await page.evaluate(async (base64, name, type) => {
                        // Helper to convert base64 to File
                        const res = await fetch(`data:${type};base64,${base64}`);
                        const blob = await res.blob();
                        const file = new File([blob], name, { type });

                        // Find the dropzone
                        const dropzone = document.querySelector('.upload-area, [class*="upload"], [class*="dropzone"], .border-dashed') || document.body;

                        // Create synthetic DataTransfer
                        const dataTransfer = new DataTransfer();
                        dataTransfer.items.add(file);

                        // Create and dispatch events
                        const createEvent = (type: string) => {
                            const event = new DragEvent(type, {
                                bubbles: true,
                                cancelable: true,
                                dataTransfer: dataTransfer,
                                composed: true,
                                view: window
                            });
                            return event;
                        };

                        console.log('Dispatching drag/drop events on:', dropzone);
                        dropzone.dispatchEvent(createEvent('dragenter'));
                        dropzone.dispatchEvent(createEvent('dragover'));
                        dropzone.dispatchEvent(createEvent('drop'));

                        // Also trigger input change if it exists inside
                        const input = dropzone.querySelector('input[type="file"]') as HTMLInputElement;
                        if (input) {
                            input.files = dataTransfer.files;
                            input.dispatchEvent(new Event('change', { bubbles: true }));
                            input.dispatchEvent(new Event('input', { bubbles: true }));
                        }
                    }, base64Data, fileName, mimeType);

                    console.log('[LogoRemover] Drag & Drop events dispatched');
                } catch (dropError) {
                    console.error('[LogoRemover] Drag & Drop simulation failed:', dropError);

                    // Fallback to standard uploadFile if DnD fails
                    console.log('[LogoRemover] Falling back to standard uploadFile...');
                    if (!fileInput) throw new Error('File input not found for fallback');
                    const inputElement = fileInput as import('puppeteer').ElementHandle<HTMLInputElement>;
                    await inputElement.uploadFile(videoPath);
                }
            },
            async () => {
                // Validation: check if start button appears or file name is shown
                const startBtn = await page.evaluate(() => {
                    const buttons = Array.from(document.querySelectorAll('button'));
                    const hasStartBtn = buttons.some(b => b.innerText && b.innerText.includes('Start Removing Watermark'));
                    const hasPrimaryBtn = !!document.querySelector('.bg-primary:not(:disabled)');
                    // Also check if file name is displayed anywhere (indicating successful upload)
                    const hasFileName = document.body.innerText.includes('.mp4') || document.body.innerText.includes('.webm');
                    return hasStartBtn || hasPrimaryBtn || hasFileName;
                });
                return startBtn;
            },
            { maxRetries: 5, retryDelay: 3000 }
        );

        if (!successUpload) throw new Error('Failed to upload video');
        console.log('[LogoRemover] File uploaded successfully');

        // Wait additional time for the button to become active after upload
        await this.browser.randomDelay(3000, 5000);

        // 3. Wait for "Start Removing Watermark" button to be clickable
        await this.browser.performAction(
            'Click Start Removing',
            async () => {
                // First wait for the button to be enabled (not Loading Core)
                const buttonState = await page.evaluate(() => {
                    const buttons = Array.from(document.querySelectorAll('button'));
                    const states = buttons.map(b => ({
                        text: b.textContent?.trim().substring(0, 30),
                        disabled: b.disabled,
                        class: b.className.includes('bg-primary') ? 'primary' : ''
                    })).filter(b => b.text && b.text.length > 0);
                    return states;
                });
                console.log('[LogoRemover] Available buttons:', JSON.stringify(buttonState));

                // Check if still loading
                const isLoading = await page.evaluate(() => {
                    const buttons = Array.from(document.querySelectorAll('button'));
                    return buttons.some(b => b.textContent?.includes('Loading Core'));
                });

                if (isLoading) {
                    throw new Error('Button still showing "Loading Core..." - core not loaded');
                }

                const clicked = await page.evaluate(() => {
                    const buttons = Array.from(document.querySelectorAll('button'));
                    // Look for Start Removing button
                    const btn = buttons.find(b =>
                        b.textContent?.includes('Start Removing') &&
                        !b.disabled
                    );
                    // Fallback to any enabled primary button
                    const fallback = document.querySelector('.bg-primary:not(:disabled)') as HTMLElement;
                    const target = btn || fallback;

                    if (target && !target.hasAttribute('disabled')) {
                        target.click();
                        return true;
                    }
                    return false;
                });
                if (!clicked) throw new Error('Start removing button not found or disabled');
            },
            async () => true,
            { maxRetries: 10, retryDelay: 3000 } // More retries with 3s delay
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
        const downloadStartTime = Date.now(); // Track when download was initiated

        while (Date.now() - startTime < maxWaitTime) {
            await this.browser.randomDelay(pollInterval, pollInterval + 500);

            if (fs.existsSync(outputDir)) {
                const currentFiles = fs.readdirSync(outputDir);
                const candidates = currentFiles.filter(f => {
                    if (existingFiles.has(f)) return false;
                    if (!(f.endsWith('.mp4') || f.endsWith('.webm') || f.endsWith('.mov'))) return false;
                    if (f.endsWith('.crdownload') || f.endsWith('.tmp')) return false;

                    // Additional safeguard: check file creation time to avoid picking up
                    // files from parallel downloads
                    try {
                        const filePath = path.join(outputDir, f);
                        const stats = fs.statSync(filePath);
                        const fileCreatedTime = stats.birthtimeMs || stats.mtimeMs;
                        // File should be created after download was initiated (with 5s grace period)
                        return fileCreatedTime >= (downloadStartTime - 5000);
                    } catch {
                        return false;
                    }
                });

                if (candidates.length > 0) {
                    // Sort by creation time to get the most recent file
                    candidates.sort((a, b) => {
                        const statsA = fs.statSync(path.join(outputDir, a));
                        const statsB = fs.statSync(path.join(outputDir, b));
                        return (statsB.birthtimeMs || statsB.mtimeMs) - (statsA.birthtimeMs || statsA.mtimeMs);
                    });
                    newFile = candidates[0];
                    break;
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
