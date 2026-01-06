import { Page } from 'puppeteer';
import { CaptiveBrowser } from '../browser/CaptiveBrowser';
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
            await this.browser.initialize({ headless: config.headless });

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
            let outputDir: string;
            if (config.outputDir) {
                outputDir = path.join(config.outputDir, 'output', jobId);
            } else if (config.sourceFolder) {
                // Local Mode: Save in sourceFolder/output/job...
                outputDir = path.join(config.sourceFolder, 'output', jobId);
            } else if (filesToUpload && filesToUpload.length > 0) {
                // Save output inside the source folder's 'output' subfolder
                const sourceFolder = path.dirname(filesToUpload[0]);
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
            if (filesToUpload && filesToUpload.length > 0) {
                try {
                    steps.push(`⏳ Uploading ${filesToUpload.length} file(s)...`);

                    const fileInput = await page.$('input[data-testid="file-upload-input"]');

                    if (fileInput) {
                        const inputElement = fileInput as import('puppeteer').ElementHandle<HTMLInputElement>;
                        await inputElement.uploadFile(...filesToUpload);
                        steps.push(`✓ Attached ${filesToUpload.length} file(s)`);

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
                        // If text hasn't changed for 5 checks (approx 5 seconds), assume done
                        if (stableCount >= 5) {
                            responseText = currentText;
                            break;
                        }
                    } else {
                        stableCount = 0;
                        lastLength = currentText.length;
                    }

                    // Check if "Stop generating" button is gone
                    const isGenerating = await page.evaluate(() => {
                        return !!document.querySelector('button[aria-label="Stop generating response"]');
                    });

                    if (!isGenerating && stableCount >= 3) {
                        // If no stop button and stable for 3s, done
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
            const responseFilePath = path.join(outputDir, `${jobId}_perplexity_response.txt`);
            fs.writeFileSync(responseFilePath, responseText, 'utf-8');
            steps.push(`✓ Response saved to: ${responseFilePath}`);

            const screenshotPath = path.join(outputDir, `${jobId}_perplexity_screenshot.png`);

            // Scroll to bottom before screenshot
            await page.evaluate(() => {
                window.scrollTo(0, document.body.scrollHeight);
            });
            await this.browser.randomDelay(1000, 2000); // Wait for any lazy load

            await page.screenshot({ path: screenshotPath, fullPage: true });
            steps.push(`✓ Screenshot saved: ${screenshotPath}`);

            // Step 9: Cleanup (Delete response)
            try {
                steps.push('⏳ Cleaning up (deleting response)...');

                // Find all "More actions" buttons and click the LAST one
                const dotsClicked = await page.evaluate(() => {
                    const buttons = Array.from(document.querySelectorAll('button[aria-label="More actions"]'));
                    if (buttons.length === 0) return false;

                    const lastBtn = buttons[buttons.length - 1] as HTMLElement;
                    lastBtn.click();
                    return true;
                });

                if (dotsClicked) {
                    await this.browser.randomDelay(800, 1200);

                    // Click "Delete" in the popup menu
                    const deleteClicked = await page.evaluate(() => {
                        const menuItems = Array.from(document.querySelectorAll('div[role="menuitem"]'));
                        // Find item with "Delete" text
                        const deleteItem = menuItems.find(item => item.textContent?.trim() === 'Delete' || item.textContent?.includes('Delete'));

                        if (deleteItem) {
                            (deleteItem as HTMLElement).click();
                            return true;
                        }
                        return false;
                    });

                    if (deleteClicked) {
                        steps.push('✓ Response deleted from history');
                        await this.browser.randomDelay(1000, 2000);
                    } else {
                        steps.push('⚠ "Delete" option not found in menu');
                    }
                } else {
                    steps.push('⚠ "More actions" button not found');
                }
            } catch (cleanupError) {
                steps.push(`⚠ Cleanup failed: ${(cleanupError as Error).message}`);
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

    public async close(): Promise<void> {
        await this.browser.closePage('perplexity-test');
    }
}
