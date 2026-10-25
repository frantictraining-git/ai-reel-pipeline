#!/usr/bin/env python3
"""
app.py — local web UI for the reel pipeline.

Run this, then open http://localhost:5050 in your browser. Everything runs
on your machine — nothing you upload here leaves your computer.

    python3 app.py
"""

import json
import shutil
import subprocess
import uuid
from pathlib import Path

from flask import Flask, request, jsonify, send_file, render_template
from werkzeug.utils import secure_filename

from analyze_reference import analyze
from build_reel import build
from export_platforms import export_format, FORMAT_DIMS, LOGO_POSITIONS
from speech_cleaner import clean_speech
from tag_content import tag_reference as tag_reference_shots, tag_clips as tag_clips_folder, DEFAULT_CATEGORIES

import os
from pathlib import Path

BASE_DIR = Path(__file__).parent
os.environ["PATH"] = f"{BASE_DIR / 'bin'}:{os.environ.get('PATH', '')}"

JOBS_DIR = BASE_DIR / "jobs"
JOBS_DIR.mkdir(exist_ok=True)
FONTS_DIR = BASE_DIR / "custom_fonts"
FONTS_DIR.mkdir(exist_ok=True)

app = Flask(__name__)

@app.after_request
def add_header(r):
    r.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    r.headers["Pragma"] = "no-cache"
    r.headers["Expires"] = "0"
    r.headers['Cache-Control'] = 'public, max-age=0'
    return r



@app.errorhandler(FileNotFoundError)
def handle_missing_job(e):
    return jsonify({"error": str(e)}), 404


def job_dir(job_id: str) -> Path:
    d = JOBS_DIR / job_id
    if not d.exists():
        raise FileNotFoundError(f"Unknown job {job_id}")
    return d


@app.route("/")
def index():
    return render_template("index.html")

@app.route("/sorter")
def sorter():
    return render_template("sorter.html")



@app.route("/api/analyze", methods=["POST"])
def api_analyze():
    job_id = request.form.get("job_id")
    if not job_id:
        job_name = request.form.get("job_name", "").strip()
        if job_name:
            import re
            safe_name = re.sub(r'[^a-zA-Z0-9_\-]', '_', job_name)
            job_id = f"{safe_name}_{uuid.uuid4().hex[:4]}"
        else:
            job_id = uuid.uuid4().hex[:12]
    jdir = JOBS_DIR / job_id
    jdir.mkdir(exist_ok=True)

    ref_file = request.files.get("reference")
    if not ref_file or not ref_file.filename:
        return jsonify({"error": "No reference video uploaded"}), 400

    ref_path = jdir / f"reference{Path(ref_file.filename).suffix or '.mp4'}"
    ref_file.save(ref_path)

    threshold = float(request.form.get("threshold", 20.0))
    min_shot = float(request.form.get("min_shot", 0.05))

    try:
        result = analyze(str(ref_path), threshold, min_shot)
    except Exception as e:
        return jsonify({"error": f"Analysis failed: {e}"}), 500

    (jdir / "rhythm.json").write_text(json.dumps(result, indent=2))

    import datetime
    meta = {
        "job_id": job_id,
        "filename": f"Reel: {ref_file.filename}",
        "timestamp": datetime.datetime.now().isoformat(),
        "type": "Reel Pipeline"
    }
    (jdir / "meta.json").write_text(json.dumps(meta))

    return jsonify({
        "job_id": job_id,
        "rhythm": result,
        "reference_url": f"/api/media/{job_id}/{ref_path.name}",
    })


def _resolve_clips_dir(jdir: Path):
    """Shared by /api/tag and /api/build: returns the clips folder, saving
    uploaded files into jdir/source_clips if no local_folder path was given.
    Preserves exact original filenames so DaVinci Resolve relinks 100% cleanly."""
    local_folder = request.form.get("local_folder")
    if local_folder and Path(local_folder).is_dir():
        (jdir / "clips_folder.txt").write_text(str(Path(local_folder).resolve()))
        return Path(local_folder)

    clip_files = [f for f in request.files.getlist("clips") if f and f.filename]
    clips_dir = jdir / "source_clips"

    if not clip_files:
        # If clips were already uploaded or a local folder was saved earlier for this job, reuse it!
        saved_folder_file = jdir / "clips_folder.txt"
        if saved_folder_file.exists():
            saved_p = Path(saved_folder_file.read_text().strip())
            if saved_p.is_dir():
                return saved_p
        if clips_dir.exists() and any(clips_dir.iterdir()):
            return clips_dir
        return None

    if clips_dir.exists():
        shutil.rmtree(clips_dir)
    clips_dir.mkdir()

    for i, f in enumerate(clip_files):
        raw_name = Path(f.filename).name.replace("/", "_").replace("\\", "_")
        if not raw_name or raw_name.startswith("."):
            suffix = Path(f.filename).suffix or ".mp4"
            raw_name = f"clip_{i:03d}{suffix}"
        f.save(clips_dir / raw_name)

    return clips_dir



@app.route("/api/progress/<job_id>", methods=["GET"])
def api_progress(job_id):
    jdir = job_dir(job_id)
    prog_file = jdir / "progress.json"
    if prog_file.exists():
        import json
        try:
            data = json.loads(prog_file.read_text())
            return jsonify(data)
        except:
            pass
    return jsonify({"phase": "Starting up...", "current": 0, "total": 0})


@app.route("/api/tag", methods=["POST"])
def api_tag():
    """Content-aware tagging step. Tags both the reference video's shots and
    your uploaded/local footage clips using a local CLIP model, so build_reel
    can match clips to shots by content (food, kitchen, interior, person...)
    instead of alphabetical order. Fully offline after the model's first
    download."""
    job_id = request.form.get("job_id")
    if not job_id:
        return jsonify({"error": "Missing job_id — run Analyze first"}), 400
    jdir = job_dir(job_id)

    rhythm_path = jdir / "rhythm.json"
    if not rhythm_path.exists():
        return jsonify({"error": "No rhythm map found — run Analyze first"}), 400

    ref_candidates = list(jdir.glob("reference.*"))
    if not ref_candidates:
        return jsonify({"error": "Reference video not found — run Analyze first"}), 400
    ref_path = ref_candidates[0]

    clips_dir = _resolve_clips_dir(jdir)
    if clips_dir is None:
        return jsonify({"error": "No footage clips uploaded or selected"}), 400

    categories_raw = request.form.get("categories", ",".join(DEFAULT_CATEGORIES))
    categories = [c.strip() for c in categories_raw.split(",") if c.strip()]
    if not categories:
        return jsonify({"error": "No categories given"}), 400

    tags_path = jdir / "clip_tags.json"
    try:
        prog_file = jdir / "progress.json"
        tag_reference_shots(str(rhythm_path), str(ref_path), categories, progress_file=str(prog_file))
        tag_clips_folder(str(clips_dir), categories, str(tags_path), progress_file=str(prog_file))
    except Exception as e:
        return jsonify({"error": f"Tagging failed: {e}"}), 500

    return jsonify({
        "job_id": job_id,
        "rhythm": json.loads(rhythm_path.read_text()),
        "clip_tags": json.loads(tags_path.read_text()),
    })


@app.route("/api/pick_local_folder", methods=["POST"])
def pick_local_folder():
    import subprocess
    try:
        script = '''
        set frontApp to (path to frontmost application as text)
        tell application frontApp
            set myFolder to choose folder with prompt "Select your raw footage folder:"
            return POSIX path of myFolder
        end tell
        '''
        result = subprocess.run(["osascript", "-e", script], capture_output=True, text=True)
        if result.returncode == 0:
            folder_path = result.stdout.strip()
            return jsonify({"path": folder_path})
        else:
            return jsonify({"error": "User cancelled"}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/build", methods=["POST"])
def api_build():
    job_id = request.form.get("job_id")
    if not job_id:
        return jsonify({"error": "Missing job_id — run Analyze first"}), 400
    jdir = job_dir(job_id)

    rhythm_path = jdir / "rhythm.json"
    if not rhythm_path.exists():
        return jsonify({"error": "No rhythm map found — run Analyze first"}), 400

    clips_dir = _resolve_clips_dir(jdir)
    if clips_dir is None:
        return jsonify({"error": "No footage clips uploaded or selected"}), 400

    keep_audio = request.form.get("keep_audio") == "true"
    overlay_audio = request.form.get("overlay_audio") == "true"
    width = int(request.form.get("width", 1080))
    height = int(request.form.get("height", 1920))
    fps = float(request.form.get("fps", 30))

    inpoints = {}
    inpoints_raw = request.form.get("inpoints")
    if inpoints_raw:
        try:
            inpoints = json.loads(inpoints_raw)
        except json.JSONDecodeError:
            pass

    clip_tags = None
    if request.form.get("smart_match") == "true":
        tags_path = jdir / "clip_tags.json"
        if tags_path.exists():
            clip_tags = json.loads(tags_path.read_text())

    shot_plan = None
    shot_plan_raw = request.form.get("shot_plan")
    if shot_plan_raw:
        try:
            shot_plan = json.loads(shot_plan_raw)
        except json.JSONDecodeError:
            pass

    text_track = None
    text_track_raw = request.form.get("text_track")
    if text_track_raw:
        try:
            text_track = json.loads(text_track_raw)
        except json.JSONDecodeError:
            pass

    crop_mode = request.form.get("crop_mode", "center")
    audio_in = float(request.form.get("audio_in", 0.0))
    audio_duration = float(request.form.get("audio_duration", 0.0))
    audio_volume = float(request.form.get("audio_volume", 1.0))
    hdr_output = request.form.get("hdr_output") == "true"

    # Optional 3D LUT (.cube / .3dl)
    if request.form.get("clear_lut") == "true":
        for p in jdir.glob("custom_lut.*"):
            p.unlink(missing_ok=True)
    lut_file = request.files.get("lut_file")
    if lut_file and lut_file.filename:
        for p in jdir.glob("custom_lut.*"):
            p.unlink(missing_ok=True)
        lut_ext = Path(lut_file.filename).suffix or ".cube"
        lut_file.save(jdir / f"custom_lut{lut_ext}")
    lut_matches = list(jdir.glob("custom_lut.*"))
    lut_path = str(lut_matches[0]) if lut_matches else None

    # Optional Custom Audio Track
    if request.form.get("clear_custom_audio") == "true":
        for p in jdir.glob("custom_audio.*"):
            p.unlink(missing_ok=True)
    custom_audio_file = request.files.get("custom_audio")
    if custom_audio_file and custom_audio_file.filename:
        for p in jdir.glob("custom_audio.*"):
            p.unlink(missing_ok=True)
        a_ext = Path(custom_audio_file.filename).suffix or ".mp3"
        custom_audio_file.save(jdir / f"custom_audio{a_ext}")
    custom_audio_matches = list(jdir.glob("custom_audio.*"))
    custom_audio_path = str(custom_audio_matches[0]) if custom_audio_matches else None

    output_path = jdir / "built_reel.mp4"
    try:
        ref_matches = list(jdir.glob("reference.*"))
        ref_path = str(ref_matches[0]) if ref_matches else None
        plan_out = build(
            str(rhythm_path),
            str(clips_dir),
            str(output_path),
            width,
            height,
            fps,
            keep_audio,
            inpoints,
            clip_tags,
            progress_file=str(jdir / "progress.json"),
            overlay_audio=overlay_audio,
            reference_path=ref_path,
            shot_plan=shot_plan,
            crop_mode=crop_mode,
            lut_path=lut_path,
            custom_audio_path=custom_audio_path,
            audio_in=audio_in,
            audio_duration=audio_duration,
            audio_volume=audio_volume,
            hdr_output=hdr_output,
            text_track=text_track,
        )
    except Exception as e:
        return jsonify({"error": f"Build failed: {e}"}), 500

    available_clips = sorted(
        [p.name for p in Path(clips_dir).iterdir() if p.suffix.lower() in {".mp4", ".mov", ".m4v", ".mkv", ".avi", ".webm"} and not p.name.startswith(".")]
    )

    return jsonify({
        "job_id": job_id,
        "video_url": f"/api/media/{job_id}/built_reel.mp4",
        "shot_plan": plan_out,
        "available_clips": available_clips,
    })


@app.route("/api/job_state/<job_id>")
def api_job_state(job_id):
    jdir = job_dir(job_id)
    if not jdir.exists():
        return jsonify({"error": "Not found"}), 404
    meta = {}
    if (jdir / "meta.json").exists():
        try:
            meta = json.loads((jdir / "meta.json").read_text())
        except Exception:
            pass
    job_name = meta.get("job_name") or meta.get("filename") or job_id
    rhythm = json.loads((jdir / "rhythm.json").read_text()) if (jdir / "rhythm.json").exists() else None
    shot_plan = json.loads((jdir / "shot_plan.json").read_text()) if (jdir / "shot_plan.json").exists() else []
    text_track = json.loads((jdir / "text_track.json").read_text()) if (jdir / "text_track.json").exists() else []
    built_exists = (jdir / "built_reel.mp4").exists()
    local_folder = (jdir / "clips_folder.txt").read_text().strip() if (jdir / "clips_folder.txt").exists() else None
    folder_missing = bool(local_folder and not Path(local_folder).is_dir())
    exts = {".mp4", ".mov", ".m4v", ".mkv", ".avi", ".webm"}
    available_clips = []
    if local_folder and Path(local_folder).is_dir():
        available_clips = sorted([p.name for p in Path(local_folder).iterdir() if p.suffix.lower() in exts and not p.name.startswith(".")])
    elif (jdir / "source_clips").is_dir():
        available_clips = sorted([p.name for p in (jdir / "source_clips").iterdir() if p.suffix.lower() in exts and not p.name.startswith(".")])
    elif shot_plan:
        available_clips = sorted(list({s.get("clip") for s in shot_plan if s.get("clip")}))
    lut_name = None
    if (jdir / "luts").is_dir():
        for lp in sorted((jdir / "luts").iterdir()):
            if lp.suffix.lower() in (".cube", ".3dl"):
                lut_name = lp.name
                break
    custom_audio_name = None
    if (jdir / "audio").is_dir():
        for ap in sorted((jdir / "audio").iterdir()):
            if not ap.name.startswith("."):
                custom_audio_name = ap.name
                break

    ref_candidates = list(jdir.glob("reference.*"))
    reference_url = f"/api/media/{job_id}/{ref_candidates[0].name}" if ref_candidates else None
    custom_audio_candidates = list(jdir.glob("custom_audio.*"))
    custom_audio_url = f"/api/media/{job_id}/{custom_audio_candidates[0].name}" if custom_audio_candidates else None

    return jsonify({
        "job_id": job_id,
        "job_name": job_name,
        "settings": meta.get("settings", {"width": 1080, "height": 1920, "fps": 30}),
        "rhythm": rhythm,
        "shot_plan": shot_plan,
        "text_track": text_track,
        "built_exists": built_exists,
        "video_url": f"/api/media/{job_id}/built_reel.mp4" if built_exists else None,
        "reference_url": reference_url,
        "custom_audio_url": custom_audio_url,
        "local_folder": local_folder,
        "folder_missing": folder_missing,
        "available_clips": available_clips,
        "tagged": (jdir / "clip_tags.json").exists(),
        "lut_name": lut_name,
        "custom_audio_name": custom_audio_name,
    })


@app.route("/api/job_rename", methods=["POST"])
def api_job_rename():
    import datetime
    data = request.get_json(silent=True) or request.form
    job_id = data.get("job_id")
    new_name = (data.get("job_name") or "").strip()
    if not job_id or not new_name:
        return jsonify({"error": "Missing job_id or job_name"}), 400
    jdir = job_dir(job_id)
    meta_path = jdir / "meta.json"
    meta = {}
    if meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text())
        except Exception:
            pass
    meta["job_id"] = job_id
    meta["job_name"] = new_name
    meta["filename"] = new_name
    if "timestamp" not in meta:
        meta["timestamp"] = datetime.datetime.now().isoformat()
    meta_path.write_text(json.dumps(meta, indent=2))
    return jsonify({"job_id": job_id, "job_name": new_name})


@app.route("/api/project_save", methods=["POST"])
def api_project_save():
    import datetime, re
    data = request.get_json(silent=True) or {}
    job_id = data.get("job_id")
    if not job_id:
        return jsonify({"error": "No active job to save"}), 400
    jdir = job_dir(job_id)

    meta_path = jdir / "meta.json"
    meta = {}
    if meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text())
        except Exception:
            pass

    job_name = (data.get("job_name") or meta.get("job_name") or meta.get("filename") or job_id).strip()
    settings = data.get("settings") or meta.get("settings") or {"width": 1080, "height": 1920, "fps": 30}
    meta["job_id"] = job_id
    meta["job_name"] = job_name
    meta["filename"] = job_name
    meta["settings"] = settings
    meta["timestamp"] = datetime.datetime.now().isoformat()
    meta_path.write_text(json.dumps(meta, indent=2))

    shot_plan = data.get("shot_plan")
    if shot_plan is not None:
        (jdir / "shot_plan.json").write_text(json.dumps(shot_plan, indent=2))
    elif (jdir / "shot_plan.json").exists():
        shot_plan = json.loads((jdir / "shot_plan.json").read_text())
    else:
        shot_plan = []

    text_track = data.get("text_track")
    if text_track is not None:
        (jdir / "text_track.json").write_text(json.dumps(text_track, indent=2))
    elif (jdir / "text_track.json").exists():
        text_track = json.loads((jdir / "text_track.json").read_text())
    else:
        text_track = []

    local_folder = data.get("local_folder")
    if local_folder:
        (jdir / "clips_folder.txt").write_text(str(local_folder).strip())
    elif (jdir / "clips_folder.txt").exists():
        local_folder = (jdir / "clips_folder.txt").read_text().strip()

    rhythm = json.loads((jdir / "rhythm.json").read_text()) if (jdir / "rhythm.json").exists() else None
    clip_tags = json.loads((jdir / "clip_tags.json").read_text()) if (jdir / "clip_tags.json").exists() else None

    proj_payload = {
        "reel_pipeline_project": "1.0",
        "job_id": job_id,
        "job_name": job_name,
        "saved_at": meta["timestamp"],
        "settings": settings,
        "local_folder": local_folder,
        "rhythm": rhythm,
        "shot_plan": shot_plan,
        "text_track": text_track,
        "clip_tags": clip_tags,
    }
    proj_file = jdir / "project.reelproj"
    proj_file.write_text(json.dumps(proj_payload, indent=2))

    safe_name = re.sub(r"[^a-zA-Z0-9_\-]+", "_", job_name).strip("_") or job_id
    return jsonify({
        "job_id": job_id,
        "job_name": job_name,
        "download_url": f"/api/project_download/{job_id}?name={safe_name}.reelproj",
        "filename": f"{safe_name}.reelproj",
    })


@app.route("/api/project_download/<job_id>")
def api_project_download(job_id):
    jdir = job_dir(job_id)
    proj_file = jdir / "project.reelproj"
    if not proj_file.exists():
        return jsonify({"error": "Project file not found"}), 404
    dl_name = request.args.get("name") or f"{job_id}.reelproj"
    return send_file(proj_file, as_attachment=True, download_name=dl_name, mimetype="application/json")


@app.route("/api/project_open", methods=["POST"])
def api_project_open():
    import datetime
    f = request.files.get("project_file")
    if not f or not f.filename:
        return jsonify({"error": "No project file selected"}), 400
    try:
        payload = json.loads(f.read().decode("utf-8"))
    except Exception as e:
        return jsonify({"error": f"Invalid project file: {e}"}), 400

    job_id = payload.get("job_id") or uuid.uuid4().hex[:12]
    jdir = JOBS_DIR / job_id
    jdir.mkdir(exist_ok=True)

    job_name = payload.get("job_name") or Path(f.filename).stem
    settings = payload.get("settings") or {"width": 1080, "height": 1920, "fps": 30}
    meta = {
        "job_id": job_id,
        "job_name": job_name,
        "filename": job_name,
        "settings": settings,
        "timestamp": payload.get("saved_at") or datetime.datetime.now().isoformat(),
        "type": "Reel Pipeline",
    }
    (jdir / "meta.json").write_text(json.dumps(meta, indent=2))

    if payload.get("rhythm"):
        (jdir / "rhythm.json").write_text(json.dumps(payload["rhythm"], indent=2))
    if payload.get("shot_plan") is not None:
        (jdir / "shot_plan.json").write_text(json.dumps(payload["shot_plan"], indent=2))
    if payload.get("text_track") is not None:
        (jdir / "text_track.json").write_text(json.dumps(payload["text_track"], indent=2))
    if payload.get("clip_tags"):
        (jdir / "clip_tags.json").write_text(json.dumps(payload["clip_tags"], indent=2))
    if payload.get("local_folder"):
        (jdir / "clips_folder.txt").write_text(str(payload["local_folder"]).strip())

    return api_job_state(job_id)


@app.route("/api/relink_folder", methods=["POST"])
def api_relink_folder():
    from urllib.parse import quote
    data = request.get_json(silent=True) or request.form
    job_id = data.get("job_id")
    new_folder = (data.get("local_folder") or "").strip()
    if not job_id or not new_folder:
        return jsonify({"error": "Missing job_id or folder path"}), 400
    new_folder_path = Path(new_folder)
    if not new_folder_path.is_dir():
        return jsonify({"error": f"Folder not found: {new_folder}"}), 400

    jdir = job_dir(job_id)
    old_folder = (jdir / "clips_folder.txt").read_text().strip() if (jdir / "clips_folder.txt").exists() else None
    (jdir / "clips_folder.txt").write_text(str(new_folder_path.resolve()))

    # Also update existing timeline.edl and timeline.fcpxml if present so Resolve relinks immediately
    if old_folder:
        edl_p = jdir / "timeline.edl"
        if edl_p.exists():
            txt = edl_p.read_text()
            txt = txt.replace(str(Path(old_folder).resolve()), str(new_folder_path.resolve()))
            txt = txt.replace(old_folder, str(new_folder_path.resolve()))
            edl_p.write_text(txt)
        fcpxml_p = jdir / "timeline.fcpxml"
        if fcpxml_p.exists():
            txt = fcpxml_p.read_text()
            old_q = quote(str(Path(old_folder).resolve()))
            new_q = quote(str(new_folder_path.resolve()))
            txt = txt.replace(old_q, new_q)
            fcpxml_p.write_text(txt)

    return api_job_state(job_id)


@app.route("/api/local_clips_info", methods=["POST"])
def api_local_clips_info():
    folder = request.form.get("local_folder")
    if not folder or not Path(folder).is_dir():
        return jsonify({"error": "Invalid folder"}), 400
    exts = {".mp4", ".mov", ".m4v", ".mkv", ".avi", ".webm"}
    clips = sorted(
        [p.name for p in Path(folder).iterdir() if p.suffix.lower() in exts and not p.name.startswith(".")]
    )
    return jsonify({"clips": clips, "count": len(clips)})


@app.route("/api/clip_preview/<job_id>/<path:clip_name>")
def api_clip_preview(job_id, clip_name):
    jdir = job_dir(job_id)
    saved_folder_file = jdir / "clips_folder.txt"
    if saved_folder_file.exists():
        folder = Path(saved_folder_file.read_text().strip())
        target = folder / clip_name
        if target.exists():
            return send_file(target, conditional=True)
    target = jdir / "source_clips" / clip_name
    if target.exists():
        return send_file(target, conditional=True)
    return jsonify({"error": "Clip not found"}), 404


@app.route("/api/clip_thumb/<job_id>/<path:clip_name>")
def api_clip_thumb(job_id, clip_name):
    import hashlib, subprocess
    from ffmpeg_utils import FFMPEG
    jdir = job_dir(job_id)
    target = None
    saved_folder_file = jdir / "clips_folder.txt"
    if saved_folder_file.exists():
        folder = Path(saved_folder_file.read_text().strip())
        cand = folder / clip_name
        if cand.exists():
            target = cand
    if target is None:
        cand = jdir / "source_clips" / clip_name
        if cand.exists():
            target = cand
    if target is None:
        return jsonify({"error": "Clip not found"}), 404

    t = float(request.args.get("t", 0.0))
    thumbs_dir = jdir / "thumbs"
    thumbs_dir.mkdir(exist_ok=True)
    key = hashlib.md5(f"{clip_name}_{t:.1f}".encode("utf-8")).hexdigest()[:12]
    thumb_path = thumbs_dir / f"{key}.jpg"

    if not thumb_path.exists():
        cmd = [
            FFMPEG, "-y",
            "-ss", str(max(0.0, t)),
            "-i", str(target),
            "-frames:v", "1",
            "-vf", "scale=240:-1",
            "-q:v", "5",
            "-loglevel", "error",
            str(thumb_path),
        ]
        subprocess.run(cmd, check=False)
        if not thumb_path.exists() and t > 0:
            # Fallback to 0s if timestamp was past end of video
            cmd[3] = "0"
            subprocess.run(cmd, check=False)

    if thumb_path.exists():
        return send_file(thumb_path, mimetype="image/jpeg")
    return jsonify({"error": "Failed to generate thumbnail"}), 500


@app.route("/api/folder_thumb")
def api_folder_thumb():
    import hashlib, subprocess
    from ffmpeg_utils import FFMPEG
    folder = request.args.get("folder")
    clip_name = request.args.get("clip")
    if not folder or not clip_name:
        return jsonify({"error": "Missing params"}), 400
    target = Path(folder) / clip_name
    if not target.exists():
        return jsonify({"error": "Clip not found"}), 404

    thumbs_dir = JOBS_DIR / "_folder_thumbs"
    thumbs_dir.mkdir(exist_ok=True)
    key = hashlib.md5(str(target.resolve()).encode("utf-8")).hexdigest()[:14]
    thumb_path = thumbs_dir / f"{key}.jpg"

    if not thumb_path.exists():
        cmd = [
            FFMPEG, "-y",
            "-ss", "0.2",
            "-i", str(target),
            "-frames:v", "1",
            "-vf", "scale=240:-1",
            "-q:v", "5",
            "-loglevel", "error",
            str(thumb_path),
        ]
        subprocess.run(cmd, check=False)

    if thumb_path.exists():
        return send_file(thumb_path, mimetype="image/jpeg")
    return jsonify({"error": "Failed to generate thumbnail"}), 500


@app.route("/api/export", methods=["POST"])
def api_export():
    job_id = request.form.get("job_id")
    if not job_id:
        return jsonify({"error": "Missing job_id"}), 400
    jdir = job_dir(job_id)

    built = jdir / "built_reel.mp4"
    if not built.exists():
        return jsonify({"error": "No built reel found — run Build first"}), 400

    formats = request.form.get("formats", "9:16,1:1,16:9").split(",")
    logo_pos = request.form.get("logo_pos", "bottom-right")
    container = request.form.get("container", "mp4").lower().strip()
    if container not in ("mp4", "mov"):
        container = "mp4"
    codec = request.form.get("codec", "h264").lower().strip()
    if codec not in ("h264", "h265"):
        codec = "h264"
    hdr = request.form.get("hdr") == "true"
    if hdr:
        codec = "h265"
    fps_val = float(request.form.get("fps", 30))
    proj_w = int(request.form.get("width", 1080))
    proj_h = int(request.form.get("height", 1920))

    logo_path = None
    logo_file = request.files.get("logo")
    if logo_file and logo_file.filename:
        logo_path = jdir / f"logo{Path(logo_file.filename).suffix or '.png'}"
        logo_file.save(logo_path)

    srt_path = None
    srt_file = request.files.get("srt")
    if srt_file and srt_file.filename:
        srt_path = jdir / "captions.srt"
        srt_file.save(srt_path)

    exports_dir = jdir / "exports"
    exports_dir.mkdir(exist_ok=True)

    results = []
    for fmt in formats:
        fmt = fmt.strip()
        if fmt == "project":
            w, h = proj_w, proj_h
            safe_fmt = f"{w}x{h}"
            label_fmt = f"{w}×{h}"
        elif fmt in FORMAT_DIMS:
            w, h = FORMAT_DIMS[fmt]
            safe_fmt = fmt.replace(":", "x")
            label_fmt = fmt
        else:
            continue
        out_suffix = "_hdr" if hdr else ""
        out_path = exports_dir / f"reel_{safe_fmt}_{codec}{out_suffix}.{container}"
        try:
            export_format(built, out_path, w, h, logo_path, logo_pos, srt_path, codec=codec, fps=fps_val, hdr=hdr)
        except Exception as e:
            return jsonify({"error": f"Export failed on {fmt}: {e}"}), 500
        hdr_tag = " · 10-bit HDR" if hdr else ""
        results.append({
            "format": f"{label_fmt} · {codec.upper()}{hdr_tag} · {container.upper()}",
            "url": f"/api/media/{job_id}/exports/{out_path.name}",
            "filename": out_path.name,
        })

    return jsonify({"job_id": job_id, "exports": results})


@app.route("/api/media/<job_id>/<path:filename>")
def api_media(job_id, filename):
    jdir = job_dir(job_id)
    path = (jdir / filename).resolve()
    if jdir.resolve() not in path.parents and path != jdir.resolve():
        return jsonify({"error": "Invalid path"}), 400
    if not path.exists():
        return jsonify({"error": "Not found"}), 404
    if path.suffix.lower() in {".edl", ".fcpxml"} or request.args.get("dl") == "1":
        return send_file(path, as_attachment=True, download_name=path.name)
    return send_file(path, conditional=True)


@app.route("/cleaner")
def cleaner():
    return render_template("cleaner.html")


@app.route("/api/clean", methods=["POST"])
def api_clean():
    job_id = uuid.uuid4().hex[:12]
    jdir = JOBS_DIR / job_id
    jdir.mkdir(exist_ok=True)

    video_file = request.files.get("video")
    if not video_file or not video_file.filename:
        return jsonify({"error": "No video uploaded"}), 400

    suffix = Path(video_file.filename).suffix or ".mp4"
    input_path = jdir / f"input{suffix}"
    video_file.save(input_path)

    model_size = request.form.get("model_size", "base")
    min_gap = float(request.form.get("min_gap", 0.4))
    padding = float(request.form.get("padding", 0.08))
    remove_fillers = request.form.get("remove_fillers", "true") == "true"

    output_path = jdir / "cleaned.mp4"
    edl_path = jdir / "timeline.edl"
    
    # We need the original filename for the EDL so DaVinci Resolve can link it
    original_filename = getattr(video_file, "filename", "input.mov")
    if not original_filename:
        original_filename = "input.mov"
        
    try:
        stats = clean_speech(
            str(input_path), str(output_path), str(edl_path),
            original_filename=original_filename,
            model_size=model_size,
            min_gap=min_gap,
            padding=padding,
            remove_fillers=remove_fillers,
        )
    except Exception as e:
        return jsonify({"error": f"Clean failed: {e}"}), 500

    # Save metadata so we can display it in the History tab
    import json
    from datetime import datetime
    meta = {
        "job_id": job_id,
        "filename": original_filename,
        "timestamp": datetime.now().isoformat(),
        "type": "Speech Cleaner"
    }
    (jdir / "meta.json").write_text(json.dumps(meta))

    return jsonify({
        "status": "success",
        "video_url": f"/api/media/{job_id}/cleaned.mp4",
        "edl_url": f"/api/media/{job_id}/timeline.edl",
        "stats": stats
    })


@app.route("/api/job_thumb/<job_id>")
def api_job_thumb(job_id):
    if "/" in job_id or "\\" in job_id or ".." in job_id:
        return "Invalid job ID", 400
    jdir = JOBS_DIR / job_id
    if not jdir.is_dir():
        return "Not found", 404

    thumb_path = jdir / "thumb.jpg"
    if thumb_path.exists():
        return send_file(thumb_path, mimetype="image/jpeg")

    vid_candidate = None
    if (jdir / "built_reel.mp4").exists():
        vid_candidate = jdir / "built_reel.mp4"
    else:
        ref_files = [p for p in jdir.glob("reference.*") if p.suffix.lower() in {".mp4", ".mov", ".m4v", ".webm"}]
        if ref_files:
            vid_candidate = ref_files[0]
        else:
            mp4s = [p for p in jdir.glob("*.mp4") if not p.name.startswith(".")]
            if mp4s:
                vid_candidate = mp4s[0]
            elif (jdir / "source_clips").is_dir():
                clips = [p for p in (jdir / "source_clips").iterdir() if p.suffix.lower() in {".mp4", ".mov", ".m4v"} and not p.name.startswith(".")]
                if clips:
                    vid_candidate = clips[0]

    if vid_candidate and vid_candidate.exists():
        try:
            import imageio_ffmpeg
            ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
            cmd = [
                ffmpeg_exe,
                "-y",
                "-ss", "0.8",
                "-i", str(vid_candidate),
                "-vframes", "1",
                "-vf", "scale=480:270:force_original_aspect_ratio=increase,crop=480:270",
                "-q:v", "3",
                str(thumb_path)
            ]
            subprocess.run(cmd, capture_output=True, check=True)
            if thumb_path.exists():
                return send_file(thumb_path, mimetype="image/jpeg")
        except Exception as err:
            print(f"[job_thumb] extraction error for {job_id}: {err}")

    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270" viewBox="0 0 480 270">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#1F2C38"/>
          <stop offset="100%" stop-color="#33475A"/>
        </linearGradient>
      </defs>
      <rect width="480" height="270" fill="url(#bg)"/>
      <circle cx="240" cy="115" r="34" fill="#4E6A83" opacity="0.6"/>
      <polygon points="232,101 258,115 232,129" fill="#E7EDF2"/>
      <text x="240" y="180" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="14" fill="#B7C6D3" font-weight="600" text-anchor="middle">{job_id}</text>
    </svg>'''
    return svg, 200, {"Content-Type": "image/svg+xml"}


@app.route("/history")
def history():
    return render_template("history.html")

@app.route("/api/jobs", methods=["GET"])
def list_jobs():
    import json
    import os
    from datetime import datetime
    jobs_data = []
    
    # Sort folders by modification time (newest first)
    for jdir in sorted(JOBS_DIR.iterdir(), key=os.path.getmtime, reverse=True):
        if not jdir.is_dir() or jdir.name.startswith(".") or jdir.name.startswith("_"):
            continue
        
        meta_path = jdir / "meta.json"
        meta = {}
        if meta_path.exists():
            try:
                meta = json.loads(meta_path.read_text())
            except:
                pass
        
        job_id = meta.get("job_id") or jdir.name
        job_name = meta.get("job_name") or meta.get("filename") or job_id
        timestamp = meta.get("timestamp") or datetime.fromtimestamp(jdir.stat().st_mtime).isoformat()
        
        # Calculate total size of the job folder
        total_size = sum(f.stat().st_size for f in jdir.rglob('*') if f.is_file())
        
        # Calculate duration & shots
        dur_sec = 0.0
        shot_count = 0
        if (jdir / "shot_plan.json").exists():
            try:
                plan = json.loads((jdir / "shot_plan.json").read_text())
                dur_sec = sum(float(s.get("duration", 0)) for s in plan)
                shot_count = len(plan)
            except:
                pass
        elif (jdir / "rhythm.json").exists():
            try:
                rhythm = json.loads((jdir / "rhythm.json").read_text())
                dur_sec = float(rhythm.get("duration", 0))
                shot_count = len(rhythm.get("shots", []))
            except:
                pass

        mins = int(dur_sec // 60)
        secs = int(dur_sec % 60)
        formatted_dur = f"{mins:02d}:{secs:02d}"

        status = "Rendered" if (jdir / "built_reel.mp4").exists() else ("Ready" if (jdir / "shot_plan.json").exists() else "Draft")

        jobs_data.append({
            "job_id": job_id,
            "job_name": job_name,
            "timestamp": timestamp,
            "size_bytes": total_size,
            "duration": dur_sec,
            "formatted_duration": formatted_dur,
            "shot_count": shot_count,
            "status": status,
            "thumb_url": f"/api/job_thumb/{job_id}",
            "has_built_video": (jdir / "built_reel.mp4").exists(),
        })
    
    import shutil
    disk_free = shutil.disk_usage("/").free
    
    return jsonify({"jobs": jobs_data, "disk_free": disk_free})

@app.route("/api/jobs/open/<job_id>", methods=["POST"])
def open_job_folder(job_id):
    if "/" in job_id or "\\" in job_id or ".." in job_id:
        return jsonify({"error": "Invalid job ID"}), 400
    
    jdir = JOBS_DIR / job_id
    if jdir.exists() and jdir.is_dir():
        import subprocess
        subprocess.run(["open", str(jdir)])
        return jsonify({"status": "success"})
    return jsonify({"error": "Folder not found"}), 404

@app.route("/api/jobs/delete", methods=["POST"])
def delete_jobs():
    import shutil
    job_ids = request.json.get("job_ids", [])
    deleted = 0
    for jid in job_ids:
        # Prevent path traversal security issues
        if "/" in jid or "\\" in jid or ".." in jid:
            continue
        if jid == "bfdaa1055f29":
            continue
        jdir = JOBS_DIR / jid
        if jdir.exists() and jdir.is_dir():
            shutil.rmtree(jdir)
            deleted += 1
    return jsonify({"status": "success", "deleted": deleted})


@app.route("/api/sort_media", methods=["POST"])
def api_sort_media():
    folder = request.form.get("folder")
    categories = request.form.get("categories", "")
    force = request.form.get("force") == "true"
    cats = [c.strip() for c in categories.split(",") if c.strip()]
    if not folder or not cats:
        return jsonify({"error": "Missing folder or categories"}), 400

    from sort_media import sort_folder, check_existing

    # Warn if category folders already have files in them
    if not force:
        check = check_existing(folder, cats)
        if check["existing"]:
            return jsonify({"warning": True, "existing": check["existing"]}), 200

    prog_file = JOBS_DIR / "sort_progress.json"

    # Clear stale progress file so the UI doesn't pick up the old "Done!" status
    if prog_file.exists():
        prog_file.unlink()

    import threading

    def run_sort():
        try:
            sort_folder(folder, cats, str(prog_file))
        except Exception as e:
            with open(prog_file, "w") as f:
                json.dump({"error": str(e)}, f)

    threading.Thread(target=run_sort).start()
    return jsonify({"status": "started"})


@app.route("/api/sort_progress")
def api_sort_progress():
    prog_file = JOBS_DIR / "sort_progress.json"
    if prog_file.exists():
        try:
            with open(prog_file, "r") as f:
                return jsonify(json.load(f))
        except:
            pass
    return jsonify({"total": 0, "current": 0, "phase": ""})


@app.route("/api/fonts", methods=["GET"])
def api_list_fonts():
    """Return all uploaded custom fonts plus installed macOS fonts."""
    custom_list = []
    if FONTS_DIR.exists():
        for fp in sorted(FONTS_DIR.iterdir()):
            if fp.suffix.lower() in {".ttf", ".otf", ".ttc", ".woff", ".woff2"} and not fp.name.startswith("."):
                family = f"Custom: {fp.stem}"
                custom_list.append({
                    "name": fp.stem,
                    "family": family,
                    "filename": fp.name,
                    "url": f"/api/custom_font/{fp.name}",
                })

    os_dirs = [
        Path.home() / "Library" / "Fonts",
        Path("/Library/Fonts"),
        Path("/System/Library/Fonts/Supplemental"),
        Path("/System/Library/Fonts"),
    ]
    seen = set()
    os_fonts = []
    for d in os_dirs:
        if not d.exists():
            continue
        try:
            for fp in sorted(d.iterdir()):
                if fp.suffix.lower() in {".ttf", ".otf", ".ttc"} and not fp.name.startswith("."):
                    stem = fp.stem
                    if stem not in seen:
                        seen.add(stem)
                        os_fonts.append(stem)
        except Exception:
            pass

    return jsonify({
        "custom_fonts": custom_list,
        "os_fonts": sorted(os_fonts, key=lambda s: s.lower()),
    })


@app.route("/api/upload_font", methods=["POST"])
def api_upload_font():
    f = request.files.get("font_file")
    if not f or not f.filename:
        return jsonify({"error": "No font file selected"}), 400
    ext = Path(f.filename).suffix.lower()
    if ext not in {".ttf", ".otf", ".ttc", ".woff", ".woff2"}:
        return jsonify({"error": "Unsupported font format. Use .ttf, .otf, .ttc, or .woff"}), 400
    safe_stem = secure_filename(Path(f.filename).stem) or "CustomFont"
    dest = FONTS_DIR / f"{safe_stem}{ext}"
    f.save(dest)
    family = f"Custom: {safe_stem}"
    return jsonify({
        "name": safe_stem,
        "family": family,
        "filename": dest.name,
        "url": f"/api/custom_font/{dest.name}",
    })


@app.route("/api/custom_font/<filename>")
def api_serve_custom_font(filename):
    safe = secure_filename(filename)
    target = FONTS_DIR / safe
    if not target.exists():
        return jsonify({"error": "Font not found"}), 404
    return send_file(target)


@app.route("/api/quit_app", methods=["POST"])
def api_quit_app():
    import subprocess
    subprocess.Popen(["killall", "ReelPipelineRunner", "SwiftReelRunner"], stderr=subprocess.DEVNULL)
    return jsonify({"status": "quitting"})


if __name__ == "__main__":
    print("\nSwift Reel running at http://localhost:5050\n")
    app.run(host="127.0.0.1", port=5050, debug=False, threaded=True)
