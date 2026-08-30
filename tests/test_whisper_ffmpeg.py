import os
import subprocess
from pathlib import Path

# Simulate app.py PATH modification
BASE_DIR = Path(__file__).parent
os.environ["PATH"] = f"{BASE_DIR / 'bin'}:{os.environ.get('PATH', '')}"

# Simulate what Whisper does under the hood
try:
    result = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True, check=True)
    print("SUCCESS: Found ffmpeg via PATH!")
    print(result.stdout.split('\n')[0])
except Exception as e:
    print(f"FAILED: {e}")
