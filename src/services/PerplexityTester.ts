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
     * 1. Navigate to chat URL or create new
     * 2. Select Search mode (Strict check)
     * 3. Change LLM to Claude Sonnet 4.5 FIRST (Strict check)
     * 4. Attach files (preserving original filenames)
     * 5. Wait for files to upload completely
     * 6. Enter prompt
     * 7. Submit
     * 8. Wait for and extract response
     * 9. Save response to file
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

                const modeButtonSelectors = [
                    'button[aria-label*="Focus"]',
                    'button[aria-label*="Mode"]',
                    'button:has-text("Focus")',
                    'button:has-text("Deep")',
                    'button:has-text("Search")',
                    '[data-testid*="focus"]',
                    '[data-testid*="mode"]'
                ];

                let modeMenuOpened = false;
                for (const selector of modeButtonSelectors) {
                    try {
                        const button = await page.$(selector);
                        if (button) {
                            await button.click();
                            await this.browser.randomDelay(500, 1000);
                            modeMenuOpened = true;
                            steps.push('✓ Opened mode selector');
                            break;
                        }
                    } catch (e) {
                        continue;
                    }
                }

                if (modeMenuOpened) {
                    const searchSelectors = [
                        'button:has-text("Search")',
                        '[role="menuitem"]:has-text("Search")',
                        '[role="option"]:has-text("Search")',
                        'div:has-text("Search")'
                    ];

                    let searchSelected = false;
                    for (const selector of searchSelectors) {
                        try {
                            await page.waitForSelector(selector, { timeout: 2000 });
                            await page.click(selector);
                            await this.browser.randomDelay(500, 1000);
                            searchSelected = true;
                            steps.push('✓ Selected Search mode');
                            break;
                        } catch (e) {
                            continue;
                        }
                    }

                    if (!searchSelected) {
                        throw new Error('Could not find Search mode option');
                    }
                } else {
                    throw new Error('Could not open mode selector');
                }

                await this.browser.randomDelay(500, 1000);
            } catch (error) {
                throw new Error(`Mode selection failed: ${(error as Error).message}`);
            }

            // Step 3: Change LLM to Claude Sonnet 4.5
            try {
                steps.push('⏳ Changing LLM to Claude Sonnet 4.5...');

                const modelButtonSelectors = [
                    'button[aria-label*="model"]',
                    'button[aria-label*="Model"]',
                    'button:has-text("Pro")',
                    'button:has-text("GPT")',
                    'button:has-text("Claude")',
                    '[data-testid*="model"]'
                ];

                let modelMenuOpened = false;
                for (const selector of modelButtonSelectors) {
                    try {
                        const button = await page.$(selector);
                        if (button) {
                            await button.click();
                            await this.browser.randomDelay(1000, 1500);
                            modelMenuOpened = true;
                            steps.push('✓ Opened model selector');
                            break;
                        }
                    } catch (e) {
                        continue;
                    }
                }

                if (modelMenuOpened) {
                    const claudeSelectors = [
                        'button:has-text("Claude")',
                        'button:has-text("Sonnet")',
                        'button:has-text("4.5")',
                        '[role="menuitem"]:has-text("Claude")',
                        '[role="option"]:has-text("Claude")',
                        'div:has-text("Claude Sonnet 4")'
                    ];

                    let claudeSelected = false;
                    for (const selector of claudeSelectors) {
                        try {
                            await page.waitForSelector(selector, { timeout: 3000 });
                            await page.click(selector);
                            await this.browser.randomDelay(1000, 1500);
                            claudeSelected = true;
                            steps.push('✓ Selected Claude Sonnet 4.5');
                            break;
                        } catch (e) {
                            continue;
                        }
                    }

                    if (!claudeSelected) {
                        throw new Error('Could not find Claude Sonnet 4.5 option');
                    }
                } else {
                    throw new Error('Could not open model selector');
                }

                await this.browser.randomDelay(1000, 2000);
            } catch (error) {
                throw new Error(`LLM selection failed: ${(error as Error).message}`);
            }

            // Step 4: Attach files with ORIGINAL filenames
            if (config.files && config.files.length > 0) {
                try {
                    steps.push(`⏳ Uploading ${config.files.length} file(s) with original names...`);

                    const fileInput = await page.$('input[type="file"]');

                    if (fileInput) {
                        // Puppeteer preserves original filenames
                        await fileInput.uploadFile(...config.files);
                        steps.push(`✓ Attached ${config.files.length} file(s) with original names`);

                        // Wait for files to upload
                        steps.push('⏳ Waiting for files to upload...');
                        await this.browser.randomDelay(3000, 5000);

                        // Wait for upload indicators to disappear
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
                            console.warn('Upload wait timeout, checking if files attached...');
                            // We don't throw hero, just warn, as sometimes indicators are tricky
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
                const textareaSelectors = [
                    'textarea[placeholder*="Ask"]',
                    'textarea[placeholder*="follow"]',
                    'textarea'
                ];

                let promptEntered = false;
                for (const selector of textareaSelectors) {
                    try {
                        await page.waitForSelector(selector, { timeout: 3000 });

                        // Clear existing text
                        await page.click(selector);
                        await page.keyboard.down('Control');
                        await page.keyboard.press('A');
                        await page.keyboard.up('Control');
                        await page.keyboard.press('Backspace');

                        // Type the prompt
                        await this.browser.humanType(page, selector, config.prompt);
                        steps.push(`✓ Entered prompt: "${config.prompt.substring(0, 50)}..."`);
                        promptEntered = true;
                        break;
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

            // Step 8: Save response
            const responseFilePath = path.join(outputDir, `${jobId}_perplexity_response.txt`);
            fs.writeFileSync(responseFilePath, responseText, 'utf-8');
            steps.push(`✓ Response saved to: ${responseFilePath}`);

            // Screenshot
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
