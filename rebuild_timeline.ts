
import { TimelineProcessor } from './src/processing/TimelineProcessor';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function main() {
    const timelineDir = 'F:/Workspaces/Video Creator/Video 6/output/timeline';
    const imagesDir = path.join(timelineDir, 'still_images');

    // STEP 1: Regenerate fresh base timeline
    console.log('=== STEP 1: Regenerate Fresh Base Timeline ===\n');

    const processor = new TimelineProcessor();

    const videoPaths = [
        'F:/Workspaces/Video Creator/Video 6/output/notebooklm_video_1_clean.mp4',
        'F:/Workspaces/Video Creator/Video 6/output/notebooklm_video_2_clean.mp4'
    ];

    const audioPaths = [
        'F:/Workspaces/Video Creator/Video 6/output/audio/narration_take_1.wav',
        'F:/Workspaces/Video Creator/Video 6/output/audio/narration_take_2.wav'
    ];

    const result = await processor.createTimeline({
        videoPaths,
        audioPaths,
        outputDir: timelineDir,
        exportFormat: 'xml',
        projectName: 'Slideshow_Base',
        reducedPauseDuration: 1,
        silenceDuration: 2,
        silenceThreshold: -30
    });

    console.log(`Base timeline result: ${result.message}`);

    // STEP 2: Read the fresh timeline JSON
    console.log('\n=== STEP 2: Extract Still Frames ===\n');

    const timelineJson = JSON.parse(fs.readFileSync(path.join(timelineDir, 'timeline.json'), 'utf-8'));
    const fps = timelineJson.frameRate;

    // Create images directory
    if (!fs.existsSync(imagesDir)) {
        fs.mkdirSync(imagesDir, { recursive: true });
    }

    // Group clips by track
    const clipsByTrack = new Map<number, any[]>();
    for (const clip of timelineJson.videoClips) {
        if (!clipsByTrack.has(clip.track)) {
            clipsByTrack.set(clip.track, []);
        }
        clipsByTrack.get(clip.track)!.push(clip);
    }

    const toFrames = (seconds: number): number => Math.round(seconds * fps);
    const trackCursors = new Map<number, number>();

    interface ImageClip {
        track: number;
        imagePath: string;
        timelineStartFrame: number;
        durationFrames: number;
        name: string;
    }
    const imageClips: ImageClip[] = [];

    for (const [track, clips] of clipsByTrack) {
        console.log(`Track V${track}: ${clips.length} clips`);

        for (const clip of clips) {
            const currentFrame = trackCursors.get(track) || 0;
            const durationFrames = toFrames(clip.duration);
            const extractTime = clip.startTime + Math.min(1, clip.duration / 2);

            const imageName = `img_V${track}_${String(clip.index).padStart(3, '0')}.png`;
            const imagePath = path.join(imagesDir, imageName);

            try {
                await execAsync(`ffmpeg -ss ${extractTime} -i "${clip.sourcePath}" -vframes 1 -y "${imagePath}"`);

                imageClips.push({
                    track,
                    imagePath,
                    timelineStartFrame: currentFrame,
                    durationFrames,
                    name: imageName
                });

                console.log(`  ${imageName}: frame ${currentFrame} -> ${currentFrame + durationFrames}`);
            } catch (e) {
                console.error(`  Failed: ${imageName}`);
            }

            trackCursors.set(track, currentFrame + durationFrames);
        }
    }

    // STEP 3: Generate NEW FCPXML with images
    console.log('\n=== STEP 3: Create Timeline With Images ===\n');

    const baseXml = fs.readFileSync(path.join(timelineDir, 'timeline.fcpxml'), 'utf-8');

    // Add image resources
    let resourceId = 100;
    let imageResources = '';
    const imageRefs = new Map<string, number>();

    for (const img of imageClips) {
        if (!imageRefs.has(img.imagePath)) {
            imageRefs.set(img.imagePath, resourceId);
            const normalizedPath = img.imagePath.replace(/\\/g, '/');
            imageResources += `        <asset id="r${resourceId}" name="${img.name}" src="file:///${normalizedPath}" hasVideo="1" hasAudio="0"/>\n`;
            resourceId++;
        }
    }

    // Add image clips
    let imageClipXml = '';
    for (const img of imageClips) {
        const refId = imageRefs.get(img.imagePath);
        const lane = img.track + 2;
        imageClipXml += `                            <asset-clip ref="r${refId}" offset="${img.timelineStartFrame}/${fps}s" name="${img.name}" duration="${img.durationFrames}/${fps}s" start="0s" lane="${lane}"/>\n`;
    }

    // Insert into XML
    let newXml = baseXml
        .replace('    </resources>', imageResources + '    </resources>')
        .replace('                        </gap>', imageClipXml + '                        </gap>')
        .replace(/Slideshow_Base/g, 'Slideshow_WithImages');

    fs.writeFileSync(path.join(timelineDir, 'timeline_with_images.fcpxml'), newXml);

    console.log('Created: timeline_with_images.fcpxml');
    console.log(`Added ${imageClips.length} image clips on lanes 3 and 4`);
}

main().catch(console.error);
