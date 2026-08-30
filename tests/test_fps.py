import subprocess
import re

ffmpeg_path = "/Users/threedwizard/Desktop/AI Agent/Digital Agency/AI Editor/reel_pipeline/bin/ffmpeg"
video_path = "/Users/threedwizard/Desktop/AI Agent/Digital Agency/AI Editor/reel_pipeline/jobs/f60a06ad202a/input.mov"

result = subprocess.run([ffmpeg_path, "-i", video_path], capture_output=True, text=True)
match = re.search(r"(\d+(?:\.\d+)?)\s*fps", result.stderr)
if match:
    print("FPS:", float(match.group(1)))
else:
    print("Not found")
