#!/bin/bash
cd "/Users/threedwizard/Desktop/AI Agent/Digital Agency/AI Editor/reel_pipeline"

# Check if dependencies are installed
if ! python3 -c "import flask, whisper, imageio_ffmpeg, torch, transformers" 2>/dev/null; then
    osascript -e 'display dialog "Missing required AI tools or FFmpeg. Click OK to download and install them automatically." buttons {"Cancel", "OK"} default button "OK"'
    if [ $? -eq 0 ]; then
        pip3 install -r requirements.txt
    else
        exit 1
    fi
fi

lsof -ti:5050 | xargs kill -9 2>/dev/null || true
nohup python3 app.py > /tmp/reel_pipeline.log 2>&1 &
sleep 4
open http://127.0.0.1:5050
