import { MarkdownScriptParser } from './src/services/MarkdownScriptParser';

const result = MarkdownScriptParser.parseFile('./give me the revised script based on this.md');

console.log('=== PARSE RESULTS ===');
console.log('Total videos:', result.totalVideos);
console.log('Chapter:', result.chapterTitle);
console.log('');

for (const v of result.videos) {
    console.log(`Video ${v.videoNumber}: ${v.title}`);
    console.log(`  Duration: ${v.duration}`);
    console.log(`  Concept: ${v.concept}`);
    console.log(`  Slides: ${v.slides.length}`);
    console.log(`  Code blocks: ${v.allCodeBlocks.length}`);

    // Show first 2 code blocks
    for (const block of v.allCodeBlocks.slice(0, 2)) {
        const firstLine = block.code.split('\n')[0].substring(0, 50);
        console.log(`    - Slide ${block.slideNumber}: ${firstLine}...`);
    }
    console.log('');
}

// Show narration for Video 6
const video6 = result.videos.find(v => v.videoNumber === 6);
if (video6) {
    console.log('=== VIDEO 6 NARRATION (first 500 chars) ===');
    console.log(video6.fullNarration.substring(0, 500));
}
