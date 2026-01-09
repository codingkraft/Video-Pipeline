import { Page } from 'puppeteer';
import { CaptiveBrowser } from '../browser/CaptiveBrowser';
import { ProgressTracker } from './ProgressTracker';
import * as path from 'path';
import * as fs from 'fs';

const PERPLEXITY_URL = 'https://www.perplexity.ai/';

export interface PerplexityTestConfig {
    chatUrl?: string;
    files: string[];
    prompt: string;
    outputDir?: string;
    sourceFolder?: string;
    headless?: boolean;
    shouldDeleteConversation?: boolean;
    model?: string; // NEW: The model to use (e.g. "GPT-5.2")
    profileId?: string; // Browser profile to use
    outputFilename?: string; // Custom output filename (without extension)
}

export class PerplexityTester {
    private browser: CaptiveBrowser;

    constructor() {
        this.browser = CaptiveBrowser.getInstance();
    }

    /**
     * Test the complete Perplexity workflow with EXACT selectors from HTML analysis
     */
    public async testWorkflow(config: PerplexityTestConfig): Promise<{ success: boolean; message: string; details?: any }> {
        try {
            await this.browser.initialize({
                headless: config.headless,
                profileId: config.profileId || 'default'
            });

            const page = await this.browser.getPage('perplexity-test', config.chatUrl || PERPLEXITY_URL);
            await this.browser.randomDelay(2000, 3000);

            const steps: string[] = [];
            const jobId = `job_${Date.now()}`;

            // Resolve file paths if sourceFolder is provided
            let filesToUpload = config.files;
            if (config.sourceFolder && config.files.length > 0) {
                // If we have a source folder, ensure files are absolute paths
                filesToUpload = config.files.map(f => {
                    return path.isAbsolute(f) ? f : path.join(config.sourceFolder!, f);
                });
            }

            // Determine output directory:
            // 1. Use explicit outputDir if provided
            // 2. Use sourceFolder if provided (this is the Local Mode)
            // 3. Fall back to first file's directory
            // 4. Fall back to project output folder
            // NOTE: No job-specific subfolder - files will overwrite on each run
            let outputDir: string;
            if (config.outputDir) {
                outputDir = path.join(config.outputDir, 'output');
            } else if (config.sourceFolder) {
                // Local Mode: Save in sourceFolder/output/
                outputDir = path.join(config.sourceFolder, 'output');
            } else if (filesToUpload && filesToUpload.length > 0) {
                // Save output inside the source folder's 'output' subfolder
                const sourceFolder = path.dirname(filesToUpload[0]);
                outputDir = path.join(sourceFolder, 'output');
            } else {
                outputDir = path.join(process.cwd(), 'output');
            }

            // Output directory is ready - files will be overwritten if they exist

            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }
            steps.push(`✓ Output will be saved to: ${outputDir}`);

            // Step 1: Navigate
            if (config.chatUrl) {
                steps.push(`✓ Navigated to: ${config.chatUrl}`);
            } else {
                steps.push('✓ Opened Perplexity home');
            }

            // Step 2: Select Search mode
            // HTML: <button role="radio" value="search" aria-checked="true|false">
            try {
                steps.push('⏳ Checking Search mode...');

                const searchButton = await page.$('button[value="search"][role="radio"]');
                if (searchButton) {
                    const isChecked = await page.evaluate(el => el.getAttribute('aria-checked'), searchButton);
                    if (isChecked === 'true') {
                        steps.push('✓ Search mode already selected');
                    } else {
                        await searchButton.click();
                        await this.browser.randomDelay(500, 1000);
                        steps.push('✓ Selected Search mode');
                    }
                } else {
                    // Not a critical failure - may be on different UI
                    steps.push('⚠ Search mode button not found (may be different UI)');
                }
                await this.browser.randomDelay(500, 1000);
            } catch (error) {
                steps.push(`⚠ Mode selection: ${(error as Error).message}`);
            }

            // Step 2.5: Select Model (if configured and not default)
            if (config.model && config.model !== 'Best') {
                try {
                    steps.push(`⏳ Selecting model: ${config.model}...`);

                    // 1. Find and click the model trigger (button with CPU icon)
                    const triggerClicked = await page.evaluate(() => {
                        // Find all buttons containing the CPU icon
                        const buttons = Array.from(document.querySelectorAll('button'));
                        const cpuButtons = buttons.filter(b => {
                            const useElement = b.querySelector('svg use');
                            if (useElement) {
                                const href = useElement.getAttribute('xlink:href') || useElement.getAttribute('href');
                                return href && href.includes('pplx-icon-cpu');
                            }
                            return false;
                        });

                        // Use the LAST button with CPU icon on the page
                        if (cpuButtons.length > 0) {
                            const targetBtn = cpuButtons[cpuButtons.length - 1];
                            targetBtn.click();
                            return true;
                        }
                        return false;
                    });

                    if (triggerClicked) {
                        await this.browser.randomDelay(1000, 1500);

                        // 2. Select the specific model from the menu
                        const modelSelected = await page.evaluate((modelName) => {
                            const items = Array.from(document.querySelectorAll('div[role="menuitem"]'));
                            const targetItem = items.find(item => item.textContent?.includes(modelName));

                            if (targetItem) {
                                (targetItem as HTMLElement).click();
                                return true;
                            }
                            return false;
                        }, config.model);

                        if (modelSelected) {
                            steps.push(`✓ Model selected: ${config.model}`);
                        } else {
                            steps.push(`⚠ Could not find model "${config.model}" in menu`);
                            // Try to close menu by clicking body (soft fail)
                            await page.evaluate(() => document.body.click());
                        }
                    } else {
                        steps.push('⚠ Could not find model selector button');
                    }
                    await this.browser.randomDelay(1000, 1500);
                } catch (err) {
                    steps.push(`⚠ Model selection failed: ${(err as Error).message}`);
                }
            }

            // (Old hardcoded Step 3 removed - replaced by Step 2.5 generic model selection)

            // Step 4: Attach files
            // HTML: <input data-testid="file-upload-input" type="file" ...>
            if (filesToUpload && filesToUpload.length > 0) {
                try {
                    steps.push(`⏳ Uploading ${filesToUpload.length} file(s)...`);

                    const fileInput = await page.$('input[data-testid="file-upload-input"]');

                    if (fileInput) {
                        const inputElement = fileInput as import('puppeteer').ElementHandle<HTMLInputElement>;

                        // Clear file input value before uploading (fixes repeat run issues)
                        await page.evaluate((el) => { (el as HTMLInputElement).value = ''; }, fileInput);

                        await inputElement.uploadFile(...filesToUpload);
                        steps.push(`✓ Attached ${filesToUpload.length} file(s)`);

                    }
                    if (filesToUpload.length > 0) {
                        steps.push('⏳ Waiting for files to upload...');

                        // Wait for file loading spinner to appear and then disappear
                        try {
                            // Wait for spinner to appear (indicates upload started)
                            await page.waitForSelector('[data-testid="file-loading-icon"]', { timeout: 5000 });
                            steps.push('📤 Upload in progress...');

                            // Wait for spinner to disappear (indicates upload complete)
                            await page.waitForSelector('[data-testid="file-loading-icon"]', { hidden: true, timeout: 30000 });
                            steps.push('✓ Files uploaded');
                        } catch (e) {
                            // Fallback to delay if spinner detection fails
                            steps.push('⚠ Could not detect upload spinner, using fallback delay');
                            await this.browser.randomDelay(3000, 5000);
                            steps.push('✓ Files uploaded (fallback)');
                        }

                        await this.browser.randomDelay(2000, 3000);
                    } else {
                        throw new Error('File upload input not found');
                    }
                } catch (error) {
                    throw new Error(`File attachment failed: ${(error as Error).message}`);
                }
            }

            // Step 5: Enter prompt
            // Method 3: Clipboard Paste (Most reliable for rich text editors)
            // 1. Copy to clipboard using Puppeteer
            // 2. Focus input
            // 3. Paste (Ctrl+V)
            try {
                steps.push('⏳ Entering prompt...');

                // Focus and clear first
                await page.click('#ask-input');
                await this.browser.randomDelay(200, 400);

                await page.keyboard.down('Control');
                await page.keyboard.press('KeyA');
                await page.keyboard.up('Control');
                await page.keyboard.press('Backspace');

                await this.browser.randomDelay(200, 400);

                // Copy text to clipboard (using explicit browser permissions if needed, but usually works in Puppeteer)
                await page.evaluate((text) => {
                    const input = document.createElement('textarea');
                    input.value = text;
                    document.body.appendChild(input);
                    input.select();
                    document.execCommand('copy');
                    document.body.removeChild(input);
                }, config.prompt);

                // Focus again before pasting
                await page.click('#ask-input');
                await this.browser.randomDelay(200, 400);

                // Paste
                await page.keyboard.down('Control');
                await page.keyboard.press('KeyV');
                await page.keyboard.up('Control');

                steps.push(`✓ Pasted prompt via Clipboard`);

                await this.browser.randomDelay(2000, 3000);

                // VERIFY text is present before continuing
                let hasText = await page.evaluate(() => {
                    const el = document.querySelector('#ask-input');
                    return el && el.textContent && el.textContent.trim().length > 0;
                });

                if (!hasText) {
                    steps.push('⚠ Text verification failed - retrying paste...');
                    // Retry paste once
                    await page.click('#ask-input');
                    await page.keyboard.down('Control');
                    await page.keyboard.press('KeyV');
                    await page.keyboard.up('Control');

                    await this.browser.randomDelay(1000, 2000);

                    hasText = await page.evaluate(() => {
                        const el = document.querySelector('#ask-input');
                        return el && el.textContent && el.textContent.trim().length > 0;
                    });
                }

                if (hasText) {
                    steps.push('✓ Verified prompt text is present');
                } else {
                    throw new Error('Failed to set prompt text after retry');
                }

                // Important: Wait for UI to process the text and enable the submit button
                await this.browser.randomDelay(2000, 3000);

            } catch (error) {
                throw new Error(`Prompt entry failed: ${(error as Error).message}`);
            }

            // Step 6: Submit - ONLY use button click, never Enter key
            try {
                steps.push('⏳ Submitting query...');

                // Wait for button to become enabled (up to 5 seconds)
                let submitted = false;
                for (let i = 0; i < 5; i++) {
                    submitted = await page.evaluate(() => {
                        const submitBtn = document.querySelector('button[aria-label="Submit"]') as HTMLButtonElement;
                        if (submitBtn && !submitBtn.disabled) {
                            submitBtn.click();
                            return true;
                        }
                        return false;
                    });

                    if (submitted) break;
                    await this.browser.randomDelay(1000, 1500);
                }

                if (submitted) {
                    steps.push('✓ Submitted via button');
                } else {
                    throw new Error('Submit button stuck disabled or not found');
                }

                await this.browser.randomDelay(3000, 5000);
            } catch (error) {
                throw new Error(`Submit failed: ${(error as Error).message}`);
            }

            // Step 7: Wait for response
            steps.push('⏳ Waiting for Perplexity response (max 2 mins)...');
            let responseText = '';

            try {
                // 1. Wait for answer container to appear
                await page.waitForSelector('[class*="prose"]', { timeout: 60000 });
                steps.push('✓ Response started streaming...');

                // 2. Poll for text stability (wait until text stops changing)
                let lastLength = 0;
                let lastProseCount = 0;
                let stableCount = 0;
                const maxWait = 600000; // 10 minutes
                const startTime = Date.now();

                while (Date.now() - startTime < maxWait) {
                    const { text: currentText, proseCount } = await page.evaluate(() => {
                        // Use data-state="active" to find conversation turns
                        const activeDivs = document.querySelectorAll('div[data-state="active"]');
                        if (activeDivs.length === 0) return { text: '', proseCount: 0 };

                        // Get the LAST active div (most recent turn)
                        const lastActive = activeDivs[activeDivs.length - 1];

                        // Find the prose content within this last active div
                        const prose = lastActive.querySelector('[class*="prose"]');
                        return {
                            text: prose ? (prose.textContent || '') : '',
                            proseCount: document.querySelectorAll('[class*="prose"]').length
                        };
                    });

                    // If prose count increased, reset stability (new content being added)
                    if (proseCount > lastProseCount) {
                        stableCount = 0;
                        lastProseCount = proseCount;
                        lastLength = currentText.length;
                    } else if (currentText.length > 0 && currentText.length === lastLength) {
                        stableCount++;
                        // We rely entirely on "Stop generating" button absence for completion.
                        // The global maxWait (10 min) handles effectively stuck processes.
                    } else {
                        stableCount = 0;
                        lastLength = currentText.length;
                    }

                    // Check if "Stop generating" button is gone
                    const isGenerating = await page.evaluate(() => {
                        return !!document.querySelector('button[aria-label="Stop generating response"]');
                    });

                    // PRIMARY CHECK: Done if no longer generating AND text is stable for a few seconds
                    if (!isGenerating && stableCount >= 3) {
                        responseText = currentText;
                        break;
                    }

                    await this.browser.randomDelay(1000, 1000);
                }

                // Check if we timed out without getting a response
                if (!responseText || responseText.length < 50) {
                    throw new Error('Response timeout: Perplexity did not generate a response within 10 minutes');
                }

                steps.push(`✓ Response captured (${responseText.length} chars)`);
            } catch (error) {
                steps.push(`⚠ Response extraction: ${(error as Error).message}`);
                responseText = await page.evaluate(() => document.body.innerText);
            }

            // Step 8: Save
            // Clean up extra blank lines (textContent can include many newlines from nested HTML)
            let cleanedResponse = responseText
                .split('\n')
                .map(line => line.trim())
                .filter((line, index, arr) => {
                    // Keep non-empty lines, and only keep one blank line between sections
                    if (line !== '') return true;
                    // Check if previous line was also empty - if so, filter this one out
                    return index === 0 || arr[index - 1] !== '';
                })
                .join('\n')
                .trim();

            // Remove 'text' from the beginning if it starts with exactly those 4 characters (case-sensitive)
            if (cleanedResponse.startsWith('text')) {
                cleanedResponse = cleanedResponse.substring(4).trim();
            }

            // Use custom filename or default to 'perplexity_video_response'
            const outputBasename = config.outputFilename || 'perplexity_video_response';
            const responseFilePath = path.join(outputDir, `${outputBasename}.txt`);
            fs.writeFileSync(responseFilePath, cleanedResponse, 'utf-8');
            steps.push(`✓ Response saved to: ${responseFilePath}`);

            // Update progress tracker
            const sourceFolder = config.sourceFolder || (filesToUpload && filesToUpload.length > 0 ? path.dirname(filesToUpload[0]) : null);
            if (sourceFolder) {
                ProgressTracker.markStepComplete(sourceFolder, 'perplexity', {
                    outputFile: `${outputBasename}.txt`,
                    steeringPrompt: cleanedResponse  // Save for NotebookLM to use
                });
                steps.push('✓ Progress saved (including steering prompt)');
            }

            const screenshotPath = path.join(outputDir, `${outputBasename}_screenshot.png`);

            // Scroll to bottom before screenshot
            await page.evaluate(() => {
                window.scrollTo(0, document.body.scrollHeight);
            });
            await this.browser.randomDelay(1000, 2000); // Wait for any lazy load

            await page.screenshot({ path: screenshotPath, fullPage: true });
            steps.push(`✓ Screenshot saved: ${screenshotPath}`);

            // Step 9: Cleanup (Delete response) if requested
            if (config.shouldDeleteConversation) {
                try {
                    steps.push('⏳ Cleaning up (deleting conversation)...');

                    // Find "More actions" button SPECIFICALLY within the last active response
                    // Get all active divs and find the button in the last one
                    const activeDivs = await page.$$('div[data-state="active"]');
                    let btnElement = null;

                    if (activeDivs.length > 0) {
                        const lastActiveDiv = activeDivs[activeDivs.length - 1];
                        btnElement = await lastActiveDiv.$('button[aria-label="More actions"]');
                    }

                    if (btnElement) {
                        // Use Puppeteer's native click which properly triggers event handlers
                        await btnElement.click();
                        await this.browser.randomDelay(800, 1200);

                        // Click "Delete" in the popup menu using native click
                        const deleteSelector = 'div[role="menuitem"]';
                        await page.waitForSelector(deleteSelector, { timeout: 3000 });

                        // Find and click the Delete menu item
                        const deleteClicked = await page.evaluate(() => {
                            const menuItems = Array.from(document.querySelectorAll('div[role="menuitem"]'));
                            const deleteItem = menuItems.find(item => {
                                const text = item.textContent?.trim().toLowerCase();
                                return text === 'delete' || text?.includes('delete');
                            });
                            if (deleteItem) {
                                // Return the index so we can click it natively
                                return menuItems.indexOf(deleteItem);
                            }
                            return -1;
                        });

                        if (deleteClicked >= 0) {
                            // Click using Puppeteer's native click
                            const deleteItems = await page.$$('div[role="menuitem"]');
                            if (deleteItems[deleteClicked]) {
                                await deleteItems[deleteClicked].click();
                                steps.push('✓ Response deleted from history');
                                await this.browser.randomDelay(1000, 2000);
                            }
                        } else {
                            steps.push('⚠ "Delete" option not found in menu');
                        }
                    } else {
                        steps.push('⚠ "More actions" button not found in the current response');
                    }
                } catch (cleanupError) {
                    steps.push(`⚠ Cleanup failed: ${(cleanupError as Error).message}`);
                }
            } else {
                steps.push('ℹ Conversation preserved (deletion not requested)');
            }

            return {
                success: true,
                message: 'Perplexity test completed successfully',
                details: {
                    jobId,
                    steps,
                    responseFilePath,
                    screenshotPath,
                    responseLength: responseText.length,
                    currentUrl: page.url()
                }
            };

        } catch (error) {
            return {
                success: false,
                message: `Test failed: ${(error as Error).message}`
            };
        }
    }

    /**
     * Generate audio narration via Perplexity
     * Uploads narration input file and extracts narration output
     * REFACTORED: Now uses the existing testWorkflow function to avoid code duplication
     */
    public async generateAudioNarration(config: {
        sourceFolder: string;
        audioNarrationPerplexityUrl: string;
        headless?: boolean;
        profileId?: string;
        model?: string;
        prompt?: string;
    }): Promise<{ success: boolean; message: string; narrationPath?: string; details?: any }> {
        const steps: string[] = [];

        try {
            // Find narration input file
            const inputFiles = fs.readdirSync(config.sourceFolder)
                .filter(f => f.toLowerCase().includes('narration') && f.endsWith('.txt'));

            if (inputFiles.length === 0) {
                return {
                    success: false,
                    message: `No narration input file found in ${config.sourceFolder}. Expected filename to contain "narration".`
                };
            }

            const narrationInputPath = path.join(config.sourceFolder, inputFiles[0]);
            steps.push(`✓ Found narration input: ${inputFiles[0]}`);

            // Use the existing testWorkflow function to handle Perplexity interaction
            const result = await this.testWorkflow({
                chatUrl: config.audioNarrationPerplexityUrl,
                files: [narrationInputPath],
                prompt: config.prompt || '', // Use provided prompt or empty string
                sourceFolder: config.sourceFolder,
                headless: config.headless,
                shouldDeleteConversation: false,
                model: config.model,
                profileId: config.profileId,
                outputFilename: 'audio_narration' // Custom filename for audio narration
            });

            if (!result.success) {
                return {
                    success: false,
                    message: result.message,
                    details: { steps: [...steps, ...(result.details?.steps || [])] }
                };
            }

            // The response is already saved by testWorkflow as audio_narration.txt
            const outputDir = path.join(config.sourceFolder, 'output');
            const narrationOutputPath = path.join(outputDir, 'audio_narration.txt');

            if (!fs.existsSync(narrationOutputPath)) {
                throw new Error('Audio narration file was not created');
            }

            // Mark progress
            ProgressTracker.markStepComplete(config.sourceFolder, 'audio_narration_generated' as any, {});

            return {
                success: true,
                message: 'Audio narration generated successfully',
                narrationPath: narrationOutputPath,
                details: { steps: [...steps, ...(result.details?.steps || [])] }
            };

        } catch (error) {
            steps.push(`✗ Error: ${(error as Error).message}`);
            return {
                success: false,
                message: `Failed to generate audio narration: ${(error as Error).message}`,
                details: { steps }
            };
        }
    }


    public async close(): Promise<void> {
        await this.browser.closePage('perplexity-test');
    }
}
