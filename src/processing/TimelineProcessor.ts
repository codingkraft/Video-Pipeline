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
     * Export timeline in Final Cut Pro XML format
     */
    private exportAsXML(timeline: TimelineExport, outputPath: string): void {
        const fps = timeline.frameRate;
        const totalDurationFrames = Math.round(timeline.totalDuration * fps) || 3600;

        // Helper to convert seconds to frame count
        const toFrames = (seconds: number): number => Math.round(seconds * fps);

        let xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.9">
    <resources>
        <format id="r1" name="FFVideoFormat1080p${fps}" frameDuration="1/${fps}s" width="1920" height="1080"/>
`;

        // Add media resources
        let resourceId = 2;
        const mediaRefs: Map<string, number> = new Map();

        for (const clip of [...timeline.videoClips, ...timeline.audioClips]) {
            const filePath = clip.clipPath || clip.sourcePath;
            if (!mediaRefs.has(filePath)) {
                mediaRefs.set(filePath, resourceId);
                // Ensure proper 3-slash file URI for Windows
                const normalizedPath = filePath.replace(/\\/g, '/');
                xml += `        <asset id="r${resourceId}" name="${clip.name}" src="file:///${normalizedPath}" hasVideo="${clip.type === 'video' ? '1' : '0'}" hasAudio="1"/>\n`;
                resourceId++;
            }
        }

        xml += `    </resources>
    <library>
        <event name="${timeline.projectName}">
            <project name="${timeline.projectName}">
                <sequence format="r1">
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

            // Calculate sequential offset for this track
            const currentCursorFrames = trackCursors.get(clip.track) || 0;
            const startFrame = currentCursorFrames;

            // Update cursor
            trackCursors.set(clip.track, currentCursorFrames + durationFrames);

            // V1 -> lane 1. V2 -> lane 2.
            const lane = clip.track || 1;
            xml += `                            <asset-clip ref="r${refId}" offset="${startFrame}/${fps}s" name="${clip.name}" duration="${durationFrames}/${fps}s" start="0s" lane="${lane}"/>\n`;
        }

        // Add Audio clips as connected clips
        const audioTracks = [...new Set(timeline.audioClips.map(c => c.track))].sort();

        for (const clip of timeline.audioClips) {
            const refId = mediaRefs.get(clip.clipPath || clip.sourcePath);
            const durationFrames = toFrames(clip.duration);

            // Calculate sequential offset for this track
            const currentCursorFrames = trackCursors.get(clip.track) || 0;
            const startFrame = currentCursorFrames;

            // Update cursor
            trackCursors.set(clip.track, currentCursorFrames + durationFrames);

            // Map track to negative lane: A1 -> -1, A2 -> -2
            const trackIndex = audioTracks.indexOf(clip.track);
            const lane = -1 * (trackIndex + 1);

            xml += `                            <asset-clip ref="r${refId}" offset="${startFrame}/${fps}s" name="${clip.name}" duration="${durationFrames}/${fps}s" start="0s" lane="${lane}" role="dialogue"/>\n`;
        }

        xml += `                        </gap>\n`;
        xml += `                    </spine>
                </sequence>
            </project>
        </event>
    </library>
</fcpxml>`;

        fs.writeFileSync(outputPath, xml, 'utf-8');
        console.log(`Exported XML timeline: ${outputPath}`);
    }

    /**
     * Export timeline in JSON format (for programmatic use)
     */
    private exportAsJSON(timeline: TimelineExport, outputPath: string): void {
        fs.writeFileSync(outputPath, JSON.stringify(timeline, null, 2), 'utf-8');
        console.log(`Exported JSON timeline: ${outputPath}`);
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

        // 2. XML (Final Cut Pro / Resolve)
        const xmlPath = path.join(baseDir, 'timeline.fcpxml');
        this.exportAsXML(timeline, xmlPath);

        // 3. JSON
        const jsonPath = path.join(baseDir, 'timeline.json');
        this.exportAsJSON(timeline, jsonPath);

        console.log('Exported timeline in all formats (EDL, XML, JSON)');
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
                    videoClipsDir = videoClipsDir || path.join(outputDir, 'video_clips');

                    // Build timeline clips for this video
                    const baseName = path.basename(videoPath, path.extname(videoPath));
                    const videoTimelineClips = sceneResult.clips.map((clip) => ({
                        index: clip.index,
                        name: `${baseName}_clip_${String(clip.index).padStart(3, '0')}`,
                        type: 'video' as const,
                        sourcePath: videoPath,
                        clipPath: clip.outputPath,
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
