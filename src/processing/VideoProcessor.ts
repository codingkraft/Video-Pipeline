import ffmpeg from 'fluent-ffmpeg';
import * as path from 'path';
import * as fs from 'fs';

export interface VideoProcessingConfig {
    notebookLMVideoPath: string;
    geminiVideoPath: string;
    ttsAudioPath: string;
    outputPath: string;
}

export interface VideoProcessingResult {
    outputPath: string;
    duration: number;
}

export class VideoProcessor {
    /**
     * Combine videos and replace audio.
     * Steps:
     * 1. Extract video stream from NotebookLM video (remove audio)
     * 2. Combine with Gemini video (overlay, concat, or side-by-side)
     * 3. Add TTS audio synced to video
     */
    public async processVideos(config: VideoProcessingConfig): Promise<VideoProcessingResult> {
        const { notebookLMVideoPath, geminiVideoPath, ttsAudioPath, outputPath } = config;

        // Validate input files exist
        this.validateFiles([notebookLMVideoPath, geminiVideoPath, ttsAudioPath]);

        // Step 1: Extract video only from NotebookLM video (no audio)
        const videoOnlyPath = path.join(path.dirname(outputPath), 'temp_video_only.mp4');
        await this.extractVideoOnly(notebookLMVideoPath, videoOnlyPath);

        // Step 2: Combine videos (overlay Gemini video onto NotebookLM video)
        const combinedVideoPath = path.join(path.dirname(outputPath), 'temp_combined.mp4');
        await this.combineVideos(videoOnlyPath, geminiVideoPath, combinedVideoPath);

        // Step 3: Add TTS audio to the combined video
        await this.addAudioToVideo(combinedVideoPath, ttsAudioPath, outputPath);

        // Cleanup temp files
        await this.cleanup([videoOnlyPath, combinedVideoPath]);

        // Get duration of final video
        const duration = await this.getVideoDuration(outputPath);

        return {
            outputPath,
            duration,
        };
    }

    /**
     * Validate that all input files exist.
     */
    private validateFiles(filePaths: string[]): void {
        for (const filePath of filePaths) {
            if (!fs.existsSync(filePath)) {
                throw new Error(`File not found: ${filePath}`);
            }
        }
    }

    /**
     * Extract video stream only (remove audio).
     */
    private extractVideoOnly(inputPath: string, outputPath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            ffmpeg(inputPath)
                .outputOptions(['-an']) // Remove audio
                .output(outputPath)
                .on('end', () => {
                    console.log(`Extracted video (no audio): ${outputPath}`);
                    resolve();
                })
                .on('error', (err) => {
                    reject(new Error(`Failed to extract video: ${err.message}`));
                })
                .run();
        });
    }

    /**
     * Combine two videos using picture-in-picture.
     * The Gemini video will be overlaid in the bottom-right corner.
     */
    private combineVideos(
        mainVideoPath: string,
        overlayVideoPath: string,
        outputPath: string
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            ffmpeg()
                .input(mainVideoPath)
                .input(overlayVideoPath)
                .complexFilter([
                    // Scale overlay video to 25% of main video
                    '[1:v]scale=iw/4:ih/4[overlay]',
                    // Overlay in bottom-right corner with padding
                    '[0:v][overlay]overlay=main_w-overlay_w-10:main_h-overlay_h-10[outv]'
                ])
                .outputOptions([
                    '-map', '[outv]',
                    '-c:v', 'libx264',
                    '-preset', 'fast',
                    '-crf', '23'
                ])
                .output(outputPath)
                .on('end', () => {
                    console.log(`Combined videos: ${outputPath}`);
                    resolve();
                })
                .on('error', (err) => {
                    reject(new Error(`Failed to combine videos: ${err.message}`));
                })
                .run();
        });
    }

    /**
     * Add audio track to video.
     */
    private addAudioToVideo(
        videoPath: string,
        audioPath: string,
        outputPath: string
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            ffmpeg()
                .input(videoPath)
                .input(audioPath)
                .outputOptions([
                    '-c:v', 'copy',
                    '-c:a', 'aac',
                    '-map', '0:v:0',
                    '-map', '1:a:0',
                    '-shortest' // End when the shortest stream ends
                ])
                .output(outputPath)
                .on('end', () => {
                    console.log(`Added audio to video: ${outputPath}`);
                    resolve();
                })
                .on('error', (err) => {
                    reject(new Error(`Failed to add audio: ${err.message}`));
                })
                .run();
        });
    }

    /**
     * Get video duration in seconds.
     */
    private getVideoDuration(videoPath: string): Promise<number> {
        return new Promise((resolve, reject) => {
            ffmpeg.ffprobe(videoPath, (err, metadata) => {
                if (err) {
                    reject(new Error(`Failed to probe video: ${err.message}`));
                    return;
                }
                resolve(metadata.format.duration || 0);
            });
        });
    }

    /**
     * Cleanup temporary files.
     */
    private async cleanup(filePaths: string[]): Promise<void> {
        for (const filePath of filePaths) {
            try {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                    console.log(`Cleaned up: ${filePath}`);
                }
            } catch (error) {
                console.log(`Failed to cleanup ${filePath}:`, error);
            }
        }
    }

    /**
     * Concatenate videos sequentially.
     */
    public async concatenateVideos(
        videoPaths: string[],
        outputPath: string
    ): Promise<void> {
        // Create a temporary file list for ffmpeg concat
        const listPath = path.join(path.dirname(outputPath), 'concat_list.txt');
        const listContent = videoPaths.map(p => `file '${p}'`).join('\n');
        fs.writeFileSync(listPath, listContent);

        return new Promise((resolve, reject) => {
            ffmpeg()
                .input(listPath)
                .inputOptions(['-f', 'concat', '-safe', '0'])
                .outputOptions(['-c', 'copy'])
                .output(outputPath)
                .on('end', () => {
                    fs.unlinkSync(listPath);
                    console.log(`Concatenated videos: ${outputPath}`);
                    resolve();
                })
                .on('error', (err) => {
                    fs.unlinkSync(listPath);
                    reject(new Error(`Failed to concatenate: ${err.message}`));
                })
                .run();
        });
    }
}
