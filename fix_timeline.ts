
import { TimelineProcessor } from './src/processing/TimelineProcessor';
import * as path from 'path';

async function main() {
    const processor = new TimelineProcessor();

    const videoPaths = [
        'F:/Workspaces/Video Creator/Video 6/output/notebooklm_video_1_clean.mp4',
        'F:/Workspaces/Video Creator/Video 6/output/notebooklm_video_2_clean.mp4'
    ];

    const audioPaths = [
        'F:/Workspaces/Video Creator/Video 6/output/audio/narration_take_1.wav',
        'F:/Workspaces/Video Creator/Video 6/output/audio/narration_take_2.wav'
    ];

    console.log('Regenerating timeline with ATRIM-based precise audio cutting...');

    const result = await processor.createTimeline({
        videoPaths,
        audioPaths,
        outputDir: 'F:/Workspaces/Video Creator/Video 6/output/timeline',
        exportFormat: 'xml',
        projectName: 'Slideshow_Precise',
        reducedPauseDuration: 1,
        silenceDuration: 2,
        silenceThreshold: -30
    });

    console.log('Result:', JSON.stringify(result, null, 2));
}

main().catch(console.error);
