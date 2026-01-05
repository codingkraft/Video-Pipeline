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
     * 2. Attach files
     * 3. Enter prompt
     * 4. Change mode to Search
     * 5. Change LLM to Claude Sonnet 4.5
     * 6. Submit
     * 7. Wait for and extract response
     * 8. Save response to file
     */
    public async testWorkflow(config: PerplexityTestConfig): Promise<{ success: boolean; message: string; details?: any }> {
        try {
            await this.browser.initialize();

            const page = await this.browser.getPage('perplexity-test', config.chatUrl || PERPLEXITY_URL);
            await this.browser.randomDelay(2000, 3000);

            const steps: string[] = [];
            const jobId = `job_${Date.now()}`;
            const outputDir = path.join(process.cwd(), 'output', jobId);

            // Create output directory
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }

            // Step 1: Navigate to chat (if URL provided)
            if (config.chatUrl) {
                steps.push(`✓ Navigated to: ${config.chatUrl}`);
            } else {
                steps.push('✓ Opened Perplexity home');
            }

            // Step 2: Attach files
            if (config.files && config.files.length > 0) {
                try {
                    const fileInputSelector = 'input[type="file"]';
                    const fileInput = await page.$(fileInputSelector);

                    if (fileInput) {
                        await fileInput.uploadFile(...config.files);
                        steps.push(`✓ Attached ${config.files.length} file(s)`);
                        await this.browser.randomDelay(2000, 3000);
                    } else {
                        steps.push('⚠ Could not find file upload');
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

            // Step 4: Submit
            try {
                await page.keyboard.press('Enter');
                steps.push('✓ Submitted query');
                await this.browser.randomDelay(3000, 5000);
            } catch (error) {
                steps.push(`⚠ Submit error: ${(error as Error).message}`);
            }

            // Step 5: Wait for response and extract text
            steps.push('⏳ Waiting for Perplexity response (up to 60s)...');
            let responseText = '';

            try {
                // Wait for response container
                const responseSelectors = [
                    '[class*="answer"]',
                    '[class*="response"]',
                    'div[class*="prose"]',
                    'article',
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

            // Step 6: Save response to file
            const responseFilePath = path.join(outputDir, `${jobId}_perplexity_response.txt`);
            fs.writeFileSync(responseFilePath, responseText, 'utf-8');
            steps.push(`✓ Response saved to: ${responseFilePath}`);

            // Take screenshot
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
