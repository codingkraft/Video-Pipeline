# Video Creator - Automated Video Generation Pipeline

Automate video creation from documents using AI services (Perplexity, NotebookLM, Gemini, Google TTS) with a beautiful web UI.

## 🚀 Features

- **📂 Multi-Folder Support** - Select multiple folders with documents and images
- **🔐 Session Management** - Login once, sessions persist automatically
- **⚙️ Settings Persistence** - All configurations saved to localStorage
- **📊 Real-Time Progress** - Live updates via WebSocket
- **🧪 Testing Tools** - Test individual components before full pipeline
- **🎨 Modern UI** - Beautiful dark theme with animations

## 📋 Requirements

- **Node.js** 18+ and npm
- **FFmpeg** - For video processing ([Download](https://ffmpeg.org/download.html))
- **Chromium/Chrome** - Installed automatically with Puppeteer

## 🛠️ Installation

```bash
# Install dependencies
npm install

# Install FFmpeg (Windows with winget)
winget install --id=Gyan.FFmpeg -e
```

## 🎯 Quick Start

### 1. Start the UI
```bash
npm run ui
```
Open: http://localhost:3000

### 2. Setup Login (First Time Only)
- Click "🔐 Setup Login"
- Log into Perplexity, NotebookLM, and Gemini
- Sessions are saved automatically

### 3. Create Videos
- Click "📂 Add Folder" to select documents/images
- Configure settings (saved automatically)
- Click "🚀 Generate Video"
- Watch real-time progress!

## 📁 Supported File Types

**Documents:** `.pdf`, `.txt`, `.md`, `.doc`, `.docx`  
**Images:** `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.bmp`

## 🧪 Testing

```bash
# Test browser functionality
npm run test

# Test Perplexity workflow (via UI)
Click "🧪 Test Perplexity" button

# Run example pipeline
npm run example
```

## 📂 Project Structure

```
video-creator/
├── src/
│   ├── browser/
│   │   └── CaptiveBrowser.ts      # Puppeteer wrapper with stealth
│   ├── services/
│   │   ├── PerplexityService.ts   # Prompt generation
│   │   ├── NotebookLMService.ts   # Notebook & video creation
│   │   ├── GeminiService.ts       # Gemini video generation
│   │   ├── TTSService.ts          # Text-to-speech
│   │   └── PerplexityTester.ts    # Test automation
│   ├── processing/
│   │   └── VideoProcessor.ts      # FFmpeg video/audio processing
│   ├── workflow/
│   │   └── VideoPipeline.ts       # Main orchestrator
│   ├── server.ts                  # Express + Socket.IO server
│   └── index.ts                   # CLI entry point
├── public/
│   ├── index.html                 # Web UI
│   ├── styles.css                 # Modern dark theme
│   └── app.js                     # Frontend logic
└── sample_docs/                   # Example documents
```

## ⚙️ Configuration

All settings are saved automatically in the UI:
- **Perplexity Chat URL** - Use existing chat or create new
- **Prompt Text** - Video generation prompt
- **NotebookLM Settings** - Chat instructions and style
- **Gemini Style** - Video style preferences
- **Output Directory** - Custom save location

## 🔧 Available Commands

```bash
npm run ui        # Start web UI (recommended)
npm run dev       # Run CLI pipeline
npm run test      # Test browser
npm run login     # Manual login setup
npm run example   # Process sample document
npm run build     # Compile TypeScript
```

## 🌐 How It Works

1. **Perplexity** - Generates creative video prompts from documents
2. **NotebookLM** - Creates notebook, uploads docs, generates video
3. **Gemini** - Generates additional video content
4. **Google TTS** - Creates narration audio from script
5. **FFmpeg** - Combines videos and syncs audio

## 🔐 Session Management

- Browser profile stored at: `~/.video-creator/browser-profile`
- Login once, sessions persist across runs
- Verify sessions anytime with "✓ Verify Sessions" button

## 📝 Notes

- **Processing Time**: ~10-20 minutes per video
- **Concurrent Processing**: 2 videos at a time (configurable)
- **Web Selectors**: May need updates if service UIs change
- **Rate Limiting**: Random delays built-in to avoid bans

## 🐛 Troubleshooting

**Browser closes immediately?**
- Run `npm run login` to re-authenticate

**Selectors not found?**
- Website UI may have changed
- Check console for errors
- Update selectors in service files

**FFmpeg errors?**
- Ensure FFmpeg is installed and in PATH
- Restart terminal after installation

## 📄 License

MIT

## 🤝 Contributing

This is a personal automation project. Feel free to fork and adapt for your needs!

---

**Made with ❤️ for automated video creation**
