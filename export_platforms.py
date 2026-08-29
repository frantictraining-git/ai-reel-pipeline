#!/usr/bin/env python3
"""
export_platforms.py

Step 3 of the pipeline (optional, run after build_reel.py).

Takes your built reel and exports it in the aspect ratios you need
(9:16 Reels/TikTok/Shorts, 1:1 feed, 16:9 YouTube/website), with optional
logo watermark and caption burn-in.

Usage:
    python3 export_platforms.py built_reel.mp4 -o exports/

    # with logo (transparent PNG, bottom-right by default):
    python3 export_platforms.py built_reel.mp4 -o exports/ --logo logo.png

    # with burned-in captions from an SRT file:
    python3 export_platforms.py built_reel.mp4 -o exports/ --srt captions.srt

    # only specific formats:
    python3 export_platforms.py built_reel.mp4 -o exports/ --formats 9:16,1:1
"""

import argparse
import subprocess

from ffmpeg_utils import FFMPEG, get_duration
from pathlib import Path

FORMAT_DIMS = {
    "9:16": (1080, 1920),
    "1:1": (1080, 1080),
    "16:9": (1920, 1080),
    "4:5": (1080, 1350),
}

LOGO_POSITIONS = {
    "bottom-right": "main_w-overlay_w-40:main_h-overlay_h-60",
    "bottom-left": "40:main_h-overlay_h-60",
    "top-right": "main_w-overlay_w-40:60",
    "top-left": "40:60",
}


from typing import Optional

def export_format(src: Path, out_path: Path, w: int, h: int, logo: Optional[Path],
                   logo_pos: str, srt: Optional[Path]):
    filters = []
    inputs = ["-i", str(src)]

    # scale+crop to fill target aspect
    filters.append(f"[0:v]scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h}[base]")
    last_label = "base"

    if srt is not None:
        # burn captions. Font size scales with output width for readability.
        font_size = max(28, w // 22)
        style = (
            f"FontName=Arial,FontSize={font_size},PrimaryColour=&H00FFFFFF,"
            f"OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,"
            f"Alignment=2,MarginV={h // 12}"
        )
        srt_escaped = str(srt).replace(":", r"\:")
        filters.append(f"[{last_label}]subtitles='{srt_escaped}':force_style='{style}'[capped]")
        last_label = "capped"

    map_video = f"[{last_label}]"

    if logo is not None:
        inputs += ["-i", str(logo)]
        pos = LOGO_POSITIONS.get(logo_pos, LOGO_POSITIONS["bottom-right"])
        logo_w = w // 5
        filters.append(f"[1:v]scale={logo_w}:-1[logo]")
        filters.append(f"[{last_label}][logo]overlay={pos}[withlogo]")
        map_video = "[withlogo]"

    filter_complex = ";".join(filters)

    cmd = [FFMPEG, "-y", *inputs,
           "-filter_complex", filter_complex,
           "-map", map_video, "-map", "0:a?",
           "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
           "-c:a", "aac", "-b:a", "192k",
           "-loglevel", "error", str(out_path)]

    subprocess.run(cmd, check=True)


def main():
    ap = argparse.ArgumentParser(description="Export a built reel to multiple platform aspect ratios.")
    ap.add_argument("input", help="Path to your built reel (from build_reel.py)")
    ap.add_argument("-o", "--outdir", default="exports")
    ap.add_argument("--formats", default="9:16,1:1,16:9",
                     help="Comma-separated list of formats to export. Options: 9:16, 1:1, 16:9, 4:5")
    ap.add_argument("--logo", default=None, help="Path to a transparent PNG logo/watermark")
    ap.add_argument("--logo-pos", default="bottom-right",
                     choices=list(LOGO_POSITIONS.keys()))
    ap.add_argument("--srt", default=None, help="Path to an SRT file to burn in as captions")
    args = ap.parse_args()

    src = Path(args.input)
    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    logo = Path(args.logo) if args.logo else None
    srt = Path(args.srt) if args.srt else None

    stem = src.stem
    for fmt in args.formats.split(","):
        fmt = fmt.strip()
        if fmt not in FORMAT_DIMS:
            print(f"Skipping unknown format '{fmt}'")
            continue
        w, h = FORMAT_DIMS[fmt]
        safe_fmt = fmt.replace(":", "x")
        out_path = outdir / f"{stem}_{safe_fmt}.mp4"
        print(f"Exporting {fmt} ({w}x{h}) -> {out_path}")
        export_format(src, out_path, w, h, logo, args.logo_pos, srt)

    print(f"\nDone. Files in {outdir}/")


if __name__ == "__main__":
    main()
