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
                        .filter(f => /\.(pdf|txt|md|docx?|jpe?g|png|gif|webp|bmp)$/i.test(f))
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
                } else if (alreadyUploaded) {
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

            // Step 1: Click the "Create new" or "New notebook" button
            const createButtonSelectors = [
                '.create-new-action-button-icon-container',  // Actual NotebookLM button
                'mat-icon.create-new-action-button-icon',    // The mat-icon inside
                'button[aria-label*="Create"]',
                'button[aria-label*="New"]',
                '[data-testid="create-notebook"]'
            ];

            let createClicked = false;
            for (const selector of createButtonSelectors) {
                try {
                    const btn = await page.$(selector);
                    if (btn) {
                        await btn.click();
                        createClicked = true;
                        steps.push(`✓ Clicked create button`);
                        break;
                    }
                } catch {
                    continue;
                }
            }

            if (!createClicked) {
                // Try clicking via evaluate for more flexibility
                createClicked = await page.evaluate(() => {
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
            }

            if (!createClicked) {
                steps.push('⚠ Create button not found');
                return undefined;
            }

            await this.browser.randomDelay(2000, 3000);

            // Step 2: Enter the notebook name (folder name)
            // Look for an input field for notebook title
            const titleInputSelectors = [
                'input.title-input',                    // Actual NotebookLM title input
                'input.title-input.mat-title-large',    // More specific
                'input[aria-label*="title"]',
                'input[aria-label*="name"]',
                'input[placeholder*="Untitled"]',
                'input[type="text"]'
            ];

            let titleEntered = false;
            for (const selector of titleInputSelectors) {
                try {
                    const input = await page.$(selector);
                    if (input) {
                        // First click closes the modal
                        await input.click();
                        await this.browser.randomDelay(500, 800);

                        // Second click makes the input editable
                        await input.click({ clickCount: 3 });
                        await this.browser.randomDelay(200, 400);

                        // Clear any existing content
                        await page.keyboard.press('Backspace');
                        await this.browser.randomDelay(200, 400);

                        // Type folder name
                        await page.keyboard.type(folderName);
                        titleEntered = true;
                        steps.push(`✓ Entered notebook name: "${folderName}"`);
                        break;
                    }
                } catch {
                    continue;
                }
            }

            if (!titleEntered) {
                // Try via evaluate for contenteditable elements
                titleEntered = await page.evaluate((name) => {
                    const editables = document.querySelectorAll('[contenteditable="true"]');
                    if (editables.length > 0) {
                        const el = editables[0] as HTMLElement;
                        el.focus();
                        el.textContent = name;
                        return true;
                    }
                    return false;
                }, folderName);

                if (titleEntered) {
                    steps.push(`✓ Entered notebook name via contenteditable`);
                }
            }

            await this.browser.randomDelay(1000, 2000);

            // Step 3: Click Create/Save/Confirm button if present
            //THis will actually hit the submit button on the chat, but 
            //nothing would happen as the text there would be empty
            const confirmSelectors = [
                'button[type="submit"]',
                'button:has-text("Create")',
                'button:has-text("Save")',
                'button:has-text("Done")',
                'button[aria-label*="Create"]',
                'button[aria-label*="Save"]'
            ];

            for (const selector of confirmSelectors) {
                try {
                    const btn = await page.$(selector);
                    if (btn) {
                        await btn.click();
                        steps.push(`✓ Clicked confirm button`);
                        break;
                    }
                } catch {
                    continue;
                }
            }

            await this.browser.randomDelay(3000, 5000);

            // Step 4: Wait for the notebook to load and capture URL
            // The URL should change to include the notebook ID
            let notebookUrl: string | undefined;
            const maxWait = 30000; // 30 seconds
            const startTime = Date.now();

            while (Date.now() - startTime < maxWait) {
                const currentUrl = page.url();
                if (currentUrl.includes('notebook') && currentUrl !== NOTEBOOKLM_URL) {
                    notebookUrl = currentUrl;
                    break;
                }
                await this.browser.randomDelay(1000, 1500);
            }

            if (notebookUrl) {
                steps.push(`✓ Notebook URL captured: ${notebookUrl}`);
                return notebookUrl;
            } else {
                steps.push('⚠ Could not capture notebook URL - may need to click on notebook');

                // Try to find and click on the newly created notebook by name
                const notebookClicked = await page.evaluate((name) => {
                    const elements = Array.from(document.querySelectorAll('*'));
                    const notebookEl = elements.find(el =>
                        el.textContent?.trim() === name ||
                        el.textContent?.includes(name)
                    );
                    if (notebookEl && notebookEl instanceof HTMLElement) {
                        notebookEl.click();
                        return true;
                    }
                    return false;
                }, folderName);

                if (notebookClicked) {
                    await this.browser.randomDelay(3000, 5000);
                    notebookUrl = page.url();
                    if (notebookUrl.includes('notebook')) {
                        steps.push(`✓ Clicked on notebook and captured URL: ${notebookUrl}`);
                        return notebookUrl;
                    }
                }
            }

            return undefined;

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
            // First, check if the "Add sources" modal is already open and close it
            const modalOpen = await page.$('.mat-mdc-dialog-container, mat-dialog-container');
            if (modalOpen) {
                steps.push(`⚠ Add sources modal is already open, closing it first...`);

                // Try to click the close button within the modal
                const closeButton = await modalOpen.$('button[aria-label="Close"], button.close-button');
                if (closeButton) {
                    await closeButton.click();
                    await this.browser.randomDelay(500, 800);
                    steps.push(`✓ Closed existing modal`);
                } else {
                    // Fallback: click outside the modal
                    await page.click('body');
                    await this.browser.randomDelay(500, 800);
                    steps.push(`✓ Closed modal by clicking outside`);
                }
            }

            // Check if sources already exist and delete them to avoid duplicates
            const existingSources = await page.$$('.source-item-more-button');

            if (existingSources.length > 0) {
                steps.push(`⚠ Found ${existingSources.length} existing sources, deleting to avoid duplicates...`);

                // Delete each source by clicking its menu button, then delete button
                for (let i = 0; i < existingSources.length; i++) {
                    try {
                        // Find all menu buttons again (DOM updates after each deletion)
                        const menuButtons = await page.$$('.source-item-more-button');
                        if (menuButtons.length === 0) break;

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
                                await this.browser.randomDelay(800, 1200);
                                steps.push(`✓ Deleted source ${i + 1}/${existingSources.length}`);
                            } else {
                                steps.push(`⚠ Could not find confirmation button for source ${i + 1}`);
                            }
                        } else {
                            steps.push(`⚠ Could not find delete button for source ${i + 1}`);
                            // Press Escape to close menu
                            await page.keyboard.press('Escape');
                            await this.browser.randomDelay(300, 500);
                        }
                    } catch (e) {
                        steps.push(`⚠ Error deleting source ${i + 1}: ${(e as Error).message}`);
                    }
                }

                steps.push(`✓ Finished deleting existing sources`);
                await this.browser.randomDelay(1000, 2000);
            }

            // Open the add sources modal
            const addSourcesButton = await page.$('button[aria-label*="Add source"]');
            if (addSourcesButton) {
                await addSourcesButton.click();
                steps.push(`✓ Clicked Add sources button`);
                await this.browser.randomDelay(1000, 2000);

                // Wait for modal to appear
                await page.waitForSelector('.mat-mdc-dialog-container, mat-dialog-container', { timeout: 5000 });
                steps.push(`✓ Add sources modal opened`);
            } else {
                steps.push(`⚠ Could not find Add sources button`);
                throw new Error('Add sources button not found');
            }

            // We need to trigger the file input to be added to DOM first
            // Click upload button, but use setInput method to set files without native dialog
            const uploadButton = await page.$('button[xapscottyuploadertrigger]');
            if (!uploadButton) {
                steps.push(`⚠ Could not find Upload files button`);
                throw new Error('Upload files button not found');
            }

            // Use page.evaluate to set up a listener before clicking
            // This will capture the file input as soon as it's added
            await page.evaluate(() => {
                // Override the click on file input to prevent native dialog
                const observer = new MutationObserver((mutations) => {
                    mutations.forEach((mutation) => {
                        mutation.addedNodes.forEach((node) => {
                            if (node instanceof HTMLInputElement && node.type === 'file') {
                                // Prevent the native dialog from opening by removing click behavior
                                node.style.display = 'block';
                                node.style.opacity = '1';
                                (window as any).__fileInput = node;
                            }
                        });
                    });
                });
                observer.observe(document.body, { childList: true, subtree: true });
                (window as any).__inputObserver = observer;
            });

            // Use waitForFileChooser to intercept the file dialog
            // This prevents the native dialog from appearing
            const [fileChooser] = await Promise.all([
                page.waitForFileChooser(),
                uploadButton.click()
            ]);
            steps.push(`✓ Clicked Upload files button`);

            steps.push(`✓ Intercepted file chooser`);

            // Accept the files without showing native dialog
            await fileChooser.accept(files);
            steps.push(`✓ Uploaded ${files.length} files`);

            // Wait for upload to process
            await this.browser.randomDelay(3000, 5000);

            // Wait for processing indicators to disappear
            let processingCount = 0;
            const maxWait = 120000; // 2 minutes
            const startTime = Date.now();

            while (Date.now() - startTime < maxWait) {
                const isProcessing = await page.evaluate(() => {
                    // Look for NotebookLM loading/processing indicators
                    const loadingIndicators = document.querySelectorAll(
                        'mat-progress-spinner.loading-spinner, .loading-spinner-container'
                    );
                    return loadingIndicators.length > 0;
                });

                if (!isProcessing) {
                    break;
                }

                processingCount++;
                if (processingCount % 10 === 0) {
                    steps.push(`⏳ Still processing files...`);
                }

                await this.browser.randomDelay(1000, 2000);
            }

            steps.push(`✓ Files processed`);

            // Close the Add sources modal by clicking outside
            try {
                await page.click('body');
                await this.browser.randomDelay(1000, 2000);
                steps.push(`✓ Closed Add sources modal`);
            } catch (e) {
                steps.push(`⚠ Could not close modal: ${(e as Error).message}`);
            }

        } catch (error) {
            steps.push(`❌ Upload error: ${(error as Error).message}`);
            throw error;
        }
    }

    /**
     * Navigate to the video/audio creation section.
     */
    private async navigateToVideoCreation(page: Page, steps: string[], config?: NotebookLMTestConfig): Promise<void> {
        try {
            // Look for Audio Overview or Studio tab
            const videoButtonSelectors = [
                'button[aria-label="Customize Video Overview"]', // User identified correct button
                'button[aria-label*="Customize Video"]',
            ];

            let clicked = false;
            for (const selector of videoButtonSelectors) {
                try {
                    const btn = await page.$(selector);
                    if (btn) {
                        await btn.click();
                        clicked = true;
                        steps.push(`✓ Clicked video/audio button: ${selector}`);
                        break;
                    }
                } catch {
                    continue;
                }
            }


            if (clicked) {
                steps.push('✓ Clicked "Customize Video Overview" button');

                // Wait for the modal to appear
                try {
                    const modalSelector = 'mat-dialog-container';
                    await page.waitForSelector(modalSelector, { timeout: 5000 });
                    steps.push('✓ Opened "Customize Video Overview" modal');
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
                    } else {
                        steps.push('⚠ Could not find "Explainer" option');
                    }

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

                        // 3. Put the visual style from settings in the custom visual style input
                        if (config?.visualStyle) {
                            // Look for the input that appears for Custom style
                            await new Promise(r => setTimeout(r, 500)); // Wait for input to appear
                            const inputFound = await page.evaluate((styleText) => {
                                const textareas = Array.from(document.querySelectorAll('mat-dialog-container textarea'));
                                // @ts-ignore - Valid JS at runtime, textarea has placeholder
                                const styleInput = textareas.find(t => t.placeholder && t.placeholder.includes('Try a story-like style'));

                                if (styleInput) {
                                    // @ts-ignore - Valid JS at runtime
                                    styleInput.value = styleText;
                                    styleInput.dispatchEvent(new Event('input', { bubbles: true }));
                                    styleInput.dispatchEvent(new Event('change', { bubbles: true }));
                                    return true;
                                }
                                return false;
                            }, config.visualStyle);

                            if (inputFound) {
                                steps.push('✓ Entered custom visual style');
                            } else {
                                steps.push('⚠ Could not find input for custom visual style');
                            }
                        }
                    } else {
                        steps.push('⚠ Could not find "Custom" visual style option');
                    }

                    // 4. Put the steering prompt created by perplexity in what should the AI focus on
                    if (config?.steeringPrompt) {
                        const promptEntered = await page.evaluate((promptText) => {
                            const textareas = Array.from(document.querySelectorAll('mat-dialog-container textarea'));
                            // @ts-ignore - Valid JS at runtime, textarea has placeholder
                            const focusInput = textareas.find(t => (t.placeholder && t.placeholder.includes('Things to try')));

                            if (focusInput) {
                                // @ts-ignore - Valid JS at runtime
                                focusInput.value = promptText;
                                focusInput.dispatchEvent(new Event('input', { bubbles: true }));
                                focusInput.dispatchEvent(new Event('change', { bubbles: true }));
                                return true;
                            }
                            return false;
                        }, config.steeringPrompt);

                        if (promptEntered) {
                            steps.push('✓ Entered steering prompt');
                        } else {
                            steps.push('⚠ Could not find "What should AI focus on" input');
                        }
                    }

                    await this.browser.randomDelay(1000, 2000);

                    // Click the "Generate" button inside the modal
                    const generateClicked = await page.evaluate(() => {
                        const buttons = Array.from(document.querySelectorAll('mat-dialog-container button'));
                        const generateBtn = buttons.find(b => b.textContent?.includes('Generate'));
                        if (generateBtn) {
                            (generateBtn as HTMLElement).click();
                            return true;
                        }
                        return false;
                    });

                    if (generateClicked) {
                        steps.push('✓ Clicked "Generate" button');
                        await this.browser.randomDelay(2000, 3000);

                        // Mark step as complete explicitly since multiple things happen here
                        // Actually, progress tracking handles 'notebooklm_video_started' separately? 
                        // We'll let the caller handle progress tracking updates if needed, 
                        // but for now just logging it is enough.
                    } else {
                        steps.push('⚠ Could not find "Generate" button in modal');
                    }
                } catch (e) {
                    steps.push(`⚠ Modal did not appear or error interacting: ${(e as Error).message}`);
                }

            } else {
                steps.push('⚠ Audio/Studio/Customize button not found - may need manual navigation');
            }

        } catch (error) {
            steps.push(`⚠ Navigation error: ${(error as Error).message}`);
        }
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


    public async close(): Promise<void> {
        await this.browser.closePage('notebooklm-test');
    }
}
