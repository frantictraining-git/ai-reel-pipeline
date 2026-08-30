#!/usr/bin/env python3
"""
build_reel.py

Step 2 of the pipeline.

Takes the rhythm.json produced by analyze_reference.py and a folder of your
OWN trimmed clips, then cuts your footage to match the reference's cut
timing and stitches it into one video.

Clips are assigned to shot slots in filename order (alphabetical). If you
have fewer clips than shots, clips repeat (cycle) so you don't need one
clip per shot. If a clip is shorter than the shot duration it needs to
fill, it's used at its full length (a warning is printed) rather than
looping or freezing, since footage looping usually looks worse than a
slightly-off beat.

By default, each clip is read from its own start (0s) for the shot's
duration. If you want a specific in-point per clip (e.g. skip the first
0.5s of handheld shake), pass a mapping file with --map (see --help).

Output is normalized to the reference's resolution/aspect (center-crop to
fill, no stretching) so the cut points land cleanly.

Usage:
    python3 build_reel.py rhythm.json source_clips/ -o built_reel.mp4

    # with a custom resolution target and muted-by-default audio kept instead:
    python3 build_reel.py rhythm.json source_clips/ -o built_reel.mp4 \\
        --width 1080 --height 1920 --keep-audio

    # with specific in-points per clip:
    python3 build_reel.py rhythm.json source_clips/ -o built_reel.mp4 --map inpoints.json

    inpoints.json format: {"clip1.mp4": 1.2, "clip3.mp4": 0.5}
    (seconds to skip into that clip before taking the shot duration)
"""

import argparse
import json
import subprocess

from ffmpeg_utils import FFMPEG, get_duration
import sys
import tempfile
from pathlib import Path

VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".mkv", ".avi", ".webm"}


def write_progress(prog_file, current, total, phase):
    if prog_file:
        try:
            import json
            Path(prog_file).write_text(json.dumps({'phase': phase, 'current': current, 'total': total}))
        except:
            pass

def ffprobe_duration(path: Path) -> float:
    return get_duration(str(path))


def get_start_frames(clip_path, fps):
    import subprocess, re
    cmd = [FFMPEG, "-i", str(clip_path)]
    result = subprocess.run(cmd, capture_output=True, text=True)
    match = re.search(r"timecode\s+:\s+(\d{2}:\d{2}:\d{2}[:;]\d{2})", result.stderr)
    if match:
        tc = match.group(1)
        h, m, s, f = map(int, tc.replace(";", ":").split(':'))
        return int((h * 3600 + m * 60 + s) * fps + f)
    return 0

def frames_to_tc(frames, fps):
    fps_int = int(round(fps))
    h = int(frames // (fps_int * 3600))
    m = int((frames // (fps_int * 60)) % 60)
    s = int((frames // fps_int) % 60)
    f = int(frames % fps_int)
    return f"{h:02d}:{m:02d}:{s:02d}:{f:02d}"


def build(rhythm_path: str, clips_dir: str, output: str, width: int, height: int,
          fps: float, keep_audio: bool, inpoints: dict, clip_tags: dict = None, progress_file: str = None, overlay_audio: bool = False, reference_path: str = None):
    rhythm = json.loads(Path(rhythm_path).read_text())
    shots = rhythm["shots"]

    clips_dir = Path(clips_dir)
    clip_files = sorted(
        [p for p in clips_dir.iterdir() if p.suffix.lower() in VIDEO_EXTS]
    )
    if not clip_files:
        print(f"Error: no video files found in {clips_dir}", file=sys.stderr)
        sys.exit(1)

    print(f"Found {len(clip_files)} source clip(s), matching to {len(shots)} shot(s) from rhythm map.")

    # Smart-match: if clip_tags (from tag_content.py) is given, group clips by
    # content category and prefer a clip whose tag matches the reference shot's
    # tag, instead of just cycling through clips in filename order. Falls back
    # to the old alphabetical-cycle behavior whenever a shot or clip has no tag,
    # so tagging is optional and partial tagging never breaks a build.
    tag_pools = {}
    if clip_tags:
        for clip in clip_files:
            tag = clip_tags.get(clip.name)
            if tag:
                tag_pools.setdefault(tag, []).append(clip)
        if tag_pools:
            print(f"Smart-match on — content categories found: {', '.join(sorted(tag_pools))}")
        else:
            print("Smart-match on, but no clips matched any tag — falling back to filename order.")

    pool_pointers = {tag: 0 for tag in tag_pools}
    used_clips = set()
    fallback_pool = list(clip_files)
    fallback_pointer = 0

    def pick_clip(shot: dict) -> Path:
        nonlocal fallback_pointer
        tag = shot.get("tag")
        pool = tag_pools.get(tag) if tag else None
        
        if pool:
            while pool_pointers[tag] < len(pool):
                c = pool[pool_pointers[tag]]
                pool_pointers[tag] += 1
                if c not in used_clips:
                    used_clips.add(c)
                    return c
                    
        while fallback_pointer < len(fallback_pool):
            c = fallback_pool[fallback_pointer]
            fallback_pointer += 1
            if c not in used_clips:
                used_clips.add(c)
                return c
                
        return fallback_pool[0]

    tmpdir = Path(tempfile.mkdtemp(prefix="reel_"))
    segment_paths = []
    pick_clip_log = []  # track which clip was picked for each shot (for FCPXML)

    edl_path = Path(output).with_name("timeline.edl")
    edl_content = "TITLE: AI Built Reel\nFCM: NON-DROP FRAME\n\n"
    timeline_frame = 0

    clean_media_dir = Path(output).parent / "clean_media"
    clean_media_dir.mkdir(exist_ok=True)
    clean_clip_cache = {}
    clean_counter = 1

    for i, shot in enumerate(shots):
        write_progress(progress_file, i + 1, len(shots), 'Stitching clips together...')
        original_clip = pick_clip(shot)
        
        if original_clip not in clean_clip_cache:
            clean_name = original_clip.name.replace(" ", "_").replace("\u202F", "_")
            clean_counter += 1
            clean_path = clean_media_dir / clean_name
            if not clean_path.exists():
                try:
                    import os
                    os.link(str(original_clip), str(clean_path))
                except OSError:
                    import shutil
                    shutil.copy2(str(original_clip), str(clean_path))
            clean_clip_cache[original_clip] = clean_path
            
        clip = clean_clip_cache[original_clip]
        pick_clip_log.append(clip)
        duration = shot["duration"]
        in_point = inpoints.get(clip.name, 0.0)

        clip_duration = ffprobe_duration(clip)
        available = clip_duration - in_point
        use_duration = duration
        if available < duration:
            use_duration = max(available, 0.05)
            print(f"  ! shot {i}: {clip.name} only has {available:.2f}s available from "
                  f"in-point {in_point:.2f}s (needs {duration:.2f}s) -> using {use_duration:.2f}s")

        seg_out = tmpdir / f"seg_{i:03d}.mp4"
        vf = f"scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},fps={fps}"

        cmd = [
            "ffmpeg", "-y",
            "-ss", str(in_point),
            "-i", str(clip),
            "-t", str(use_duration),
            "-vf", vf,
            "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
        ]
        if keep_audio:
            cmd += ["-c:a", "aac", "-b:a", "192k"]
        else:
            cmd += ["-an"]
        cmd += ["-loglevel", "error", str(seg_out)]

        subprocess.run(cmd, check=True)
        segment_paths.append(seg_out)
        tag_note = f" [{shot['tag']}]" if shot.get("tag") else ""
        print(f"  shot {i:>2}{tag_note}: {clip.name} @ {in_point:.2f}s -> {use_duration:.2f}s")

        # EDL Logic
        tc_offset = get_start_frames(clip, fps)
        src_start_f = int(in_point * fps) + tc_offset
        src_end_f = int((in_point + use_duration) * fps) + tc_offset
        dur_f = src_end_f - src_start_f
        
        src_in = frames_to_tc(src_start_f, fps)
        src_out = frames_to_tc(src_end_f, fps)
        rec_in = frames_to_tc(timeline_frame, fps)
        rec_out = frames_to_tc(timeline_frame + dur_f, fps)

        tape_name = "AX      "
        edl_content += f"{i+1:03d}  {tape_name} V     C        {src_in} {src_out} {rec_in} {rec_out}\n"
        edl_content += f"* FROM CLIP NAME: {clip.name}\n\n"
        timeline_frame += dur_f

    # concat
    concat_list = tmpdir / "concat.txt"
    with open(concat_list, "w") as f:
        for p in segment_paths:
            f.write(f"file '{p.as_posix()}'\n")

    subprocess.run(
        [FFMPEG, "-y", "-f", "concat", "-safe", "0", "-i", str(concat_list),
         "-c", "copy", "-loglevel", "error", output],
        check=True,
    )

    if overlay_audio and reference_path:
        import shutil
        mixed_out = Path(output).with_name("mixed_out.mp4")
        if keep_audio:
            mix_cmd = [
                FFMPEG, "-y",
                "-i", str(output),
                "-i", str(reference_path),
                "-filter_complex", "[0:a][1:a]amix=inputs=2:duration=first:dropout_transition=2[a]",
                "-map", "0:v",
                "-map", "[a]",
                "-c:v", "copy",
                "-c:a", "aac",
                "-loglevel", "error",
                str(mixed_out)
            ]
        else:
            mix_cmd = [
                FFMPEG, "-y",
                "-i", str(output),
                "-i", str(reference_path),
                "-c:v", "copy",
                "-c:a", "aac",
                "-map", "0:v:0",
                "-map", "1:a:0",
                "-shortest",
                "-loglevel", "error",
                str(mixed_out)
            ]
        subprocess.run(mix_cmd, check=True)
        shutil.move(str(mixed_out), str(output))


    with open(edl_path, "w") as f:
        f.write(edl_content)

    # ── FCPXML generation (DaVinci Resolve native, with absolute file paths) ──
    from urllib.parse import quote as url_quote

    fcpxml_path = Path(output).with_name("timeline.fcpxml")
    frame_dur = f"{int(round(1000/fps))}/1000s"  # e.g. "33/1000s" for 30fps

    # Collect all unique clips used and their durations for the <resources> block
    used_clips = []  # list of (clip_path, clip_duration, resource_id)
    clip_to_rid = {}
    rid_counter = [2]  # r1 is reserved for the format

    def get_rid(clip_path):
        key = str(clip_path)
        if key not in clip_to_rid:
            rid = f"r{rid_counter[0]}"
            rid_counter[0] += 1
            dur = ffprobe_duration(clip_path)
            used_clips.append((clip_path, dur, rid))
            clip_to_rid[key] = rid
        return clip_to_rid[key]

    # Build the clip references for each shot
    fcpxml_clips = []
    timeline_offset_s = 0.0
    for i, shot in enumerate(shots):
        clip = pick_clip_log[i] if i < len(pick_clip_log) else clip_files[i % len(clip_files)]
        duration = shot["duration"]
        in_point = inpoints.get(clip.name, 0.0)
        clip_duration = ffprobe_duration(clip)
        available = clip_duration - in_point
        use_duration = min(duration, available) if available < duration else duration

        rid = get_rid(clip)
        # FCPXML times are in rational seconds
        offset_str = f"{int(round(timeline_offset_s * 1000))}/1000s"
        dur_str = f"{int(round(use_duration * 1000))}/1000s"
        tc_offset_s = get_start_frames(clip, fps) / fps
        start_str = f"{int(round((in_point + tc_offset_s) * 1000))}/1000s"
        clip_dur_str = f"{int(round(clip_duration * 1000))}/1000s"

        fcpxml_clips.append(
            f'            <asset-clip ref="{rid}" offset="{offset_str}" '
            f'name="{clip.stem}" duration="{dur_str}" start="{start_str}" '
            f'tcFormat="NDF"/>'
        )
        timeline_offset_s += use_duration

    total_dur_str = f"{int(round(timeline_offset_s * 1000))}/1000s"

    # Build resources block
    resources_xml = f'        <format id="r1" name="FFVideoFormat{height}p{int(round(fps))}" frameDuration="{frame_dur}" width="{width}" height="{height}"/>\n'
    from urllib.parse import quote
    for clip_path, clip_dur, rid in used_clips:
        raw_path = str(clip_path.resolve())
        # Use file://localhost/ explicitly for DaVinci Resolve
        file_url = "file://localhost" + quote(raw_path)
        asset_tc_offset_s = get_start_frames(clip_path, fps) / fps
        asset_start_str = f"{int(round(asset_tc_offset_s * 1000))}/1000s"
        cdur_str = f"{int(round(clip_dur * 1000))}/1000s"
        resources_xml += (
            f'        <asset id="{rid}" name="{clip_path.stem}" src="{file_url}" '
            f'start="{asset_start_str}" duration="{cdur_str}" hasVideo="1" format="r1"/>\n'
        )

    clips_xml = "\n".join(fcpxml_clips)

    fcpxml_content = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.9">
    <resources>
{resources_xml}    </resources>
    <library>
        <event name="AI Built Reel">
            <project name="AI Built Reel">
                <sequence format="r1" duration="{total_dur_str}" tcStart="0/1s" tcFormat="NDF">
                    <spine>
{clips_xml}
                    </spine>
                </sequence>
            </project>
        </event>
    </library>
</fcpxml>
"""

    with open(fcpxml_path, "w") as f:
        f.write(fcpxml_content)

    print(f"\nBuilt reel saved to {output}")
    print(f"Resolve EDL saved to {edl_path}")
    print(f"Resolve FCPXML saved to {fcpxml_path}")


def main():
    ap = argparse.ArgumentParser(description="Cut your footage to match a reference rhythm map.")
    ap.add_argument("rhythm", help="Path to rhythm.json from analyze_reference.py")
    ap.add_argument("clips_dir", help="Folder containing your trimmed source clips")
    ap.add_argument("-o", "--output", default="built_reel.mp4")
    ap.add_argument("--width", type=int, default=1080)
    ap.add_argument("--height", type=int, default=1920)
    ap.add_argument("--fps", type=float, default=30)
    ap.add_argument("--keep-audio", action="store_true", help="Keep each clip's original audio (default: muted)")
    ap.add_argument("--map", dest="map_file", default=None,
                     help="JSON file of {clip_filename: in_point_seconds} for custom in-points")
    ap.add_argument("--clip-tags", dest="clip_tags_file", default=None,
                     help="clip_tags.json from tag_content.py. When given, clips are matched to "
                          "shots by content category instead of alphabetical order.")
    args = ap.parse_args()

    inpoints = {}
    if args.map_file:
        inpoints = json.loads(Path(args.map_file).read_text())

    clip_tags = None
    if args.clip_tags_file:
        clip_tags = json.loads(Path(args.clip_tags_file).read_text())

    build(args.rhythm, args.clips_dir, args.output, args.width, args.height,
          args.fps, args.keep_audio, inpoints, clip_tags)


if __name__ == "__main__":
    main()
