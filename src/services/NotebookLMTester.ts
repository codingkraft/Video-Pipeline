import { Page } from 'puppeteer';
import { CaptiveBrowser } from '../browser/CaptiveBrowser';
import { ProgressTracker } from './ProgressTracker';
import * as path from 'path';
import * as fs from 'fs';

const NOTEBOOKLM_URL = 'https://notebooklm.google.com/';

export interface NotebookLMTestConfig {
    sourceFolder: string;
    files?: string[];
    headless?: boolean;
    existingNotebookUrl?: string; // If resuming from an existing notebook
    steeringPrompt?: string;      // Prompt from Perplexity
    videoPrompt?: string;         // Direct video prompt override
    visualStyle?: string;         // Visual style description
    profileId?: string;           // Browser profile to use
    skipSourcesUpload?: boolean;  // Whether to skip source upload
    forceSourceUpload?: boolean;  // Whether to force source upload even if already done
    skipNotebookCreation?: boolean; // Whether to skip notebook creation (must use existing)
}

export interface NotebookLMTestResult {
    success: boolean;
    message: string;
    details?: {
        steps: string[];
        notebookUrl?: string;
        sourceCount?: number;
        screenshotPath?: string;
    };
}

export class NotebookLMTester {
    private browser: CaptiveBrowser;

    constructor() {
        this.browser = CaptiveBrowser.getInstance();
    }

    /**
     * MODULE: Setup Notebook
     * Creates a new notebook and uploads sources.
     * Uses modular recovery: Open → Work → Close, with 3 retries.
     * 
     * @param config Configuration for notebook setup
     * @returns Notebook URL on success, throws on failure after retries
     */
    public async setupNotebook(config: NotebookLMTestConfig): Promise<string> {
        await this.browser.initialize({
            headless: config.headless,
            profileId: config.profileId || 'default'
        });

        const targetUrl = config.existingNotebookUrl || NOTEBOOKLM_URL;
        // Use folder name in service key to ensure each parallel operation gets its own tab
        const folderName = path.basename(config.sourceFolder);
        const serviceKey = `notebooklm-setup-${folderName}`;

        return await this.browser.withModularRecovery<string>(
            serviceKey,
            targetUrl,
            async (page) => {
                const steps: string[] = [];
                let notebookUrl: string | undefined;

                // Step 1: Create or use existing notebook
                if (config.existingNotebookUrl) {
                    notebookUrl = config.existingNotebookUrl;
                    steps.push(`✓ Using existing notebook: ${notebookUrl}`);
                } else if (config.skipNotebookCreation) {
                    const savedProgress = ProgressTracker.getProgress(config.sourceFolder);
                    notebookUrl = savedProgress?.steps.notebooklm_notebook_created?.notebookUrl;
                    if (!notebookUrl) {
                        throw new Error('No existing notebook URL found. Cannot skip notebook creation.');
                    }
                    steps.push(`✓ Found existing notebook URL: ${notebookUrl}`);
                } else {
                    const folderName = path.basename(config.sourceFolder);
                    notebookUrl = await this.createNotebook(page, folderName, steps);

                    if (!notebookUrl) {
                        throw new Error('Failed to create notebook');
                    }

                    ProgressTracker.markStepComplete(config.sourceFolder, 'notebooklm_notebook_created', {
                        notebookUrl
                    });
                }

                // Step 2: Upload sources
                let filesToUpload = config.files || [];
                if (filesToUpload.length === 0 && config.sourceFolder) {
                    if (fs.existsSync(config.sourceFolder)) {
                        filesToUpload = fs.readdirSync(config.sourceFolder)
                            .filter(f => !f.startsWith('~') && /\.(pdf|txt|md|docx?|jpe?g|png|gif|webp|bmp)$/i.test(f))
                            .map(f => path.join(config.sourceFolder, f));
                    }
                }

                if (filesToUpload.length > 0) {
                    const alreadyUploaded = ProgressTracker.isStepComplete(config.sourceFolder, 'notebooklm_sources_uploaded');

                    if (config.skipSourcesUpload) {
                        steps.push(`✓ Skipping source upload (skipSourcesUpload=true)`);
                    } else if (alreadyUploaded && !config.forceSourceUpload) {
                        steps.push(`✓ Sources already uploaded (skipping)`);
                    } else {
                        await this.uploadSources(page, filesToUpload, steps);
                        ProgressTracker.markStepComplete(config.sourceFolder, 'notebooklm_sources_uploaded', {
                            sourceCount: filesToUpload.length
                        });
                    }
                }

                console.log('[NotebookLM Setup] Steps:', steps.join('\n'));
                return notebookUrl;
            }
        );
    }

    /**
     * MODULE: Generate Video
     * Navigates to existing notebook and triggers video generation.
     * Uses modular recovery: Open → Work → Close, with 3 retries.
     * 
     * @param notebookUrl URL of existing notebook (from setupNotebook)
     * @param config Configuration for video generation
     */
    public async generateVideo(notebookUrl: string, config: NotebookLMTestConfig): Promise<NotebookLMTestResult> {
        await this.browser.initialize({
            headless: config.headless,
            profileId: config.profileId || 'default'
        });

        // Use folder name in service key to ensure each parallel operation gets its own tab
        const folderName = path.basename(config.sourceFolder);
        const serviceKey = `notebooklm-video-${folderName}`;

        return await this.browser.withModularRecovery<NotebookLMTestResult>(
            serviceKey,
            notebookUrl,
            async (page) => {
                const steps: string[] = [];
                steps.push(`✓ Navigated to notebook: ${notebookUrl}`);

                // Load steering prompt
                await this.loadSteeringPrompt(config, steps);

                // Navigate to video creation and trigger generation
                await this.navigateToVideoCreation(page, steps, config);

                // Take screenshot
                const outputDir = path.join(config.sourceFolder, 'output');
                if (!fs.existsSync(outputDir)) {
                    fs.mkdirSync(outputDir, { recursive: true });
                }
                const screenshotPath = path.join(outputDir, 'notebooklm_screenshot.png');
                await page.screenshot({ path: screenshotPath, fullPage: true });

                return {
                    success: true,
                    message: 'Video generation started successfully',
                    details: {
                        steps,
                        notebookUrl,
                        screenshotPath
                    }
                };
            }
        );
    }

    /**
     * Helper to load steering prompt from files or progress
     */
    private async loadSteeringPrompt(config: NotebookLMTestConfig, steps: string[]): Promise<void> {
        if (config.steeringPrompt) return;

        const progress = ProgressTracker.getProgress(config.sourceFolder);
        if (progress?.steps.perplexity?.steeringPrompt) {
            config.steeringPrompt = progress.steps.perplexity.steeringPrompt;
            steps.push(`✓ Loaded steering prompt from progress`);
            return;
        }

        // Try loading from file
        const promptPaths = [
            path.join(config.sourceFolder, 'output', 'perplexity_video_response.txt'),
            path.join(config.sourceFolder, 'perplexity_video_response.txt'),
            path.join(config.sourceFolder, 'perplexity_response.txt'),
            path.join(config.sourceFolder, 'output', 'perplexity_response.txt')
        ];

        for (const promptPath of promptPaths) {
            if (fs.existsSync(promptPath)) {
                config.steeringPrompt = fs.readFileSync(promptPath, 'utf-8');
                steps.push(`✓ Loaded steering prompt from ${path.basename(promptPath)}`);
                return;
            }
        }

        steps.push(`⚠ No steering prompt found`);
    }

    /**
     * Test the complete NotebookLM workflow:
     * 1. Navigate to NotebookLM
     * 2. Create a new notebook
     * 3. Upload source files
     * 4. Navigate to video creation
     */
    public async testWorkflow(config: NotebookLMTestConfig): Promise<NotebookLMTestResult> {
        const steps: string[] = [];

        try {
            await this.browser.initialize({
                headless: config.headless,
                profileId: config.profileId || 'default'
            });

            // Determine URL: use existing notebook or go to home
            const targetUrl = config.existingNotebookUrl || NOTEBOOKLM_URL;
            const page = await this.browser.getPage('notebooklm-test', targetUrl);
            await this.browser.randomDelay(2000, 3000);

            steps.push(`✓ Navigated to: ${targetUrl}`);

            // Load steering prompt from per-folder progress if not provided
            // This allows resuming from any step while preserving Perplexity-generated data
            // Note: visualStyle comes from global settings, not per-folder progress
            if (!config.steeringPrompt) {
                const progress = ProgressTracker.getProgress(config.sourceFolder);
                if (progress?.steps.perplexity?.steeringPrompt) {
                    config.steeringPrompt = progress.steps.perplexity.steeringPrompt;
                    steps.push(`✓ Loaded steering prompt from progress`);
                } else {
                    // Get prompt from file or config
                    let prompt = config.videoPrompt;
                    if (!prompt) {
                        const promptPath = path.join(config.sourceFolder, 'perplexity_video_response.txt');
                        const legacyPromptPath = path.join(config.sourceFolder, 'perplexity_response.txt');
                        const legacyPromptPath2 = path.join(config.sourceFolder, 'output', 'perplexity_response.txt'); // Check output if not in root

                        if (fs.existsSync(promptPath)) {
                            prompt = fs.readFileSync(promptPath, 'utf-8');
                            steps.push('✓ Loaded prompt from perplexity_video_response.txt');
                        } else if (fs.existsSync(legacyPromptPath)) {
                            prompt = fs.readFileSync(legacyPromptPath, 'utf-8');
                            steps.push('✓ Loaded prompt from perplexity_response.txt');
                        } else if (fs.existsSync(legacyPromptPath2)) {
                            prompt = fs.readFileSync(legacyPromptPath2, 'utf-8');
                            steps.push('✓ Loaded prompt from output/perplexity_response.txt');
                        }
                    }

                    if (prompt) {
                        config.steeringPrompt = prompt;
                    } else {
                        steps.push(`⚠ No steering prompt found (run Perplexity first)`);
                    }
                }
            }

            // Resolve files to upload
            let filesToUpload = config.files || [];
            if (filesToUpload.length === 0 && config.sourceFolder) {
                // Get all supported files from source folder
                if (fs.existsSync(config.sourceFolder)) {
                    filesToUpload = fs.readdirSync(config.sourceFolder)
                        .filter(f => !f.startsWith('~') && /\.(pdf|txt|md|docx?|jpe?g|png|gif|webp|bmp)$/i.test(f))
                        .map(f => path.join(config.sourceFolder, f));
                    steps.push(`✓ Found ${filesToUpload.length} files in source folder`);
                }
            }

            // Output directory
            const outputDir = path.join(config.sourceFolder, 'output');
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }

            let notebookUrl: string | undefined;

            // Step 1: Create new notebook (if not using existing)
            if (config.existingNotebookUrl) {
                notebookUrl = config.existingNotebookUrl;
                steps.push(`✓ Using existing notebook: ${notebookUrl}`);
            } else if (config.skipNotebookCreation) {
                // If skipNotebookCreation is true but no URL provided, we still need to navigate to video
                steps.push(`⚠ skipNotebookCreation is true but no existing URL provided. Attempting to find existing notebook...`);
                // Try to retrieve notebook URL from progress
                const savedProgress = ProgressTracker.getProgress(config.sourceFolder);
                notebookUrl = savedProgress?.steps.notebooklm_notebook_created?.notebookUrl;
                if (notebookUrl) {
                    steps.push(`✓ Found existing notebook URL in progress: ${notebookUrl}`);
                } else {
                    steps.push(`❌ No existing notebook URL found in progress. Cannot proceed.`);
                    throw new Error('No existing notebook URL found. Cannot skip notebook creation.');
                }
            } else {
                const folderName = path.basename(config.sourceFolder);
                notebookUrl = await this.createNotebook(page, folderName, steps);

                if (notebookUrl) {
                    // Save progress
                    ProgressTracker.markStepComplete(config.sourceFolder, 'notebooklm_notebook_created', {
                        notebookUrl
                    });
                    steps.push(`✓ Notebook created: ${notebookUrl}`);
                }
            }

            // Step 2: Upload sources
            if (filesToUpload.length > 0) {
                // Check if we should skip upload
                const alreadyUploaded = config.sourceFolder && ProgressTracker.isStepComplete(config.sourceFolder, 'notebooklm_sources_uploaded');

                if (config.skipSourcesUpload) {
                    steps.push(`✓ skipSourcesUpload is true (skipping upload)`);
                } else if (alreadyUploaded && !config.forceSourceUpload) {
                    steps.push(`✓ Sources already uploaded (skipping upload)`);
                } else {
                    steps.push(`⏳ Uploading ${filesToUpload.length} source files...`);
                    await this.uploadSources(page, filesToUpload, steps);

                    if (config.sourceFolder) {
                        ProgressTracker.markStepComplete(config.sourceFolder, 'notebooklm_sources_uploaded', {
                            sourceCount: filesToUpload.length
                        });
                    }
                }
            }

            // Step 3: Navigate to video creation
            steps.push('⏳ Navigating to video creation...');
            await this.navigateToVideoCreation(page, steps, config);

            // Take screenshot
            const screenshotPath = path.join(outputDir, 'notebooklm_screenshot.png');
            await page.screenshot({ path: screenshotPath, fullPage: true });
            steps.push(`✓ Screenshot saved: ${screenshotPath}`);

            return {
                success: true,
                message: 'NotebookLM workflow completed successfully',
                details: {
                    steps,
                    notebookUrl,
                    sourceCount: filesToUpload.length,
                    screenshotPath
                }
            };

        } catch (error) {
            steps.push(`❌ Error: ${(error as Error).message}`);
            return {
                success: false,
                message: `NotebookLM test failed: ${(error as Error).message}`,
                details: { steps }
            };
        }
    }

    /**
     * Create a new notebook with the folder name and return its URL.
     * @param page Puppeteer page
     * @param folderName Name of the folder (used as notebook name)
     * @param steps Array to log progress steps
     */
    private async createNotebook(page: Page, folderName: string, steps: string[]): Promise<string | undefined> {
        try {
            steps.push(`⏳ Creating notebook named: "${folderName}"...`);

            // ACTION 1: Click "New Notebook"
            const successCreate = await this.browser.performAction(
                'Click "New Notebook" button',
                async () => {
                    const createButtonSelectors = [
                        '.create-new-action-button-icon-container',
                        'mat-icon.create-new-action-button-icon',
                        'button[aria-label*="Create"]',
                        'button[aria-label*="New"]',
                        '[data-testid="create-notebook"]'
                    ];

                    for (const selector of createButtonSelectors) {
                        const btn = await page.$(selector);
                        if (btn) {
                            await btn.click();
                            return;
                        }
                    }

                    // Fallback to evaluate
                    const clicked = await page.evaluate(() => {
                        const buttons = Array.from(document.querySelectorAll('button'));
                        const createBtn = buttons.find(b => {
                            const text = b.textContent?.toLowerCase() || '';
                            const label = b.getAttribute('aria-label')?.toLowerCase() || '';
                            return text.includes('new') || text.includes('create') ||
                                label.includes('new') || label.includes('create');
                        });
                        if (createBtn) {
                            createBtn.click();
                            return true;
                        }
                        return false;
                    });
                    if (!clicked) throw new Error('Create button not found');
                },
                async () => {
                    // Validation: Check if title input or modal appeared
                    const titleInput = await page.$('input.title-input, input[aria-label*="title"], input[placeholder*="Untitled"]');
                    return !!titleInput;
                },
                { maxRetries: 3 }
            );

            if (!successCreate) {
                steps.push('❌ Failed to click "New Notebook" button');
                throw new Error('Failed to initiate notebook creation');
            }
            steps.push('✓ Clicked create button');

            // ACTION 2: Enter Notebook Name
            const successTitle = await this.browser.performAction(
                'Enter Notebook Name',
                async () => {
                    const titleInputSelectors = [
                        'input.title-input',
                        'input.title-input.mat-title-large',
                        'input[aria-label*="title"]',
                        'input[placeholder*="Untitled"]'
                    ];

                    let inputFound = false;
                    for (const selector of titleInputSelectors) {
                        const input = await page.$(selector);
                        if (input) {
                            inputFound = true;
                            await input.click({ clickCount: 3 });
                            await this.browser.randomDelay(200, 400);
                            await page.keyboard.press('Backspace');
                            await page.keyboard.type(folderName);
                            break;
                        }
                    }

                    if (!inputFound) {
                        // Fallback evaluate
                        await page.evaluate((name) => {
                            const editables = document.querySelectorAll('[contenteditable="true"]');
                            if (editables.length > 0) {
                                const el = editables[0] as HTMLElement;
                                el.focus();
                                el.textContent = name;
                            }
                        }, folderName);
                    }
                },
                async () => {
                    // Validation: Check if input value matches
                    const val = await page.evaluate(() => {
                        const input = document.querySelector('input.title-input') as HTMLInputElement;
                        return input ? input.value : document.querySelector('[contenteditable]')?.textContent;
                    });
                    return val === folderName;
                },
                { maxRetries: 3 }
            );

            if (!successTitle) {
                // Warning only, as default title might persist but flow can continue
                steps.push('⚠ Failed to set custom notebook name (continuing with default)');
            } else {
                steps.push(`✓ Entered notebook name: "${folderName}"`);
            }

            // ACTION 3: Capture URL (Wait for notebook creation)
            // This is effectively waiting for the URL to update, which confirms creation
            let notebookUrl: string | undefined;
            const successUrl = await this.browser.performAction(
                'Capture Notebook URL',
                async () => {
                    // No specific action, just waiting logic wraps here or we just wait
                    await this.browser.randomDelay(1000, 2000);
                },
                async () => {
                    const url = page.url();
                    if (url.includes('notebook') && url !== 'https://notebooklm.google.com/') {
                        notebookUrl = url;
                        return true;
                    }
                    return false;
                },
                { maxRetries: 10, retryDelay: 2000 } // Extended wait essentially
            );

            if (!successUrl || !notebookUrl) {
                steps.push('❌ Failed to capture new notebook URL');
                throw new Error('Notebook creation failed or timed out');
            }

            steps.push(`✓ Notebook URL captured: ${notebookUrl}`);
            return notebookUrl;

        } catch (error) {
            steps.push(`⚠ Create notebook error: ${(error as Error).message}`);
            return undefined;
        }
    }

    /**
     * Upload source files to the current notebook.
     */
    private async uploadSources(page: Page, files: string[], steps: string[]): Promise<void> {
        try {
            // ACTION 1: Ensure "Add Sources" modal is ready (cleaning up old ones first if needed)
            await this.browser.performAction(
                'Clean up existing modals',
                async () => {
                    const modalOpen = await page.$('.mat-mdc-dialog-container, mat-dialog-container');
                    if (modalOpen) {
                        await page.click('body'); // Click outside to close
                    }
                },
                async () => {
                    const modal = await page.$('.mat-mdc-dialog-container, mat-dialog-container');
                    return !modal;
                }
            );

            // ACTION 1.5: Delete existing sources if any
            await this.browser.performAction(
                'Delete Existing Sources',
                async () => {
                    // Loop until no more source menu buttons exist
                    // We trust the validation step to fail eventually if we get stuck, but we'll add a safety break
                    let attempts = 0;
                    const MAX_SOURCE_DELETIONS = 50;

                    while (attempts < MAX_SOURCE_DELETIONS) {
                        // Find all menu buttons (DOM updates after each deletion)
                        const menuButtons = await page.$$('.source-item-more-button');
                        if (menuButtons.length === 0) {
                            console.log('[NotebookLM] No more sources to delete');
                            break;
                        }

                        console.log(`[NotebookLM] Deleting source ${attempts + 1}...`);

                        // Click the first menu button (more_vert icon)
                        await menuButtons[0].click();
                        await this.browser.randomDelay(500, 800);

                        // Click the "Remove source" button from the menu
                        const deleteButton = await page.$('button.more-menu-delete-source-button, button[jslog*="202052"]');
                        if (deleteButton) {
                            await deleteButton.click();
                            await this.browser.randomDelay(500, 800);

                            // Confirmation dialog appears - click the "Delete" button to confirm
                            const confirmButton = await page.$('button[type="submit"].submit, button.submit');
                            if (confirmButton) {
                                await confirmButton.click();
                                await this.browser.randomDelay(1000, 2000); // Wait for list to update
                            } else {
                                console.warn('[NotebookLM] Could not find confirmation button');
                                await page.keyboard.press('Escape'); // Close menu/modal if stuck
                            }
                        } else {
                            console.warn('[NotebookLM] Could not find delete option in menu');
                            await page.keyboard.press('Escape'); // Close menu
                        }

                        attempts++;
                    }
                },
                async () => {
                    // Validation: No source menu buttons should remain
                    const count = await page.evaluate(() => {
                        return document.querySelectorAll('.source-item-more-button').length;
                    });
                    return count === 0;
                },
                { maxRetries: 3 }
            );

            // ACTION 2: Open "Add Source" Modal
            const successOpen = await this.browser.performAction(
                'Open "Add Source" modal',
                async () => {
                    const addSourcesButton = await page.$('button[aria-label*="Add source"]');
                    if (addSourcesButton) {
                        await addSourcesButton.click();
                    } else {
                        throw new Error('Add source button not found');
                    }
                },
                async () => {
                    const modal = await page.$('.mat-mdc-dialog-container, mat-dialog-container');
                    return !!modal;
                },
                { maxRetries: 3 }
            );

            if (!successOpen) throw new Error('Failed to open Add Source modal');
            steps.push(`✓ Add sources modal opened`);

            // ACTION 3: Upload Files
            const successUpload = await this.browser.performAction(
                'Upload Files',
                async () => {
                    // Set up observer for file input
                    await page.evaluate(() => {
                        const observer = new MutationObserver((mutations) => {
                            mutations.forEach((mutation) => {
                                mutation.addedNodes.forEach((node) => {
                                    if (node instanceof HTMLInputElement && node.type === 'file') {
                                        node.style.display = 'block';
                                        node.style.opacity = '1';
                                        (window as any).__fileInput = node;
                                    }
                                });
                            });
                        });
                        observer.observe(document.body, { childList: true, subtree: true });
                    });

                    const uploadButton = await page.$('button[xapscottyuploadertrigger]');
                    if (!uploadButton) throw new Error('Upload button not found');

                    const [fileChooser] = await Promise.all([
                        page.waitForFileChooser(),
                        uploadButton.click()
                    ]);
                    await fileChooser.accept(files);
                },
                async () => {
                    // Validation: Check if sources are listed in the background or processing
                    // This is hard to validate instantly, so we might just assume success if no error
                    return true;
                },
                { maxRetries: 2 }
            );

            if (!successUpload) throw new Error('Failed to upload files');
            steps.push(`✓ Uploaded ${files.length} files`);

            // ACTION 4: Wait for Processing
            const successProcess = await this.browser.performAction(
                'Wait for Source Processing',
                async () => {
                    await this.browser.randomDelay(2000, 4000); // Wait loop handled by validator essentially
                },
                async () => {
                    const isProcessing = await page.evaluate(() => {
                        const loadingIndicators = document.querySelectorAll(
                            'mat-progress-spinner.loading-spinner, .loading-spinner-container'
                        );
                        return loadingIndicators.length > 0;
                    });
                    return !isProcessing;
                },
                { maxRetries: 20, retryDelay: 3000 } // Extended poll
            );

            if (!successProcess) steps.push('⚠ Timed out waiting for file processing (continuing anyway)');
            else steps.push('✓ Files processed');

            // ACTION 5: Close Modal
            await this.browser.performAction(
                'Close Add Source Modal',
                async () => {
                    await page.click('body');
                },
                async () => {
                    const modal = await page.$('.mat-mdc-dialog-container, mat-dialog-container');
                    return !modal;
                }
            );

        } catch (error) {
            steps.push(`❌ Upload error: ${(error as Error).message}`);
            throw error;
        }
    }

    /**
     * Navigate to the video/audio creation section.
     * THROWS on critical failures (button not found, modal not appearing, etc.)
     */
    private async navigateToVideoCreation(page: Page, steps: string[], config?: NotebookLMTestConfig): Promise<void> {
        // Look for Audio Overview or Studio tab
        const videoButtonSelectors = [
            'button[aria-label="Customize Video Overview"]',
            'button[aria-label*="Customize Video"]',
        ];

        let clicked = false;
        for (const selector of videoButtonSelectors) {
            try {
                const btn = await page.$(selector);
                if (btn) {
                    await btn.click();
                    clicked = true;
                    steps.push(`✓ Clicked video button: ${selector}`);
                    break;
                }
            } catch {
                continue;
            }
        }

        if (!clicked) {
            throw new Error('Video/Customize button not found - cannot proceed');
        }

        // Wait for the modal to appear
        const modalSelector = 'mat-dialog-container';
        try {
            await page.waitForSelector(modalSelector, { timeout: 5000 });
        } catch {
            throw new Error('Video modal did not appear after clicking button');
        }
        steps.push('✓ Opened video customization modal');
        await this.browser.randomDelay(1000, 2000);

        // 1. Click on Explainer
        const explainerClicked = await page.evaluate(() => {
            const radios = Array.from(document.querySelectorAll('mat-radio-button'));
            const explainer = radios.find(r => r.textContent?.includes('Explainer'));
            if (explainer) {
                const explainerInput = explainer.querySelector('input');
                if (explainerInput) {
                    explainerInput.click();
                    return true;
                }
            }
            return false;
        });

        if (explainerClicked) {
            steps.push('✓ Selected "Explainer" format');
            await this.browser.randomDelay(500, 1000);
        }
        // Explainer is optional, don't throw

        // 2. Click on Custom Visual Style
        const customStyleClicked = await page.evaluate(() => {
            const radios = Array.from(document.querySelectorAll('mat-radio-button'));
            const custom = radios.find(r => r.textContent?.includes('Custom'));
            if (custom) {
                const customInput = custom.querySelector('input');
                if (customInput) {
                    customInput.click();
                    return true;
                }
            }
            return false;
        });

        if (customStyleClicked) {
            steps.push('✓ Selected "Custom" visual style');
            await this.browser.randomDelay(500, 1000);

            // 3. Enter visual style if provided
            if (config?.visualStyle) {
                await new Promise(r => setTimeout(r, 500));
                const inputFound = await page.evaluate((styleText) => {
                    const textareas = Array.from(document.querySelectorAll('mat-dialog-container textarea'));
                    // @ts-ignore
                    const styleInput = textareas.find(t => t.placeholder && t.placeholder.includes('Try a story-like style'));
                    if (styleInput) {
                        // @ts-ignore
                        styleInput.value = styleText;
                        styleInput.dispatchEvent(new Event('input', { bubbles: true }));
                        styleInput.dispatchEvent(new Event('change', { bubbles: true }));
                        return true;
                    }
                    return false;
                }, config.visualStyle);

                if (inputFound) {
                    steps.push('✓ Entered custom visual style');
                }
            }
        }

        // 4. Enter steering prompt if provided
        if (config?.steeringPrompt) {
            const promptEntered = await page.evaluate((promptText) => {
                const textareas = Array.from(document.querySelectorAll('mat-dialog-container textarea'));
                // @ts-ignore
                const focusInput = textareas.find(t => (t.placeholder && t.placeholder.includes('Things to try')));
                if (focusInput) {
                    // @ts-ignore
                    focusInput.value = promptText;
                    focusInput.dispatchEvent(new Event('input', { bubbles: true }));
                    focusInput.dispatchEvent(new Event('change', { bubbles: true }));
                    return true;
                }
                return false;
            }, config.steeringPrompt);

            if (promptEntered) {
                steps.push('✓ Entered steering prompt');
            }
        }

        await this.browser.randomDelay(1000, 2000);

        // Click the "Generate" button - THIS IS CRITICAL
        const generateClicked = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('mat-dialog-container button'));
            const generateBtn = buttons.find(b => b.textContent?.includes('Generate'));
            if (generateBtn) {
                (generateBtn as HTMLElement).click();
                return true;
            }
            return false;
        });

        if (!generateClicked) {
            throw new Error('Generate button not found in modal - cannot trigger video creation');
        }

        steps.push('✓ Clicked "Generate" button');
        await this.browser.randomDelay(2000, 3000);
    }

    /**
     * Check if video generation is complete for a notebook.
     * @param notebookUrl URL of the notebook to check
     * @returns 'generating' | 'ready' | 'error'
     */
    public async checkVideoStatus(notebookUrl: string): Promise<'generating' | 'ready' | 'error'> {
        try {
            const page = await this.browser.getPage('notebooklm-test', notebookUrl);
            await this.browser.randomDelay(2000, 3000);

            // Look for video status indicators based on actual NotebookLM HTML
            const status = await page.evaluate(() => {
                // Check for GENERATING state:
                // - Button is disabled with class 'mat-mdc-button-disabled'
                // - Has rotating sync icon with class 'rotate'
                // - Contains text "Generating Video Overview..."
                const generatingButton = document.querySelector(
                    'button.mat-mdc-button-disabled mat-icon.sync.rotate, ' +
                    'button[disabled] mat-icon.rotate'
                );
                if (generatingButton) return 'generating';

                // Also check for "Generating" text
                const generatingText = document.querySelector('.artifact-title');
                if (generatingText?.textContent?.includes('Generating')) {
                    return 'generating';
                }

                // Check for READY state:
                // - Button is NOT disabled
                // - Has subscriptions icon (not sync)
                // - Has Play button (play_arrow icon)
                const subscriptionsIcon = document.querySelector(
                    'artifact-library-item mat-icon[data-mat-icon-type="font"]'
                );
                const playButton = document.querySelector(
                    'button[aria-label="Play"], button mat-icon'
                );

                // If subscriptions icon exists and Play button exists, video is ready
                if (subscriptionsIcon &&
                    subscriptionsIcon.textContent?.trim() === 'subscriptions' &&
                    playButton) {
                    return 'ready';
                }

                // Alternative ready check: look for non-disabled video button without rotating icon
                const videoButton = document.querySelector(
                    'artifact-library-item button:not([disabled])'
                );
                const noRotatingIcon = !document.querySelector('mat-icon.rotate');
                if (videoButton && noRotatingIcon) {
                    return 'ready';
                }

                // Check for error indicators
                const errorEl = document.querySelector(
                    '[class*="error"], [role="alert"], .generation-failed'
                );
                if (errorEl) return 'error';

                // Default to generating if no clear indicator
                return 'generating';
            });

            return status as 'generating' | 'ready' | 'error';

        } catch (error) {
            console.error('Error checking video status:', error);
            return 'error';
        }
    }

    /**
     * Download the completed video from a notebook.
     * @param notebookUrl URL of the notebook with the completed video
     * @param outputPath Path where the video should be saved
     * @param videoIndex 1-based index of the video to download (default 1)
     * @returns true if download was successful
     */
    public async downloadVideo(notebookUrl: string, outputPath: string, videoIndex: number = 1): Promise<boolean> {
        try {
            const page = await this.browser.getPage('notebooklm-test', notebookUrl);
            await this.browser.randomDelay(2000, 3000);

            // Ensure output directory exists
            const outputDir = path.dirname(outputPath);
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }

            // Set up download behavior using CDP
            const client = await page.createCDPSession();
            await client.send('Page.setDownloadBehavior', {
                behavior: 'allow',
                downloadPath: outputDir
            });

            // Try to find and click the download button via the "More" menu on the artifact card
            const downloadClicked = await page.evaluate(async (index) => {
                // 1. Find all "Video Overview" buttons (the rounded rectangle artifacts)
                // They have aria-description="Video Overview"
                const videoArtifacts = Array.from(document.querySelectorAll('button[aria-description="Video Overview"]'));

                if (videoArtifacts.length === 0) {
                    console.log('No "Video Overview" artifacts found.');
                    return false;
                }

                // Get target artifact based on index (1-based)
                const targetArtifact = videoArtifacts[index - 1] as HTMLElement;

                if (!targetArtifact) {
                    console.log(`Video artifact at index ${index} not found. Found ${videoArtifacts.length} total.`);
                    return false;
                }

                // 2. Find the "More" button (3 dots) INSIDE this artifact button
                const moreButton = targetArtifact.querySelector('button[aria-label="More"]') as HTMLElement;

                if (!moreButton) {
                    console.log('More button (3 dots) not found inside the video artifact.');
                    return false;
                }

                // 3. Click the "More" button to open the menu
                moreButton.click();

                // Wait a bit for the menu to open (simulated wait in browser context)
                await new Promise(resolve => setTimeout(resolve, 500));

                // 4. Find the "Download" menu item
                const menuItems = Array.from(document.querySelectorAll('.mat-mdc-menu-item'));
                const downloadItem = menuItems.find(item =>
                    item.textContent?.trim().includes('Download')
                ) as HTMLElement;

                if (downloadItem) {
                    downloadItem.click();
                    return true;
                }

                console.log('"Download" option not found in the menu.');
                return false;
            }, videoIndex);

            if (!downloadClicked) {
                console.log('Failed to initiate download via More menu, attempting generic fallback...');
            }

            if (!downloadClicked) {
                console.log('Download button not found, trying alternative methods...');

                // Try to extract video URL from page
                const videoUrl = await page.evaluate(() => {
                    const video = document.querySelector('video');
                    if (video?.src) return video.src;

                    const source = document.querySelector('video source');
                    if (source instanceof HTMLSourceElement) return source.src;

                    return null;
                });

                if (videoUrl) {
                    console.log(`Found video URL: ${videoUrl}`);
                    // Navigate directly to trigger download
                    await page.goto(videoUrl as string);
                    await this.browser.randomDelay(5000, 10000);
                    return true;
                }

                return false;
            }

            // Snapshot files before download
            const existingFiles = new Set(fs.readdirSync(outputDir));

            console.log('Download initiated, waiting for file...');

            // Wait for download to complete - polling for new file
            let newFile: string | undefined;
            const maxWaitTime = 60000; // 60s max wait for download
            const pollInterval = 2000;
            const startTime = Date.now();

            while (Date.now() - startTime < maxWaitTime) {
                await this.browser.randomDelay(pollInterval, pollInterval + 500);

                const currentFiles = fs.readdirSync(outputDir);
                const candidates = currentFiles.filter(f => !existingFiles.has(f) && (f.endsWith('.mp4') || f.endsWith('.webm') || f.endsWith('.mov')));

                if (candidates.length > 0) {
                    // Found a new file!
                    // Wait until it stops growing (simple check) or just assume done if not .crdownload (Chrome)
                    const candidate = candidates[0];
                    if (!candidate.endsWith('.crdownload') && !candidate.endsWith('.tmp')) {
                        // Double check file size stability? For now, just take it if it's a valid extension
                        newFile = candidate;
                        break;
                    }
                }
            }

            if (newFile) {
                // Rename to expected output path
                const downloadedPath = path.join(outputDir, newFile);

                if (downloadedPath !== outputPath && fs.existsSync(downloadedPath)) {
                    // Overwrite if exists
                    if (fs.existsSync(outputPath)) {
                        try { fs.unlinkSync(outputPath); } catch (e) { }
                    }
                    fs.renameSync(downloadedPath, outputPath);
                }
                console.log(`Video saved to: ${outputPath}`);
                return true;
            }

            console.log('Video file not found after download attempt');
            return false;

        } catch (error) {
            console.error('Error downloading video:', error);
            return false;
        }
    }
    /**
     * MODULE: Collect Videos
     * Checks video status and downloads all ready videos from a notebook.
     * Uses modular recovery: Open → Check → Download → Close, with 3 retries.
     * 
     * @param notebookUrl URL of the notebook to collect videos from
     * @param outputDir Directory to save videos
     * @param expectedVideoCount Number of videos expected (default 2)
     * @returns Array of downloaded video paths
     */
    public async collectVideos(
        notebookUrl: string,
        outputDir: string,
        expectedVideoCount: number = 2,
        profileId?: string
    ): Promise<{ downloaded: string[]; status: 'generating' | 'ready' | 'error' }> {
        if (profileId) {
            await this.browser.initialize({ profileId });
        }

        // Use folder name in service key to ensure each parallel operation gets its own tab
        const folderName = path.basename(path.dirname(outputDir)); // outputDir is typically "folder/output"
        const serviceKey = `notebooklm-collect-${folderName}`;

        return await this.browser.withModularRecovery(
            serviceKey,
            notebookUrl,
            async (page) => {
                const downloaded: string[] = [];

                // First, check overall status
                const status = await this.checkVideoStatusInternal(page);

                if (status === 'generating') {
                    console.log('[NotebookLM Collect] Videos still generating');
                    return { downloaded: [], status: 'generating' };
                }

                if (status === 'error') {
                    throw new Error('Video generation failed on NotebookLM');
                }

                // Count actual available video artifacts
                const actualVideoCount = await page.evaluate(() => {
                    const videoArtifacts = document.querySelectorAll('button[aria-description="Video Overview"]');
                    return videoArtifacts.length;
                });

                console.log(`[NotebookLM Collect] Found ${actualVideoCount} video artifact(s), expected ${expectedVideoCount}`);

                if (actualVideoCount === 0) {
                    throw new Error('No video artifacts found on the page');
                }

                if (actualVideoCount < expectedVideoCount) {
                    throw new Error(`Only ${actualVideoCount} video(s) found, expected ${expectedVideoCount}. Stopping folder processing.`);
                }

                // Download available videos (up to expected count)
                const videosToDownload = Math.min(actualVideoCount, expectedVideoCount);

                for (let i = 1; i <= videosToDownload; i++) {
                    const outputPath = path.join(outputDir, `notebooklm_video_${i}.mp4`);
                    const success = await this.downloadVideoInternal(page, outputPath, i);

                    if (success) {
                        downloaded.push(outputPath);
                        console.log(`[NotebookLM Collect] Downloaded video ${i}/${videosToDownload}`);
                    } else {
                        throw new Error(`Failed to download video ${i} - download button not found or download failed`);
                    }
                }

                return { downloaded, status: 'ready' };
            }
        );
    }

    /**
     * Internal check video status (operates on existing page)
     */
    private async checkVideoStatusInternal(page: Page): Promise<'generating' | 'ready' | 'error'> {
        await this.browser.randomDelay(2000, 3000);

        const status = await page.evaluate(() => {
            const generatingButton = document.querySelector(
                'button.mat-mdc-button-disabled mat-icon.sync.rotate, ' +
                'button[disabled] mat-icon.rotate'
            );
            if (generatingButton) return 'generating';

            const generatingText = document.querySelector('.artifact-title');
            if (generatingText?.textContent?.includes('Generating')) {
                return 'generating';
            }

            const subscriptionsIcon = document.querySelector(
                'artifact-library-item mat-icon[data-mat-icon-type="font"]'
            );
            const playButton = document.querySelector(
                'button[aria-label="Play"], button mat-icon'
            );

            if (subscriptionsIcon &&
                subscriptionsIcon.textContent?.trim() === 'subscriptions' &&
                playButton) {
                return 'ready';
            }

            const videoButton = document.querySelector(
                'artifact-library-item button:not([disabled])'
            );
            const noRotatingIcon = !document.querySelector('mat-icon.rotate');
            if (videoButton && noRotatingIcon) {
                return 'ready';
            }

            const errorEl = document.querySelector(
                '[class*="error"], [role="alert"], .generation-failed'
            );
            if (errorEl) return 'error';

            return 'generating';
        });

        return status as 'generating' | 'ready' | 'error';
    }

    /**
     * Internal download video (operates on existing page)
     */
    private async downloadVideoInternal(page: Page, outputPath: string, videoIndex: number): Promise<boolean> {
        const outputDir = path.dirname(outputPath);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const client = await page.createCDPSession();
        await client.send('Page.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: outputDir
        });

        const downloadClicked = await page.evaluate(async (index) => {
            const videoArtifacts = Array.from(document.querySelectorAll('button[aria-description="Video Overview"]'));
            if (videoArtifacts.length === 0) return false;

            const targetArtifact = videoArtifacts[index - 1] as HTMLElement;
            if (!targetArtifact) return false;

            const moreButton = targetArtifact.querySelector('button[aria-label="More"]') as HTMLElement;
            if (!moreButton) return false;

            moreButton.click();
            await new Promise(resolve => setTimeout(resolve, 500));

            const menuItems = Array.from(document.querySelectorAll('.mat-mdc-menu-item'));
            const downloadItem = menuItems.find(item =>
                item.textContent?.trim().includes('Download')
            ) as HTMLElement;

            if (downloadItem) {
                downloadItem.click();
                return true;
            }
            return false;
        }, videoIndex);

        if (!downloadClicked) {
            return false;
        }

        // Wait for download
        const existingFiles = new Set(fs.readdirSync(outputDir));
        let newFile: string | undefined;
        const maxWaitTime = 60000;
        const pollInterval = 2000;
        const startTime = Date.now();

        while (Date.now() - startTime < maxWaitTime) {
            await this.browser.randomDelay(pollInterval, pollInterval + 500);

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

        if (newFile) {
            const downloadedPath = path.join(outputDir, newFile);
            if (downloadedPath !== outputPath && fs.existsSync(downloadedPath)) {
                if (fs.existsSync(outputPath)) {
                    try { fs.unlinkSync(outputPath); } catch (e) { }
                }
                fs.renameSync(downloadedPath, outputPath);
            }
            return true;
        }

        return false;
    }


    public async close(): Promise<void> {
        await this.browser.closePage('notebooklm-test');
        await this.browser.closePage('notebooklm-setup');
        await this.browser.closePage('notebooklm-video');
        await this.browser.closePage('notebooklm-collect');
    }
}
