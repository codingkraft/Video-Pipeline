/**
 * Local Logo Remover using FFmpeg
 * Removes NotebookLM watermark by applying a blur filter to the logo area
 * This bypasses the need for external websites like notebooklmremover.com
 */

import * as fs from 'fs';
import * as path from 'path';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface LocalLogoRemovalResult {
    success: boolean;
    cleanVideoPath?: string;
    message?: string;
}

export class LocalLogoRemover {
    /**
     * Check if FFmpeg is installed on the system
     */
    public async isFFmpegInstalled(): Promise<boolean> {
        try {
            await execAsync('ffmpeg -version');
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Remove NotebookLM logo from video using FFmpeg blur filter
     * The NotebookLM logo is typically in the bottom-left corner
     * 
     * @param videoPath - Path to the input video file
     * @param options - Optional configuration for logo position and blur
     */
    public async removeLogo(
        videoPath: string,
        options?: {
            // Logo position (default: bottom-left for NotebookLM)
            logoX?: number;           // X position from left (default: 0)
            logoY?: number;           // Y position from bottom (default: 0)
            logoWidth?: number;       // Logo width in pixels (default: 200)
            logoHeight?: number;      // Logo height in pixels (default: 60)
            blurStrength?: number;    // Blur strength 1-20 (default: 30 - strong blur)
            cropBottom?: boolean;     // Whether to crop bottom section instead of blur
        }
    ): Promise<LocalLogoRemovalResult> {
        if (!fs.existsSync(videoPath)) {
            return { success: false, message: `Video file not found: ${videoPath}` };
        }

        // Check if FFmpeg is available
        const ffmpegAvailable = await this.isFFmpegInstalled();
        if (!ffmpegAvailable) {
            return {
                success: false,
                message: 'FFmpeg is not installed. Please install FFmpeg and add it to your PATH.'
            };
        }

        const ext = path.extname(videoPath);
        const base = path.basename(videoPath, ext);
        const outputDir = path.dirname(videoPath);
        const cleanPath = path.join(outputDir, `${base}_clean${ext}`);

        // Default values for NotebookLM logo position (BOTTOM-RIGHT corner based on actual video analysis)
        // Video is 1280x720, logo "🎙 NotebookLM" is in bottom-right
        const logoWidth = options?.logoWidth ?? 180;
        const logoHeight = options?.logoHeight ?? 40;
        const blurStrength = options?.blurStrength ?? 30;
        const cropBottom = options?.cropBottom ?? false;

        console.log(`[LocalLogoRemover] Processing: ${path.basename(videoPath)}`);
        console.log(`[LocalLogoRemover] Output: ${path.basename(cleanPath)}`);

        try {
            // First, get video dimensions
            const probeResult = await execAsync(
                `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "${videoPath}"`
            );
            const dimensions = probeResult.stdout.trim().split('x');
            const videoWidth = parseInt(dimensions[0]);
            const videoHeight = parseInt(dimensions[1]);

            console.log(`[LocalLogoRemover] Video dimensions: ${videoWidth}x${videoHeight}`);

            // Calculate logo position - BOTTOM-RIGHT corner
            // Add some padding (10px) from bottom and right edges
            const logoX = options?.logoX ?? (videoWidth - logoWidth - 10);
            const logoY = options?.logoY ?? (videoHeight - logoHeight - 10);

            let filterComplex: string;

            if (cropBottom) {
                // Option 1: Crop the bottom section entirely
                const cropHeight = videoHeight - logoHeight;
                filterComplex = `crop=${videoWidth}:${cropHeight}:0:0`;
                console.log(`[LocalLogoRemover] Using crop filter: ${filterComplex}`);
            } else {
                // Option 2: Draw a black box over the logo area
                // Using 90% opacity to blend slightly with background
                filterComplex = `drawbox=x=${logoX}:y=${logoY}:w=${logoWidth}:h=${logoHeight}:color=black@0.95:t=fill`;
                console.log(`[LocalLogoRemover] Using drawbox filter at position (${logoX},${logoY}) size ${logoWidth}x${logoHeight}`);
            }

            // Build FFmpeg command
            const ffmpegCmd = `ffmpeg -y -i "${videoPath}" -vf "${filterComplex}" -c:a copy "${cleanPath}"`;
            console.log(`[LocalLogoRemover] Executing FFmpeg...`);

            await execAsync(ffmpegCmd, { maxBuffer: 50 * 1024 * 1024 });

            // Verify output file was created
            if (!fs.existsSync(cleanPath)) {
                return { success: false, message: 'FFmpeg completed but output file was not created' };
            }

            const outputSize = fs.statSync(cleanPath).size;
            console.log(`[LocalLogoRemover] Success! Output size: ${Math.round(outputSize / 1024)}KB`);

            return { success: true, cleanVideoPath: cleanPath };

        } catch (error: any) {
            console.error(`[LocalLogoRemover] Error: ${error.message}`);

            // If delogo fails, try alternative approach
            if (error.message.includes('delogo')) {
                console.log('[LocalLogoRemover] Delogo filter failed, trying crop approach...');
                return this.removeLogo(videoPath, { ...options, cropBottom: true });
            }

            return { success: false, message: `FFmpeg error: ${error.message}` };
        }
    }

    /**
     * Remove logo from multiple videos in parallel
     */
    public async removeLogoBatch(
        videoPaths: string[],
        concurrencyLimit: number = 3
    ): Promise<Map<string, LocalLogoRemovalResult>> {
        const results = new Map<string, LocalLogoRemovalResult>();

        // Process in batches
        for (let i = 0; i < videoPaths.length; i += concurrencyLimit) {
            const batch = videoPaths.slice(i, i + concurrencyLimit);
            const batchResults = await Promise.all(
                batch.map(async (videoPath) => {
                    const result = await this.removeLogo(videoPath);
                    return { path: videoPath, result };
                })
            );

            for (const { path: videoPath, result } of batchResults) {
                results.set(videoPath, result);
            }
        }

        return results;
    }
}
