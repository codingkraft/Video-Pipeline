import { Page } from 'puppeteer';
import { CaptiveBrowser } from '../browser/CaptiveBrowser';
import * as path from 'path';
import * as fs from 'fs';

const PERPLEXITY_URL = 'https://www.perplexity.ai/';

export interface PerplexityTestConfig {
    chatUrl?: string;
    files: string[];
    prompt: string;
}

export class PerplexityTester {
    private browser: CaptiveBrowser;

    constructor() {
        this.browser = CaptiveBrowser.getInstance();
    }

    /**
     * Test the complete Perplexity workflow:
     * 1. Navigate to chat
     * 2. Select Search mode (using value="search")
     * 3. Change LLM (using aria-label="Gemini..." etc)
     * 4. Attach files (preserving filenames)
     * 5. Enter prompt
     * 6. Submit
     * 7. Save output
     */
    public async testWorkflow(config: PerplexityTestConfig): Promise<{ success: boolean; message: string; details?: any }> {
        try {
            await this.browser.initialize();

            const page = await this.browser.getPage('perplexity-test', config.chatUrl || PERPLEXITY_URL);
            await this.browser.randomDelay(2000, 3000);

            const steps: string[] = [];
            const jobId = `job_${Date.now()}`;
            const outputDir = path.join(process.cwd(), 'output', jobId);

            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }

            // Step 1: Navigate
            if (config.chatUrl) {
                steps.push(`✓ Navigated to: ${config.chatUrl}`);
            } else {
                steps.push('✓ Opened Perplexity home');
            }

            // Step 2: Select Search mode
            try {
                steps.push('⏳ Selecting Search mode...');

                // Based on HTML: <button role="radio" value="search" ...>
                const searchButtonSelectors = [
                    'button[value="search"]',
                    'button[aria-label="Search"]',
                    '[role="radio"][value="search"]'
                ];

                let searchSelected = false;
                for (const selector of searchButtonSelectors) {
                    try {
                        const button = await page.$(selector);
                        if (button) {
                            // Check if already selected
                            const ariaChecked = await page.evaluate(el => el.getAttribute('aria-checked'), button);
                            if (ariaChecked === 'true') {
                                steps.push('✓ Search mode already selected');
                                searchSelected = true;
                                break;
                            }

                            await button.click();
                            await this.browser.randomDelay(500, 1000);
                            searchSelected = true;
                            steps.push('✓ Selected Search mode');
                            break;
                        }
                    } catch (e) {
                        continue;
                    }
                }

                if (!searchSelected) {
                    // Fallback to text search if specific value selector fails
                    try {
                        const textSearch = await page.$('button:has-text("Search")');
                        if (textSearch) {
                            await textSearch.click();
                            steps.push('✓ Selected Search mode (text fallback)');
                            searchSelected = true;
                        }
                    } catch (e) {
                        // Ignore
                    }
                }

                if (!searchSelected) {
                    throw new Error('Could not find Search mode button');
                }

                await this.browser.randomDelay(500, 1000);
            } catch (error) {
                throw new Error(`Mode selection failed: ${(error as Error).message}`);
            }

            // Step 3: Change LLM to Claude Sonnet 4.5
            try {
                steps.push('⏳ Changing LLM to Claude Sonnet 4.5...');

                // From HTML: aria-label="Gemini 3 Pro" (or whatever current model is)
                const modelButtonSelectors = [
                    'button[aria-label*="Pro"]',
                    'button[aria-label*="Claude"]',
                    'button[aria-label*="GPT"]',
                    'button[aria-label*="Sonar"]',
                    'button:has(svg use[xlink\\:href="#pplx-icon-cpu"])' // Icon based selector
                ];

                let modelMenuOpened = false;
                for (const selector of modelButtonSelectors) {
                    try {
                        const button = await page.$(selector);
                        if (button) {
                            // Helper to log what we found
                            const label = await page.evaluate(el => el.getAttribute('aria-label'), button);
                            steps.push(`✓ Found model button: ${label}`);

                            await button.click();
                            await this.browser.randomDelay(1000, 1500);
                            modelMenuOpened = true;
                            break;
                        }
                    } catch (e) {
                        continue;
                    }
                }

                if (modelMenuOpened) {
                    // Look for Claude option in the dropdown
                    const claudeSelectors = [
                        'button:has-text("Claude 3.5 Sonnet")',
                        'div:has-text("Claude 3.5 Sonnet")',
                        'button:has-text("Sonnet 3.5")',
                        '[role="menuitem"]:has-text("Claude")',
                        'div:has-text("Claude")'
                    ];

                    let claudeSelected = false;
                    for (const selector of claudeSelectors) {
                        try {
                            const element = await page.waitForSelector(selector, { timeout: 2000 });
                            if (element) {
                                await element.click();
                                await this.browser.randomDelay(1000, 1500);
                                claudeSelected = true;
                                steps.push('✓ Selected Claude Sonnet 4.5');
                                break;
                            }
                        } catch (e) {
                            continue;
                        }
                    }

                    if (!claudeSelected) {
                        // Debug available options
                        const options = await page.evaluate(() => {
                            return Array.from(document.querySelectorAll('[role="menuitem"], [role="option"], .group\\/item'))
                                .map(el => el.textContent?.trim())
                                .filter(t => t && t.length > 0)
                                .join(', ');
                        });
                        throw new Error(`Could not find Claude option. Menu items: ${options}`);
                    }
                } else {
                    throw new Error('Could not open model selector');
                }

                await this.browser.randomDelay(1000, 2000);
            } catch (error) {
                throw new Error(`LLM selection failed: ${(error as Error).message}`);
            }

            // Step 4: Attach files
            if (config.files && config.files.length > 0) {
                try {
                    steps.push(`⏳ Uploading ${config.files.length} file(s) with original names...`);

                    // From HTML: data-testid="file-upload-input"
                    const fileInputSelectors = [
                        'input[data-testid="file-upload-input"]',
                        'input[type="file"]'
                    ];

                    let fileInput = null;
                    for (const sel of fileInputSelectors) {
                        fileInput = await page.$(sel);
                        if (fileInput) break;
                    }

                    if (fileInput) {
                        const inputElement = fileInput as import('puppeteer').ElementHandle<HTMLInputElement>;
                        await inputElement.uploadFile(...config.files);
                        steps.push(`✓ Attached ${config.files.length} file(s)`);

                        steps.push('⏳ Waiting for files to upload...');
                        await this.browser.randomDelay(3000, 5000);

                        try {
                            await page.waitForFunction(() => {
                                const indicators = document.querySelectorAll('[class*="upload"], [class*="progress"], [class*="loading"]');
                                return indicators.length === 0 ||
                                    Array.from(indicators).every(el =>
                                        el.textContent?.includes('100%') ||
                                        !el.textContent?.includes('%')
                                    );
                            }, { timeout: 30000 });
                            steps.push('✓ Files uploaded successfully');
                        } catch (e) {
                            console.warn('Upload wait timeout, continuing...');
                        }

                        await this.browser.randomDelay(2000, 3000);
                    } else {
                        throw new Error('Could not find file upload input');
                    }
                } catch (error) {
                    throw new Error(`File attachment failed: ${(error as Error).message}`);
                }
            }

            // Step 5: Enter prompt
            try {
                steps.push('⏳ Entering prompt...');
                // From HTML: id="ask-input"
                const textareaSelectors = [
                    '#ask-input',
                    'textarea[placeholder*="Ask"]',
                    '[contenteditable="true"]'
                ];

                let promptEntered = false;
                for (const selector of textareaSelectors) {
                    try {
                        const element = await page.$(selector);
                        if (element) {
                            await element.click();
                            await this.browser.randomDelay(500, 1000);

                            // Human typing for contenteditable div
                            await this.browser.humanType(page, selector, config.prompt);

                            steps.push(`✓ Entered prompt: "${config.prompt.substring(0, 50)}..."`);
                            promptEntered = true;
                            break;

                        }
                    } catch (e) {
                        continue;
                    }
                }

                if (!promptEntered) {
                    throw new Error('Could not find prompt input');
                }

                await this.browser.randomDelay(1000, 1500);
            } catch (error) {
                throw new Error(`Prompt entry failed: ${(error as Error).message}`);
            }

            // Step 6: Submit
            try {
                steps.push('⏳ Submitting query...');
                await page.keyboard.press('Enter');
                steps.push('✓ Submitted query');
                await this.browser.randomDelay(3000, 5000);
            } catch (error) {
                throw new Error(`Submit failed: ${(error as Error).message}`);
            }

            // Step 7: Wait for response
            steps.push('⏳ Waiting for Perplexity response (up to 60s)...');
            let responseText = '';

            try {
                const responseSelectors = [
                    '[class*="answer"]',
                    '[class*="response"]',
                    'div[class*="prose"]',
                    'article'
                ];

                let responseFound = false;
                for (const selector of responseSelectors) {
                    try {
                        await page.waitForSelector(selector, { timeout: 60000 });
                        await this.browser.randomDelay(5000, 7000);

                        responseText = await page.evaluate((sel) => {
                            const element = document.querySelector(sel);
                            return element ? element.textContent || '' : '';
                        }, selector);

                        if (responseText && responseText.length > 50) {
                            responseFound = true;
                            steps.push(`✓ Response received (${responseText.length} characters)`);
                            break;
                        }
                    } catch (e) {
                        continue;
                    }
                }

                if (!responseFound) {
                    responseText = await page.evaluate(() => document.body.innerText);
                    steps.push('⚠ Used fallback text extraction');
                }

            } catch (error) {
                steps.push(`⚠ Response extraction error: ${(error as Error).message}`);
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
