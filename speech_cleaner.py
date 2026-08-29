#!/usr/bin/env python3
"""
speech_cleaner.py — WhisperX-style word-level speech cleaner.

Uses openai-whisper with word timestamps to:
  1. Transcribe the video word by word
  2. Remove filler words (umm, uh, like, etc.) 
  3. Remove silence gaps between words longer than min_gap
  4. Cut and re-join only the segments worth keeping

Far more precise than silence-detection — cuts happen at word boundaries
so speech always sounds natural.
"""

import json
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Optional

from ffmpeg_utils import FFMPEG, get_duration

# ── Filler words that get cut by default ─────────────────────────────────────
DEFAULT_FILLERS = {
    "um", "uh", "umm", "uhh", "hmm", "hm",
    "like", "you know", "you know what i mean",
    "basically", "literally", "actually",
    "so", "right", "okay", "ok",
    "kind of", "sort of", "i mean",
    "er", "err", "ah", "ahh",
}

def get_fps(video_path: str) -> float:
    """Get video framerate using ffmpeg."""
    import re
    result = subprocess.run([FFMPEG, "-i", video_path], capture_output=True, text=True)
    match = re.search(r"(\d+(?:\.\d+)?)\s*fps", result.stderr)
    if match:
        return float(match.group(1))
    return 24.0 # fallback

def frames_to_tc(frames, fps):
    fps_int = int(round(fps))
    h = int(frames // (fps_int * 3600))
    m = int((frames // (fps_int * 60)) % 60)
    s = int((frames // fps_int) % 60)
    f = int(frames % fps_int)
    return f"{h:02d}:{m:02d}:{s:02d}:{f:02d}"

def generate_edl(video_path: str, segments: list, fps: float, edl_path: str, original_filename: str = "input.mov"):
    """Generate a DaVinci Resolve compatible CMX3600 EDL file."""
    edl = "TITLE: AI Cleaned Speech\nFCM: NON-DROP FRAME\n\n"
    timeline_frame = 0
    
    for i, (start_sec, end_sec) in enumerate(segments):
        start_f = int(start_sec * fps)
        end_f = int(end_sec * fps)
        dur_f = end_f - start_f
        if dur_f <= 0: continue
        
        src_in = frames_to_tc(start_f, fps)
        src_out = frames_to_tc(end_f, fps)
        rec_in = frames_to_tc(timeline_frame, fps)
        rec_out = frames_to_tc(timeline_frame + dur_f, fps)
        
        edl += f"{i+1:03d}  AX       B     C        {src_in} {src_out} {rec_in} {rec_out}\n"
        edl += f"* FROM CLIP NAME: {original_filename}\n\n"
        
        timeline_frame += dur_f
        
    Path(edl_path).write_text(edl)


def extract_audio(video_path: str, audio_path: str):
    """Extract mono 16kHz WAV — what Whisper expects."""
    subprocess.run([
        FFMPEG, "-y", "-i", video_path,
        "-vn", "-acodec", "pcm_s16le",
        "-ar", "16000", "-ac", "1",
        "-loglevel", "error", audio_path,
    ], check=True)


def transcribe(audio_path: str, model_size: str = "base") -> list:
    """
    Run Whisper with word-level timestamps.
    Returns list of word dicts: {word, start, end}
    """
    import whisper
    
    # Force Whisper to use our permanent local models folder, not the Mac's temp cache
    model_dir = Path(__file__).parent / "models"
    model_dir.mkdir(exist_ok=True)
    
    model = whisper.load_model(
        model_size,
        download_root=str(model_dir)
    )
    
    result = model.transcribe(
        audio_path,
        word_timestamps=True,
        language="en",
        fp16=False,          # Mac CPU — no GPU fp16
        verbose=False,
    )

    words = []
    for seg in result.get("segments", []):
        for w in seg.get("words", []):
            word_text = w["word"].strip().lower().strip(".,!?;:-\"'")
            words.append({
                "word":  w["word"].strip(),
                "clean": word_text,
                "start": round(w["start"], 3),
                "end":   round(w["end"],   3),
            })
    return words


def build_keep_segments(
    words: list,
    duration: float,
    fillers: set,
    min_gap: float,
    padding: float,
) -> list:
    """
    Given word-level timestamps, return list of (start, end) segments to KEEP.

    Rules:
    - Skip any word whose clean text is in fillers
    - Skip gaps between consecutive kept words > min_gap
    - Add padding around each kept segment so cuts aren't abrupt
    """
    if not words:
        return [(0.0, duration)]

    # Mark which words to keep
    kept = [w for w in words if w["clean"] not in fillers]

    if not kept:
        return [(0.0, duration)]

    # Group consecutive kept words into segments, splitting on gaps > min_gap
    segments = []
    seg_start = max(0.0, kept[0]["start"] - padding)
    seg_end   = min(duration, kept[0]["end"] + padding)

    for i in range(1, len(kept)):
        prev = kept[i - 1]
        curr = kept[i]
        gap  = curr["start"] - prev["end"]

        if gap > min_gap:
            # Close current segment, start new one
            segments.append((seg_start, seg_end))
            seg_start = max(0.0, curr["start"] - padding)
        # Extend segment to cover this word
        seg_end = min(duration, curr["end"] + padding)

    segments.append((seg_start, seg_end))

    # Merge overlapping segments (can happen with large padding)
    merged = []
    for seg in segments:
        if merged and seg[0] <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], seg[1]))
        else:
            merged.append(list(seg))

    return [tuple(s) for s in merged]


def cut_and_join(video_path: str, segments: list, output_path: str):
    """Cut the video to only the kept segments and concatenate them."""
    tmpdir = Path(tempfile.mkdtemp(prefix="cleaner_"))
    seg_files = []

    for i, (start, end) in enumerate(segments):
        dur = end - start
        if dur < 0.05:
            continue
        seg_out = tmpdir / f"s{i:04d}.mp4"
        
        # Apply a micro 30ms fade-in and fade-out to audio to stop "tock tock" pops
        fade_dur = 0.03
        af_filter = f"afade=t=in:st=0:d={fade_dur},afade=t=out:st={dur - fade_dur}:d={fade_dur}"
        
        subprocess.run([
            FFMPEG, "-y",
            "-ss", str(start), "-i", video_path,
            "-t",  str(dur),
            "-c:v", "libx264", "-preset", "fast", "-crf", "18",
            "-af", af_filter,
            "-c:a", "aac", "-b:a", "192k",
            "-pix_fmt", "yuv420p",
            "-loglevel", "error",
            str(seg_out),
        ], check=True)
        seg_files.append(seg_out)

    if not seg_files:
        raise RuntimeError("No segments to keep after filtering.")

    concat_list = tmpdir / "list.txt"
    concat_list.write_text("\n".join(f"file '{p.as_posix()}'" for p in seg_files))

    subprocess.run([
        FFMPEG, "-y",
        "-f", "concat", "-safe", "0", "-i", str(concat_list),
        "-c", "copy", "-loglevel", "error", output_path,
    ], check=True)


def clean_speech(
    video_path: str,
    output_path: str,
    edl_path: str,
    original_filename: str = "input.mov",
    model_size:  str   = "base",
    min_gap:     float = 0.4,
    padding:     float = 0.08,
    custom_fillers: Optional[list] = None,
    remove_fillers: bool = True,
) -> dict:
    """
    Full pipeline: transcribe → identify cuts → cut & join → generate EDL.
    """
    original_duration = get_duration(video_path)
    fps = get_fps(video_path)

    # Extract audio for Whisper
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        audio_path = tmp.name
    try:
        extract_audio(video_path, audio_path)
        words = transcribe(audio_path, model_size)
    finally:
        os.unlink(audio_path)

    # Build filler set
    fillers = set()
    if remove_fillers:
        fillers = DEFAULT_FILLERS.copy()
    if custom_fillers:
        fillers |= {f.strip().lower() for f in custom_fillers}

    # Flag each word
    for w in words:
        w["kept"] = w["clean"] not in fillers

    # Build keep segments
    segments = build_keep_segments(words, original_duration, fillers, min_gap, padding)

    # Generate the DaVinci Resolve EDL timeline BEFORE cutting
    generate_edl(video_path, segments, fps, edl_path, original_filename)

    # Cut and join
    cut_and_join(video_path, segments, output_path)

    cleaned_duration = get_duration(output_path)
    fillers_cut = [w for w in words if not w["kept"]]
    gaps_cut    = len(segments)   # approximate — each segment = a kept block

    return {
        "original_duration": round(original_duration, 2),
        "cleaned_duration":  round(cleaned_duration,  2),
        "time_saved":        round(original_duration - cleaned_duration, 2),
        "segments_kept":     len(segments),
        "words_total":       len(words),
        "fillers_removed":   len(fillers_cut),
        "transcript":        words,   # full word list with kept/cut flags
    }
