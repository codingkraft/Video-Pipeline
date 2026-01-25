
import * as fs from 'fs';

// Mock classes to simulate docx generation logic
class Paragraph {
    text: string;
    heading: any;
    constructor(options: any) {
        this.text = options.text || '';
        this.heading = options.heading;
    }
}

const HeadingLevel = {
    HEADING_1: 'Heading1',
    HEADING_2: 'Heading2'
};

// Mock Video Section
const video = {
    slides: [
        { number: 1, title: 'Intro', originalVideoNumber: '5', duration: 10 },
        { number: 2, title: 'Concept', originalVideoNumber: '5', duration: 20 },
        { number: 3, title: 'Start Video 6', originalVideoNumber: '6', duration: 15 },
        { number: 4, title: 'Start Video 7', originalVideoNumber: '7', duration: 15 },
    ]
};

// Logic extracted from VideoFolderCreator.ts
function runVerification() {
    const children: any[] = [];
    let currentOriginalVideo = '';
    let isFirstVideoHeader = true;
    let log = '';

    log += '--- START VERIFICATION ---\n';

    for (const slide of video.slides) {
        // Video Demarcation Check
        if (slide.originalVideoNumber && slide.originalVideoNumber !== currentOriginalVideo) {
            currentOriginalVideo = slide.originalVideoNumber;

            // Add explicit Video Header (Visual Demarcation) - ONLY for the first video in the batch
            if (isFirstVideoHeader) {
                const p = new Paragraph({
                    text: `[[Video: ${currentOriginalVideo}]]`,
                    heading: HeadingLevel.HEADING_1,
                    spacing: { before: 400, after: 200 }
                });
                children.push(p);
                log += `HEADER ADDED: ${p.text}\n`;
                isFirstVideoHeader = false;
            } else {
                log += `HEADER SKIPPED for Video: ${currentOriginalVideo}\n`;
            }
        }

        // Slide Header
        const slideHeader = slide.duration
            ? `[[SLIDE ${slide.number}: ${slide.title}]] **[${slide.duration} seconds]**`
            : `[[SLIDE ${slide.number}: ${slide.title}]]`;

        children.push(new Paragraph({
            text: slideHeader,
            heading: HeadingLevel.HEADING_2
        }));
        log += `SLIDE ADDED: ${slideHeader}\n`;
    }

    log += '--- END VERIFICATION ---\n';
    fs.writeFileSync('log.txt', log, 'utf8');
}

runVerification();
