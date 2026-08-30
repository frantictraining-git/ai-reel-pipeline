import os
import time
from pathlib import Path

# Setup PATH exactly as app.py does
BASE_DIR = Path(__file__).parent
os.environ["PATH"] = f"{BASE_DIR / 'bin'}:{os.environ.get('PATH', '')}"

from speech_cleaner import clean_speech

input_video = "/Users/threedwizard/Desktop/AI Agent/Digital Agency/AI Editor/reel_pipeline/jobs/f60a06ad202a/input.mov"
output_video = str(BASE_DIR / "jobs/f60a06ad202a/cleaned_test.mp4")

print(f"Testing full pipeline on {input_video}...")
start = time.time()

try:
    stats = clean_speech(
        video_path=input_video,
        output_path=output_video,
        model_size="base", # Use base model we just verified
        min_gap=0.4,
        padding=0.08,
        remove_fillers=True
    )
    print("SUCCESS! Pipeline finished.")
    print("Stats:", stats)
    print(f"Time taken: {time.time() - start:.2f}s")
except Exception as e:
    print(f"FAILED: {e}")
