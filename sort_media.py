import os
import shutil
import json
import tempfile
import unicodedata
from pathlib import Path

from tag_content import extract_frame, classify_frame, _load_model
from ffmpeg_utils import FFMPEG
import subprocess


def safe_extract_frame(vid: Path, timestamp: float, frame_out: Path) -> bool:
    """Extract a frame safely, handling Apple invisible-space filenames
    by copying the file to a clean temp path first."""
    import subprocess

    def _run(path):
        cmd = [FFMPEG, "-y", "-ss", str(timestamp), "-i", str(path),
               "-vframes", "1", "-q:v", "2", str(frame_out)]
        r = subprocess.run(cmd, capture_output=True)
        return r.returncode == 0 and frame_out.exists()

    # Try directly first
    if _run(vid):
        return True

    # Fallback: copy to a safe tmp path with no special chars
    safe_name = unicodedata.normalize("NFC", vid.name)
    safe_name = "".join(c if c.isalnum() or c in "._-" else "_" for c in safe_name)

    with tempfile.TemporaryDirectory() as tmpdir:
        safe_path = Path(tmpdir) / safe_name
        shutil.copy2(str(vid), str(safe_path))
        if _run(safe_path):
            return True

    # Final fallback: try timestamp 0
    if timestamp > 0:
        return safe_extract_frame(vid, 0.0, frame_out)

    return False


def check_existing(folder_path: str, categories: list) -> dict:
    """Check if any category subfolders already exist and have files in them."""
    folder = Path(folder_path)
    existing = []
    for cat in categories:
        cat_dir = folder / cat
        if cat_dir.exists() and any(cat_dir.iterdir()):
            existing.append(cat)
    return {"existing": existing}


def sort_folder(folder_path: str, categories: list, progress_file: str = None):
    folder = Path(folder_path)
    if not folder.is_dir():
        raise ValueError(f"Not a directory: {folder_path}")

    valid_exts = {".mov", ".mp4", ".m4v", ".mxf", ".MOV", ".MP4", ".MOV"}
    videos = [f for f in folder.iterdir()
              if f.suffix in valid_exts and f.is_file()]

    if not videos:
        if progress_file:
            with open(progress_file, "w") as f:
                json.dump({"total": 0, "current": 0, "phase": "Done!", "sorted": 0}, f)
        return {"status": "no videos found"}

    _load_model()  # Ensure CLIP is loaded

    total = len(videos)

    def update_progress(current, status="working"):
        if progress_file:
            with open(progress_file, "w") as f:
                json.dump({"total": total, "current": current, "phase": status}, f)

    update_progress(0, "Sorting media...")

    # Create category folders beforehand
    for cat in categories:
        (folder / cat).mkdir(exist_ok=True)

    sorted_count = 0
    skipped_count = 0

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_dir = Path(tmpdir)
        for i, vid in enumerate(videos):
            update_progress(i, f"Analyzing {vid.name}...")

            frame_out = tmp_dir / f"frame_{i}.jpg"
            if frame_out.exists():
                frame_out.unlink()

            got_frame = safe_extract_frame(vid, 0.5, frame_out)

            if got_frame and frame_out.exists():
                try:
                    result = classify_frame(frame_out, categories)
                    # classify_frame returns {"label": "food", "confidence": 0.9, "scores": {...}}
                    best_cat = result["label"]

                    dest_dir = folder / best_cat
                    dest_path = dest_dir / vid.name

                    # Handle name collisions
                    counter = 1
                    while dest_path.exists():
                        dest_path = dest_dir / f"{vid.stem}_{counter}{vid.suffix}"
                        counter += 1

                    shutil.move(str(vid), str(dest_path))
                    sorted_count += 1
                except Exception as e:
                    print(f"Error classifying {vid.name}: {e}")
                    skipped_count += 1
            else:
                print(f"Could not extract frame from {vid.name}, skipping.")
                skipped_count += 1

    update_progress(total, "Done!")
    return {"sorted": sorted_count, "skipped": skipped_count, "total": total}
