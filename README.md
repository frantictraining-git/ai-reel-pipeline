# Reel Pipeline & Speech Cleaner

A fully autonomous, 100% offline, AI-powered video editing toolkit. Built to process high-end footage (including ProRes and HDR) locally on macOS without relying on cloud APIs or paying server costs.

## Core Features
- **Whisper AI Speech Cleaner:** Transcribes video word-by-word, automatically slicing out dead air and filler words ("um", "uh", "like") using OpenAI's Whisper models.
- **DaVinci Resolve Integration:** Generates an industry-standard Edit Decision List (`.edl`) alongside the video. Import this into Resolve or Premiere to get a fully populated timeline of the AI's cuts directly on your raw, uncompressed footage.
- **Audio Pop Prevention:** Automatically injects a 30-millisecond audio cross-fade (`afade`) at every cut boundary to prevent "tock" sounds and speaker snap.
- **Fully Self-Contained:** Whisper AI models and FFmpeg binaries are stored locally within the project directory. You can run this app entirely offline, or move it to a USB drive, and it will never break due to cache wipes or internet dropouts.
- **Reel Pipeline:** Auto-crops landscape videos into portrait 9:16 format for social media.

## How to Run
1. Open your terminal.
2. Navigate to the project folder.
3. Run the server:
   ```bash
   python3 app.py
   ```
4. Open your web browser and go to: `http://127.0.0.1:5050`

## Architecture
- **Backend:** Python 3.9 / Flask
- **AI Engine:** `openai-whisper`
- **Video Processing:** `ffmpeg` (via `imageio-ffmpeg` bundled inside the local `/bin` directory).
- **Models:** Stored permanently in `./models/`

## Troubleshooting "Media Offline" in DaVinci Resolve
If DaVinci Resolve says your media is offline when importing the `.edl` file:
1. Ensure your original raw video file is imported into the Media Pool *before* importing the `.edl`.
2. Right-click the raw video in Resolve -> **Clip Attributes...** -> **Timecode**. Change the "Current Frame" / "Start Timecode" to exactly `00:00:00:00`. (Professional cameras bake time-of-day timecodes into the file, which conflicts with the AI's 0-second start time).
