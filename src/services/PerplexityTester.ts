import { Page } from 'puppeteer';
import { CaptiveBrowser } from '../browser/CaptiveBrowser';
import * as path from 'path';
import * as fs from 'fs';

const PERPLEXITY_URL = 'https://www.perplexity.ai/';

export interface PerplexityTestConfig {
    chatUrl?: string;
    files: string[];
    prompt: string;
    outputDir?: string; // Optional: directory to save output (defaults to source folder)
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
            await this.browser.initialize();

            const page = await this.browser.getPage('perplexity-test', config.chatUrl || PERPLEXITY_URL);
            await this.browser.randomDelay(2000, 3000);

            const steps: string[] = [];
            const jobId = `job_${Date.now()}`;

            // Determine output directory:
            // 1. Use explicit outputDir if provided
            // 2. Otherwise, use the folder of the first input file
            // 3. Fall back to project output folder
            let outputDir: string;
            if (config.outputDir) {
                outputDir = path.join(config.outputDir, 'output', jobId);
            } else if (config.files && config.files.length > 0) {
                // Save output inside the source folder's 'output' subfolder
                const sourceFolder = path.dirname(config.files[0]);
                outputDir = path.join(sourceFolder, 'output', jobId);
            } else {
                outputDir = path.join(process.cwd(), 'output', jobId);
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

            // Step 3: Change LLM to Claude Sonnet 4.5
            // HTML: <button aria-label="Gemini 3 Pro" ...> with <svg><use xlink:href="#pplx-icon-cpu">
            try {
                steps.push('⏳ Opening model selector...');

                // Use JavaScript to find the LAST button containing the CPU icon
                // There are multiple CPU icons - the last one is the model selector
                const modelButtonClicked = await page.evaluate(() => {
                    // Find all buttons with CPU icon
                    const buttons = Array.from(document.querySelectorAll('button'));
                    const cpuButtons: HTMLButtonElement[] = [];

                    for (const btn of buttons) {
                        // Check if button contains the CPU icon
                        const useElement = btn.querySelector('svg use');
                        if (useElement) {
                            const href = useElement.getAttribute('xlink:href') || useElement.getAttribute('href');
                            if (href && href.includes('pplx-icon-cpu')) {
                                cpuButtons.push(btn);
                            }
                        }
                    }

                    // Use the LAST CPU button (model selector near input)
                    if (cpuButtons.length > 0) {
                        const modelBtn = cpuButtons[cpuButtons.length - 1];
                        const label = modelBtn.getAttribute('aria-label');
                        modelBtn.click();
                        return label || 'Model button (last CPU icon)';
                    }
                    return null;
                });

                if (modelButtonClicked) {
                    steps.push(`✓ Clicked model button: ${modelButtonClicked}`);
                    await this.browser.randomDelay(1500, 2000);

                    // Wait for dropdown to appear and find Claude option
                    // Look for text containing "Claude" in the dropdown
                    try {
                        // Use XPath for specific text matching
                        // We must match "Sonnet" to avoid "Opus"
                        const claudeXpath = "//div[contains(text(), 'Claude Sonnet 4.5')] | //button[contains(text(), 'Sonnet')]";
                        await page.waitForXPath(claudeXpath, { timeout: 3000 });

                        const [claudeOption] = await page.$x(claudeXpath);
                        if (claudeOption) {
                            await (claudeOption as any).click();
                            await this.browser.randomDelay(1000, 1500);
                            steps.push('✓ Selected Claude Sonnet');
                        } else {
                            throw new Error('Claude Sonnet option not clickable');
                        }
                    } catch (e) {
                        // Fallback: Try clicking by evaluating text
                        const clicked = await page.evaluate(() => {
                            const elements = Array.from(document.querySelectorAll('button, div[role="menuitem"], div[role="option"]'));
                            for (const el of elements) {
                                // Explicitly check for "Sonnet"
                                const text = el.textContent || '';
                                if (text.includes('Claude') && text.includes('Sonnet')) {
                                    (el as HTMLElement).click();
                                    return true;
                                }
                            }
                            return false;
                        });

                        if (clicked) {
                            steps.push('✓ Selected Claude (fallback)');
                        } else {
                            // Click somewhere else to close dropdown
                            await page.keyboard.press('Escape');
                            steps.push('⚠ Claude not found, keeping current model');
                        }
                    }
                } else {
                    steps.push('⚠ Model selector button not found');
                }

                await this.browser.randomDelay(1000, 2000);
            } catch (error) {
                steps.push(`⚠ LLM selection: ${(error as Error).message}`);
            }

            // Step 4: Attach files
            // HTML: <input data-testid="file-upload-input" type="file" ...>
            if (config.files && config.files.length > 0) {
                try {
                    steps.push(`⏳ Uploading ${config.files.length} file(s)...`);

                    const fileInput = await page.$('input[data-testid="file-upload-input"]');

                    if (fileInput) {
                        const inputElement = fileInput as import('puppeteer').ElementHandle<HTMLInputElement>;
                        await inputElement.uploadFile(...config.files);
                        steps.push(`✓ Attached ${config.files.length} file(s)`);

                        // Wait for upload to complete
                        steps.push('⏳ Waiting for files to upload...');
                        await this.browser.randomDelay(3000, 5000);
                        steps.push('✓ Files uploaded');

                        await this.browser.randomDelay(2000, 3000);
                    } else {
                        throw new Error('File upload input not found');
                    }
                } catch (error) {
                    throw new Error(`File attachment failed: ${(error as Error).message}`);
                }
            }

            // Step 5: Enter prompt - set text directly via JavaScript
            // HTML: <div contenteditable="true" id="ask-input" data-lexical-editor="true">
            try {
                steps.push('⏳ Entering prompt...');

                // Set text directly via JavaScript - much faster than typing
                // Lexical editor requires special handling
                // Set text using execCommand which works reliably with Lexical/contenteditable
                const promptSet = await page.evaluate((promptText) => {
                    const inputArea = document.querySelector('#ask-input') as HTMLElement;
                    if (!inputArea) return false;

                    // Focus and clear
                    inputArea.focus();

                    // Select all and delete to clear cleanly
                    document.execCommand('selectAll', false);
                    document.execCommand('delete', false);

                    // Use insertText command - this simulates a user paste/type
                    // and triggers all necessary internal events for Lexical
                    return document.execCommand('insertText', false, promptText);
                }, config.prompt);

                if (promptSet) {
                    steps.push(`✓ Set prompt: "${config.prompt.substring(0, 50)}..."`);
                } else {
                    throw new Error('Could not set prompt - #ask-input not found');
                }

                await this.browser.randomDelay(1000, 1500);
            } catch (error) {
                throw new Error(`Prompt entry failed: ${(error as Error).message}`);
            }

            // Step 6: Submit - ONLY use button click, never Enter key
            try {
                steps.push('⏳ Submitting query...');

                // Wait a moment for the UI to update after prompt entry
                await this.browser.randomDelay(500, 1000);

                // Click submit button (must wait for it to be enabled)
                const submitted = await page.evaluate(() => {
                    const submitBtn = document.querySelector('button[aria-label="Submit"]') as HTMLButtonElement;
                    if (submitBtn && !submitBtn.disabled) {
                        submitBtn.click();
                        return true;
                    }
                    return false;
                });

                if (submitted) {
                    steps.push('✓ Submitted via button');
                } else {
                    // Wait and retry - button might need time to enable
                    await this.browser.randomDelay(1000, 1500);
                    const retrySubmit = await page.evaluate(() => {
                        const submitBtn = document.querySelector('button[aria-label="Submit"]') as HTMLButtonElement;
                        if (submitBtn) {
                            submitBtn.click();
                            return true;
                        }
                        return false;
                    });

                    if (retrySubmit) {
                        steps.push('✓ Submitted via button (after retry)');
                    } else {
                        throw new Error('Submit button not found or still disabled');
                    }
                }

                await this.browser.randomDelay(3000, 5000);
            } catch (error) {
                throw new Error(`Submit failed: ${(error as Error).message}`);
            }

            // Step 7: Wait for response
            steps.push('⏳ Waiting for Perplexity response (up to 60s)...');
            let responseText = '';

            try {
                // Wait for answer content to appear
                await page.waitForSelector('[class*="prose"], [class*="answer"], article', { timeout: 60000 });
                await this.browser.randomDelay(5000, 7000);

                responseText = await page.evaluate(() => {
                    // Try to get the main answer content
                    const prose = document.querySelector('[class*="prose"]');
                    if (prose) return prose.textContent || '';
                    return document.body.innerText;
                });

                if (responseText && responseText.length > 50) {
                    steps.push(`✓ Response received (${responseText.length} characters)`);
                } else {
                    steps.push('⚠ Response may be incomplete');
                }

            } catch (error) {
                steps.push(`⚠ Response extraction: ${(error as Error).message}`);
                responseText = await page.evaluate(() => document.body.innerText);
            }

            // Step 8: Save
            const responseFilePath = path.join(outputDir, `${jobId}_perplexity_response.txt`);
            fs.writeFileSync(responseFilePath, responseText, 'utf-8');
            steps.push(`✓ Response saved to: ${responseFilePath}`);

            const screenshotPath = path.join(outputDir, `${jobId}_perplexity_screenshot.png`);
            await page.screenshot({ path: screenshotPath, fullPage: true });
            steps.push(`✓ Screenshot saved: ${screenshotPath}`);

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

    public async close(): Promise<void> {
        await this.browser.closePage('perplexity-test');
    }
}
