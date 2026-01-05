# Login System Explanation

## How It Works

### 1. **Setup Login**
When you click "Setup Login":
- Opens a Puppeteer browser with a persistent profile at `~/.video-creator/browser-profile`
- Opens tabs for Perplexity, NotebookLM, and Gemini
- Browser stays open for you to manually log in
- All cookies/sessions are automatically saved to the profile folder

### 2. **After Logging In**
You can:
- **Close the browser manually** - Sessions are already saved!
- **Click "Verify Sessions"** - Checks if you're logged in

### 3. **Verify Sessions**
When you click "Verify Sessions":
- **If browser is still open**: Checks each service's URL for login keywords
- **If browser is closed**: Shows "✓ Sessions saved (browser closed)"
  - This is NORMAL and EXPECTED
  - Your sessions are saved in the profile
  - They will be used when you generate videos

### 4. **When Generating Videos**
The pipeline will:
- Launch a new browser using the same profile
- All your saved cookies/sessions will be loaded
- You'll already be logged in to all services
- No manual login needed!

## Why "Checking..." Gets Stuck

If "Verify Sessions" shows "Checking..." forever, it means:
- The server might be trying to access a closed browser
- **Solution**: Refresh the page and try again
- Or just proceed with video generation - your sessions are saved!

## Important Notes

✅ **Sessions are saved** even after closing the browser
✅ **You only need to log in once** (until cookies expire)
✅ **"Browser closed" message is GOOD** - it means sessions are saved
✅ **Supported files now include images**: .jpg, .jpeg, .png, .gif, .webp, .bmp

## Quick Test

1. Click "Setup Login"
2. Log into all 3 services
3. Close the browser
4. Refresh the page
5. Click "Verify Sessions" → Should show "✓ Sessions saved (browser closed)"
6. Try generating a video → Browser will open with you already logged in!

Your sessions persist because Puppeteer uses a persistent profile directory that stores all cookies and local storage data.
