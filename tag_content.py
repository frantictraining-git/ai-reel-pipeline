#!/usr/bin/env python3
"""
tag_content.py

Step "1.5" of the pipeline — content-aware tagging.

Uses a local CLIP model (no cloud, no API key) to classify:
  1. Each shot of the reference video's rhythm map (what kind of shot is it —
     food, kitchen, interior, person, etc.)
  2. Each of your own source clips, by the same categories

The output feeds build_reel.py's smart-match mode, so your clips get slotted
into shots by content instead of alphabetical order.

The CLIP model (~600MB) downloads once from Hugging Face the first time you
run this, then is cached locally in ./models/clip/. After that first run,
tagging is fully offline like the rest of the pipeline.

Usage:
    # Tag the reference video's shots (adds a "tag" field to each shot,
    # in place, in rhythm.json)
    python3 tag_content.py reference --rhythm rhythm.json --video reference.mp4

    # Tag your own footage clips (writes clip_tags.json)
    python3 tag_content.py clips --clips-dir source_clips/ -o clip_tags.json

    # Custom categories (default: food, kitchen, interior, person)
    python3 tag_content.py clips --clips-dir source_clips/ \\
        --categories "food,drink,person,exterior"
"""

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

from ffmpeg_utils import FFMPEG

DEFAULT_CATEGORIES = ["food", "kitchen", "interior", "person"]
MODELS_DIR = Path(__file__).parent / "models" / "clip"

_model = None
_processor = None


def _load_model():
    """Lazy-load CLIP so tagging isn't a hard dependency for people who never use it."""
    global _model, _processor
    if _model is not None:
        return _model, _processor

    try:
        import torch
        from transformers import CLIPModel, CLIPProcessor
    except ImportError:
        print(
            "Content tagging needs a couple of extra packages that aren't installed.\n"
            "Install with:\n"
            "  pip install torch transformers pillow\n",
            file=sys.stderr,
        )
        sys.exit(1)

    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    model_name = "openai/clip-vit-base-patch32"

    print("Loading CLIP model (first run downloads ~600MB, then it's cached locally in ./models/clip)...")
    _model = CLIPModel.from_pretrained(model_name, cache_dir=str(MODELS_DIR))
    _processor = CLIPProcessor.from_pretrained(model_name, cache_dir=str(MODELS_DIR))
    _model.eval()

    if torch.backends.mps.is_available():
        _model = _model.to("mps")  # Apple Silicon GPU — much faster than CPU on a Mac
    return _model, _processor


def write_progress(prog_file, current, total, phase):
    if prog_file:
        try:
            import json
            Path(prog_file).write_text(json.dumps({'phase': phase, 'current': current, 'total': total}))
        except:
            pass

def extract_frame(video_path: str, timestamp: float, out_path: Path):
    """Grab a single frame at `timestamp` seconds as a JPEG."""
    subprocess.run(
        [FFMPEG, "-y", "-ss", str(max(timestamp, 0.0)), "-i", str(video_path),
         "-frames:v", "1", "-q:v", "2", "-loglevel", "error", str(out_path)],
        check=True,
    )


def classify_frame(image_path: Path, categories: list) -> dict:
    """Zero-shot classify one frame against the category list."""
    import torch
    from PIL import Image

    model, processor = _load_model()
    image = Image.open(image_path).convert("RGB")

    # Phrasing each category as a short sentence gives CLIP more signal than a bare word.
    prompts = [f"a photo of {c}" for c in categories]

    inputs = processor(text=prompts, images=image, return_tensors="pt", padding=True)
    device = next(model.parameters()).device
    inputs = {k: v.to(device) for k, v in inputs.items()}

    with torch.no_grad():
        outputs = model(**inputs)
        probs = outputs.logits_per_image.softmax(dim=1)[0].tolist()

    scored = sorted(zip(categories, probs), key=lambda x: x[1], reverse=True)
    return {
        "label": scored[0][0],
        "confidence": round(scored[0][1], 3),
        "scores": {c: round(p, 3) for c, p in scored},
    }


def tag_reference(rhythm_path: str, video_path: str, categories: list, progress_file: str = None):
    rhythm = json.loads(Path(rhythm_path).read_text())
    tmpdir = Path(tempfile.mkdtemp(prefix="tag_ref_"))

    for i, shot in enumerate(rhythm["shots"]):
        # Sample from the middle of the shot — avoids catching a transition frame.
        mid = shot["start"] + shot["duration"] / 2
        frame_path = tmpdir / f"shot_{shot['index']:03d}.jpg"
        extract_frame(video_path, mid, frame_path)
        result = classify_frame(frame_path, categories)
        shot["tag"] = result["label"]
        shot["tag_confidence"] = result["confidence"]
        print(f"  shot {shot['index']:>2}: {result['label']:<10} ({result['confidence']:.0%})")
        write_progress(progress_file, i + 1, len(rhythm['shots']), 'Analyzing reference video cuts...')

    Path(rhythm_path).write_text(json.dumps(rhythm, indent=2))
    print(f"\nTagged {len(rhythm['shots'])} reference shots -> {rhythm_path}")


def tag_clips(clips_dir: str, categories: list, output: str, progress_file: str = None):
    VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".mkv", ".avi", ".webm"}
    clips_dir = Path(clips_dir)
    clip_files = sorted(p for p in clips_dir.iterdir() if p.suffix.lower() in VIDEO_EXTS)

    if not clip_files:
        print(f"Error: no video files found in {clips_dir}", file=sys.stderr)
        sys.exit(1)

    tmpdir = Path(tempfile.mkdtemp(prefix="tag_clips_"))
    tags = {}

    for i, clip in enumerate(clip_files):
        frame_path = tmpdir / f"{clip.stem}.jpg"
        # 1s in, so we skip a common lead-in blank/black frame at the very start.
        extract_frame(str(clip), 1.0, frame_path)
        result = classify_frame(frame_path, categories)
        tags[clip.name] = result["label"]
        print(f"  {clip.name:<30} -> {result['label']:<10} ({result['confidence']:.0%})")
        write_progress(progress_file, i + 1, len(clip_files), 'Analyzing raw footage clips...')

    Path(output).write_text(json.dumps(tags, indent=2))
    print(f"\nTagged {len(clip_files)} clips -> {output}")


def main():
    ap = argparse.ArgumentParser(
        description="Tag reference shots or your own clips by content, using a local CLIP model."
    )
    sub = ap.add_subparsers(dest="mode", required=True)

    ref = sub.add_parser("reference", help="Tag each shot in a rhythm.json using the reference video")
    ref.add_argument("--rhythm", required=True, help="rhythm.json from analyze_reference.py (tags added in place)")
    ref.add_argument("--video", required=True, help="The reference video file")
    ref.add_argument("--categories", default=",".join(DEFAULT_CATEGORIES))

    clips = sub.add_parser("clips", help="Tag every clip in a folder of your own footage")
    clips.add_argument("--clips-dir", required=True)
    clips.add_argument("-o", "--output", default="clip_tags.json")
    clips.add_argument("--categories", default=",".join(DEFAULT_CATEGORIES))

    args = ap.parse_args()
    categories = [c.strip() for c in args.categories.split(",") if c.strip()]

    if args.mode == "reference":
        tag_reference(args.rhythm, args.video, categories)
    else:
        tag_clips(args.clips_dir, categories, args.output)


if __name__ == "__main__":
    main()
