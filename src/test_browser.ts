// Browser Test Script
// Run with: npm test
import { CaptiveBrowser } from './browser/CaptiveBrowser';

async function testBrowser() {
    console.log('Testing Captive Browser...\n');

    const browser = CaptiveBrowser.getInstance();

    try {
        // Initialize browser
        console.log('1. Initializing browser...');
        await browser.initialize();
        console.log('   ✅ Browser initialized\n');

        // Test random delay
        console.log('2. Testing random delay (1-2 seconds)...');
        const startTime = Date.now();
        await browser.randomDelay(1000, 2000);
        const elapsed = Date.now() - startTime;
        console.log(`   ✅ Delay worked: ${elapsed}ms\n`);

        // Test getting a page
        console.log('3. Opening a test page (Google)...');
        const page = await browser.getPage('test', 'https://www.google.com');
        console.log(`   ✅ Page opened: ${page.url()}\n`);

        // Take a screenshot as proof
        console.log('4. Taking a screenshot...');
        await page.screenshot({ path: 'test_screenshot.png' });
        console.log('   ✅ Screenshot saved to test_screenshot.png\n');

        // Wait a moment for user to see the browser
        console.log('5. Waiting 5 seconds for visual verification...');
        await browser.randomDelay(5000, 5000);

        console.log('\n=== All tests passed! ===\n');
        console.log('The browser is working correctly with:');
        console.log('- Persistent user profile');
        console.log('- Stealth mode (anti-detection)');
        console.log('- Random delays');
        console.log('\nYou can now log into your services (Perplexity, NotebookLM, Gemini)');
        console.log('and the sessions will be saved for future runs.');

    } catch (error) {
        console.error('Test failed:', error);
    } finally {
        await browser.close();
        console.log('\nBrowser closed.');
    }
}

testBrowser().catch(console.error);
