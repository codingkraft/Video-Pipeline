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
            await this.browser.performAction(
                'Select Search Mode',
                async () => {
                    const searchButton = await page.$('button[value="search"][role="radio"]');
                    if (searchButton) {
                        const isChecked = await page.evaluate(el => el.getAttribute('aria-checked'), searchButton);
                        if (isChecked !== 'true') {
                            await searchButton.click();
                        }
                    }
                },
                async () => {
                    const searchButton = await page.$('button[value="search"][role="radio"]');
                    if (!searchButton) return true; // UI changed? Assume success
                    const isChecked = await page.evaluate(el => el.getAttribute('aria-checked'), searchButton);
                    return isChecked === 'true';
                },
                { maxRetries: 3 }
            );
            steps.push('✓ Search mode checked/selected');

            // Step 2.5: Select Model (if configured and not default)
            if (config.model && config.model !== 'Best') {
                const successModel = await this.browser.performAction(
                    `Select Model: ${config.model}`,
                    async () => {
                        // 1. Find and click the model trigger (button with CPU icon)
                        const triggerClicked = await page.evaluate(() => {
                            const buttons = Array.from(document.querySelectorAll('button'));
                            const cpuButtons = buttons.filter(b => {
                                const useElement = b.querySelector('svg use');
                                if (useElement) {
                                    const href = useElement.getAttribute('xlink:href') || useElement.getAttribute('href');
                                    return href && href.includes('pplx-icon-cpu');
                                }
                                return false;
                            });
                            if (cpuButtons.length > 0) {
                                cpuButtons[cpuButtons.length - 1].click();
                                return true;
                            }
                            return false;
                        });

                        if (!triggerClicked) throw new Error('Model trigger button not found');

                        await this.browser.randomDelay(1000, 1500);

                        // 2. Select model from menu
                        const modelSelected = await page.evaluate((modelName) => {
                            const items = Array.from(document.querySelectorAll('div[role="menuitem"]'));
                            const targetItem = items.find(item => item.textContent?.includes(modelName));
                            if (targetItem) {
                                (targetItem as HTMLElement).click();
                                return true;
                            }
                            return false;
                        }, config.model || '');

                        if (!modelSelected) throw new Error(`Model ${config.model} not found in menu`);
                    },
                    async () => {
                        // Validation could be checking if menu closed or icon updated, but simplified for now
                        const menu = await page.$('div[role="menu"]');
                        return !menu; // Assume success if menu closed
                    },
                    { maxRetries: 3 }
                );

                if (successModel) steps.push(`✓ Model selected: ${config.model}`);
                else steps.push(`⚠ Model selection failed (using default)`);
            }

            // Step 4: Attach files
            if (filesToUpload && filesToUpload.length > 0) {
                const successUpload = await this.browser.performAction(
                    'Upload Files',
                    async () => {
                        const fileInput = await page.$('input[data-testid="file-upload-input"]');
                        if (!fileInput) throw new Error('File upload input not found');

                        const inputElement = fileInput as import('puppeteer').ElementHandle<HTMLInputElement>;
                        // Clear first
                        await page.evaluate((el) => { (el as HTMLInputElement).value = ''; }, fileInput);
                        await inputElement.uploadFile(...filesToUpload);
                    },
                    async () => {
                        // Wait for spinner to appear AND then disappear
                        try {
                            await page.waitForSelector('[data-testid="file-loading-icon"]', { timeout: 3000 });
                            await page.waitForSelector('[data-testid="file-loading-icon"]', { hidden: true, timeout: 30000 });
                            return true;
                        } catch (e) {
                            // If spinner never appeared, maybe upload failed or was too fast?
                            // Let's assume failure if we can't confirm success via UI state
                            return false;
                        }
                    }
                );

                if (!successUpload) throw new Error('File upload validation failed');
                steps.push(`✓ Attached ${filesToUpload.length} file(s)`);
            }

            // Step 5: Enter prompt
            const successPrompt = await this.browser.performAction(
                'Enter Prompt',
                async () => {
                    await page.click('#ask-input');
                    // Clean
                    await page.keyboard.down('Control');
                    await page.keyboard.press('KeyA');
                    await page.keyboard.up('Control');
                    await page.keyboard.press('Backspace');

                    await this.browser.randomDelay(200, 400);

                    // Copy & Paste technique
                    await page.evaluate((text) => {
                        const input = document.createElement('textarea');
                        input.value = text;
                        document.body.appendChild(input);
                        input.select();
                        document.execCommand('copy');
                        document.body.removeChild(input);
                    }, config.prompt);

                    await page.click('#ask-input');
                    await page.keyboard.down('Control');
                    await page.keyboard.press('KeyV');
                    await page.keyboard.up('Control');
                },
                async () => {
                    const text = await page.evaluate(() => {
                        const el = document.querySelector('#ask-input');
                        return el ? el.textContent : '';
                    });
                    return !!(text && text.trim().length > 0);
                }
            );

            if (!successPrompt) throw new Error('Failed to enter prompt text');
            steps.push(`✓ Pasted prompt via Clipboard`);

            // Step 6: Submit
            const successSubmit = await this.browser.performAction(
                'Submit Query',
                async () => {
                    const submitted = await page.evaluate(() => {
                        const submitBtn = document.querySelector('button[aria-label="Submit"]') as HTMLButtonElement;
                        if (submitBtn && !submitBtn.disabled) {
                            submitBtn.click();
                            return true;
                        }
                        return false;
                    });
                    if (!submitted) throw new Error('Submit button disabled or missing');
                },
                async () => {
                    // Check if stop button appears or response starts
                    const isGenerating = await page.$('button[aria-label="Stop generating response"]');
                    const prose = await page.$('[class*="prose"]');
                    return !!isGenerating || !!prose;
                },
                { maxRetries: 5, retryDelay: 2000 }
            );

            if (!successSubmit) throw new Error('Failed to submit query');
            steps.push('✓ Submitted via button');

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
