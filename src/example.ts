// Example: Process a single video from sample document
import { VideoPipeline, PipelineInput } from './workflow/VideoPipeline';
import * as path from 'path';

async function main() {
    console.log('=================================');
    console.log('  Video Creator - Example Run');
    console.log('=================================\n');

    const pipeline = new VideoPipeline(1); // Process 1 video at a time

    try {
        await pipeline.initialize();

        const input: PipelineInput = {
            id: 'ai_future_video',
            documentPaths: [
                path.join(__dirname, '../sample_docs/ai_future.md')
            ],
            stylePrompt: 'Modern, professional, educational style with smooth transitions and engaging visuals',
            chatSettings: {
                customInstructions: 'Focus on explaining complex AI concepts in simple terms. Use examples and analogies.',
            },
            outputDir: path.join(__dirname, '../output/ai_future_video'),
        };

        console.log('Starting video creation pipeline...\n');
        console.log('Input document:', input.documentPaths[0]);
        console.log('Output directory:', input.outputDir);
        console.log('\nThis will take several minutes as it:');
        console.log('  1. Generates video prompt via Perplexity');
        console.log('  2. Creates NotebookLM notebook and generates video');
        console.log('  3. Generates additional video via Gemini');
        console.log('  4. Creates TTS narration');
        console.log('  5. Combines everything into final video\n');

        const result = await pipeline.processVideo(input);

        if (result.success) {
            console.log('\n✅ Video created successfully!');
            console.log(`\nFinal video: ${result.outputVideoPath}`);
            console.log('\nPipeline steps completed:');
            if (result.steps.perplexity) {
                console.log('  ✅ Perplexity prompt generation');
            }
            if (result.steps.notebookLM) {
                console.log('  ✅ NotebookLM video generation');
            }
            if (result.steps.gemini) {
                console.log('  ✅ Gemini video generation');
            }
            if (result.steps.tts) {
                console.log('  ✅ TTS audio generation');
            }
            if (result.steps.processing) {
                console.log('  ✅ Video processing complete');
            }
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

main().catch(console.error);
