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
    profileId?: string;  // Profile ID for multi-profile support
}

export class CaptiveBrowser {
    private static instance: CaptiveBrowser;
    private browser: Browser | null = null;
    private pages: Map<string, Page> = new Map();
    private config: BrowserConfig;
    private currentProfileId: string = 'default';

    private constructor(config?: Partial<BrowserConfig>) {
        const defaultUserDataDir = path.join(os.homedir(), '.video-creator', 'browser-profile');

        this.config = {
            headless: false, // Keep visible for login and debugging
            userDataDir: config?.userDataDir ?? defaultUserDataDir,
            defaultViewport: config?.defaultViewport ?? { width: 1920, height: 1080 },
            profileId: config?.profileId ?? 'default',
        };
        this.currentProfileId = this.config.profileId ?? 'default';
    }

    public static getInstance(config?: Partial<BrowserConfig>): CaptiveBrowser {
        if (!CaptiveBrowser.instance) {
            CaptiveBrowser.instance = new CaptiveBrowser(config);
        }
        return CaptiveBrowser.instance;
    }

    /**
     * Get the user data directory for a specific profile
     */
    public static getProfileDir(profileId: string): string {
        return path.join(os.homedir(), '.video-creator', 'profiles', profileId);
    }

    public async initialize(config?: Partial<BrowserConfig>): Promise<void> {
        // Update config if provided
        if (config) {
            const newProfileId = config.profileId ?? this.currentProfileId;
            const profileChanged = newProfileId !== this.currentProfileId;
            const headlessChanged = config.headless !== undefined && config.headless !== this.config.headless;

            // Update userDataDir based on profile
            if (config.profileId) {
                config.userDataDir = CaptiveBrowser.getProfileDir(config.profileId);
            }

            this.config = { ...this.config, ...config };

            // Restart browser if profile or headless mode changed
            if (this.browser && (profileChanged || headlessChanged)) {
                console.log(`Profile changed from ${this.currentProfileId} to ${newProfileId}, restarting browser...`);
                try {
                    await this.browser.close();
                    // Wait for Chrome process to fully exit before relaunching
                    console.log('Waiting for browser process to exit...');
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } catch (e) {
                    console.log('Browser close encountered an error (may already be closed):', (e as Error).message);
                }
                this.browser = null;
                this.pages.clear();
            }

            this.currentProfileId = newProfileId;
        }

        if (this.browser) {
            // Check if browser is actually still connected
            const isConnected = this.browser.isConnected();
            if (isConnected) {
                console.log(`Browser already initialized with profile: ${this.currentProfileId}`);
                return;
            } else {
                console.log('Browser instance exists but is disconnected, reinitializing...');
                this.browser = null;
                this.pages.clear();
            }
        }

        console.log(`Launching browser with profile: ${this.currentProfileId} (${this.config.userDataDir})`);


        const startMinimized = this.config.headless; // "headless" config now triggers minimized mode

        const args = [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--disable-infobars',
        ];

        if (startMinimized) {
            args.push('--start-minimized');
        } else {
            args.push('--start-maximized');
        }

        this.browser = await puppeteerExtra.launch({
            headless: false, // Always visible (false), just minimized if requested
            userDataDir: this.config.userDataDir,
            defaultViewport: null, // Use full screen viewport
            args: args,
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

    /**
     * Perform a browser action with robust retry logic and validation.
     * 
     * @param actionName Friendly name for the action (for logging)
     * @param action Async function to perform the action (e.g. clicking a button)
     * @param validation Optional async function to verify success (e.g. waiting for a modal). 
     *                   Should return true if successful, false otherwise.
     *                   If omitted, the action is assumed successful if it doesn't throw.
     * @param options Retry configuration
     */
    public async performAction(
        actionName: string,
        action: () => Promise<void>,
        validation?: () => Promise<boolean>,
        options: { maxRetries?: number; retryDelay?: number; timeout?: number } = {}
    ): Promise<boolean> {
        const maxRetries = options.maxRetries ?? 3;
        const retryDelay = options.retryDelay ?? 2000;

        console.log(`[Action] Attempting: ${actionName}`);

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                // Perform the action
                await action();

                // If no validation provided, we assume success if no error thrown
                if (!validation) {
                    console.log(`[Action] ${actionName} completed (no validation needed)`);
                    return true;
                }

                // Verify success
                // Give it a moment for UI to update before validating
                await this.randomDelay(500, 1000);

                const isValid = await validation();
                if (isValid) {
                    console.log(`[Action] ${actionName} verified success on attempt ${attempt}`);
                    return true;
                } else {
                    console.warn(`[Action] ${actionName} validation failed on attempt ${attempt}`);
                }
            } catch (error) {
                console.warn(`[Action] ${actionName} error on attempt ${attempt}: ${(error as Error).message}`);
            }

            // If we are here, action failed or validation failed
            if (attempt < maxRetries) {
                console.log(`[Action] Retrying ${actionName} in ${retryDelay}ms...`);
                await this.randomDelay(retryDelay, retryDelay + 1000);
            }
        }

        console.error(`[Action] ${actionName} failed after ${maxRetries} attempts`);
        return false;
    }

    public getCurrentProfileId(): string {
        return this.currentProfileId;
    }
}
