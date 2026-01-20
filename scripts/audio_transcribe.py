"""
Audio Transcription using OpenAI Whisper
Returns full transcription and segment information for marker detection.

Usage:
    python audio_transcribe.py "path/to/audio.wav" -m "next slide please"
"""

import whisper
import subprocess
import os
import sys
import argparse
import json


def get_audio_duration(audio_file: str) -> float:
    """Get audio duration using ffprobe."""
    cmd = [
        'ffprobe', '-v', 'quiet', '-print_format', 'json',
        '-show_format', audio_file
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode == 0:
        try:
            data = json.loads(result.stdout)
            return float(data['format']['duration'])
        except:
            pass
    return 0.0


def transcribe_audio(
    audio_file: str,
    marker_phrase: str = "next slide please",
    model_name: str = "base"
) -> dict:
    """
    Transcribe audio and find markers.
    
    Returns dict with:
    - transcription: full text
    - segments: list of content segments between markers
    - markers: list of marker positions
    - duration: total audio duration
    """
    if not os.path.exists(audio_file):
        return {"error": f"Audio file not found: {audio_file}"}
    
    # Load model
    print(f"Loading Whisper model '{model_name}'...", file=sys.stderr)
    model = whisper.load_model(model_name)
    
    # Transcribe
    print(f"Transcribing {audio_file}...", file=sys.stderr)
    result = model.transcribe(audio_file, word_timestamps=True)
    
    full_text = result.get("text", "")
    duration = get_audio_duration(audio_file)
    
    # Find markers and build segments
    markers = []
    target_phrase = marker_phrase.lower()
    
    for segment in result.get("segments", []):
        segment_text = segment.get("text", "").lower()
        
        if target_phrase in segment_text:
            # Find word-level position
            target_words = target_phrase.split()
            
            if "words" in segment:
                for i, word_info in enumerate(segment["words"]):
                    word = word_info["word"].lower().strip(".,!?")
                    
                    if target_words[0] in word:
                        phrase_start = word_info['start']
                        phrase_end = word_info['end']
                        
                        # Find end of phrase
                        for j, target in enumerate(target_words[1:], 1):
                            if i + j < len(segment["words"]):
                                next_word = segment["words"][i + j]["word"].lower().strip(".,!?")
                                if target in next_word:
                                    phrase_end = segment["words"][i + j]['end']
                        
                        markers.append({
                            'start': round(phrase_start, 2),
                            'end': round(phrase_end, 2),
                            'text': marker_phrase
                        })
                        break
    
    # Build content segments (between markers)
    segments = []
    current_start = 0
    buffer = 0.1
    
    for marker in markers:
        seg_end = max(0, marker['start'] - buffer)
        if seg_end > current_start + 0.5:
            segments.append({
                'start': round(current_start, 2),
                'end': round(seg_end, 2),
                'duration': round(seg_end - current_start, 2)
            })
        current_start = marker['end'] + buffer
    
    # Final segment
    if current_start < duration - 0.5:
        segments.append({
            'start': round(current_start, 2),
            'end': round(duration, 2),
            'duration': round(duration - current_start, 2)
        })
    
    return {
        'success': True,
        'transcription': full_text,
        'segments': segments,
        'markers': markers,
        'markerCount': len(markers),
        'segmentCount': len(segments),
        'duration': round(duration, 2)
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Transcribe audio using Whisper")
    parser.add_argument("audio_file", help="Path to audio file")
    parser.add_argument("-m", "--marker", help="Marker phrase to find", default="next slide please")
    parser.add_argument("--model", help="Whisper model size", default="base")
    
    args = parser.parse_args()
    
    try:
        result = transcribe_audio(args.audio_file, args.marker, args.model)
        print(json.dumps(result, indent=2))
        sys.exit(0 if result.get('success') else 1)
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
