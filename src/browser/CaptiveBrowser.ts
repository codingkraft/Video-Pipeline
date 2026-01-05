import puppeteer, { Browser, Page } from 'puppeteer';
import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import path from 'path';
import os from 'os';

// Apply stealth plugin to avoid bot detection
puppeteerExtra.use(StealthPlugin());

export interface BrowserConfig {
    headless: boolean;
    userDataDir: string;
    defaultViewport: { width: number; height: number };
}

export class CaptiveBrowser {
    private static instance: CaptiveBrowser;
    private browser: Browser | null = null;
    private pages: Map<string, Page> = new Map();
    private config: BrowserConfig;

    private constructor(config?: Partial<BrowserConfig>) {
        const defaultUserDataDir = path.join(os.homedir(), '.video-creator', 'browser-profile');

        this.config = {
            headless: false, // Keep visible for login and debugging
            userDataDir: config?.userDataDir ?? defaultUserDataDir,
            defaultViewport: config?.defaultViewport ?? { width: 1920, height: 1080 },
        };
    }

    public static getInstance(config?: Partial<BrowserConfig>): CaptiveBrowser {
        if (!CaptiveBrowser.instance) {
            CaptiveBrowser.instance = new CaptiveBrowser(config);
        }
        return CaptiveBrowser.instance;
    }

    public async initialize(): Promise<void> {
        if (this.browser) {
            console.log('Browser already initialized');
            return;
        }

        console.log(`Launching browser with profile: ${this.config.userDataDir}`);

        this.browser = await puppeteerExtra.launch({
            headless: this.config.headless,
            userDataDir: this.config.userDataDir,
            defaultViewport: null, // Use full screen viewport
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--disable-infobars',
                '--start-maximized', // Start maximized to fit screen
            ],
        });

        console.log('Browser launched successfully');
    }

    /**
     * Get a page for a specific service. Creates a new tab if one doesn't exist.
     */
    public async getPage(serviceKey: string, url?: string): Promise<Page> {
        if (!this.browser) {
            throw new Error('Browser not initialized. Call initialize() first.');
        }

        let page = this.pages.get(serviceKey);

        if (!page || page.isClosed()) {
            page = await this.browser.newPage();
            this.pages.set(serviceKey, page);

            if (url) {
                await page.goto(url, { waitUntil: 'networkidle2' });
            }
        }

        return page;
    }

    /**
     * Add a random delay to mimic human behavior.
     * @param minMs Minimum delay in milliseconds
     * @param maxMs Maximum delay in milliseconds
     */
    public async randomDelay(minMs: number = 500, maxMs: number = 2000): Promise<void> {
        const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
        console.log(`Waiting ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
    }

    /**
     * Type text with human-like delays between keystrokes.
     */
    public async humanType(page: Page, selector: string, text: string): Promise<void> {
        await page.click(selector);
        for (const char of text) {
            await page.keyboard.type(char, { delay: Math.random() * 100 + 50 });
        }
    }

    /**
     * Close a specific page/tab.
     */
    public async closePage(serviceKey: string): Promise<void> {
        const page = this.pages.get(serviceKey);
        if (page && !page.isClosed()) {
            await page.close();
        }
        this.pages.delete(serviceKey);
    }

    /**
     * Close the browser entirely.
     */
    public async close(): Promise<void> {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            this.pages.clear();
        }
    }

    public getBrowser(): Browser | null {
        return this.browser;
    }
}
