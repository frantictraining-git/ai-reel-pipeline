import math

def frames_to_tc(frames, fps):
    fps = int(round(fps))
    if fps == 0: fps = 24
    h = int(frames // (fps * 3600))
    m = int((frames // (fps * 60)) % 60)
    s = int((frames // fps) % 60)
    f = int(frames % fps)
    return f"{h:02d}:{m:02d}:{s:02d}:{f:02d}"

def generate_edl(video_path, segments, fps):
    import os
    filename = os.path.basename(video_path)
    
    edl = "TITLE: AI Cleaned\nFCM: NON-DROP FRAME\n\n"
    timeline_frame = 0
    
    for i, (start_sec, end_sec) in enumerate(segments):
        start_f = int(start_sec * fps)
        end_f = int(end_sec * fps)
        dur_f = end_f - start_f
        
        src_in = frames_to_tc(start_f, fps)
        src_out = frames_to_tc(end_f, fps)
        rec_in = frames_to_tc(timeline_frame, fps)
        rec_out = frames_to_tc(timeline_frame + dur_f, fps)
        
        # B means both Audio and Video
        edl += f"{i+1:03d}  AX       B     C        {src_in} {src_out} {rec_in} {rec_out}\n"
        edl += f"* FROM CLIP NAME: {filename}\n\n"
        
        timeline_frame += dur_f
        
    return edl

print(generate_edl("input.mov", [(0.0, 5.2), (7.0, 10.5)], 24.0))
