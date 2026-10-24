#!/bin/bash
# Linux Startup Script for Reel Pipeline

# Move into the directory where this script is located
cd "$(dirname "$0")"

# Check if dependencies are installed
if ! python3 -c "import flask, whisper, imageio_ffmpeg, torch, transformers" 2>/dev/null; then
    echo "Missing required AI tools, libraries, or FFmpeg."
    read -p "Do you want to download and install them automatically now? (y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "Installing dependencies..."
        pip3 install -r requirements.txt
    else
        echo "Cannot start without required tools. Exiting."
        exit 1
    fi
fi

# Kill any existing server on port 5050
fuser -k 5050/tcp 2>/dev/null || true

# Start the Flask server in the background
nohup python3 app.py > /tmp/reel_pipeline.log 2>&1 &

# Wait for it to boot
sleep 4

# Open the browser (cross-platform Linux/Mac fallback)
if command -v xdg-open &> /dev/null; then
    xdg-open http://127.0.0.1:5050
elif command -v open &> /dev/null; then
    open http://127.0.0.1:5050
else
    echo "Server running! Please manually open http://127.0.0.1:5050 in your browser."
fi
