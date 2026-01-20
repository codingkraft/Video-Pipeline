import puppeteer, { Browser, Page } from 'puppeteer';
import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import path from 'path';
import os from 'os';

// Apply stealth plugin with all evasions enabled
const stealthPlugin = StealthPlugin();
// Enable all evasions for maximum anti-bot-detection
stealthPlugin.enabledEvasions.add('chrome.app');
stealthPlugin.enabledEvasions.add('chrome.csi');
stealthPlugin.enabledEvasions.add('chrome.loadTimes');
stealthPlugin.enabledEvasions.add('chrome.runtime');
stealthPlugin.enabledEvasions.add('defaultArgs');
stealthPlugin.enabledEvasions.add('iframe.contentWindow');
stealthPlugin.enabledEvasions.add('media.codecs');
stealthPlugin.enabledEvasions.add('navigator.hardwareConcurrency');
stealthPlugin.enabledEvasions.add('navigator.languages');
stealthPlugin.enabledEvasions.add('navigator.permissions');
stealthPlugin.enabledEvasions.add('navigator.plugins');
stealthPlugin.enabledEvasions.add('navigator.vendor');
stealthPlugin.enabledEvasions.add('navigator.webdriver');
stealthPlugin.enabledEvasions.add('sourceurl');
stealthPlugin.enabledEvasions.add('user-agent-override');
stealthPlugin.enabledEvasions.add('webgl.vendor');
stealthPlugin.enabledEvasions.add('window.outerdimensions');
puppeteerExtra.use(stealthPlugin);

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
    private initializationPromise: Promise<void> | null = null;  // Lock to prevent parallel browser launches

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
        // If initialization is already in progress, wait for it to complete
        if (this.initializationPromise) {
            console.log('Browser initialization already in progress, waiting...');
            await this.initializationPromise;
            // After waiting, check if we need to change profiles
            if (!config?.profileId || config.profileId === this.currentProfileId) {
                return;
            }
            // Profile change needed - continue to handle it below
        }

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

        // Create the initialization promise (lock)
        this.initializationPromise = (async () => {
            console.log(`Launching browser with profile: ${this.currentProfileId} (${this.config.userDataDir})`);

            const startMinimized = this.config.headless; // "headless" config now triggers minimized mode

            const args = [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--disable-infobars',
                // Disable background tab throttling for parallel automation
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding',
                '--disable-background-networking',
                // Enable WebGL and WebAssembly (required by some sites like notebooklmremover)
                '--enable-webgl',
                '--enable-accelerated-2d-canvas',
                '--enable-gpu-rasterization',
                '--enable-features=SharedArrayBuffer',
                '--disable-features=IsolateOrigins,site-per-process',
                // Make it appear more like a regular browser
                '--disable-popup-blocking',
                '--disable-extensions',
                '--disable-dev-shm-usage',
                '--ignore-certificate-errors',
                // Window settings
                '--window-size=1920,1080',
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
        })();

        try {
            await this.initializationPromise;
        } finally {
            // Clear the lock after completion (success or failure)
            this.initializationPromise = null;
        }
    }

    /**
     * Get a page for a specific service. Creates a new tab if one doesn't exist.
     * If a URL is provided and the page already exists, navigates to that URL.
     */
    public async getPage(serviceKey: string, url?: string): Promise<Page> {
        if (!this.browser) {
            throw new Error('Browser not initialized. Call initialize() first.');
        }

        let page = this.pages.get(serviceKey);
        let needsNavigation = false;

        if (!page || page.isClosed()) {
            page = await this.browser.newPage();
            this.pages.set(serviceKey, page);
            needsNavigation = true;
        } else if (url) {
            // Page exists - check if we need to navigate to a different URL
            const currentUrl = page.url();
            if (currentUrl !== url && !currentUrl.includes(url) && !url.includes(currentUrl)) {
                needsNavigation = true;
            }
        }

        if (needsNavigation && url) {
            await page.goto(url, { waitUntil: 'networkidle2' });
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

    /**
     * Execute work within a modular recovery context.
     * Pattern: Open Page → Execute Work → Close Page
     * On failure: closes page, retries from opening (up to maxRetries).
     * After all retries exhausted, throws to allow caller to skip to next folder.
     * 
     * @param serviceKey Unique key for this service/module
     * @param url URL to navigate to when opening the page
     * @param work Async function that performs the actual work, receives the Page
     * @param options Configuration for retries and cleanup
     * @returns The result from the work function
     */
    public async withModularRecovery<T>(
        serviceKey: string,
        url: string,
        work: (page: Page) => Promise<T>,
        options?: {
            maxRetries?: number;
            onBeforeRetry?: () => Promise<void>;
        }
    ): Promise<T> {
        const maxRetries = options?.maxRetries ?? 3;
        let lastError: Error | null = null;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`[ModularRecovery] ${serviceKey}: Starting attempt ${attempt}/${maxRetries}`);

                // Step 1: Open page (fresh navigation)
                const page = await this.getPage(serviceKey, url);
                await this.randomDelay(1000, 2000);

                try {
                    // Step 2: Execute work
                    const result = await work(page);

                    // Step 3: Close page on success
                    console.log(`[ModularRecovery] ${serviceKey}: Success, closing page`);
                    await this.closePage(serviceKey);

                    return result;
                } catch (workError) {
                    // Work failed - close page before retry
                    console.error(`[ModularRecovery] ${serviceKey}: Work failed on attempt ${attempt}:`, (workError as Error).message);
                    lastError = workError as Error;

                    try {
                        await this.closePage(serviceKey);
                    } catch (closeError) {
                        console.warn(`[ModularRecovery] ${serviceKey}: Error closing page:`, (closeError as Error).message);
                    }

                    throw workError; // Re-throw to trigger retry logic below
                }
            } catch (error) {
                lastError = error as Error;

                if (attempt < maxRetries) {
                    console.log(`[ModularRecovery] ${serviceKey}: Retrying in 3 seconds... (attempt ${attempt}/${maxRetries})`);

                    // Optional cleanup before retry
                    if (options?.onBeforeRetry) {
                        try {
                            await options.onBeforeRetry();
                        } catch (cleanupError) {
                            console.warn(`[ModularRecovery] ${serviceKey}: Cleanup error:`, (cleanupError as Error).message);
                        }
                    }

                    await new Promise(resolve => setTimeout(resolve, 3000));
                }
            }
        }

        // All retries exhausted - throw to let caller handle (skip to next folder)
        const finalError = new Error(`[ModularRecovery] ${serviceKey}: Failed after ${maxRetries} attempts. Last error: ${lastError?.message}`);
        console.error(finalError.message);
        throw finalError;
    }

    public getCurrentProfileId(): string {
        return this.currentProfileId;
    }
}
