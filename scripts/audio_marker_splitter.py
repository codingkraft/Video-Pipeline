"""
Audio Marker Detection and Splitting using OpenAI Whisper

This script:
1. Transcribes audio using Whisper to find spoken markers (e.g., "next slide please")
2. Splits the audio into separate slide files using FFmpeg (no pydub dependency)
3. Outputs clean audio files: slide_1.wav, slide_2.wav, etc.

Prerequisites:
- pip install openai-whisper
- FFmpeg installed and in PATH
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
        data = json.loads(result.stdout)
        return float(data['format']['duration'])
    return 0.0


def find_slide_markers(audio_file: str, marker_phrase: str = "next slide please", model_name: str = "base") -> list[dict]:
    """
    Find spoken markers in audio file using Whisper.
    
    Args:
        audio_file: Path to audio file
        marker_phrase: The spoken marker to find (e.g., "next slide please")
        model_name: Whisper model size ("tiny", "base", "small", "medium", "large")
    
    Returns:
        List of dicts with 'start' and 'end' timestamps for each marker
    """
    print(f"Loading Whisper model '{model_name}'... (first time may download ~140MB)")
    model = whisper.load_model(model_name)
    
    print(f"Transcribing {audio_file}...")
    result = model.transcribe(audio_file, word_timestamps=True)
    
    # Search for the marker phrase in transcribed segments
    markers = []
    target_words = marker_phrase.lower().split()
    
    for segment in result["segments"]:
        segment_text = segment.get("text", "").lower()
        # Normalize: remove punctuation for matching
        import re
        normalized_text = re.sub(r'[.,!?;:\'\"]', '', segment_text)
        print(f"  [DEBUG] Segment: '{segment_text}' -> normalized: '{normalized_text}'")
        
        # Check if the marker phrase appears in this segment (after normalization)
        if marker_phrase.lower() in normalized_text:
            # Find the word-level timestamps for the marker
            if "words" in segment:
                for i, word_info in enumerate(segment["words"]):
                    word = word_info["word"].lower().strip(".,!?")
                    
                    # Check if this word starts the marker phrase
                    if target_words[0] in word:
                        # Try to find the complete phrase
                        phrase_start = word_info['start']
                        phrase_end = word_info['end']
                        
                        # Look ahead for remaining words in the phrase
                        for j, target in enumerate(target_words[1:], 1):
                            if i + j < len(segment["words"]):
                                next_word = segment["words"][i + j]["word"].lower().strip(".,!?")
                                if target in next_word:
                                    phrase_end = segment["words"][i + j]['end']
                        
                        print(f"  Found marker at {phrase_start:.2f}s - {phrase_end:.2f}s")
                        markers.append({
                            'start': phrase_start,
                            'end': phrase_end,
                            'text': marker_phrase
                        })
                        break
    
    print(f"\nTotal markers found: {len(markers)}")
    return markers


def split_audio_with_ffmpeg(
    audio_file: str,
    markers: list[dict],
    output_dir: str,
    buffer_sec: float = 0.1
) -> list[str]:
    """
    Split audio file into segments using FFmpeg, removing the marker phrases.
    
    Args:
        audio_file: Path to source audio file
        markers: List of marker timestamps from find_slide_markers()
        output_dir: Directory to save split files
        buffer_sec: Extra seconds to trim around markers
    
    Returns:
        List of output file paths
    """
    print(f"\nSplitting audio: {audio_file}")
    os.makedirs(output_dir, exist_ok=True)
    
    # Get total duration
    total_duration = get_audio_duration(audio_file)
    print(f"Total audio duration: {total_duration:.2f}s")
    
    output_files = []
    
    # Build segments (content between markers)
    segments = []
    current_start = 0
    
    for marker in markers:
        # Segment ends just before marker (minus buffer)
        segment_end = max(0, marker['start'] - buffer_sec)
        
        if segment_end > current_start + 0.5:  # At least 0.5s segment
            segments.append((current_start, segment_end))
        
        # Next segment starts after marker (plus buffer)
        current_start = marker['end'] + buffer_sec
    
    # Add final segment (after last marker to end)
    if current_start < total_duration - 0.5:
        segments.append((current_start, total_duration))
    
    print(f"Creating {len(segments)} segments...")
    
    for i, (start, end) in enumerate(segments, 1):
        output_filename = f"slide_{i}.wav"
        output_path = os.path.join(output_dir, output_filename)
        temp_path = os.path.join(output_dir, f"temp_slide_{i}.wav")
        
        duration = end - start
        
        # Step 1: Extract segment
        extract_cmd = [
            'ffmpeg', '-y', '-i', audio_file,
            '-ss', str(start),
            '-t', str(duration),
            '-acodec', 'pcm_s16le',
            temp_path
        ]
        
        result = subprocess.run(extract_cmd, capture_output=True, text=True)
        
        if result.returncode != 0:
            print(f"  [FAILED] Failed to extract {output_filename}: {result.stderr}")
            continue
        
        # Step 2: Normalize silence - trim leading AND trailing silence, add 1s pad at end
        # silenceremove: removes silence from start (start_periods=1) and end (stop_periods=-1)
        # apad: adds 1 second of silence at end
        normalize_cmd = [
            'ffmpeg', '-y', '-i', temp_path,
            '-af', 'silenceremove=start_periods=1:start_silence=0.05:start_threshold=-50dB:stop_periods=-1:stop_duration=0.05:stop_threshold=-50dB,apad=pad_dur=1',
            '-acodec', 'pcm_s16le',
            output_path
        ]
        
        result = subprocess.run(normalize_cmd, capture_output=True, text=True)
        
        # Clean up temp file
        if os.path.exists(temp_path):
            os.remove(temp_path)
        
        if result.returncode == 0:
            # Get final duration
            final_duration = get_audio_duration(output_path)
            print(f"  Created {output_filename}: {final_duration:.2f}s (original: {duration:.2f}s)")
            output_files.append(output_path)
        else:
            print(f"  [FAILED] Failed to normalize {output_filename}: {result.stderr}")
    
    return output_files


def process_audio(
    audio_file: str,
    output_dir: str = None,
    marker_phrase: str = "next slide please",
    model_name: str = "base",
    expected_parts: int = None
) -> dict:
    """
    Main function to detect markers and split audio.
    
    Args:
        audio_file: Path to input audio file
        output_dir: Output directory (default: same as input with '_slides' suffix)
        marker_phrase: Spoken marker to detect
        model_name: Whisper model size
        expected_parts: If provided, verify the number of segments matches
    
    Returns:
        Dict with results including marker count and output files
    """
    if not os.path.exists(audio_file):
        raise FileNotFoundError(f"Audio file not found: {audio_file}")
    
    if output_dir is None:
        base = os.path.splitext(audio_file)[0]
        output_dir = f"{base}_slides"
    
    print(f"\n{'='*60}")
    print(f"Audio Marker Splitter")
    print(f"{'='*60}")
    print(f"Input: {audio_file}")
    print(f"Output: {output_dir}")
    print(f"Marker: '{marker_phrase}'")
    print(f"Model: {model_name}")
    if expected_parts:
        print(f"Expected parts: {expected_parts}")
    print(f"{'='*60}\n")
    
    # Step 1: Find markers
    markers = find_slide_markers(audio_file, marker_phrase, model_name)
    
    # Step 2: Split audio (even if no markers - will create single file)
    output_files = split_audio_with_ffmpeg(audio_file, markers, output_dir)
    
    # Step 3: Verify expected parts if provided
    success = len(output_files) > 0
    message = f'Split into {len(output_files)} segments (found {len(markers)} markers)'
    
    if expected_parts is not None:
        if len(output_files) == expected_parts:
            print(f"\n[OK] SUCCESS: Created {len(output_files)} parts as expected!")
        else:
            print(f"\n[MISMATCH] Expected {expected_parts} parts, got {len(output_files)}")
            success = False
            message = f"Expected {expected_parts} parts, got {len(output_files)}"
    
    print(f"\n{'='*60}")
    print(f"{'[OK] Complete!' if success else '[ERROR] Issues found'} {message}")
    print(f"{'='*60}")
    
    return {
        'success': success,
        'message': message,
        'markers': markers,
        'output_files': output_files,
        'expected_parts': expected_parts,
        'actual_parts': len(output_files)
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Split audio by spoken markers using Whisper")
    parser.add_argument("audio_file", help="Path to audio file")
    parser.add_argument("-o", "--output", help="Output directory", default=None)
    parser.add_argument("-m", "--marker", help="Marker phrase to detect", default="next slide please")
    parser.add_argument("--model", help="Whisper model (tiny/base/small/medium/large)", default="base")
    parser.add_argument("-e", "--expected", type=int, help="Expected number of parts (for verification)", default=None)
    
    args = parser.parse_args()
    
    try:
        result = process_audio(
            args.audio_file,
            args.output,
            args.marker,
            args.model,
            args.expected
        )
        # Always exit 0 if script ran effectively, success checked by output parsing
        sys.exit(0)
    except Exception as e:
        print(f"[ERROR] Error: {e}")
        sys.exit(1)
