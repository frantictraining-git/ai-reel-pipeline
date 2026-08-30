import os
import shutil
import time
from pathlib import Path

from tag_content import extract_frame, classify_frame, _load_model

def sort_folder(folder_path: str, categories: list, progress_file: str = None):
    folder = Path(folder_path)
    if not folder.is_dir():
        raise ValueError(f"Not a directory: {folder_path}")
        
    valid_exts = {".mov", ".mp4", ".m4v", ".mxf"}
    videos = [f for f in folder.iterdir() if f.suffix.lower() in valid_exts and f.is_file()]
    
    if not videos:
        return {"status": "no videos found"}
        
    _load_model()  # Ensure CLIP is loaded
    
    total = len(videos)
    import json
    
    def update_progress(current, status="working"):
        if progress_file:
            with open(progress_file, "w") as f:
                json.dump({"total": total, "current": current, "phase": status}, f)
                
    update_progress(0, "Sorting media...")
    
    # Create category folders beforehand
    for cat in categories:
        (folder / cat).mkdir(exist_ok=True)
        
    import tempfile
    
    sorted_count = 0
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_dir = Path(tmpdir)
        for i, vid in enumerate(videos):
            update_progress(i, f"Analyzing {vid.name}...")
            
            frame_out = tmp_dir / f"frame_{i}.jpg"
            # Extract a frame at 0.5s (or fallback to 0s if clip is tiny)
            try:
                extract_frame(str(vid), 0.5, frame_out)
                if not frame_out.exists():
                    extract_frame(str(vid), 0.0, frame_out)
            except Exception:
                pass
                
            if frame_out.exists():
                try:
                    scores = classify_frame(frame_out, categories)
                    # Find highest scoring category
                    best_cat = max(scores, key=scores.get)
                    
                    # Move the file
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
                    print(f"Error classifying {vid}: {e}")
                    
    update_progress(total, "Done!")
    return {"sorted": sorted_count, "total": total}
