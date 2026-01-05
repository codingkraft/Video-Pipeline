import { Page } from 'puppeteer';
import { CaptiveBrowser } from '../browser/CaptiveBrowser';

const PERPLEXITY_URL = 'https://www.perplexity.ai/';

export interface PerplexityResult {
    prompt: string;
    response: string;
}

export class PerplexityService {
    private browser: CaptiveBrowser;
    private page: Page | null = null;

    constructor() {
        this.browser = CaptiveBrowser.getInstance();
    }

    /**
     * Initialize the Perplexity page and navigate to the site.
     */
    public async initialize(): Promise<void> {
        this.page = await this.browser.getPage('perplexity', PERPLEXITY_URL);
        await this.browser.randomDelay(1000, 2000);
    }

    /**
     * Generate a video prompt based on input documents.
     * @param documentContent The content of the documents to analyze
     * @param customInstructions Additional instructions for prompt generation
     */
    public async generateVideoPrompt(
        documentContent: string,
        customInstructions?: string
    ): Promise<PerplexityResult> {
        if (!this.page) {
            await this.initialize();
        }

        const page = this.page!;

        // Construct the query for Perplexity
        const query = `Based on the following document content, generate a creative and engaging video prompt that would work well for AI video generation. Focus on visual storytelling elements.

${customInstructions ? `Additional instructions: ${customInstructions}\n\n` : ''}
Document content:
${documentContent}

Please provide:
1. A concise video generation prompt (1-2 sentences)
2. Style suggestions for the video`;

        // Wait for the text input to be available
        await this.browser.randomDelay(500, 1500);

        // Find and click the search/input area
        const inputSelector = 'textarea[placeholder*="Ask"]';
        await page.waitForSelector(inputSelector, { timeout: 10000 });

        // Type the query with human-like delays
        await this.browser.humanType(page, inputSelector, query);

        await this.browser.randomDelay(500, 1000);

        // Submit the query (press Enter)
        await page.keyboard.press('Enter');

        // Wait for the response to generate
        await this.browser.randomDelay(5000, 10000);

        // Wait for the response to appear
        // Note: This selector may need adjustment based on Perplexity's actual DOM structure
        const responseSelector = '[class*="prose"]';
        await page.waitForSelector(responseSelector, { timeout: 60000 });

        // Extract the response text
        const responseText = await page.evaluate((selector) => {
            const elements = document.querySelectorAll(selector);
            const lastElement = elements[elements.length - 1];
            return lastElement?.textContent || '';
        }, responseSelector);

        return {
            prompt: query,
            response: responseText,
        };
    }

    /**
     * Close the Perplexity page.
     */
    public async close(): Promise<void> {
        await this.browser.closePage('perplexity');
        this.page = null;
    }
}
