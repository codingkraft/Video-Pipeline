
import { TimelineProcessor } from './src/processing/TimelineProcessor';
import * as fs from 'fs';

async function main() {
    const processor = new TimelineProcessor();

    const audioPath = 'F:/Workspaces/Video Creator/Video 6/output/audio/narration_take_1.wav';

    const result = await processor.detectSilences(audioPath, 2, -30);

    let output = 'CLIP ANALYSIS FOR narration_take_1.wav\n';
    output += '='.repeat(50) + '\n\n';

    output += 'SILENCES FOUND:\n';
    for (const s of result.silences) {
        output += `  Silence ${s.index}: ${s.startTime.toFixed(2)}s -> ${s.endTime.toFixed(2)}s (${s.duration.toFixed(2)}s)\n`;
    }

    output += '\nCLIPS THAT WILL BE CUT:\n';
    for (const c of result.clips) {
        output += `  Clip ${c.index}: ${c.startTime.toFixed(2)}s -> ${c.endTime.toFixed(2)}s (duration: ${c.duration.toFixed(2)}s)\n`;
    }

    output += `\nSummary: ${result.clips.length} clips from ${result.silences.length} silences\n`;
    output += `File duration: ${result.totalDuration.toFixed(2)}s\n`;

    // Write to a file we can read
    fs.writeFileSync('C:/Users/Nitin/.gemini/clip_analysis.txt', output);
    console.log('Analysis written to C:/Users/Nitin/.gemini/clip_analysis.txt');
}

main().catch(console.error);
