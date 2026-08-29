#!/usr/bin/env python3
"""
analyze_reference.py

Step 1 of the pipeline.

Takes a trendy reel (a video you downloaded/saved as reference) and detects
every hard cut in it. Outputs a JSON "rhythm map" describing how long each
shot holds before the next cut. That rhythm is what build_reel.py later
applies to YOUR footage.

This only reads the reference video's cut TIMING. It never touches or
reproduces the reference video's actual footage in the output.

Usage:
    python3 analyze_reference.py reference.mp4 -o rhythm.json

Options:
    -o, --output      Where to save the rhythm JSON (default: rhythm.json)
    -t, --threshold    Sensitivity for cut detection (default: 27.0).
                        Lower = more sensitive (may catch fast pans as cuts).
                        Higher = less sensitive (may miss subtle cuts).
    --min-shot         Minimum shot length in seconds to keep (default: 0.15).
                        Filters out false-positive micro-cuts.
"""

import argparse
import json
import sys
from pathlib import Path

from scenedetect import open_video, SceneManager
from scenedetect.detectors import ContentDetector


def analyze(video_path: str, threshold: float, min_shot: float) -> dict:
    video = open_video(video_path)
    scene_manager = SceneManager()
    scene_manager.add_detector(ContentDetector(threshold=threshold))
    scene_manager.detect_scenes(video, show_progress=False)
    scene_list = scene_manager.get_scene_list()

    fps = float(video.frame_rate)
    total_duration = video.duration.get_seconds()

    shots = []
    for start, end in scene_list:
        start_s = start.get_seconds()
        end_s = end.get_seconds()
        dur = round(end_s - start_s, 3)
        if dur < min_shot:
            # merge tiny false-positive shots into the previous one
            if shots:
                shots[-1]["duration"] = round(shots[-1]["duration"] + dur, 3)
                shots[-1]["end"] = end_s
            continue
        shots.append({
            "index": len(shots),
            "start": round(start_s, 3),
            "end": round(end_s, 3),
            "duration": dur,
        })

    if not shots:
        # No cuts detected at all — treat whole clip as one shot
        shots = [{"index": 0, "start": 0.0, "end": total_duration, "duration": round(total_duration, 3)}]

    return {
        "source": Path(video_path).name,
        "fps": round(fps, 3),
        "total_duration": round(total_duration, 3),
        "shot_count": len(shots),
        "shots": shots,
    }


def main():
    ap = argparse.ArgumentParser(description="Detect cut rhythm from a reference reel.")
    ap.add_argument("reference", help="Path to the reference video")
    ap.add_argument("-o", "--output", default="rhythm.json", help="Output JSON path")
    ap.add_argument("-t", "--threshold", type=float, default=20.0, help="Cut sensitivity (lower = more sensitive)")
    ap.add_argument("--min-shot", type=float, default=0.05, help="Minimum shot length in seconds")
    args = ap.parse_args()

    if not Path(args.reference).exists():
        print(f"Error: {args.reference} not found", file=sys.stderr)
        sys.exit(1)

    result = analyze(args.reference, args.threshold, args.min_shot)

    with open(args.output, "w") as f:
        json.dump(result, f, indent=2)

    print(f"Detected {result['shot_count']} shots across {result['total_duration']}s")
    for s in result["shots"]:
        print(f"  shot {s['index']:>2}: {s['duration']:>5.2f}s  ({s['start']:.2f}s -> {s['end']:.2f}s)")
    print(f"\nSaved rhythm map to {args.output}")


if __name__ == "__main__":
    main()
