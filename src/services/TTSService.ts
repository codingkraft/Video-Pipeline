import { Page } from 'puppeteer';
import { CaptiveBrowser } from '../browser/CaptiveBrowser';
import * as path from 'path';
import * as fs from 'fs';

const GOOGLE_TTS_URL = 'https://cloud.google.com/text-to-speech';

export interface TTSConfig {
    text: string;
    voice?: string;
    languageCode?: string;
    speakingRate?: number;
    pitch?: number;
}

export interface TTSResult {
    audioPath: string;
    duration: number;
}

export class TTSService {
    private browser: CaptiveBrowser;
    private page: Page | null = null;

    constructor() {
        this.browser = CaptiveBrowser.getInstance();
    }

    /**
     * Initialize the TTS page.
     * Note: Google Cloud TTS requires API access. This implementation uses the demo page.
     * For production, consider using the API directly with service account credentials.
     */
    public async initialize(): Promise<void> {
        // Navigate to Google Cloud TTS demo page
        this.page = await this.browser.getPage('tts', GOOGLE_TTS_URL);
        await this.browser.randomDelay(2000, 4000);
    }

    /**
     * Generate speech from text using Google TTS.
     * @param config TTS configuration
     * @param outputDir Directory to save the audio file
     */
    public async generateSpeech(
        config: TTSConfig,
        outputDir: string
    ): Promise<TTSResult> {
        if (!this.page) {
            await this.initialize();
        }

        const page = this.page!;

        // Look for the TTS demo/playground area
        const demoAreaSelector = '[class*="demo"], [class*="playground"], textarea';
        await page.waitForSelector(demoAreaSelector, { timeout: 15000 });

        await this.browser.randomDelay(1000, 2000);

        // Find text input area
        const textInputSelector = 'textarea[aria-label*="text"], textarea, [contenteditable="true"]';

        try {
            await page.waitForSelector(textInputSelector, { timeout: 10000 });

            // Clear existing text and input new text
            await page.click(textInputSelector, { clickCount: 3 });
            await this.browser.humanType(page, textInputSelector, config.text);

            await this.browser.randomDelay(500, 1000);
        } catch (error) {
            console.log('Text input area not found:', error);
            throw new Error('Could not find TTS text input');
        }

        // Configure voice settings if available
        if (config.voice || config.languageCode) {
            await this.configureVoiceSettings(config);
        }

        // Click synthesize/generate button
        const synthesizeSelector = 'button:has-text("Speak"), button:has-text("Synthesize"), button:has-text("Generate")';

        try {
            await page.click(synthesizeSelector);
            await this.browser.randomDelay(3000, 5000);
        } catch {
            console.log('Synthesize button not found');
        }

        // Wait for audio generation
        console.log('TTS generation in progress...');
        await this.browser.randomDelay(5000, 10000);

        // Download the audio
        const audioPath = await this.downloadAudio(outputDir);

        // Estimate duration (rough calculation based on text length)
        const wordsPerMinute = 150;
        const wordCount = config.text.split(/\s+/).length;
        const estimatedDuration = (wordCount / wordsPerMinute) * 60;

        return {
            audioPath,
            duration: estimatedDuration,
        };
    }

    /**
     * Configure voice settings.
     */
    private async configureVoiceSettings(config: TTSConfig): Promise<void> {
        if (!this.page) return;

        const page = this.page;

        try {
            // Language selection
            if (config.languageCode) {
                const langSelector = 'select[aria-label*="language"], [role="listbox"]';
                const langOption = await page.$(langSelector);
                if (langOption) {
                    await page.select(langSelector, config.languageCode);
                    await this.browser.randomDelay(500, 1000);
                }
            }

            // Voice selection
            if (config.voice) {
                const voiceSelector = 'select[aria-label*="voice"], [aria-label*="Voice"]';
                const voiceOption = await page.$(voiceSelector);
                if (voiceOption) {
                    await page.select(voiceSelector, config.voice);
                    await this.browser.randomDelay(500, 1000);
                }
            }

            // Speaking rate
            if (config.speakingRate !== undefined) {
                const rateSelector = 'input[aria-label*="rate"], input[type="range"]';
                const rateInput = await page.$(rateSelector);
                if (rateInput) {
                    await rateInput.click();
                    // Adjust rate value
                }
            }
        } catch (error) {
            console.log('Could not configure all voice settings:', error);
        }
    }

    /**
     * Download the generated audio.
     */
    private async downloadAudio(outputDir: string): Promise<string> {
        if (!this.page) {
            throw new Error('Page not initialized');
        }

        const page = this.page;
        const outputPath = path.join(outputDir, `tts_audio_${Date.now()}.mp3`);

        // Set up download behavior
        const client = await page.createCDPSession();
        await client.send('Page.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: outputDir,
        });

        // Look for download button or audio element
        const downloadSelector = 'a[download], button:has-text("Download"), audio';

        try {
            const audioElement = await page.$('audio');
            if (audioElement) {
                const audioSrc = await page.evaluate(el => (el as HTMLAudioElement).src, audioElement);
                if (audioSrc) {
                    console.log(`Audio URL found: ${audioSrc}`);
                    // In production, download the audio file here
                }
            }

            await page.click(downloadSelector);
            console.log(`Downloading audio to ${outputDir}...`);
            await this.browser.randomDelay(5000, 10000);
        } catch {
            console.log('Download button not found, audio may need to be extracted differently');
        }

        return outputPath;
    }

    /**
     * Close the TTS page.
     */
    public async close(): Promise<void> {
        await this.browser.closePage('tts');
        this.page = null;
    }
}
