import ffmpeg from 'fluent-ffmpeg';
import * as path from 'path';
import * as fs from 'fs';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Information about a clip detected in media
 */
export interface ClipInfo {
    index: number;
    startTime: number;
    endTime: number;
    duration: number;
    outputPath?: string;
}

/**
 * Result from scene detection
 */
export interface SceneDetectionResult {
    success: boolean;
    videoPath: string;
    clips: ClipInfo[];
    totalDuration: number;
    message: string;
}

/**
 * Result from silence detection
 */
export interface SilenceDetectionResult {
    success: boolean;
    audioPath: string;
    clips: ClipInfo[];       // Audio segments between silences
    silences: ClipInfo[];    // The silent portions themselves
    totalDuration: number;
    message: string;
}

/**
 * Timeline clip for export
 */
export interface TimelineClip {
    index: number;
    name: string;
    type: 'video' | 'audio';
    sourcePath: string;
    clipPath?: string;
    imagePath?: string;
    startTime: number;
    endTime: number;
    duration: number;
    track: number;
}

/**
 * Complete timeline structure for export
 */
export interface TimelineExport {
    projectName: string;
    frameRate: number;
    totalDuration: number;
    videoClips: TimelineClip[];
    audioClips: TimelineClip[];
}

/**
 * Configuration for creating a timeline
 */
export interface TimelineConfig {
    videoPaths?: string[];        // Array of video files - each goes on its own track
    audioPaths?: string[];        // Array of audio files - each goes on its own track
    outputDir: string;
    exportFormat: 'edl' | 'xml' | 'json';
    sceneThreshold?: number;      // 0.0-1.0, default 0.1 (lower = more sensitive)
    silenceDuration?: number;     // seconds, default 3
    silenceThreshold?: number;    // dB, default -30
    reducedPauseDuration?: number; // seconds, default 1
    projectName?: string;
    frameRate?: number;           // default 30
}

/**
 * Result from timeline creation
 */
export interface TimelineResult {
    success: boolean;
    message: string;
    timelinePath?: string;
    videoClipsDir?: string;
    audioClipsDir?: string;
    videoClipCount?: number;
    audioClipCount?: number;
    timeline?: TimelineExport;
}

/**
 * TimelineProcessor - Detects scene changes and silences to create editable timelines
 */
export class TimelineProcessor {

    /**
     * Get video duration using ffprobe
     */
    private async getMediaDuration(filePath: string): Promise<number> {
        return new Promise((resolve, reject) => {
            ffmpeg.ffprobe(filePath, (err, metadata) => {
                if (err) {
                    reject(new Error(`Failed to probe file: ${err.message}`));
                    return;
                }
                resolve(metadata.format.duration || 0);
            });
        });
    }

    /**
     * Detect scene changes in a video using FFmpeg's scene filter
     * Returns clip boundaries where the video display changes
     */
    public async detectSceneChanges(
        videoPath: string,
        threshold: number = 0.1
    ): Promise<SceneDetectionResult> {
        if (!fs.existsSync(videoPath)) {
            return {
                success: false,
                videoPath,
                clips: [],
                totalDuration: 0,
                message: `Video file not found: ${videoPath}`
            };
        }

        console.log(`Detecting scene changes in: ${videoPath} (threshold: ${threshold})`);

        try {
            const totalDuration = await this.getMediaDuration(videoPath);

            // Use FFmpeg to detect scene changes
            // The select filter with scene detection outputs frame info when scene changes
            const cmd = `ffmpeg -i "${videoPath}" -filter:v "select='gt(scene,${threshold})',showinfo" -f null - 2>&1`;

            const { stdout, stderr } = await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024 });
            const output = stdout + stderr;

            // Parse showinfo output to get timestamps
            // Format: [Parsed_showinfo_1 @ ...] n:  123 pts: 12345 pts_time:1.234567
            const ptsTimeRegex = /pts_time:(\d+\.?\d*)/g;
            const sceneChanges: number[] = [0]; // Always start at 0

            let match;
            while ((match = ptsTimeRegex.exec(output)) !== null) {
                const time = parseFloat(match[1]);
                // Avoid duplicates and very close detections
                if (sceneChanges.length === 0 || time - sceneChanges[sceneChanges.length - 1] > 0.5) {
                    sceneChanges.push(time);
                }
            }

            // Add end time if not already there
            if (sceneChanges[sceneChanges.length - 1] < totalDuration - 0.5) {
                sceneChanges.push(totalDuration);
            }

            // Convert to clips
            const clips: ClipInfo[] = [];
            for (let i = 0; i < sceneChanges.length - 1; i++) {
                clips.push({
                    index: i + 1,
                    startTime: sceneChanges[i],
                    endTime: sceneChanges[i + 1],
                    duration: sceneChanges[i + 1] - sceneChanges[i]
                });
            }

            console.log(`Detected ${clips.length} scene changes`);

            return {
                success: true,
                videoPath,
                clips,
                totalDuration,
                message: `Detected ${clips.length} clips from scene changes`
            };

        } catch (error) {
            return {
                success: false,
                videoPath,
                clips: [],
                totalDuration: 0,
                message: `Scene detection failed: ${(error as Error).message}`
            };
        }
    }

    /**
     * Detect silences in audio using FFmpeg's silencedetect filter
     * Returns audio segments between silences
     */
    public async detectSilences(
        audioPath: string,
        silenceDuration: number = 2,
        silenceThreshold: number = -30
    ): Promise<SilenceDetectionResult> {
        if (!fs.existsSync(audioPath)) {
            return {
                success: false,
                audioPath,
                clips: [],
                silences: [],
                totalDuration: 0,
                message: `Audio file not found: ${audioPath}`
            };
        }

        console.log(`Detecting silences in: ${audioPath} (duration: ${silenceDuration}s, threshold: ${silenceThreshold}dB)`);

        try {
            const totalDuration = await this.getMediaDuration(audioPath);

            // Use FFmpeg silencedetect filter
            const cmd = `ffmpeg -i "${audioPath}" -af silencedetect=n=${silenceThreshold}dB:d=${silenceDuration} -f null - 2>&1`;

            const { stdout, stderr } = await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024 });
            const output = stdout + stderr;

            // Parse silencedetect output
            // Format: [silencedetect @ ...] silence_start: 5.123
            // Format: [silencedetect @ ...] silence_end: 8.456 | silence_duration: 3.333
            const silenceStartRegex = /silence_start:\s*(\d+\.?\d*)/g;
            const silenceEndRegex = /silence_end:\s*(\d+\.?\d*)/g;

            const silenceStarts: number[] = [];
            const silenceEnds: number[] = [];

            let match;
            while ((match = silenceStartRegex.exec(output)) !== null) {
                silenceStarts.push(parseFloat(match[1]));
            }
            while ((match = silenceEndRegex.exec(output)) !== null) {
                silenceEnds.push(parseFloat(match[1]));
            }

            // Build silence clips
            const silences: ClipInfo[] = [];
            for (let i = 0; i < Math.min(silenceStarts.length, silenceEnds.length); i++) {
                silences.push({
                    index: i + 1,
                    startTime: silenceStarts[i],
                    endTime: silenceEnds[i],
                    duration: silenceEnds[i] - silenceStarts[i]
                });
            }

            // Build audio segment clips (between silences)
            const clips: ClipInfo[] = [];
            let currentStart = 0;

            for (let i = 0; i < silences.length; i++) {
                // Audio segment from currentStart to silence start
                // Require at least 0.5s duration to avoid noise/ghost clips
                if (silences[i].startTime > currentStart + 0.5) {
                    clips.push({
                        index: clips.length + 1,
                        startTime: currentStart,
                        endTime: silences[i].startTime,
                        duration: silences[i].startTime - currentStart
                    });
                }
                // Next segment starts after this silence
                currentStart = silences[i].endTime;
            }

            // Add final segment if there's content (> 0.5s) after last silence
            if (currentStart < totalDuration - 0.5) {
                clips.push({
                    index: clips.length + 1,
                    startTime: currentStart,
                    endTime: totalDuration,
                    duration: totalDuration - currentStart
                });
            }

            console.log(`Detected ${silences.length} silences, ${clips.length} audio segments`);

            return {
                success: true,
                audioPath,
                clips,
                silences,
                totalDuration,
                message: `Detected ${clips.length} audio segments between ${silences.length} silences`
            };

        } catch (error) {
            return {
                success: false,
                audioPath,
                clips: [],
                silences: [],
                totalDuration: 0,
                message: `Silence detection failed: ${(error as Error).message}`
            };
        }
    }

    /**
     * Extract a representative image (thumbnail) for each clip
     */
    public async extractClipImages(
        videoPath: string,
        clips: ClipInfo[],
        outputDir: string
    ): Promise<string[]> {
        const outputPaths: string[] = [];
        const baseName = path.basename(videoPath, path.extname(videoPath));

        for (const clip of clips) {
            const outputPath = path.join(outputDir, `${baseName}_clip_${String(clip.index).padStart(3, '0')}.jpg`);

            // Capture frame at start time + small offset (e.g. 0.5s) to avoid black frames at cut points
            // But ensure we don't go past end time
            const timestamp = Math.min(clip.startTime + 0.5, clip.endTime - 0.1);

            console.log(`Extracting image for clip ${clip.index} at ${timestamp.toFixed(2)}s`);

            await new Promise<void>((resolve, reject) => {
                ffmpeg(videoPath)
                    .seekInput(timestamp)
                    .frames(1)
                    .outputOptions(['-q:v', '2']) // High quality JPEG
                    .output(outputPath)
                    .on('end', () => {
                        outputPaths.push(outputPath);
                        resolve();
                    })
                    .on('error', (err) => {
                        console.error(`Failed to extract image for clip ${clip.index}: ${err.message}`);
                        // Don't fail the whole process, just log
                        resolve();
                    })
                    .run();
            });
        }
        return outputPaths;
    }

    /**
     * Cut video into clips at the specified boundaries
     */
    public async cutVideoClips(
        videoPath: string,
        clips: ClipInfo[],
        outputDir: string
    ): Promise<string[]> {
        const videoClipsDir = path.join(outputDir, 'video_clips');
        if (!fs.existsSync(videoClipsDir)) {
            fs.mkdirSync(videoClipsDir, { recursive: true });
        }

        const outputPaths: string[] = [];
        const baseName = path.basename(videoPath, path.extname(videoPath));

        for (const clip of clips) {
            const outputPath = path.join(videoClipsDir, `${baseName}_clip_${String(clip.index).padStart(3, '0')}.mp4`);

            console.log(`Cutting video clip ${clip.index}: ${clip.startTime.toFixed(2)}s - ${clip.endTime.toFixed(2)}s`);

            await new Promise<void>((resolve, reject) => {
                ffmpeg(videoPath)
                    .setStartTime(clip.startTime)
                    .setDuration(clip.duration)
                    .outputOptions([
                        '-c:v', 'libx264',
                        '-preset', 'fast',
                        '-crf', '18',
                        '-c:a', 'aac'
                    ])
                    .output(outputPath)
                    .on('end', () => {
                        clip.outputPath = outputPath;
                        outputPaths.push(outputPath);
                        resolve();
                    })
                    .on('error', (err) => {
                        console.error(`Failed to cut clip ${clip.index}: ${err.message}`);
                        reject(err);
                    })
                    .run();
            });
        }

        return outputPaths;
    }

    /**
     * Cut audio into clips, reducing pause duration from 3s to specified duration
     */
    public async cutAudioClips(
        audioPath: string,
        clips: ClipInfo[],
        outputDir: string,
        reducedPauseDuration: number = 1
    ): Promise<string[]> {
        const audioClipsDir = path.join(outputDir, 'audio_clips');
        if (!fs.existsSync(audioClipsDir)) {
            fs.mkdirSync(audioClipsDir, { recursive: true });
        }

        const outputPaths: string[] = [];
        const baseName = path.basename(audioPath, path.extname(audioPath));
        const ext = path.extname(audioPath);

        for (let i = 0; i < clips.length; i++) {
            const clip = clips[i];
            const outputPath = path.join(audioClipsDir, `${baseName}_clip_${String(clip.index).padStart(3, '0')}${ext}`);

            console.log(`Cutting audio clip ${clip.index}: ${clip.startTime.toFixed(2)}s - ${clip.endTime.toFixed(2)}s`);

            // For all clips except the last, we'll add a reduced silence at the end
            const isLastClip = i === clips.length - 1;

            await new Promise<void>((resolve, reject) => {
                // Use atrim filter for PRECISE audio cutting (much more reliable than -ss)
                const cmd = ffmpeg(audioPath);

                // Build filter chain: atrim for precise cut, then optional apad for silence
                const filters: string[] = [];

                // atrim: precise audio trimming by timestamp
                filters.push(`atrim=start=${clip.startTime}:duration=${clip.duration}`);

                // asetpts: reset timestamps after trim (required for proper output)
                filters.push('asetpts=PTS-STARTPTS');

                // Add padding silence at the end if not the last clip
                if (!isLastClip && reducedPauseDuration > 0) {
                    filters.push(`apad=pad_dur=${reducedPauseDuration}`);
                }

                cmd.audioFilters(filters.join(','));

                cmd.output(outputPath)
                    .on('end', () => {
                        clip.outputPath = outputPath;
                        outputPaths.push(outputPath);
                        resolve();
                    })
                    .on('error', (err) => {
                        console.error(`Failed to cut audio clip ${clip.index}: ${err.message}`);
                        reject(err);
                    })
                    .run();
            });
        }

        return outputPaths;
    }

    /**
     * Export timeline in EDL format (CMX 3600 compatible)
     */
    private exportAsEDL(timeline: TimelineExport, outputPath: string): void {
        const lines: string[] = [];
        lines.push('TITLE: ' + timeline.projectName);
        lines.push('FCM: NON-DROP FRAME');
        lines.push('');

        let eventNum = 1;

        // Helper to convert seconds to timecode (HH:MM:SS:FF)
        const toTimecode = (seconds: number): string => {
            const fps = timeline.frameRate;
            const totalFrames = Math.floor(seconds * fps);
            const frames = totalFrames % fps;
            const totalSeconds = Math.floor(totalFrames / fps);
            const secs = totalSeconds % 60;
            const totalMinutes = Math.floor(totalSeconds / 60);
            const mins = totalMinutes % 60;
            const hours = Math.floor(totalMinutes / 60);
            return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
        };

        // Add video clips
        let recordPosition = 0;
        for (const clip of timeline.videoClips) {
            const srcIn = toTimecode(clip.startTime);
            const srcOut = toTimecode(clip.endTime);
            const recIn = toTimecode(recordPosition);
            const recOut = toTimecode(recordPosition + clip.duration);

            lines.push(`${String(eventNum).padStart(3, '0')}  AX       V     C        ${srcIn} ${srcOut} ${recIn} ${recOut}`);
            lines.push(`* FROM CLIP NAME: ${clip.name}`);
            lines.push(`* SOURCE FILE: ${clip.clipPath || clip.sourcePath}`);
            lines.push('');

            recordPosition += clip.duration;
            eventNum++;
        }

        // Add audio clips on separate track
        recordPosition = 0;
        for (const clip of timeline.audioClips) {
            const srcIn = toTimecode(clip.startTime);
            const srcOut = toTimecode(clip.endTime);
            const recIn = toTimecode(recordPosition);
            const recOut = toTimecode(recordPosition + clip.duration);

            lines.push(`${String(eventNum).padStart(3, '0')}  AX       A     C        ${srcIn} ${srcOut} ${recIn} ${recOut}`);
            lines.push(`* FROM CLIP NAME: ${clip.name}`);
            lines.push(`* SOURCE FILE: ${clip.clipPath || clip.sourcePath}`);
            lines.push('');

            recordPosition += clip.duration;
            eventNum++;
        }

        fs.writeFileSync(outputPath, lines.join('\r\n'), 'utf-8');
        console.log(`Exported EDL timeline: ${outputPath}`);
    }

    /**
     * Export timeline in Final Cut Pro XML format (FCPXML 1.9 for DaVinci Resolve)
     */
    private exportAsXML(timeline: TimelineExport, outputPath: string): void {
        const fps = timeline.frameRate;
        const totalDurationFrames = Math.round(timeline.totalDuration * fps) || 3600;

        // Helper to convert seconds to frame count
        const toFrames = (seconds: number): number => Math.round(seconds * fps);

        // Escape XML special characters
        const escapeXml = (str: string): string => {
            return str
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&apos;');
        };

        // For still images, we give them a very long intrinsic duration (24 hours)
        // This is a standard workaround to allow infinite extension in NLEs
        const stillImageDurationFrames = fps * 3600 * 24;

        let xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.9">
    <resources>
        <format id="r1" name="FFVideoFormat1080p${fps}" frameDuration="1/${fps}s" width="1920" height="1080"/>
`;

        // Add media resources
        let resourceId = 2;
        const mediaRefs: Map<string, number> = new Map();

        // Add Video & Audio resources
        for (const clip of [...timeline.videoClips, ...timeline.audioClips]) {
            const filePath = clip.clipPath || clip.sourcePath;
            if (!mediaRefs.has(filePath)) {
                mediaRefs.set(filePath, resourceId);
                const normalizedPath = filePath.replace(/\\/g, '/');
                const durationFrames = toFrames(clip.duration);
                // For video/audio, we want strict duration to avoid issues
                xml += `        <asset id="r${resourceId}" name="${escapeXml(clip.name)}" src="file:///${normalizedPath}" duration="${durationFrames}/${fps}s" hasVideo="${clip.type === 'video' ? '1' : '0'}" hasAudio="1" format="r1"/>\n`;
                resourceId++;
            }
        }

        // Add Image resources - NO format attribute, NO duration to mark as still image
        for (const clip of timeline.videoClips) {
            if (clip.imagePath && !mediaRefs.has(clip.imagePath)) {
                mediaRefs.set(clip.imagePath, resourceId);
                const normalizedPath = clip.imagePath.replace(/\\/g, '/');
                // Still images: hasVideo="1", hasAudio="0", NO format, duration="0s" signals still
                // The absence of duration or a 0s duration tells Resolve this is a still image
                xml += `        <asset id="r${resourceId}" name="${escapeXml(clip.name)}_img" src="file:///${normalizedPath}" hasVideo="1" hasAudio="0"/>\n`;
                resourceId++;
            }
        }

        xml += `    </resources>
    <library>
        <event name="${escapeXml(timeline.projectName)}">
            <project name="${escapeXml(timeline.projectName)}">
                <sequence format="r1" duration="${totalDurationFrames}/${fps}s">
                    <spine>
`;

        // Use a GAP as the primary storyline canvas
        xml += `                        <gap name="Master" offset="0s" duration="${totalDurationFrames}/${fps}s" start="0s">\n`;

        // Track cursors for sequential placement per track (in Frames)
        const trackCursors = new Map<number, number>();

        // Add Video clips as connected clips
        for (const clip of timeline.videoClips) {
            const refId = mediaRefs.get(clip.clipPath || clip.sourcePath);
            const durationFrames = toFrames(clip.duration);

            const currentCursorFrames = trackCursors.get(clip.track) || 0;
            const startFrame = currentCursorFrames;
            trackCursors.set(clip.track, currentCursorFrames + durationFrames);

            const lane = clip.track || 1;
            xml += `                            <asset-clip ref="r${refId}" offset="${startFrame}/${fps}s" name="${escapeXml(clip.name)}" duration="${durationFrames}/${fps}s" start="0s" lane="${lane}" format="r1"/>\n`;

            // Add corresponding Image clip on a higher lane
            if (clip.imagePath && mediaRefs.has(clip.imagePath)) {
                const imgRefId = mediaRefs.get(clip.imagePath);
                const imgLane = lane + 10;
                // Use conform-rate to force a valid frame interpretation. 
                // We also add a timeMap to explicitly map the duration to a single frame (freeze frame effect) if needed, 
                // but usually just the long asset duration is enough. 
                // However, adding a 'conformed-rate' often helps Resolve treat it as a retimed/flexible clip.
                xml += `                            <asset-clip ref="r${imgRefId}" offset="${startFrame}/${fps}s" name="${escapeXml(clip.name)}_img" duration="${durationFrames}/${fps}s" start="0s" lane="${imgLane}" format="r1">
                                <conform-rate srcFrameRate="${fps}"/>
                            </asset-clip>\n`;
            }
        }

        // Add Audio clips as connected clips
        const audioTrackNumbers = [...new Set(timeline.audioClips.map(c => c.track))].sort();

        for (const clip of timeline.audioClips) {
            const refId = mediaRefs.get(clip.clipPath || clip.sourcePath);
            const durationFrames = toFrames(clip.duration);

            const currentCursorFrames = trackCursors.get(clip.track) || 0;
            const startFrame = currentCursorFrames;
            trackCursors.set(clip.track, currentCursorFrames + durationFrames);

            const trackIndex = audioTrackNumbers.indexOf(clip.track);
            const lane = -1 * (trackIndex + 1);

            xml += `                            <asset-clip ref="r${refId}" offset="${startFrame}/${fps}s" name="${escapeXml(clip.name)}" duration="${durationFrames}/${fps}s" start="0s" lane="${lane}" role="dialogue" format="r1"/>\n`;
        }

        xml += `                        </gap>\n`;
        xml += `                    </spine>
                </sequence>
            </project>
        </event>
    </library>
</fcpxml>`;

        fs.writeFileSync(outputPath, xml, 'utf-8');
        console.log(`Exported FCPXML timeline: ${outputPath}`);
    }

    /**
     * Export timeline in Adobe Premiere Pro XML format (FCP 7 XML / xmeml)
     */
    private exportAsPremiereXML(timeline: TimelineExport, outputPath: string): void {
        const fps = timeline.frameRate;
        const totalDurationFrames = Math.round(timeline.totalDuration * fps) || 3600; // Default to 2 min if 0

        // Helper to convert seconds to frame count
        const toFrames = (seconds: number): number => Math.round(seconds * fps);

        // Escape XML special characters
        const escapeXml = (str: string): string => {
            return str
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&apos;');
        };

        // Convert path to file:// URL format for Premiere
        const toFileUrl = (filePath: string): string => {
            // Standard file:/// URI for Windows is most compatible
            const normalized = filePath.replace(/\\/g, '/');
            return `file:///${normalized}`;
        };

        // Still images get 1 hour in Premiere too
        const stillImageDurationFrames = fps * 3600;

        let xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="4">
    <sequence id="sequence-1">
        <uuid>${Date.now()}</uuid>
        <updatebehavior>add</updatebehavior>
        <name>${escapeXml(timeline.projectName)}</name>
        <duration>${totalDurationFrames}</duration>
        <rate>
            <timebase>${fps}</timebase>
            <ntsc>FALSE</ntsc>
        </rate>
        <timecode>
            <rate>
                <timebase>${fps}</timebase>
                <ntsc>FALSE</ntsc>
            </rate>
            <string>00:00:00:00</string>
            <frame>0</frame>
            <displayformat>NDF</displayformat>
        </timecode>
        <in>-1</in>
        <out>-1</out>
        <media>
            <video>
                <format>
                    <samplecharacteristics>
                        <rate>
                            <timebase>${fps}</timebase>
                            <ntsc>FALSE</ntsc>
                        </rate>
                        <width>1920</width>
                        <height>1080</height>
                        <anamorphic>FALSE</anamorphic>
                        <pixelaspectratio>square</pixelaspectratio>
                        <fielddominance>none</fielddominance>
                    </samplecharacteristics>
                </format>
`;

        // Group clips by track
        const videoTracksMap = new Map<number, TimelineClip[]>();
        const imageTracksMap = new Map<number, TimelineClip[]>();
        for (const clip of timeline.videoClips) {
            const track = clip.track || 1;
            if (!videoTracksMap.has(track)) videoTracksMap.set(track, []);
            videoTracksMap.get(track)?.push(clip);

            if (clip.imagePath && fs.existsSync(clip.imagePath)) {
                if (!imageTracksMap.has(track)) imageTracksMap.set(track, []);
                imageTracksMap.get(track)?.push(clip);
            }
        }

        const audioTracksMap = new Map<number, TimelineClip[]>();
        for (const clip of timeline.audioClips) {
            const track = clip.track || 1;
            if (!audioTracksMap.has(track)) audioTracksMap.set(track, []);
            audioTracksMap.get(track)?.push(clip);
        }

        // Track file IDs to avoid duplicates
        const fileIds = new Map<string, string>();
        let fileCounter = 1;

        const getFileId = (filePath: string): string => {
            if (!fileIds.has(filePath)) {
                fileIds.set(filePath, `file-${fileCounter++}`);
            }
            return fileIds.get(filePath)!;
        };

        // Add Video Tracks
        const sortedVideoTrackIndices = Array.from(videoTracksMap.keys()).sort((a, b) => a - b);
        for (const trackIndex of sortedVideoTrackIndices) {
            const clips = videoTracksMap.get(trackIndex)!;
            xml += `                <track>\n`;
            let currentTimelineFrame = 0;

            for (const clip of clips) {
                const clipDurationFrames = toFrames(clip.duration);
                const filePath = clip.clipPath || clip.sourcePath;
                const fileId = getFileId(filePath);
                const clipId = `clipitem-${escapeXml(clip.name)}-v${trackIndex}`;

                xml += `                    <clipitem id="${clipId}">
                        <masterclipid>masterclip-${fileId}</masterclipid>
                        <name>${escapeXml(clip.name)}</name>
                        <enabled>TRUE</enabled>
                        <duration>${clipDurationFrames}</duration>
                        <rate>
                            <timebase>${fps}</timebase>
                            <ntsc>FALSE</ntsc>
                        </rate>
                        <start>${currentTimelineFrame}</start>
                        <end>${currentTimelineFrame + clipDurationFrames}</end>
                        <in>0</in>
                        <out>${clipDurationFrames}</out>
                        <file id="${fileId}">
                            <name>${escapeXml(path.basename(filePath))}</name>
                            <pathurl>${toFileUrl(filePath)}</pathurl>
                            <rate>
                                <timebase>${fps}</timebase>
                                <ntsc>FALSE</ntsc>
                            </rate>
                            <duration>${clipDurationFrames}</duration>
                            <media>
                                <video>
                                    <samplecharacteristics>
                                        <rate>
                                            <timebase>${fps}</timebase>
                                            <ntsc>FALSE</ntsc>
                                        </rate>
                                        <width>1920</width>
                                        <height>1080</height>
                                    </samplecharacteristics>
                                </video>
                            </media>
                        </file>
                    </clipitem>\n`;
                currentTimelineFrame += clipDurationFrames;
            }
            xml += `                </track>\n`;
        }

        // Add Image Tracks (One for each video track index that has images)
        const sortedImageTrackIndices = Array.from(imageTracksMap.keys()).sort((a, b) => a - b);
        for (const trackIndex of sortedImageTrackIndices) {
            const clips = imageTracksMap.get(trackIndex)!;
            xml += `                <track>\n`;
            let currentTimelineFrame = 0;

            for (const clip of clips) {
                const clipDurationFrames = toFrames(clip.duration);
                const imagePath = clip.imagePath!;
                const fileId = getFileId(imagePath);
                const clipId = `clipitem-img-${escapeXml(clip.name)}-v${trackIndex}`;

                xml += `                    <clipitem id="${clipId}">
                        <masterclipid>masterclip-${fileId}</masterclipid>
                        <name>${escapeXml(clip.name)}_img</name>
                        <enabled>TRUE</enabled>
                        <duration>${clipDurationFrames}</duration>
                        <rate>
                            <timebase>${fps}</timebase>
                            <ntsc>FALSE</ntsc>
                        </rate>
                        <start>${currentTimelineFrame}</start>
                        <end>${currentTimelineFrame + clipDurationFrames}</end>
                        <in>0</in>
                        <out>${clipDurationFrames}</out>
                        <file id="${fileId}">
                            <name>${escapeXml(path.basename(imagePath))}</name>
                            <pathurl>${toFileUrl(imagePath)}</pathurl>
                            <rate>
                                <timebase>${fps}</timebase>
                                <ntsc>FALSE</ntsc>
                            </rate>
                            <duration>${stillImageDurationFrames}</duration>
                            <media>
                                <video>
                                    <samplecharacteristics>
                                        <rate>
                                            <timebase>${fps}</timebase>
                                            <ntsc>FALSE</ntsc>
                                        </rate>
                                        <width>1920</width>
                                        <height>1080</height>
                                    </samplecharacteristics>
                                </video>
                            </media>
                        </file>
                    </clipitem>\n`;
                currentTimelineFrame += clipDurationFrames;
            }
            xml += `                </track>\n`;
        }

        xml += `            </video>
            <audio>
                <numOutputChannels>2</numOutputChannels>
                <format>
                    <samplecharacteristics>
                        <depth>16</depth>
                        <samplerate>48000</samplerate>
                    </samplecharacteristics>
                </format>
`;

        // Add Audio Tracks
        const sortedAudioTrackIndices = Array.from(audioTracksMap.keys()).sort((a, b) => a - b);
        for (const trackIndex of sortedAudioTrackIndices) {
            const clips = audioTracksMap.get(trackIndex)!;
            xml += `                <track>\n`;
            let currentTimelineFrame = 0;

            for (const clip of clips) {
                const clipDurationFrames = toFrames(clip.duration);
                const filePath = clip.clipPath || clip.sourcePath;
                const fileId = getFileId(filePath);
                const clipId = `clipitem-audio-${escapeXml(clip.name)}-a${trackIndex}`;

                xml += `                    <clipitem id="${clipId}">
                        <masterclipid>masterclip-${fileId}</masterclipid>
                        <name>${escapeXml(clip.name)}</name>
                        <enabled>TRUE</enabled>
                        <duration>${clipDurationFrames}</duration>
                        <rate>
                            <timebase>${fps}</timebase>
                            <ntsc>FALSE</ntsc>
                        </rate>
                        <start>${currentTimelineFrame}</start>
                        <end>${currentTimelineFrame + clipDurationFrames}</end>
                        <in>0</in>
                        <out>${clipDurationFrames}</out>
                        <file id="${fileId}">
                            <name>${escapeXml(path.basename(filePath))}</name>
                            <pathurl>${toFileUrl(filePath)}</pathurl>
                            <rate>
                                <timebase>${fps}</timebase>
                                <ntsc>FALSE</ntsc>
                            </rate>
                            <duration>${clipDurationFrames}</duration>
                            <media>
                                <audio>
                                    <samplecharacteristics>
                                        <depth>16</depth>
                                        <samplerate>48000</samplerate>
                                    </samplecharacteristics>
                                    <channelcount>2</channelcount>
                                </audio>
                            </media>
                        </file>
                    </clipitem>\n`;
                currentTimelineFrame += clipDurationFrames;
            }
            xml += `                </track>\n`;
        }

        xml += `            </audio>
        </media>
    </sequence>
</xmeml>`;

        fs.writeFileSync(outputPath, xml, 'utf-8');
        console.log(`Exported Premiere XML timeline: ${outputPath}`);
    }

    /**
     * Export timeline in JSON format (for programmatic use)
     */
    private exportAsJSON(timeline: TimelineExport, outputPath: string): void {
        fs.writeFileSync(outputPath, JSON.stringify(timeline, null, 2), 'utf-8');
        console.log(`Exported JSON timeline: ${outputPath}`);
    }

    /**
     * Export timeline in Kdenlive MLT XML format
     * MLT uses 'pixbuf' producer for images which are natively treated as still images
     * and can be extended freely in Kdenlive
     */
    private exportAsMLT(timeline: TimelineExport, outputPath: string): void {
        const fps = timeline.frameRate;
        const totalDurationFrames = Math.round(timeline.totalDuration * fps) || 3600;

        // Helper to convert seconds to frame count
        const toFrames = (seconds: number): number => Math.round(seconds * fps);

        // Escape XML special characters
        const escapeXml = (str: string): string => {
            return str
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&apos;');
        };

        // Keep Windows paths for resources - MLT on Windows expects backslashes
        // Only normalize for the root attribute which may use forward slashes
        const normalizeRootPath = (p: string): string => p.replace(/\\/g, '/');

        // Collect all producers (media sources)
        const producers: string[] = [];
        const mainBinEntries: string[] = [];
        const playlists: string[] = [];
        let producerId = 1; // Start from 1 for kdenlive:id
        let clipCounter = 1;

        // Map from file path to producer ID and kdenlive:id
        const mediaProducerMap = new Map<string, { producerId: string; kdenliveId: string }>();

        // Track cursors for sequential placement
        const trackCursors = new Map<number, number>();

        // Process video clips - create producers and playlist entries
        const videoTracks = new Map<number, string[]>();
        const imageTracks = new Map<number, string[]>();

        for (const clip of timeline.videoClips) {
            const track = clip.track || 1;
            const filePath = clip.clipPath || clip.sourcePath;
            const durationFrames = toFrames(clip.duration);

            // Get or create producer for this video
            let producerInfo = mediaProducerMap.get(filePath);
            if (!producerInfo) {
                const kdenliveId = String(clipCounter++);
                const prodId = `producer${producerId++}`;
                producerInfo = { producerId: prodId, kdenliveId };
                mediaProducerMap.set(filePath, producerInfo);

                producers.push(`    <producer id="${prodId}" in="0" out="${durationFrames - 1}">
        <property name="resource">${escapeXml(filePath)}</property>
        <property name="mlt_service">avformat</property>
        <property name="kdenlive:id">${kdenliveId}</property>
        <property name="kdenlive:clipname">${escapeXml(clip.name)}</property>
    </producer>`);

                // Add to main_bin
                mainBinEntries.push(`        <entry producer="${prodId}" in="0" out="${durationFrames - 1}"/>`);
            }

            // Add to video track playlist
            if (!videoTracks.has(track)) videoTracks.set(track, []);
            const currentFrame = trackCursors.get(track) || 0;

            videoTracks.get(track)!.push(
                `        <entry producer="${producerInfo.producerId}" in="0" out="${durationFrames - 1}"/>`
            );
            trackCursors.set(track, currentFrame + durationFrames);

            // Handle image for this clip - use pixbuf producer (native still image)
            if (clip.imagePath && fs.existsSync(clip.imagePath)) {
                const imgTrack = track + 100;
                let imgProducerInfo = mediaProducerMap.get(clip.imagePath);

                if (!imgProducerInfo) {
                    const kdenliveId = String(clipCounter++);
                    const prodId = `producer${producerId++}`;
                    imgProducerInfo = { producerId: prodId, kdenliveId };
                    mediaProducerMap.set(clip.imagePath, imgProducerInfo);

                    // pixbuf producer for images - Kdenlive treats these as true still images
                    const imgDurationFrames = fps * 3600; // 1 hour default availability
                    producers.push(`    <producer id="${prodId}" in="0" out="${imgDurationFrames - 1}">
        <property name="resource">${escapeXml(clip.imagePath)}</property>
        <property name="mlt_service">pixbuf</property>
        <property name="kdenlive:id">${kdenliveId}</property>
        <property name="kdenlive:clipname">${escapeXml(path.basename(clip.imagePath))}</property>
        <property name="length">${imgDurationFrames}</property>
        <property name="ttl">1</property>
    </producer>`);

                    // Add to main_bin
                    mainBinEntries.push(`        <entry producer="${prodId}" in="0" out="${imgDurationFrames - 1}"/>`);
                }

                // Add to image track playlist
                if (!imageTracks.has(imgTrack)) imageTracks.set(imgTrack, []);
                imageTracks.get(imgTrack)!.push(
                    `        <entry producer="${imgProducerInfo.producerId}" in="0" out="${durationFrames - 1}"/>`
                );
            }
        }

        // Process audio clips
        const audioTracks = new Map<number, string[]>();

        for (const clip of timeline.audioClips) {
            const track = clip.track || 1;
            const filePath = clip.clipPath || clip.sourcePath;
            const durationFrames = toFrames(clip.duration);

            // Get or create producer for this audio
            let producerInfo = mediaProducerMap.get(filePath);
            if (!producerInfo) {
                const kdenliveId = String(clipCounter++);
                const prodId = `producer${producerId++}`;
                producerInfo = { producerId: prodId, kdenliveId };
                mediaProducerMap.set(filePath, producerInfo);

                producers.push(`    <producer id="${prodId}" in="0" out="${durationFrames - 1}">
        <property name="resource">${escapeXml(filePath)}</property>
        <property name="mlt_service">avformat</property>
        <property name="kdenlive:id">${kdenliveId}</property>
        <property name="kdenlive:clipname">${escapeXml(clip.name)}</property>
    </producer>`);

                // Add to main_bin
                mainBinEntries.push(`        <entry producer="${prodId}" in="0" out="${durationFrames - 1}"/>`);
            }

            // Add to audio track playlist
            if (!audioTracks.has(track)) audioTracks.set(track, []);
            audioTracks.get(track)!.push(
                `        <entry producer="${producerInfo.producerId}" in="0" out="${durationFrames - 1}"/>`
            );
        }

        // Build playlists for each track
        let playlistId = 0;
        const tractorTracks: string[] = [];

        // Video playlists
        const sortedVideoTracks = Array.from(videoTracks.keys()).sort((a, b) => a - b);
        for (const trackNum of sortedVideoTracks) {
            const entries = videoTracks.get(trackNum)!;
            const plId = `playlist${playlistId++}`;
            playlists.push(`    <playlist id="${plId}">
        <property name="kdenlive:track_name">Video ${trackNum}</property>
${entries.join('\n')}
    </playlist>`);
            tractorTracks.push(`        <track producer="${plId}"/>`);
        }

        // Image playlists
        const sortedImageTracks = Array.from(imageTracks.keys()).sort((a, b) => a - b);
        for (const trackNum of sortedImageTracks) {
            const entries = imageTracks.get(trackNum)!;
            const plId = `playlist${playlistId++}`;
            playlists.push(`    <playlist id="${plId}">
        <property name="kdenlive:track_name">Images ${trackNum - 100}</property>
${entries.join('\n')}
    </playlist>`);
            tractorTracks.push(`        <track producer="${plId}"/>`);
        }

        // Audio playlists
        const sortedAudioTracks = Array.from(audioTracks.keys()).sort((a, b) => a - b);
        for (const trackNum of sortedAudioTracks) {
            const entries = audioTracks.get(trackNum)!;
            const plId = `playlist${playlistId++}`;
            playlists.push(`    <playlist id="${plId}">
        <property name="kdenlive:track_name">Audio ${trackNum}</property>
        <property name="kdenlive:audio_track">1</property>
${entries.join('\n')}
    </playlist>`);
            tractorTracks.push(`        <track producer="${plId}" hide="video"/>`);
        }

        // Build the complete MLT XML
        const mlt = `<?xml version="1.0" encoding="utf-8"?>
<mlt LC_NUMERIC="C" producer="main_bin" version="7.22.0" root="${escapeXml(normalizeRootPath(path.dirname(outputPath)))}">
    <profile description="HD 1080p ${fps} fps" width="1920" height="1080" progressive="1" sample_aspect_num="1" sample_aspect_den="1" display_aspect_num="16" display_aspect_den="9" frame_rate_num="${fps}" frame_rate_den="1" colorspace="709"/>
    
    <!-- Producers (Media Sources) -->
${producers.join('\n\n')}

    <!-- Empty black producer for gaps -->
    <producer id="black" in="0" out="${totalDurationFrames}">
        <property name="resource">black</property>
        <property name="mlt_service">color</property>
        <property name="kdenlive:id">black</property>
    </producer>

    <!-- Main bin (for Kdenlive media browser) -->
    <playlist id="main_bin">
        <property name="kdenlive:docproperties.version">1.04</property>
        <property name="kdenlive:docproperties.profile">${fps}fps</property>
        <property name="xml_retain">1</property>
${mainBinEntries.join('\n')}
    </playlist>

    <!-- Track Playlists -->
${playlists.join('\n\n')}

    <!-- Main Timeline Tractor -->
    <tractor id="maintractor" in="0" out="${totalDurationFrames}">
        <property name="kdenlive:projectName">${escapeXml(timeline.projectName)}</property>
${tractorTracks.join('\n')}
    </tractor>
</mlt>`;

        fs.writeFileSync(outputPath, mlt, 'utf-8');
        console.log(`Exported Kdenlive MLT XML timeline: ${outputPath}`);
    }

    /**
     * Export timeline in OpenTimelineIO format (OTIO)
     * OTIO is a modern JSON-based format with proper still image support
     * Supported by DaVinci Resolve 18+ and other modern NLEs
     */
    private exportAsOTIO(timeline: TimelineExport, outputPath: string): void {
        const fps = timeline.frameRate;

        // Helper to create a RationalTime object
        const rationalTime = (value: number, rate: number = fps) => ({
            "OTIO_SCHEMA": "RationalTime.1",
            "value": value,
            "rate": rate
        });

        // Helper to create a TimeRange object
        const timeRange = (startValue: number, durationValue: number, rate: number = fps) => ({
            "OTIO_SCHEMA": "TimeRange.1",
            "start_time": rationalTime(startValue, rate),
            "duration": rationalTime(durationValue, rate)
        });

        // Group by track for organization
        const trackGroups = new Map<number, any[]>();

        // Process video clips
        for (const clip of timeline.videoClips) {
            const track = clip.track || 1;
            if (!trackGroups.has(track)) trackGroups.set(track, []);

            const durationFrames = Math.round(clip.duration * fps);
            const filePath = clip.clipPath || clip.sourcePath;

            // Video clip
            trackGroups.get(track)!.push({
                "OTIO_SCHEMA": "Clip.2",
                "metadata": {},
                "name": clip.name,
                "source_range": timeRange(0, durationFrames),
                "effects": [],
                "markers": [],
                "enabled": true,
                "media_references": {
                    "DEFAULT_MEDIA": {
                        "OTIO_SCHEMA": "ExternalReference.1",
                        "metadata": {},
                        "name": path.basename(filePath),
                        "available_range": timeRange(0, durationFrames),
                        "available_image_bounds": null,
                        "target_url": `file:///${filePath.replace(/\\/g, '/')}`
                    }
                },
                "active_media_reference_key": "DEFAULT_MEDIA"
            });

            // Image clip - use ExternalReference with very long duration for still images
            // Note: ImageSequenceReference is for numbered sequences (file001.png, file002.png)
            // For single still images, ExternalReference with long available_range works best
            if (clip.imagePath) {
                const imgTrack = track + 100; // Put images on separate tracks
                if (!trackGroups.has(imgTrack)) trackGroups.set(imgTrack, []);

                // For still images, use a very large duration (24 hours)
                const stillDurationFrames = fps * 3600 * 24;
                const normalizedImgPath = clip.imagePath.replace(/\\/g, '/');

                trackGroups.get(imgTrack)!.push({
                    "OTIO_SCHEMA": "Clip.2",
                    "metadata": {},
                    "name": `${clip.name}_img`,
                    "source_range": timeRange(0, durationFrames),
                    "effects": [],
                    "markers": [],
                    "enabled": true,
                    "media_references": {
                        "DEFAULT_MEDIA": {
                            "OTIO_SCHEMA": "ExternalReference.1",
                            "metadata": {},
                            "name": path.basename(clip.imagePath),
                            "available_range": timeRange(0, stillDurationFrames),
                            "available_image_bounds": null,
                            "target_url": `file:///${normalizedImgPath}`
                        }
                    },
                    "active_media_reference_key": "DEFAULT_MEDIA"
                });
            }
        }

        // Process audio clips
        for (const clip of timeline.audioClips) {
            const track = -(clip.track || 1); // Negative for audio tracks
            if (!trackGroups.has(track)) trackGroups.set(track, []);

            const durationFrames = Math.round(clip.duration * fps);
            const filePath = clip.clipPath || clip.sourcePath;

            trackGroups.get(track)!.push({
                "OTIO_SCHEMA": "Clip.2",
                "metadata": {},
                "name": clip.name,
                "source_range": timeRange(0, durationFrames),
                "effects": [],
                "markers": [],
                "enabled": true,
                "media_references": {
                    "DEFAULT_MEDIA": {
                        "OTIO_SCHEMA": "ExternalReference.1",
                        "metadata": {},
                        "name": path.basename(filePath),
                        "available_range": timeRange(0, durationFrames),
                        "available_image_bounds": null,
                        "target_url": `file:///${filePath.replace(/\\/g, '/')}`
                    }
                },
                "active_media_reference_key": "DEFAULT_MEDIA"
            });
        }

        // Build tracks array
        const tracks: any[] = [];
        const sortedTrackNums = Array.from(trackGroups.keys()).sort((a, b) => b - a); // Video first, then audio

        for (const trackNum of sortedTrackNums) {
            const trackClips = trackGroups.get(trackNum)!;
            const isAudio = trackNum < 0;
            const isImage = trackNum > 100;

            tracks.push({
                "OTIO_SCHEMA": "Track.1",
                "metadata": {},
                "name": isImage ? `Images ${trackNum - 100}` : (isAudio ? `Audio ${Math.abs(trackNum)}` : `Video ${trackNum}`),
                "source_range": null,
                "effects": [],
                "markers": [],
                "enabled": true,
                "kind": isAudio ? "Audio" : "Video",
                "children": trackClips
            });
        }

        // Build the OTIO structure
        const otio = {
            "OTIO_SCHEMA": "Timeline.1",
            "metadata": {},
            "name": timeline.projectName,
            "global_start_time": rationalTime(0),
            "tracks": {
                "OTIO_SCHEMA": "Stack.1",
                "metadata": {},
                "name": "tracks",
                "source_range": null,
                "effects": [],
                "markers": [],
                "enabled": true,
                "children": tracks
            }
        };

        fs.writeFileSync(outputPath, JSON.stringify(otio, null, 2), 'utf-8');
        console.log(`Exported OTIO timeline: ${outputPath}`);
    }

    /**
     * Export timeline in specified format
     */
    public exportTimeline(
        timeline: TimelineExport,
        format: 'edl' | 'xml' | 'json',
        outputPath: string
    ): void {
        const baseDir = path.dirname(outputPath);

        // ALWAYS export all formats for convenience

        // 1. EDL
        const edlPath = path.join(baseDir, 'timeline.edl');
        this.exportAsEDL(timeline, edlPath);

        // 2. XML (Final Cut Pro X)
        const xmlPath = path.join(baseDir, 'timeline.fcpxml');
        this.exportAsXML(timeline, xmlPath);

        // 3. Premiere XML (FCP 7 XML)
        const premierePath = path.join(baseDir, 'timeline_premiere.xml');
        this.exportAsPremiereXML(timeline, premierePath);

        // 4. JSON
        const jsonPath = path.join(baseDir, 'timeline.json');
        this.exportAsJSON(timeline, jsonPath);

        // 5. OpenTimelineIO (for DaVinci Resolve with proper still image support)
        const otioPath = path.join(baseDir, 'timeline.otio');
        this.exportAsOTIO(timeline, otioPath);

        // 6. Kdenlive MLT XML (best for still images - uses pixbuf producer)
        const mltPath = path.join(baseDir, 'timeline.kdenlive');
        this.exportAsMLT(timeline, mltPath);

        console.log('Exported timeline in all formats (EDL, FCPXML, Premiere XML, JSON, OTIO, Kdenlive)');
    }

    /**
     * Create a complete editable timeline from video and/or audio files
     * Each video and audio file gets its own track for maximum editing flexibility
     */
    public async createTimeline(config: TimelineConfig): Promise<TimelineResult> {
        const {
            videoPaths = [],
            audioPaths = [],
            outputDir,
            exportFormat,
            sceneThreshold = 0.1,
            silenceDuration = 2,
            silenceThreshold = -30,
            reducedPauseDuration = 1,
            projectName = 'Slideshow Timeline',
            frameRate = 30
        } = config;

        if (videoPaths.length === 0 && audioPaths.length === 0) {
            return {
                success: false,
                message: 'At least one video or audio path is required'
            };
        }

        // Create output directory
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const timeline: TimelineExport = {
            projectName,
            frameRate,
            totalDuration: 0,
            videoClips: [],
            audioClips: []
        };

        let videoClipsDir: string | undefined;
        let audioClipsDir: string | undefined;
        let totalVideoClips = 0;
        let totalAudioClips = 0;

        try {
            // Process each video file on its own track
            for (let videoIndex = 0; videoIndex < videoPaths.length; videoIndex++) {
                const videoPath = videoPaths[videoIndex];
                const trackNumber = videoIndex + 1; // V1, V2, etc.

                console.log(`\n=== Processing Video ${videoIndex + 1} (Track V${trackNumber}) ===`);
                console.log(`File: ${videoPath}`);

                if (!fs.existsSync(videoPath)) {
                    console.warn(`Video file not found, skipping: ${videoPath}`);
                    continue;
                }

                const sceneResult = await this.detectSceneChanges(videoPath, sceneThreshold);

                if (!sceneResult.success) {
                    console.warn(`Scene detection failed for ${videoPath}: ${sceneResult.message}`);
                    continue;
                }

                if (sceneResult.clips.length > 0) {
                    console.log(`Cutting ${sceneResult.clips.length} video clips...`);

                    // Create subfolder for this video's clips
                    const videoBaseName = path.basename(videoPath, path.extname(videoPath));
                    const videoOutputDir = path.join(outputDir, `video_${videoIndex + 1}_${videoBaseName}`);
                    if (!fs.existsSync(videoOutputDir)) {
                        fs.mkdirSync(videoOutputDir, { recursive: true });
                    }

                    await this.cutVideoClips(videoPath, sceneResult.clips, path.dirname(videoOutputDir));

                    // NEW: Extract images for each clip
                    const imagesDir = path.join(outputDir, 'images');
                    if (!fs.existsSync(imagesDir)) {
                        fs.mkdirSync(imagesDir, { recursive: true });
                    }
                    await this.extractClipImages(videoPath, sceneResult.clips, imagesDir);

                    videoClipsDir = videoClipsDir || path.join(outputDir, 'video_clips');

                    // Build timeline clips for this video
                    const baseName = path.basename(videoPath, path.extname(videoPath));
                    const videoTimelineClips = sceneResult.clips.map((clip) => ({
                        index: clip.index,
                        name: `${baseName}_clip_${String(clip.index).padStart(3, '0')}`,
                        type: 'video' as const,
                        sourcePath: videoPath,
                        clipPath: clip.outputPath,
                        imagePath: path.join(imagesDir, `${baseName}_clip_${String(clip.index).padStart(3, '0')}.jpg`),
                        startTime: clip.startTime,
                        endTime: clip.endTime,
                        duration: clip.duration,
                        track: trackNumber
                    }));

                    timeline.videoClips.push(...videoTimelineClips);
                    totalVideoClips += sceneResult.clips.length;
                    timeline.totalDuration = Math.max(timeline.totalDuration, sceneResult.totalDuration);
                }
            }

            // Process each audio file on its own track
            const audioTrackOffset = videoPaths.length; // Audio tracks start after video tracks
            for (let audioIndex = 0; audioIndex < audioPaths.length; audioIndex++) {
                const audioPath = audioPaths[audioIndex];
                const trackNumber = audioTrackOffset + audioIndex + 1; // A3, A4, etc. (after video tracks)

                console.log(`\n=== Processing Audio ${audioIndex + 1} (Track A${audioIndex + 1}) ===`);
                console.log(`File: ${audioPath}`);

                if (!fs.existsSync(audioPath)) {
                    console.warn(`Audio file not found, skipping: ${audioPath}`);
                    continue;
                }

                const silenceResult = await this.detectSilences(audioPath, silenceDuration, silenceThreshold);

                if (!silenceResult.success) {
                    console.warn(`Silence detection failed for ${audioPath}: ${silenceResult.message}`);
                    continue;
                }

                if (silenceResult.clips.length > 0) {
                    console.log(`Cutting ${silenceResult.clips.length} audio clips with ${reducedPauseDuration}s pauses...`);

                    // Create subfolder for this audio's clips
                    const audioBaseName = path.basename(audioPath, path.extname(audioPath));
                    const audioOutputDir = path.join(outputDir, `audio_${audioIndex + 1}_${audioBaseName}`);
                    if (!fs.existsSync(audioOutputDir)) {
                        fs.mkdirSync(audioOutputDir, { recursive: true });
                    }

                    await this.cutAudioClips(audioPath, silenceResult.clips, path.dirname(audioOutputDir), reducedPauseDuration);
                    audioClipsDir = audioClipsDir || path.join(outputDir, 'audio_clips');

                    // Build timeline clips for this audio
                    const baseName = path.basename(audioPath, path.extname(audioPath));
                    const audioTimelineClips = silenceResult.clips.map((clip, i) => ({
                        index: clip.index,
                        name: `${baseName}_clip_${String(clip.index).padStart(3, '0')}`,
                        type: 'audio' as const,
                        sourcePath: audioPath,
                        clipPath: clip.outputPath,
                        startTime: clip.startTime,
                        endTime: clip.endTime,
                        duration: clip.duration + (i < silenceResult.clips.length - 1 ? reducedPauseDuration : 0),
                        track: trackNumber
                    }));

                    timeline.audioClips.push(...audioTimelineClips);
                    totalAudioClips += silenceResult.clips.length;
                    timeline.totalDuration = Math.max(timeline.totalDuration, silenceResult.totalDuration);
                }
            }

            // Export timeline
            const ext = exportFormat === 'edl' ? '.edl' : exportFormat === 'xml' ? '.fcpxml' : '.json';
            const timelinePath = path.join(outputDir, `timeline${ext}`);
            this.exportTimeline(timeline, exportFormat, timelinePath);

            const videoSummary = videoPaths.length > 0 ? `${videoPaths.length} video(s) -> ${totalVideoClips} clips` : '';
            const audioSummary = audioPaths.length > 0 ? `${audioPaths.length} audio(s) -> ${totalAudioClips} clips` : '';
            const summary = [videoSummary, audioSummary].filter(s => s).join(', ');

            return {
                success: true,
                message: `Timeline created: ${summary}`,
                timelinePath,
                videoClipsDir,
                audioClipsDir,
                videoClipCount: totalVideoClips,
                audioClipCount: totalAudioClips,
                timeline
            };

        } catch (error) {
            return {
                success: false,
                message: `Timeline creation failed: ${(error as Error).message}`
            };
        }
    }
}
