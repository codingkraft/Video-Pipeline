
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface TimelineClip {
    index: number;
    name: string;
    type: string;
    sourcePath: string;
    clipPath?: string;
    startTime: number;
    endTime: number;
    duration: number;
    track: number;
}

interface Timeline {
    projectName: string;
    frameRate: number;
    totalDuration: number;
    videoClips: TimelineClip[];
    audioClips: TimelineClip[];
}

async function extractFrameAndAddImageTracks() {
    const timelineDir = 'F:/Workspaces/Video Creator/Video 6/output/timeline';
    const imagesDir = path.join(timelineDir, 'still_images');

    // Create images directory
    if (!fs.existsSync(imagesDir)) {
        fs.mkdirSync(imagesDir, { recursive: true });
    }

    // Read existing timeline JSON (the source of truth for clip data)
    const timelineJson = JSON.parse(fs.readFileSync(path.join(timelineDir, 'timeline.json'), 'utf-8')) as Timeline;
    const fps = timelineJson.frameRate;
    console.log(`Loaded timeline: ${timelineJson.projectName}`);
    console.log(`Video clips: ${timelineJson.videoClips.length}`);

    // Group clips by track and calculate TIMELINE positions
    const clipsByTrack = new Map<number, TimelineClip[]>();
    for (const clip of timelineJson.videoClips) {
        if (!clipsByTrack.has(clip.track)) {
            clipsByTrack.set(clip.track, []);
        }
        clipsByTrack.get(clip.track)!.push(clip);
    }

    const toFrames = (seconds: number): number => Math.round(seconds * fps);
    const trackCursors = new Map<number, number>();

    const imageClips: { track: number; imagePath: string; timelineStartFrame: number; durationFrames: number; name: string }[] = [];

    for (const [track, clips] of clipsByTrack) {
        console.log(`\n=== Processing Track V${track} (${clips.length} clips) ===`);

        for (const clip of clips) {
            const currentTimelineFrame = trackCursors.get(track) || 0;
            const durationFrames = toFrames(clip.duration);

            // Extract time in SOURCE file (1 second into the clip)
            const extractTime = clip.startTime + Math.min(1, clip.duration / 2);

            const imageName = `track${track}_clip${String(clip.index).padStart(3, '0')}.png`;
            const imagePath = path.join(imagesDir, imageName);

            console.log(`Clip ${clip.index}: Timeline frame ${currentTimelineFrame}, Duration ${durationFrames}, Extract at ${extractTime.toFixed(2)}s`);

            try {
                await execAsync(
                    `ffmpeg -ss ${extractTime} -i "${clip.sourcePath}" -vframes 1 -y "${imagePath}"`,
                    { maxBuffer: 10 * 1024 * 1024 }
                );

                imageClips.push({
                    track: track,
                    imagePath: imagePath,
                    timelineStartFrame: currentTimelineFrame,
                    durationFrames: durationFrames,
                    name: imageName
                });
            } catch (error) {
                console.error(`Failed: ${(error as Error).message}`);
            }

            trackCursors.set(track, currentTimelineFrame + durationFrames);
        }
    }

    console.log(`\nExtracted ${imageClips.length} still frames`);

    // Read the ORIGINAL timeline.fcpxml (NOT the _with_images version!)
    const existingXml = fs.readFileSync(path.join(timelineDir, 'timeline.fcpxml'), 'utf-8');

    // Build image resources
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

    // Build image clip elements with CORRECT timeline positions
    let imageClipElements = '';

    for (const img of imageClips) {
        const refId = imageRefs.get(img.imagePath);
        const lane = img.track + 2; // V1 -> lane 3, V2 -> lane 4

        imageClipElements += `                            <asset-clip ref="r${refId}" offset="${img.timelineStartFrame}/${fps}s" name="${img.name}" duration="${img.durationFrames}/${fps}s" start="0s" lane="${lane}"/>\n`;
    }

    // Insert into XML
    let newXml = existingXml.replace(
        '    </resources>',
        imageResources + '    </resources>'
    );

    newXml = newXml.replace(
        '                        </gap>',
        imageClipElements + '                        </gap>'
    );

    newXml = newXml.replace(/Slideshow_Precise/g, 'Slideshow_WithImages');

    // Write NEW timeline
    const newXmlPath = path.join(timelineDir, 'timeline_with_images.fcpxml');
    fs.writeFileSync(newXmlPath, newXml, 'utf-8');
    console.log(`\nCreated: ${newXmlPath}`);
}

extractFrameAndAddImageTracks().catch(console.error);
