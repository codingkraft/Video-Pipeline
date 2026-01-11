
import * as fs from 'fs';
import * as path from 'path';

// Read the generated FCPXML and extract the spine content to see positioning
const timelineDir = 'F:/Workspaces/Video Creator/Video 6/output/timeline';
const xmlContent = fs.readFileSync(path.join(timelineDir, 'timeline_with_images.fcpxml'), 'utf-8');

// Extract the gap/spine section
const gapMatch = xmlContent.match(/<gap[\s\S]*?<\/gap>/);
let output = '=== ALL CLIPS IN TIMELINE ===\n\n';

if (gapMatch) {
    // Parse out asset-clip elements
    const clips = [...gapMatch[0].matchAll(/<asset-clip[^>]+>/g)];

    for (const clip of clips) {
        const offsetMatch = clip[0].match(/offset="([^"]+)"/);
        const nameMatch = clip[0].match(/name="([^"]+)"/);
        const laneMatch = clip[0].match(/lane="([^"]+)"/);
        const durationMatch = clip[0].match(/duration="([^"]+)"/);

        output += `${nameMatch?.[1]?.padEnd(35)} | Lane: ${laneMatch?.[1]?.padStart(3)} | Offset: ${offsetMatch?.[1]?.padEnd(15)} | Duration: ${durationMatch?.[1]}\n`;
    }
}

fs.writeFileSync('C:/Users/Nitin/.gemini/clip_positions.txt', output);
console.log('Written to C:/Users/Nitin/.gemini/clip_positions.txt');
