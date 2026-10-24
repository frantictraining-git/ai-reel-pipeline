# Reel Pipeline - Tech Stack & AI Models

Here are all the core tools, AI models, and libraries powering the app under the hood:

### 1. **OpenAI Whisper (Speech Cleaner)**
- **What it is:** A state-of-the-art automatic speech recognition (ASR) model by OpenAI.
- **How it's used:** Used in the **Speech Cleaner** tab to listen to your raw audio, transcribe the words, and generate highly accurate millisecond-level timestamps for every single spoken word. This is what allows the app to cleanly slice out filler words ("um," "uh") and dead air without you having to manually find them on the timeline. It runs 100% locally on your Mac.

### 2. **OpenAI CLIP (Media Sorter & Beat Sync Smart-Match)**
- **What it is:** A vision-language model trained by OpenAI that understands both images and text natively (specifically `clip-vit-base-patch32` from Hugging Face).
- **How it's used:** 
  - In the **Media Sorter**, it "looks" at a frame of each raw video, compares it against the category words you typed (e.g., "food, kitchen, exterior"), and categorizes the video visually without needing any manual tagging.
  - In the **Beat Sync Editor**, it allows "Smart-Match by Content"—so instead of just slapping clips onto the beat alphabetically, the AI figures out if a specific cut in the reference video is a shot of "food" or a "person", and actively searches your raw footage for a matching "food" or "person" clip to drop into that exact slot.

### 3. **PySceneDetect (Beat Sync Editor)**
- **What it is:** An open-source Python tool built on top of OpenCV.
- **How it's used:** Used in the **Beat Sync Editor** to analyze the reference video. It reads the pixels frame-by-frame and detects the exact millisecond a "cut" occurs in the video (called Content Detection). It maps out the rhythm (the "beat") of the reference video so the app knows exactly how long each of your raw clips needs to be.

### 4. **FFmpeg & FFprobe (The Engine)**
- **What it is:** The industry-standard command-line tool for video and audio processing. 
- **How it's used:** It's the silent workhorse behind everything. The app uses it to rip audio for Whisper, extract frames for CLIP, scale and crop your final vertical videos, encode the final MP4 files, extract timecodes for DaVinci Resolve, and stitch everything together smoothly.

### 5. **Apple MLX / PyTorch (Hardware Acceleration)**
- **What it is:** The machine learning framework.
- **How it's used:** When CLIP runs on your Mac, it explicitly hooks into `torch.backends.mps` (Metal Performance Shaders) so that the vision AI runs on your Apple Silicon GPU instead of your CPU, making the sorting process significantly faster.

### 6. **FCPXML Generation (DaVinci Resolve Integration)**
- **What it is:** Final Cut Pro XML format (version 1.9).
- **How it's used:** Rather than locking you into the AI's final cut, the app programmatically writes this XML file from scratch, converting millisecond timestamps into exact SMPTE timecodes. This allows DaVinci Resolve to instantly rebuild the AI's edit on a real timeline linked directly to your original raw footage, so you can manually tweak the edit, add color grades, or swap out clips. 

Everything is wired together with **Flask** (the Python web server framework) and vanilla HTML/JS for the user interface.
