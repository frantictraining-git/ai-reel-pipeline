import subprocess
import re

ffmpeg_path = "/Users/threedwizard/Desktop/AI Agent/Digital Agency/AI Editor/reel_pipeline/bin/ffmpeg"
video_path = "/Users/threedwizard/Desktop/AI Agent/Digital Agency/AI Editor/reel_pipeline/jobs/f60a06ad202a/input.mov"

result = subprocess.run([ffmpeg_path, "-i", video_path], capture_output=True, text=True)
match = re.search(r"Video:.*?,.*?(\d{2,5})x(\d{2,5})", result.stderr)
if match:
    print("Res:", match.group(1), match.group(2))
else:
    print("Not found")
