"""
ffmpeg_utils.py — shared ffmpeg/ffprobe helpers for the reel pipeline.

Finds ffmpeg automatically (CapCut bundle → system PATH) and provides
get_duration() using ffmpeg instead of ffprobe.
"""

import re
import subprocess
from pathlib import Path
import imageio_ffmpeg

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()


def get_duration(video_path: str) -> float:
    """Return video duration in seconds using ffmpeg."""
    # Running ffmpeg -i without output file prints metadata to stderr and exits with 1
    result = subprocess.run(
        [FFMPEG, "-i", video_path],
        capture_output=True, text=True,
    )
    # ffmpeg prints: Duration: HH:MM:SS.ss, ...
    match = re.search(r"Duration:\s*(\d+):(\d+):([\d.]+)", result.stderr)
    if not match:
        raise RuntimeError(f"Could not determine duration of {video_path}")
    h, m, s = int(match.group(1)), int(match.group(2)), float(match.group(3))
    return h * 3600 + m * 60 + s



def run_ffmpeg(args: list, check: bool = True) -> subprocess.CompletedProcess:
    """Run ffmpeg with the resolved binary path."""
    return subprocess.run([FFMPEG] + args, capture_output=True, text=True, check=check)
