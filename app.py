#!/usr/bin/env python3
"""
app.py — local web UI for the reel pipeline.

Run this, then open http://localhost:5050 in your browser. Everything runs
on your machine — nothing you upload here leaves your computer.

    python3 app.py
"""

import json
import shutil
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


@app.route("/api/analyze", methods=["POST"])
def api_analyze():
    job_id = request.form.get("job_id") or uuid.uuid4().hex[:12]
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
    Returns None if no clips were provided either way."""
    local_folder = request.form.get("local_folder")
    if local_folder and Path(local_folder).is_dir():
        return Path(local_folder)

    clips_dir = jdir / "source_clips"
    if clips_dir.exists():
        shutil.rmtree(clips_dir)
    clips_dir.mkdir()

    clip_files = request.files.getlist("clips")
    if not clip_files:
        return None

    for i, f in enumerate(clip_files):
        if not f.filename:
            continue
        suffix = Path(f.filename).suffix or ".mp4"
        secure_name = f"{secure_filename(Path(f.filename).stem)}{suffix}"
        f.save(clips_dir / secure_name)

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

    output_path = jdir / "built_reel.mp4"
    try:
        build(str(rhythm_path), str(clips_dir), str(output_path), width, height, fps, keep_audio,
              inpoints, clip_tags, progress_file=str(jdir / 'progress.json'))
    except Exception as e:
        return jsonify({"error": f"Build failed: {e}"}), 500

    return jsonify({
        "job_id": job_id,
        "video_url": f"/api/media/{job_id}/built_reel.mp4",
    })


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
        if fmt not in FORMAT_DIMS:
            continue
        w, h = FORMAT_DIMS[fmt]
        safe_fmt = fmt.replace(":", "x")
        out_path = exports_dir / f"reel_{safe_fmt}.mp4"
        try:
            export_format(built, out_path, w, h, logo_path, logo_pos, srt_path)
        except Exception as e:
            return jsonify({"error": f"Export failed on {fmt}: {e}"}), 500
        results.append({
            "format": fmt,
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
        if not jdir.is_dir(): continue
        
        meta_path = jdir / "meta.json"
        if meta_path.exists():
            try:
                meta = json.loads(meta_path.read_text())
            except:
                meta = {"job_id": jdir.name, "filename": "Unknown File", "timestamp": datetime.fromtimestamp(jdir.stat().st_mtime).isoformat()}
        else:
            meta = {"job_id": jdir.name, "filename": "Unknown File (Old)", "timestamp": datetime.fromtimestamp(jdir.stat().st_mtime).isoformat()}
        
        # Calculate total size of the job folder
        total_size = sum(f.stat().st_size for f in jdir.rglob('*') if f.is_file())
        meta["size_bytes"] = total_size

        # Find the video file
        mp4_files = list(jdir.glob("*.mp4"))
        meta["video_file"] = mp4_files[0].name if mp4_files else "cleaned.mp4"

        jobs_data.append(meta)
    
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
        jdir = JOBS_DIR / jid
        if jdir.exists() and jdir.is_dir():
            shutil.rmtree(jdir)
            deleted += 1
    return jsonify({"status": "success", "deleted": deleted})


if __name__ == "__main__":
    print("\nReel Pipeline running at http://localhost:5050\n")
    app.run(host="127.0.0.1", port=5050, debug=False, threaded=True)
