#!/usr/bin/env python3
"""
build_reel.py

Step 2 of the pipeline.

Takes the rhythm.json produced by analyze_reference.py and a folder of your
OWN trimmed clips, then cuts your footage to match the reference's cut
timing and stitches it into one video, plus generates DaVinci Resolve
FCPXML and EDL timelines.
"""

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import quote

from ffmpeg_utils import FFMPEG, get_duration

VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".mkv", ".avi", ".webm"}


def write_progress(prog_file, current, total, phase):
    if prog_file:
        try:
            Path(prog_file).write_text(json.dumps({"phase": phase, "current": current, "total": total}))
        except Exception:
            pass


def ffprobe_duration(path: Path) -> float:
    return get_duration(str(path))


def get_start_frames(clip_path, fps):
    cmd = [FFMPEG, "-i", str(clip_path)]
    result = subprocess.run(cmd, capture_output=True, text=True)
    match = re.search(r"timecode\s*:\s*(\d{2}:\d{2}:\d{2}[:;]\d{2})", result.stderr)
    if match:
        tc = match.group(1)
        h, m, s, f = map(int, tc.replace(";", ":").split(":"))
        return int((h * 3600 + m * 60 + s) * fps + f)
    return 0


def frames_to_tc(frames, fps):
    fps_int = int(round(fps))
    h = int(frames // (fps_int * 3600))
    m = int((frames // (fps_int * 60)) % 60)
    s = int((frames // fps_int) % 60)
    f = int(frames % fps_int)
    return f"{h:02d}:{m:02d}:{s:02d}:{f:02d}"


def make_reel_id(clip_name: str, index: int) -> str:
    """Create a unique 8-char alphanumeric Reel ID for CMX3600 EDL so DaVinci
    Resolve never merges different clips that share 'AX' and 00:00:00:00 TC."""
    alnum = re.sub(r"[^A-Za-z0-9]", "", Path(clip_name).stem).upper()
    suffix = hashlib.md5(clip_name.encode("utf-8")).hexdigest()[:3].upper()
    base = (alnum[:5] + suffix).ljust(8, "0")[:8]
    return base


def build_grade_filter(grade: dict, shot_dur: float, lut_path: str = None) -> str:
    """Build FFmpeg video filter chain for color grading, LUT, levels, curves, vignette & fades."""
    if not grade and not lut_path:
        return ""
    grade = grade or {}
    parts = []

    # 1. 3D LUT (.cube / .3dl)
    if lut_path and Path(lut_path).exists() and grade.get("use_lut", True):
        esc_lut = str(Path(lut_path).resolve()).replace("\\", "/").replace(":", r"\:")
        parts.append(f"lut3d=file='{esc_lut}'")

    # 2. Brightness (-50..50), Contrast (-50..50), Saturation (-100..100)
    b = float(grade.get("brightness", 0.0)) / 100.0
    c = 1.0 + (float(grade.get("contrast", 0.0)) / 50.0)
    s = max(0.0, 1.0 + (float(grade.get("saturation", 0.0)) / 100.0))
    if abs(b) > 0.005 or abs(c - 1.0) > 0.005 or abs(s - 1.0) > 0.005:
        parts.append(f"eq=brightness={b:.3f}:contrast={c:.3f}:saturation={s:.3f}")

    # 3. Temperature (-100..100) & Tint (-100..100) via colorbalance
    temp = float(grade.get("temperature", 0.0)) / 200.0
    tint = -float(grade.get("tint", 0.0)) / 200.0
    if abs(temp) > 0.005 or abs(tint) > 0.005:
        parts.append(
            f"colorbalance=rm={temp:.3f}:gm={tint:.3f}:bm={-temp:.3f}:"
            f"rh={temp*0.6:.3f}:gh={tint*0.6:.3f}:bh={-temp*0.6:.3f}"
        )

    # 4. Levels: Whites (-50..50) & Blacks (-50..50)
    whites = float(grade.get("whites", 0.0))
    blacks = float(grade.get("blacks", 0.0))
    if abs(whites) > 0.5 or abs(blacks) > 0.5:
        imin = max(0.0, min(0.35, -blacks / 150.0)) if blacks < 0 else 0.0
        omin = max(0.0, min(0.35, blacks / 150.0)) if blacks > 0 else 0.0
        imax = max(0.65, min(1.0, 1.0 - (whites / 150.0))) if whites > 0 else 1.0
        omax = max(0.65, min(1.0, 1.0 + (whites / 150.0))) if whites < 0 else 1.0
        parts.append(
            f"colorlevels=rimin={imin:.3f}:gimin={imin:.3f}:bimin={imin:.3f}:"
            f"rimax={imax:.3f}:gimax={imax:.3f}:bimax={imax:.3f}:"
            f"romin={omin:.3f}:gomin={omin:.3f}:bomin={omin:.3f}:"
            f"romax={omax:.3f}:gomax={omax:.3f}:bomax={omax:.3f}"
        )

    # 5. Tone Curves preset
    curve = (grade.get("curve") or "none").strip()
    valid_curves = {
        "lighter", "darker", "increase_contrast", "medium_contrast",
        "strong_contrast", "linear_contrast", "vintage", "cross_process"
    }
    if curve in valid_curves:
        parts.append(f"curves=preset={curve}")

    # 6. Vignette (0..100)
    vig = float(grade.get("vignette", 0.0))
    if vig > 1.0:
        angle = min(1.0, vig / 100.0) * 0.785
        parts.append(f"vignette=angle={angle:.4f}")

    # 7. Fade In & Fade Out (seconds)
    fi = float(grade.get("fade_in", 0.0))
    fo = float(grade.get("fade_out", 0.0))
    if fi > 0.02:
        parts.append(f"fade=t=in:st=0:d={min(fi, shot_dur):.3f}")
    if fo > 0.02:
        st_out = max(0.0, shot_dur - fo)
        parts.append(f"fade=t=out:st={st_out:.3f}:d={min(fo, shot_dur):.3f}")

    return ",".join(parts)


def build(
    rhythm_path: str,
    clips_dir: str,
    output: str,
    width: int,
    height: int,
    fps: float,
    keep_audio: bool,
    inpoints: dict,
    clip_tags: dict = None,
    progress_file: str = None,
    overlay_audio: bool = False,
    reference_path: str = None,
    shot_plan: list = None,
    crop_mode: str = "center",
    lut_path: str = None,
    custom_audio_path: str = None,
    audio_in: float = 0.0,
    audio_volume: float = 1.0,
):
    rhythm = json.loads(Path(rhythm_path).read_text())
    shots = rhythm["shots"]

    clips_dir = Path(clips_dir)
    clip_files = sorted(
        [p for p in clips_dir.iterdir() if p.suffix.lower() in VIDEO_EXTS and not p.name.startswith(".")]
    )
    if not clip_files:
        print(f"Error: no video files found in {clips_dir}", file=sys.stderr)
        sys.exit(1)

    clip_by_name = {p.name: p for p in clip_files}
    # Also map normalized name (spaces/narrow-nbsp -> underscore) for safety
    for p in clip_files:
        norm = p.name.replace(" ", "_").replace("\u202f", "_")
        clip_by_name.setdefault(norm, p)

    print(f"Found {len(clip_files)} source clip(s), matching to {len(shots)} shot(s) from rhythm map.")

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
    cycle_pointer = 0
    use_counts = {}  # clip -> how many times it has been used so far

    def pick_clip(shot: dict) -> Path:
        nonlocal fallback_pointer, cycle_pointer
        tag = shot.get("tag")
        pool = tag_pools.get(tag) if tag else None

        chosen = None
        if pool:
            while pool_pointers[tag] < len(pool):
                c = pool[pool_pointers[tag]]
                pool_pointers[tag] += 1
                if c not in used_clips:
                    chosen = c
                    break

        if chosen is None:
            while fallback_pointer < len(fallback_pool):
                c = fallback_pool[fallback_pointer]
                fallback_pointer += 1
                if c not in used_clips:
                    chosen = c
                    break

        if chosen is None:
            if pool:
                chosen = min(pool, key=lambda c: use_counts.get(c, 0))
            else:
                chosen = fallback_pool[cycle_pointer % len(fallback_pool)]
                cycle_pointer += 1

        used_clips.add(chosen)
        use_counts[chosen] = use_counts.get(chosen, 0) + 1
        return chosen

    tmpdir = Path(tempfile.mkdtemp(prefix="reel_"))
    segment_paths = []
    pick_clip_log = []
    original_clip_log = []
    shot_log = []  # list of dicts with shot details

    edl_path = Path(output).with_name("timeline.edl")
    edl_content = "TITLE: AI Built Reel\nFCM: NON-DROP FRAME\n\n"
    timeline_frame = 0

    clean_media_dir = Path(output).parent / "clean_media"
    clean_media_dir.mkdir(exist_ok=True)
    clean_clip_cache = {}
    clip_reel_ids = {}

    # Determine active shot list (either custom shot_plan from timeline editor or rhythm shots)
    active_shots = []
    if shot_plan and isinstance(shot_plan, list) and len(shot_plan) > 0:
        for idx, sp in enumerate(shot_plan):
            cname = sp.get("clip")
            cpath = clip_by_name.get(cname) if cname else None
            if cpath is None:
                cpath = clip_files[idx % len(clip_files)]
            dur = float(sp.get("duration", shots[idx % len(shots)]["duration"]))
            inp = float(sp.get("in_point", inpoints.get(cpath.name, 0.0)))
            scrop = sp.get("crop", crop_mode)
            szoom = float(sp.get("zoom", 100.0))
            span_x = float(sp.get("pan_x", 0.0))
            span_y = float(sp.get("pan_y", 0.0))
            sgrade = sp.get("grade") or {}
            stag = sp.get("tag", shots[idx % len(shots)].get("tag") if idx < len(shots) else None)
            active_shots.append({
                "index": idx,
                "clip_path": cpath,
                "duration": max(0.1, dur),
                "custom_in": max(0.0, inp),
                "crop": scrop,
                "zoom": szoom,
                "pan_x": span_x,
                "pan_y": span_y,
                "grade": sgrade,
                "tag": stag,
            })
    else:
        for i, shot in enumerate(shots):
            cpath = pick_clip(shot)
            duration = float(shot["duration"])
            base_in = float(inpoints.get(cpath.name, 0.0))
            clip_duration = ffprobe_duration(cpath)
            repeat_n = use_counts.get(cpath, 1) - 1
            spare = clip_duration - base_in - duration
            in_point = base_in
            if repeat_n > 0 and spare > 0.1:
                step = max(duration, spare / 3)
                in_point = base_in + (repeat_n * step) % spare
            active_shots.append({
                "index": i,
                "clip_path": cpath,
                "duration": duration,
                "custom_in": in_point,
                "crop": crop_mode,
                "zoom": 100.0,
                "pan_x": 0.0,
                "pan_y": 0.0,
                "tag": shot.get("tag"),
            })

    for i, item in enumerate(active_shots):
        write_progress(progress_file, i + 1, len(active_shots), "Stitching clips together...")
        original_clip = item["clip_path"]

        if original_clip not in clean_clip_cache:
            clean_name = original_clip.name.replace(" ", "_").replace("\u202f", "_")
            clean_path = clean_media_dir / clean_name
            if not clean_path.exists():
                try:
                    os.link(str(original_clip), str(clean_path))
                except OSError:
                    shutil.copy2(str(original_clip), str(clean_path))
            clean_clip_cache[original_clip] = clean_path
            clip_reel_ids[original_clip] = make_reel_id(original_clip.name, len(clip_reel_ids) + 1)

        clip = clean_clip_cache[original_clip]
        pick_clip_log.append(clip)
        original_clip_log.append(original_clip)

        duration = item["duration"]
        in_point = item["custom_in"]
        scrop = item.get("crop") or "center"
        szoom = float(item.get("zoom", 100.0))
        span_x = float(item.get("pan_x", 0.0))
        span_y = float(item.get("pan_y", 0.0))

        clip_duration = ffprobe_duration(clip)
        if in_point >= clip_duration:
            in_point = max(0.0, clip_duration - duration)

        available = clip_duration - in_point
        use_duration = duration
        freeze_pad = 0.0
        if available < duration:
            use_duration = max(available, 0.05)
            freeze_pad = duration - use_duration
            print(
                f"  ! shot {i}: {original_clip.name} only has {available:.2f}s from in-point "
                f"{in_point:.2f}s (needs {duration:.2f}s) -> holding last frame {freeze_pad:.2f}s"
            )

        shot_log.append({
            "index": i,
            "clip": original_clip.name,
            "clip_path": original_clip,
            "in_point": round(in_point, 3),
            "duration": round(duration, 3),
            "use_duration": round(use_duration, 3),
            "clip_duration": round(clip_duration, 3),
            "crop": scrop,
            "zoom": round(szoom, 1),
            "pan_x": round(span_x, 2),
            "pan_y": round(span_y, 2),
            "grade": item.get("grade") or {},
            "tag": item.get("tag"),
        })

        seg_out = tmpdir / f"seg_{i:03d}.mp4"
        if abs(szoom - 100.0) > 0.5 or abs(span_x) > 0.2 or abs(span_y) > 0.2:
            z = max(0.25, min(4.0, szoom / 100.0))
            dx_px = int(round((span_x / 100.0) * width))
            dy_px = int(round((span_y / 100.0) * height))
            vf = (
                f"scale=w='trunc(max({width},iw*({height}/ih))*{z:.4f}/2)*2':"
                f"h='trunc(max({height},ih*({width}/iw))*{z:.4f}/2)*2',"
                f"pad=w='iw+{width*2}':h='ih+{height*2}':x={width}:y={height}:color=black,"
                f"crop=w={width}:h={height}:"
                f"x='clip((iw-{width})/2-({dx_px}),0,iw-{width})':"
                f"y='clip((ih-{height})/2-({dy_px}),0,ih-{height})',"
                f"setsar=1,fps={fps}"
            )
        elif scrop == "fit":
            vf = (
                f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
                f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps={fps}"
            )
        else:
            vf = f"scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},setsar=1,fps={fps}"

        grade_vf = build_grade_filter(item.get("grade"), duration, lut_path=lut_path)
        if grade_vf:
            vf += f",{grade_vf}"

        if freeze_pad > 0:
            vf += f",tpad=stop_mode=clone:stop_duration={freeze_pad:.3f}"

        cmd = [
            FFMPEG,
            "-y",
            "-ss",
            str(in_point),
            "-i",
            str(clip),
            "-t",
            str(use_duration),
            "-vf",
            vf,
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
        ]
        if keep_audio:
            cmd += ["-c:a", "aac", "-b:a", "192k"]
        else:
            cmd += ["-an"]
        cmd += ["-loglevel", "error", str(seg_out)]

        subprocess.run(cmd, check=True)
        segment_paths.append(seg_out)

        # EDL Logic — uses exact original filename + unique Reel ID so DaVinci
        # Resolve never collapses multiple 00:00:00:00 clips into one clip!
        tc_offset = get_start_frames(original_clip, fps)
        src_start_f = int(round(in_point * fps)) + tc_offset
        dur_f = max(1, int(round(use_duration * fps)))
        src_end_f = src_start_f + dur_f

        src_in = frames_to_tc(src_start_f, fps)
        src_out = frames_to_tc(src_end_f, fps)
        rec_in = frames_to_tc(timeline_frame, fps)
        rec_out = frames_to_tc(timeline_frame + dur_f, fps)

        tape_name = clip_reel_ids[original_clip]
        edl_content += f"{i+1:03d}  {tape_name} V     C        {src_in} {src_out} {rec_in} {rec_out}\n"
        edl_content += f"* FROM CLIP NAME: {original_clip.name}\n"
        edl_content += f"* SOURCE FILE: {original_clip.resolve()}\n\n"
        timeline_frame += dur_f

    # Save shot_plan.json so the frontend timeline editor can inspect & tweak every cut
    shot_plan_out = Path(output).with_name("shot_plan.json")
    serializable_plan = [
        {
            "index": s["index"],
            "clip": s["clip"],
            "in_point": s["in_point"],
            "duration": s["duration"],
            "clip_duration": s["clip_duration"],
            "crop": s["crop"],
            "zoom": s.get("zoom", 100.0),
            "pan_x": s.get("pan_x", 0.0),
            "pan_y": s.get("pan_y", 0.0),
            "grade": s.get("grade") or {},
            "tag": s["tag"],
        }
        for s in shot_log
    ]
    shot_plan_out.write_text(json.dumps(serializable_plan, indent=2))

    # Concat segments
    concat_list = tmpdir / "concat.txt"
    with open(concat_list, "w") as f:
        for p in segment_paths:
            f.write(f"file '{p.as_posix()}'\n")

    subprocess.run(
        [FFMPEG, "-y", "-f", "concat", "-safe", "0", "-i", str(concat_list), "-c", "copy", "-loglevel", "error", output],
        check=True,
    )

    # Audio Track Mixing (either custom audio track or reference audio track)
    audio_source = custom_audio_path if (custom_audio_path and Path(custom_audio_path).exists()) else (reference_path if overlay_audio else None)
    if audio_source and Path(audio_source).exists():
        mixed_out = Path(output).with_name("mixed_out.mp4")
        vol = max(0.0, min(3.0, float(audio_volume)))
        a_in = max(0.0, float(audio_in))
        if keep_audio:
            mix_cmd = [
                FFMPEG,
                "-y",
                "-i",
                str(output),
                "-ss",
                str(a_in),
                "-i",
                str(audio_source),
                "-filter_complex",
                f"[1:a]volume={vol:.2f}[a1];[0:a][a1]amix=inputs=2:duration=first:dropout_transition=2[a]",
                "-map",
                "0:v",
                "-map",
                "[a]",
                "-c:v",
                "copy",
                "-c:a",
                "aac",
                "-loglevel",
                "error",
                str(mixed_out),
            ]
        else:
            mix_cmd = [
                FFMPEG,
                "-y",
                "-i",
                str(output),
                "-ss",
                str(a_in),
                "-i",
                str(audio_source),
                "-filter_complex",
                f"[1:a]volume={vol:.2f}[a]",
                "-c:v",
                "copy",
                "-c:a",
                "aac",
                "-map",
                "0:v:0",
                "-map",
                "[a]",
                "-shortest",
                "-loglevel",
                "error",
                str(mixed_out),
            ]
        subprocess.run(mix_cmd, check=True)
        shutil.move(str(mixed_out), str(output))

    with open(edl_path, "w") as f:
        f.write(edl_content)

    # ── FCPXML generation (DaVinci Resolve native, with absolute file paths) ──
    fcpxml_path = Path(output).with_name("timeline.fcpxml")
    frame_dur = f"{int(round(1000/fps))}/1000s"

    used_clips_list = []
    clip_to_rid = {}
    rid_counter = [2]

    def get_rid(clip_path: Path):
        key = str(clip_path.resolve())
        if key not in clip_to_rid:
            rid = f"r{rid_counter[0]}"
            rid_counter[0] += 1
            dur = ffprobe_duration(clip_path)
            used_clips_list.append((clip_path, dur, rid))
            clip_to_rid[key] = rid
        return clip_to_rid[key]

    fcpxml_clips = []
    timeline_offset_s = 0.0
    for s in shot_log:
        clip = s["clip_path"]
        in_point = s["in_point"]
        use_duration = s["use_duration"]

        rid = get_rid(clip)
        offset_str = f"{int(round(timeline_offset_s * 1000))}/1000s"
        dur_str = f"{int(round(use_duration * 1000))}/1000s"
        tc_offset_s = get_start_frames(clip, fps) / fps
        start_str = f"{int(round((in_point + tc_offset_s) * 1000))}/1000s"

        fcpxml_clips.append(
            f'            <asset-clip ref="{rid}" offset="{offset_str}" '
            f'name="{clip.stem}" duration="{dur_str}" start="{start_str}" '
            f'tcFormat="NDF"/>'
        )
        timeline_offset_s += use_duration

    total_dur_str = f"{int(round(timeline_offset_s * 1000))}/1000s"

    resources_xml = (
        f'        <format id="r1" name="FFVideoFormat{height}p{int(round(fps))}" '
        f'frameDuration="{frame_dur}" width="{width}" height="{height}"/>\n'
    )
    for clip_path, clip_dur, rid in used_clips_list:
        raw_path = str(clip_path.resolve())
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
    return serializable_plan


def main():
    ap = argparse.ArgumentParser(description="Cut your footage to match a reference rhythm map.")
    ap.add_argument("rhythm", help="Path to rhythm.json from analyze_reference.py")
    ap.add_argument("clips_dir", help="Folder containing your trimmed source clips")
    ap.add_argument("-o", "--output", default="built_reel.mp4")
    ap.add_argument("--width", type=int, default=1080)
    ap.add_argument("--height", type=int, default=1920)
    ap.add_argument("--fps", type=float, default=30)
    ap.add_argument("--keep-audio", action="store_true", help="Keep each clip's original audio (default: muted)")
    ap.add_argument("--map", dest="map_file", default=None, help="JSON file of {clip_filename: in_point_seconds}")
    ap.add_argument("--clip-tags", dest="clip_tags_file", default=None, help="clip_tags.json from tag_content.py")
    args = ap.parse_args()

    inpoints = {}
    if args.map_file:
        inpoints = json.loads(Path(args.map_file).read_text())

    clip_tags = None
    if args.clip_tags_file:
        clip_tags = json.loads(Path(args.clip_tags_file).read_text())

    build(
        args.rhythm,
        args.clips_dir,
        args.output,
        args.width,
        args.height,
        args.fps,
        args.keep_audio,
        inpoints,
        clip_tags,
    )


if __name__ == "__main__":
    main()
