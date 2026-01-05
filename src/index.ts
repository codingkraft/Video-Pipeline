// Video Creator - Automated Pipeline Entry Point
import { VideoPipeline, PipelineInput } from './workflow/VideoPipeline';
import * as path from 'path';
import * as fs from 'fs';

async function main() {
    console.log('=================================');
    console.log('  Video Creator - Automated Pipeline');
    console.log('=================================\n');

    // Initialize the pipeline with concurrency of 2 (process 2 videos at a time)
    const pipeline = new VideoPipeline(2);

    try {
        await pipeline.initialize();

        // Example: Process a single video
        // In production, you would read this from a config file, folder watcher, or CLI args
        const exampleInput: PipelineInput = {
            id: 'video_001',
            documentPaths: [
                // Add your document paths here
                // Example: 'C:/Documents/my_document.pdf'
            ],
            stylePrompt: 'Modern, engaging, educational with smooth transitions',
            chatSettings: {
                customInstructions: 'Focus on key concepts and provide clear explanations',
            },
            outputDir: path.join(process.cwd(), 'output', 'video_001'),
        };

        // Check if there are documents to process
        if (exampleInput.documentPaths.length === 0) {
            console.log('No documents specified. Please configure document paths in the input.');
            console.log('\nTo use the pipeline, you can:');
            console.log('1. Modify this file to add document paths');
            console.log('2. Use the pipeline programmatically from another script');
            console.log('3. Create a config file and read inputs from it\n');

            console.log('Example usage:');
            console.log(`
const input: PipelineInput = {
    id: 'my_video',
    documentPaths: ['./docs/document1.pdf', './docs/document2.txt'],
    stylePrompt: 'Modern educational style',
    outputDir: './output/my_video',
};

const result = await pipeline.processVideo(input);
console.log('Video created:', result.outputVideoPath);
`);
            return;
        }

        // Process the video
        const result = await pipeline.processVideo(exampleInput);

        if (result.success) {
            console.log('\n✅ Video created successfully!');
            console.log(`Output: ${result.outputVideoPath}`);
        } else {
            console.log('\n❌ Video creation failed.');
            console.log(`Error: ${result.error}`);
        }

    } catch (error) {
        console.error('Pipeline error:', error);
    } finally {
        await pipeline.shutdown();
    }
}

// Run if executed directly
main().catch(console.error);
