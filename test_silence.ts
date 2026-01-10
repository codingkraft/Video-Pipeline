
import { TimelineProcessor } from './src/processing/TimelineProcessor';
import * as path from 'path';

async function main() {
    const processor = new TimelineProcessor();

    const audioPath = 'F:/Workspaces/Video Creator/Video 6/output/audio/narration_take_1.wav';

    console.log('Testing silence detection with duration=0.5s...');

    // Note: detectSilences is public.
    const result = await processor.detectSilences(audioPath, 0.5, -30);

    console.log('--- TEST RESULTS ---');
    console.log(`Success: ${result.success}`);
    console.log(`Total Duration: ${result.totalDuration}`);
    console.log(`Found ${result.clips.length} clips.`);
    console.log(`Clip Durations: ${result.clips.map(c => c.duration.toFixed(2)).join(', ')}`);
}

main().catch(console.error);
