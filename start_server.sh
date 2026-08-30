#!/bin/bash
lsof -ti:5050 | xargs kill -9 2>/dev/null || true
cd "/Users/threedwizard/Desktop/AI Agent/Digital Agency/AI Editor/reel_pipeline"
nohup python3 app.py > /tmp/reel_pipeline.log 2>&1 &
sleep 4
open http://127.0.0.1:5050
