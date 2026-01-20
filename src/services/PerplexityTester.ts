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
     * MODULE: Perplexity Workflow
     * Complete Perplexity interaction with modular recovery.
     * Uses Open → Work → Close pattern with 3 retries.
     */
    public async testWorkflow(config: PerplexityTestConfig): Promise<{ success: boolean; message: string; details?: any }> {
        try {
            await this.browser.initialize({
                headless: config.headless,
                profileId: config.profileId || 'default'
            });

            const targetUrl = config.chatUrl || PERPLEXITY_URL;

            // Use folder name in service key for parallel processing support
            const folderName = config.sourceFolder ? path.basename(config.sourceFolder) : 'default';
            const serviceKey = `perplexity-test-${folderName}`;

            return await this.browser.withModularRecovery(
                serviceKey,
                targetUrl,
                async (page) => {
                    return await this.executePerplexityWorkflow(page, config);
                }
            );
        } catch (error) {
            return {
                success: false,
                message: `Test failed after retries: ${(error as Error).message}`
            };
        }
    }

    /**
     * Internal: Execute the actual Perplexity workflow on a page
     */
    private async executePerplexityWorkflow(
        page: Page,
        config: PerplexityTestConfig
    ): Promise<{ success: boolean; message: string; details?: any }> {
        const steps: string[] = [];
        const jobId = `job_${Date.now()}`;

        // Resolve file paths if sourceFolder is provided
        let filesToUpload = config.files;
        if (config.sourceFolder && config.files.length > 0) {
            filesToUpload = config.files.map(f => {
                return path.isAbsolute(f) ? f : path.join(config.sourceFolder!, f);
            });
        }

        // Determine output directory
        let outputDir: string;
        if (config.outputDir) {
            outputDir = path.join(config.outputDir, 'output');
        } else if (config.sourceFolder) {
            outputDir = path.join(config.sourceFolder, 'output');
        } else if (filesToUpload && filesToUpload.length > 0) {
            const sourceFolder = path.dirname(filesToUpload[0]);
            outputDir = path.join(sourceFolder, 'output');
        } else {
            outputDir = path.join(process.cwd(), 'output');
        }

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
                if (!searchButton) return true;
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
                    const menu = await page.$('div[role="menu"]');
                    return !menu;
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
                    await page.evaluate((el) => { (el as HTMLInputElement).value = ''; }, fileInput);
                    await inputElement.uploadFile(...filesToUpload);
                },
                async () => {
                    try {
                        await page.waitForSelector('[data-testid="file-loading-icon"]', { timeout: 3000 });
                        await page.waitForSelector('[data-testid="file-loading-icon"]', { hidden: true, timeout: 30000 });
                        return true;
                    } catch (e) {
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
                await page.keyboard.down('Control');
                await page.keyboard.press('KeyA');
                await page.keyboard.up('Control');
                await page.keyboard.press('Backspace');

                await this.browser.randomDelay(200, 400);

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
                const isGenerating = await page.$('button[aria-label="Stop generating response"]');
                const prose = await page.$('[class*="prose"]');
                return !!isGenerating || !!prose;
            },
            { maxRetries: 5, retryDelay: 2000 }
        );

        if (!successSubmit) throw new Error('Failed to submit query');
        steps.push('✓ Submitted via button');

        // Step 7: Wait for response
        steps.push('⏳ Waiting for Perplexity response (max 10 mins)...');
        let responseText = '';

        await page.waitForSelector('[class*="prose"]', { timeout: 60000 });
        steps.push('✓ Response started streaming...');

        let lastLength = 0;
        let lastProseCount = 0;
        let stableCount = 0;
        const maxWait = 600000;
        const startTime = Date.now();

        while (Date.now() - startTime < maxWait) {
            const { text: currentText, proseCount } = await page.evaluate(() => {
                const activeDivs = document.querySelectorAll('div[data-state="active"]');
                if (activeDivs.length === 0) return { text: '', proseCount: 0 };
                const lastActive = activeDivs[activeDivs.length - 1];
                const prose = lastActive.querySelector('[class*="prose"]');
                return {
                    text: prose ? (prose.textContent || '') : '',
                    proseCount: document.querySelectorAll('[class*="prose"]').length
                };
            });

            if (proseCount > lastProseCount) {
                stableCount = 0;
                lastProseCount = proseCount;
                lastLength = currentText.length;
            } else if (currentText.length > 0 && currentText.length === lastLength) {
                stableCount++;
            } else {
                stableCount = 0;
                lastLength = currentText.length;
            }

            const isGenerating = await page.evaluate(() => {
                return !!document.querySelector('button[aria-label="Stop generating response"]');
            });

            if (!isGenerating && stableCount >= 3) {
                responseText = currentText;
                break;
            }

            await this.browser.randomDelay(1000, 1000);
        }

        if (!responseText || responseText.length < 50) {
            throw new Error('Response timeout: Perplexity did not generate a response within 10 minutes');
        }

        steps.push(`✓ Response captured (${responseText.length} chars)`);

        // Step 8: Save
        let cleanedResponse = responseText
            .split('\n')
            .map(line => line.trim())
            .filter((line, index, arr) => {
                if (line !== '') return true;
                return index === 0 || arr[index - 1] !== '';
            })
            .join('\n')
            .trim();

        if (cleanedResponse.startsWith('text')) {
            cleanedResponse = cleanedResponse.substring(4).trim();
        }

        const outputBasename = config.outputFilename || 'perplexity_video_response';
        const responseFilePath = path.join(outputDir, `${outputBasename}.txt`);
        fs.writeFileSync(responseFilePath, cleanedResponse, 'utf-8');
        steps.push(`✓ Response saved to: ${responseFilePath}`);

        // Update progress tracker
        const sourceFolder = config.sourceFolder || (filesToUpload && filesToUpload.length > 0 ? path.dirname(filesToUpload[0]) : null);
        if (sourceFolder) {
            ProgressTracker.markStepComplete(sourceFolder, 'perplexity', {
                outputFile: `${outputBasename}.txt`,
                steeringPrompt: cleanedResponse
            });
            steps.push('✓ Progress saved');
        }

        const screenshotPath = path.join(outputDir, `${outputBasename}_screenshot.png`);
        await page.evaluate(() => {
            window.scrollTo(0, document.body.scrollHeight);
        });
        await this.browser.randomDelay(1000, 2000);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        steps.push(`✓ Screenshot saved`);

        // Step 9: Cleanup (Delete response) if requested
        if (config.shouldDeleteConversation) {
            try {
                const activeDivs = await page.$$('div[data-state="active"]');
                let btnElement = null;

                if (activeDivs.length > 0) {
                    const lastActiveDiv = activeDivs[activeDivs.length - 1];
                    btnElement = await lastActiveDiv.$('button[aria-label="More actions"]');
                }

                if (btnElement) {
                    await btnElement.click();
                    await this.browser.randomDelay(800, 1200);

                    const deleteSelector = 'div[role="menuitem"]';
                    await page.waitForSelector(deleteSelector, { timeout: 3000 });

                    const deleteClicked = await page.evaluate(() => {
                        const menuItems = Array.from(document.querySelectorAll('div[role="menuitem"]'));
                        const deleteItem = menuItems.find(item => {
                            const text = item.textContent?.trim().toLowerCase();
                            return text === 'delete' || text?.includes('delete');
                        });
                        if (deleteItem) {
                            return menuItems.indexOf(deleteItem);
                        }
                        return -1;
                    });

                    if (deleteClicked >= 0) {
                        const deleteItems = await page.$$('div[role="menuitem"]');
                        if (deleteItems[deleteClicked]) {
                            await deleteItems[deleteClicked].click();
                            steps.push('✓ Response deleted from history');
                            await this.browser.randomDelay(1000, 2000);
                        }
                    }
                }
            } catch (cleanupError) {
                steps.push(`⚠ Cleanup failed: ${(cleanupError as Error).message}`);
            }
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
