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
    visualStyle?: string;         // Visual style description
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
            await this.browser.initialize({ headless: config.headless });

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
                    // Fallback: Read from perplexity_response.txt file directly
                    const perplexityResponsePath = path.join(config.sourceFolder, 'output', 'perplexity_response.txt');
                    if (fs.existsSync(perplexityResponsePath)) {
                        try {
                            config.steeringPrompt = fs.readFileSync(perplexityResponsePath, 'utf-8');
                            steps.push(`✓ Loaded steering prompt from perplexity_response.txt`);
                        } catch (e) {
                            steps.push(`⚠ Could not read perplexity_response.txt: ${(e as Error).message}`);
                        }
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
            if (!config.existingNotebookUrl) {
                const folderName = path.basename(config.sourceFolder);
                notebookUrl = await this.createNotebook(page, folderName, steps);

                if (notebookUrl) {
                    // Save progress
                    ProgressTracker.markStepComplete(config.sourceFolder, 'notebooklm_notebook_created', {
                        notebookUrl
                    });
                    steps.push(`✓ Notebook created: ${notebookUrl}`);
                }
            } else {
                notebookUrl = config.existingNotebookUrl;
                steps.push(`✓ Using existing notebook: ${notebookUrl}`);
            }

            // Step 2: Upload sources
            if (filesToUpload.length > 0) {
                // Check if sources are already uploaded
                if (config.sourceFolder && ProgressTracker.isStepComplete(config.sourceFolder, 'notebooklm_sources_uploaded')) {
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

            ProgressTracker.markStepComplete(config.sourceFolder, 'notebooklm_video_started');

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

    public async close(): Promise<void> {
        await this.browser.closePage('notebooklm-test');
    }
}
