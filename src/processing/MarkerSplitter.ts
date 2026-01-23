import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';

const execAsync = promisify(exec);

/**
 * Result from audio marker detection and splitting
 */
export interface MarkerSplitResult {
    success: boolean;
    message: string;
    markerCount: number;
    slideFiles: string[];
}

/**
 * Configuration for marker-based audio splitting
 */
export interface MarkerSplitConfig {
    audioFile: string;           // Path to input audio file
    outputDir?: string;          // Output directory (default: audioFile_slides)
    markerPhrases?: string[];    // Markers to detect (default: ["next slide please"])
    whisperModel?: string;       // Whisper model size (default: "base")
    expectedParts?: number;      // Expected number of segments for verification
    slidePrefix?: string;        // Prefix for slide files (e.g., "v1_" for video 1)
}

/**
 * Split audio file into segments using spoken markers and Whisper.
 * 
 * This function calls the Python audio_marker_splitter.py script which:
 * 1. Transcribes audio using OpenAI Whisper
 * 2. Finds all instances of the spoken marker word
 * 3. Splits audio into segments, removing the marker word
 * 
 * Prerequisites:
 * - Python 3.8+
 * - pip install openai-whisper pydub
 * - FFmpeg installed and in PATH
 */
export async function splitAudioByMarkers(config: MarkerSplitConfig): Promise<MarkerSplitResult> {
    const {
        audioFile,
        outputDir,
        markerPhrases = ['next slide please'],
        whisperModel = 'base',
        expectedParts,
        slidePrefix = ''
    } = config;

    // Validate input file
    if (!fs.existsSync(audioFile)) {
        return {
            success: false,
            message: `Audio file not found: ${audioFile}`,
            markerCount: 0,
            slideFiles: []
        };
    }

    // Find the Python script
    const scriptPath = path.resolve(__dirname, '../../scripts/audio_marker_splitter.py');
    if (!fs.existsSync(scriptPath)) {
        return {
            success: false,
            message: `Python script not found: ${scriptPath}`,
            markerCount: 0,
            slideFiles: []
        };
    }

    // Build command - use venv Python
    const venvPython = path.resolve(__dirname, '../../scripts/venv/Scripts/python.exe');
    const pythonCmd = fs.existsSync(venvPython) ? `"${venvPython}"` : 'python';

    const args: string[] = [
        `"${audioFile}"`,
        `--model ${whisperModel}`
    ];

    // Add multiple markers
    for (const phrase of markerPhrases) {
        args.push(`-m "${phrase}"`);
    }

    if (outputDir) {
        args.push(`-o "${outputDir}"`);
    }

    if (expectedParts !== undefined) {
        args.push(`-e ${expectedParts}`);
    }

    // Add slide prefix for per-video naming in batched folders
    if (slidePrefix) {
        args.push(`--prefix "${slidePrefix}"`);
    }

    const command = `${pythonCmd} "${scriptPath}" ${args.join(' ')}`;
    console.log(`[MarkerSplitter] Running: ${command}`);

    try {
        const { stdout, stderr } = await execAsync(command, { maxBuffer: 50 * 1024 * 1024 });
        const output = stdout + stderr;

        console.log(`[MarkerSplitter] Output:\n${output}`);

        // Parse output to find results
        const markerMatches = output.match(/Found marker at/g);
        const markerCount = markerMatches ? markerMatches.length : 0;

        // Find created slide files
        const slideDir = outputDir || `${path.dirname(audioFile)}/${path.basename(audioFile, path.extname(audioFile))}_slides`;
        const slideFiles: string[] = [];

        if (fs.existsSync(slideDir)) {
            const files = fs.readdirSync(slideDir)
                .filter(f => f.startsWith('slide_') && f.endsWith('.wav'))
                .sort((a, b) => {
                    const numA = parseInt(a.match(/slide_(\d+)/)?.[1] || '0');
                    const numB = parseInt(b.match(/slide_(\d+)/)?.[1] || '0');
                    return numA - numB;
                })
                .map(f => path.join(slideDir, f));

            slideFiles.push(...files);
        }

        const success = slideFiles.length > 0;

        return {
            success,
            message: success
                ? `Split into ${slideFiles.length} segments (found ${markerCount} markers)`
                : 'No slide files created - check if markers were found',
            markerCount,
            slideFiles
        };

    } catch (error) {
        const errorMsg = (error as Error).message;
        console.error(`[MarkerSplitter] Error: ${errorMsg}`);

        return {
            success: false,
            message: `Failed to split audio: ${errorMsg}`,
            markerCount: 0,
            slideFiles: []
        };
    }
}

/**
 * Check if Whisper is installed and available in venv
 */
export async function checkWhisperInstalled(): Promise<boolean> {
    try {
        const venvPython = path.resolve(__dirname, '../../scripts/venv/Scripts/python.exe');
        const pythonCmd = fs.existsSync(venvPython) ? `"${venvPython}"` : 'python';
        await execAsync(`${pythonCmd} -c "import whisper; print(whisper.__version__)"`);
        return true;
    } catch {
        console.warn('[MarkerSplitter] Whisper not installed. Run: cd scripts && venv\\Scripts\\pip install -r requirements.txt');
        return false;
    }
}
