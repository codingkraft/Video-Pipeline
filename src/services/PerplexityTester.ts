import { Page } from 'puppeteer';
import { CaptiveBrowser } from '../browser/CaptiveBrowser';
import * as path from 'path';

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
     * 2. Attach files
     * 3. Enter prompt
     * 4. Change mode to Search
     * 5. Change LLM to Claude Sonnet 4.5
     * 6. Submit
     */
    public async testWorkflow(config: PerplexityTestConfig): Promise<{ success: boolean; message: string; details?: any }> {
        try {
            await this.browser.initialize();

            const page = await this.browser.getPage('perplexity-test', config.chatUrl || PERPLEXITY_URL);
            await this.browser.randomDelay(2000, 3000);

            const steps: string[] = [];

            // Step 1: Navigate to chat (if URL provided)
            if (config.chatUrl) {
                steps.push(`✓ Navigated to: ${config.chatUrl}`);
            } else {
                steps.push('✓ Opened Perplexity home');
            }

            // Step 2: Attach files
            if (config.files && config.files.length > 0) {
                try {
                    // Look for file upload button/input
                    const fileInputSelector = 'input[type="file"]';
                    const fileInput = await page.$(fileInputSelector);

                    if (fileInput) {
                        await fileInput.uploadFile(...config.files);
                        steps.push(`✓ Attached ${config.files.length} file(s)`);
                        await this.browser.randomDelay(2000, 3000);
                    } else {
                        // Try clicking attach button first
                        const attachButtonSelectors = [
                            'button[aria-label*="attach"]',
                            'button[aria-label*="upload"]',
                            '[data-testid*="attach"]',
                            'button:has-text("Attach")'
                        ];

                        let clicked = false;
                        for (const selector of attachButtonSelectors) {
                            try {
                                await page.click(selector);
                                clicked = true;
                                await this.browser.randomDelay(500, 1000);

                                const fileInput2 = await page.$('input[type="file"]');
                                if (fileInput2) {
                                    await fileInput2.uploadFile(...config.files);
                                    steps.push(`✓ Attached ${config.files.length} file(s)`);
                                }
                                break;
                            } catch (e) {
                                continue;
                            }
                        }

                        if (!clicked) {
                            steps.push('⚠ Could not find file upload button');
                        }
                    }
                } catch (error) {
                    steps.push(`⚠ File attachment error: ${(error as Error).message}`);
                }
            }

            // Step 3: Enter prompt
            try {
                const textareaSelectors = [
                    'textarea[placeholder*="Ask"]',
                    'textarea[placeholder*="follow"]',
                    'textarea',
                    '[contenteditable="true"]'
                ];

                let promptEntered = false;
                for (const selector of textareaSelectors) {
                    try {
                        await page.waitForSelector(selector, { timeout: 3000 });
                        await this.browser.humanType(page, selector, config.prompt);
                        steps.push('✓ Entered prompt');
                        promptEntered = true;
                        break;
                    } catch (e) {
                        continue;
                    }
                }

                if (!promptEntered) {
                    steps.push('⚠ Could not find prompt input');
                }

                await this.browser.randomDelay(1000, 1500);
            } catch (error) {
                steps.push(`⚠ Prompt entry error: ${(error as Error).message}`);
            }

            // Step 4: Change mode to Search
            try {
                const modeSelectors = [
                    'button[aria-label*="mode"]',
                    'button:has-text("Focus")',
                    '[data-testid*="mode"]',
                    'button:has-text("Search")'
                ];

                let modeChanged = false;
                for (const selector of modeSelectors) {
                    try {
                        await page.click(selector);
                        await this.browser.randomDelay(500, 1000);

                        // Try to click "Search" option
                        const searchOption = await page.$('button:has-text("Search"), [role="menuitem"]:has-text("Search")');
                        if (searchOption) {
                            await searchOption.click();
                            steps.push('✓ Changed mode to Search');
                            modeChanged = true;
                        }
                        break;
                    } catch (e) {
                        continue;
                    }
                }

                if (!modeChanged) {
                    steps.push('⚠ Could not change mode (may already be in Search mode)');
                }

                await this.browser.randomDelay(1000, 1500);
            } catch (error) {
                steps.push(`⚠ Mode change error: ${(error as Error).message}`);
            }

            // Step 5: Change LLM to Claude Sonnet 4.5
            try {
                const modelSelectors = [
                    'button[aria-label*="model"]',
                    'button[aria-label*="AI"]',
                    '[data-testid*="model"]',
                    'button:has-text("GPT")',
                    'button:has-text("Claude")'
                ];

                let modelChanged = false;
                for (const selector of modelSelectors) {
                    try {
                        await page.click(selector);
                        await this.browser.randomDelay(500, 1000);

                        // Try to click Claude Sonnet 4.5
                        const claudeSelectors = [
                            'button:has-text("Claude")',
                            'button:has-text("Sonnet")',
                            '[role="menuitem"]:has-text("Claude")',
                            '[role="menuitem"]:has-text("4.5")'
                        ];

                        for (const claudeSelector of claudeSelectors) {
                            try {
                                await page.click(claudeSelector);
                                steps.push('✓ Changed LLM to Claude Sonnet 4.5');
                                modelChanged = true;
                                break;
                            } catch (e) {
                                continue;
                            }
                        }

                        if (modelChanged) break;
                    } catch (e) {
                        continue;
                    }
                }

                if (!modelChanged) {
                    steps.push('⚠ Could not change LLM (selectors may need updating)');
                }

                await this.browser.randomDelay(1000, 1500);
            } catch (error) {
                steps.push(`⚠ LLM change error: ${(error as Error).message}`);
            }

            // Step 6: Submit
            try {
                // Press Enter or click submit button
                await page.keyboard.press('Enter');
                steps.push('✓ Submitted query');
                await this.browser.randomDelay(2000, 3000);
            } catch (error) {
                steps.push(`⚠ Submit error: ${(error as Error).message}`);
            }

            // Take screenshot for verification
            const screenshotPath = path.join(process.cwd(), 'perplexity_test_screenshot.png');
            await page.screenshot({ path: screenshotPath });
            steps.push(`✓ Screenshot saved: ${screenshotPath}`);

            return {
                success: true,
                message: 'Perplexity test completed',
                details: {
                    steps,
                    screenshotPath,
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
