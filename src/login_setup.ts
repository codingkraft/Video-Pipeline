// Login Setup Script
// This script opens all services and keeps the browser open for you to log in
// Press Ctrl+C when done to close the browser

import { CaptiveBrowser } from './browser/CaptiveBrowser';

const SERVICES = {
    perplexity: 'https://www.perplexity.ai/',
    notebooklm: 'https://notebooklm.google.com/',
    gemini: 'https://gemini.google.com/',
    googleTTS: 'https://cloud.google.com/text-to-speech',
};

async function loginSetup() {
    console.log('=================================');
    console.log('  Login Setup for Video Creator');
    console.log('=================================\n');

    const browser = CaptiveBrowser.getInstance();

    try {
        console.log('Initializing browser...');
        await browser.initialize();
        console.log('✅ Browser initialized\n');

        console.log('Opening all services in separate tabs...\n');

        // Open each service in a new tab
        for (const [name, url] of Object.entries(SERVICES)) {
            console.log(`Opening ${name}: ${url}`);
            await browser.getPage(name, url);
            await browser.randomDelay(1000, 2000);
        }

        console.log('\n=================================');
        console.log('✅ All services opened!');
        console.log('=================================\n');
        console.log('Please log into each service:');
        console.log('  1. Perplexity AI');
        console.log('  2. NotebookLM (Google account)');
        console.log('  3. Gemini (Google account)');
        console.log('  4. Google Cloud TTS (optional)\n');
        console.log('Your sessions will be saved automatically.');
        console.log('\n⏳ Browser will stay open...');
        console.log('Press Ctrl+C when you\'re done logging in.\n');

        // Keep the process alive
        await new Promise(() => { }); // Never resolves

    } catch (error) {
        console.error('Error:', error);
    }
}

// Handle Ctrl+C gracefully
process.on('SIGINT', async () => {
    console.log('\n\n✅ Login setup complete!');
    console.log('Sessions have been saved to: C:\\Users\\Nitin\\.video-creator\\browser-profile');
    console.log('You can now run: npm run dev\n');
    process.exit(0);
});

loginSetup().catch(console.error);
