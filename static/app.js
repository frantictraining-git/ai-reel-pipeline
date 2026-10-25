let jobId = null;
let referenceFile = null;
let referenceUrl = null;
let clipFiles = [];
let localFolderPath = null;
let localClipNames = [];
let logoFile = null;
let srtFile = null;
let mediaViewMode = "thumb"; // "thumb" | "list"

// Project Settings (Video Dimension & Frame Rate)
let projectWidth = 1080;
let projectHeight = 1920;
let projectFps = 30;

// Interactive Timeline State
let currentRhythm = null;
let shotPlan = [];
let availableClips = [];
let selectedShotIdx = -1;
let timelineDirty = false;
const localThumbCache = {};

// Grading / 3D LUT / Custom Audio Track State
let lutFile = null;
let clearLutFlag = false;
let customAudioFile = null;
let customAudioUrl = null;
let clearCustomAudioFlag = false;
let audioStartOffset = 0.0;
let audioDurationSec = 0.0; // 0 = auto match video length
let audioVolumePct = 100;
let activeInspectorSubtab = "trim"; // "trim" | "color"
let copiedGradeClipboard = null;
let isPlayingSequence = false;
let seqPlaybackStartTime = 0;

// 10-Step Undo / Redo History Stacks
const MAX_HISTORY_STEPS = 10;
let undoStack = [];
let redoStack = [];

function defaultGrade() {
  return {
    brightness: 0,
    contrast: 0,
    saturation: 0,
    temperature: 0,
    tint: 0,
    whites: 0,
    blacks: 0,
    vignette: 0,
    curve: "none",
    fade_in: 0.0,
    fade_out: 0.0,
  };
}

function ensureShotGrade(shot) {
  if (!shot) return defaultGrade();
  if (!shot.grade || typeof shot.grade !== "object") {
    shot.grade = defaultGrade();
  } else {
    const def = defaultGrade();
    Object.keys(def).forEach((k) => {
      if (shot.grade[k] === undefined) shot.grade[k] = def[k];
    });
  }
  return shot.grade;
}

function defaultTextOverlay(yPos = 82) {
  return {
    content: "",
    font: "Arial Bold",
    size: 56,
    color: "#FFFFFF",
    bg_style: "plain",
    bg_color: "#1F2C38",
    x: 50,
    y: yPos,
  };
}

function ensureShotTexts(shot) {
  if (!shot) return [];
  if (!shot.texts || !Array.isArray(shot.texts)) {
    if (shot.text && typeof shot.text === "object" && (shot.text.content || "").trim()) {
      shot.texts = [shot.text];
    } else {
      shot.texts = [];
    }
  }
  if (shot.texts.length > 0) {
    shot.text = shot.texts[0];
  }
  return shot.texts;
}

function ensureShotText(shot) {
  const texts = ensureShotTexts(shot);
  if (!texts.length) {
    const d = defaultTextOverlay();
    texts.push(d);
    shot.text = d;
  }
  return texts[0];
}

let activeTextItemIdx = 0;

const $ = (id) => document.getElementById(id);

function fmtTime(s) {
  return Number(s || 0).toFixed(2) + "s";
}

function setStatus(el, msg, kind) {
  if (!el) return;
  el.textContent = msg;
  el.className = "status" + (kind ? " " + kind : "");
  el.classList.remove("hidden");
}

function enableStep(stepEl) {
  if (stepEl) stepEl.classList.remove("disabled");
}

// ---------- Project Settings Modal (Dimension & Frame Rate) ----------
const settingsBackdrop = $("settings-modal-backdrop");
const btnOpenSettings = $("btn-open-settings");
const btnCloseSettings = $("btn-close-settings");
const btnSaveSettings = $("btn-save-settings");
const selDimension = $("setting-dimension");
const selFps = $("setting-fps");
const monitorInfo = $("monitor-info");
const reframeViewport = $("reframe-viewport");

function updateProjectSettingsUI() {
  if (monitorInfo) {
    monitorInfo.textContent = `${projectWidth} × ${projectHeight} · ${projectFps} FPS ⚙`;
  }
  if (reframeViewport) {
    reframeViewport.style.aspectRatio = `${projectWidth} / ${projectHeight}`;
    if (projectWidth > projectHeight) {
      reframeViewport.style.width = "92%";
      reframeViewport.style.height = "auto";
    } else {
      reframeViewport.style.height = "calc(100% - 42px)";
      reframeViewport.style.width = "auto";
    }
  }
}

function openSettingsModal() {
  if (!settingsBackdrop) return;
  if (selDimension) selDimension.value = `${projectWidth}x${projectHeight}`;
  if (selFps) selFps.value = String(projectFps);
  settingsBackdrop.classList.remove("hidden");
}

function closeSettingsModal() {
  if (settingsBackdrop) settingsBackdrop.classList.add("hidden");
}

if (btnOpenSettings) btnOpenSettings.addEventListener("click", openSettingsModal);
if (monitorInfo) monitorInfo.addEventListener("click", openSettingsModal);
if (btnCloseSettings) btnCloseSettings.addEventListener("click", closeSettingsModal);
if (settingsBackdrop) {
  settingsBackdrop.addEventListener("click", (e) => {
    if (e.target === settingsBackdrop) closeSettingsModal();
  });
}
if (btnSaveSettings) {
  btnSaveSettings.addEventListener("click", () => {
    if (selDimension && selDimension.value) {
      const [w, h] = selDimension.value.split("x").map((n) => parseInt(n, 10));
      if (w && h) {
        projectWidth = w;
        projectHeight = h;
      }
    }
    if (selFps && selFps.value) {
      projectFps = parseFloat(selFps.value) || 30;
    }
    updateProjectSettingsUI();
    closeSettingsModal();
    markTimelineDirty();
  });
}

// ---------- Single-Page App Tab Switching ----------
const mainTabNav = $("main-tab-nav");
const tabViews = {
  beatsync: $("tab-view-beatsync"),
  cleaner: $("tab-view-cleaner"),
  sorter: $("tab-view-sorter"),
  history: $("tab-view-history"),
};

function switchMainTab(tabName) {
  Object.keys(tabViews).forEach((k) => {
    if (tabViews[k]) {
      tabViews[k].classList.toggle("hidden", k !== tabName);
    }
  });
  if (mainTabNav) {
    Array.from(mainTabNav.querySelectorAll(".tab-link")).forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === tabName);
    });
  }
  if (tabName === "history") {
    loadHistoryJobs();
  }
}

if (mainTabNav) {
  mainTabNav.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab-link");
    if (!btn || !btn.dataset.tab) return;
    switchMainTab(btn.dataset.tab);
  });
}

// Monitor Dual Decks for 0ms Seamless Multi-Shot Cuts
const tabProgram = $("tab-program");
const tabSource = $("tab-source");
const monitorEmpty = $("monitor-empty");
const buildResult = $("build-result");
const builtPreview = $("built-preview");
const sourcePreviewWrap = $("source-preview-wrap");
const sourcePreview = $("source-preview");
const sourcePreviewB = $("source-preview-b");
let activeDeck = "A"; // "A" | "B"

function getVisibleVideoDeck() {
  return activeDeck === "B" && sourcePreviewB ? sourcePreviewB : sourcePreview;
}

function getStandbyVideoDeck() {
  return activeDeck === "B" ? sourcePreview : sourcePreviewB;
}

function switchActiveVideoDeck() {
  if (!sourcePreviewB) return;
  if (activeDeck === "A") {
    activeDeck = "B";
    sourcePreviewB.classList.add("deck-active");
    sourcePreviewB.classList.remove("deck-standby");
    sourcePreview.classList.add("deck-standby");
    sourcePreview.classList.remove("deck-active");
  } else {
    activeDeck = "A";
    sourcePreview.classList.add("deck-active");
    sourcePreview.classList.remove("deck-standby");
    sourcePreviewB.classList.add("deck-standby");
    sourcePreviewB.classList.remove("deck-active");
  }
}

const fadePreviewLayer = $("fade-preview-layer");
const liveAudioPlayer = $("live-audio-player");
const btnSeqPlay = $("btn-seq-play");
const btnSrcPlay = $("btn-src-play");
const srcSeekSlider = $("src-seek-slider");
const srcTimeReadout = $("src-time-readout");

function showMonitorTab(which) {
  if (which === "source") {
    tabSource.classList.add("active");
    tabProgram.classList.remove("active");
    buildResult.classList.add("hidden");
    if (builtPreview) builtPreview.pause();
    const curDeck = getVisibleVideoDeck();
    if (curDeck && curDeck.getAttribute("src")) {
      monitorEmpty.classList.add("hidden");
      sourcePreviewWrap.classList.remove("hidden");
      updateProjectSettingsUI();
    } else {
      sourcePreviewWrap.classList.add("hidden");
      monitorEmpty.classList.remove("hidden");
    }
  } else {
    stopSequencePlayback();
    if (sourcePreview) sourcePreview.pause();
    if (sourcePreviewB) sourcePreviewB.pause();
    tabProgram.classList.add("active");
    tabSource.classList.remove("active");
    sourcePreviewWrap.classList.add("hidden");
    if (builtPreview.getAttribute("src")) {
      monitorEmpty.classList.add("hidden");
      buildResult.classList.remove("hidden");
    } else {
      buildResult.classList.add("hidden");
      monitorEmpty.classList.remove("hidden");
    }
  }
}

if (tabProgram) tabProgram.addEventListener("click", () => showMonitorTab("program"));
if (tabSource) tabSource.addEventListener("click", () => showMonitorTab("source"));

function getActiveAudioUrl() {
  if (customAudioFile) {
    if (!customAudioFile._blobUrl) customAudioFile._blobUrl = URL.createObjectURL(customAudioFile);
    return customAudioFile._blobUrl;
  }
  if (!clearCustomAudioFlag && customAudioUrl) {
    return customAudioUrl;
  }
  const overlayCb = $("overlay-audio");
  if (!overlayCb || overlayCb.checked) {
    if (referenceFile) {
      if (!referenceFile._blobUrl) referenceFile._blobUrl = URL.createObjectURL(referenceFile);
      return referenceFile._blobUrl;
    }
    if (referenceUrl) return referenceUrl;
  }
  return null;
}

function syncLiveAudioVolume() {
  if (!liveAudioPlayer) return;
  liveAudioPlayer.volume = Math.max(0, Math.min(1, (audioVolumePct || 100) / 100.0));
}

// ---------- Per-Clip Reverse Helpers ----------
// Browsers can't play <video> backwards natively, so reversed shots preview from a
// server-cached, full-resolution stream of the trimmed window (starts at 0.0s = start of reversed clip).
// Source files on SSD are never modified.
function isShotReversedPreview(shot) {
  return Boolean(shot && shot.reverse && shot.clip && !shot.clip.includes("(awaiting clips)"));
}

function getShotDeckIn(shot) {
  if (!shot) return 0;
  // If previewing reversed clip, the reversed stream starts at 0.0s
  return isShotReversedPreview(shot) ? 0 : Number(shot.in_point || 0);
}

function resolveShotSourceUrl(shot) {
  if (!shot) return null;
  if (isShotReversedPreview(shot) && shot.clip && !shot.clip.includes("(awaiting clips)")) {
    const inPt = Number(shot.in_point || 0).toFixed(2);
    const dur = Number(shot.duration || 1.0).toFixed(2);
    const jId = jobId || "local";
    let url = `/api/clip_reversed/${jId}/${encodeURIComponent(shot.clip)}?in=${inPt}&dur=${dur}`;
    if (localFolderPath) {
      url += `&folder=${encodeURIComponent(localFolderPath)}`;
    }
    return url;
  }
  return resolveClipSourceUrl(shot.clip);
}

function updateLiveFadeOverlay(currentClipTime, shot) {
  if (!fadePreviewLayer) return;
  if (!shot) {
    fadePreviewLayer.style.opacity = "0";
    return;
  }
  const g = ensureShotGrade(shot);
  const inPt = getShotDeckIn(shot);
  const dur = Math.max(0.15, Number(shot.duration || 1.0));
  const elapsed = Math.max(0, currentClipTime - inPt);
  const fadeIn = Number(g.fade_in || 0);
  const fadeOut = Number(g.fade_out || 0);

  let blackOpacity = 0;
  if (fadeIn > 0.02 && elapsed < fadeIn) {
    blackOpacity = Math.max(blackOpacity, 1 - elapsed / fadeIn);
  }
  if (fadeOut > 0.02 && elapsed > dur - fadeOut) {
    const rem = Math.max(0, dur - elapsed);
    blackOpacity = Math.max(blackOpacity, 1 - rem / fadeOut);
  }
  fadePreviewLayer.style.opacity = Math.max(0, Math.min(1, blackOpacity)).toFixed(2);
}

function stopSequencePlayback() {
  isPlayingSequence = false;
  stopPlayheadAnimLoop();
  if (btnSeqPlay) {
    btnSeqPlay.textContent = "▶ Play Sequence";
  }
  if (liveAudioPlayer) {
    liveAudioPlayer.pause();
  }
  if (sourcePreview) {
    sourcePreview.pause();
  }
  if (sourcePreviewB) {
    sourcePreviewB.pause();
  }
  if (fadePreviewLayer) {
    fadePreviewLayer.style.opacity = "0";
  }
  updatePlayheadPosition(getCurrentSequenceTime());
}

function startSequencePlayback(startIdx = 0) {
  if (!shotPlan || !shotPlan.length) return;
  const firstValid = shotPlan.findIndex((s) => s.clip && !s.clip.includes("(awaiting clips)"));
  if (firstValid < 0) return;

  const idx = startIdx >= 0 && startIdx < shotPlan.length ? startIdx : 0;
  isPlayingSequence = true;
  if (btnSeqPlay) {
    btnSeqPlay.textContent = "⏹ Stop Sequence";
  }

  // Calculate cumulative sequence offset up to startIdx so A1 Audio syncs accurately
  let offsetBeforeShot = 0;
  for (let i = 0; i < idx; i++) {
    offsetBeforeShot += Number(shotPlan[i].duration || 0);
  }

  const curDeck = getVisibleVideoDeck();
  const currentShot = shotPlan[idx];
  const inPt = getShotDeckIn(currentShot);
  const outPt = inPt + Number(currentShot.duration || 1.0);
  let intraShotOffset = 0;
  if (curDeck && curDeck.currentTime >= inPt && curDeck.currentTime < outPt - 0.05) {
    intraShotOffset = curDeck.currentTime - inPt;
  }

  seqPlaybackStartTime = performance.now() - (offsetBeforeShot + intraShotOffset) * 1000;

  const aUrl = getActiveAudioUrl();
  if (liveAudioPlayer && aUrl) {
    if (liveAudioPlayer.getAttribute("data-src") !== aUrl) {
      liveAudioPlayer.src = aUrl;
      liveAudioPlayer.setAttribute("data-src", aUrl);
    }
    syncLiveAudioVolume();
    const targetAudioTime = Number(audioStartOffset || 0) + offsetBeforeShot + intraShotOffset;
    const maxAudioDur = Number(audioDurationSec || 0);
    if (maxAudioDur <= 0.1 || (offsetBeforeShot + intraShotOffset) < maxAudioDur) {
      try {
        liveAudioPlayer.currentTime = targetAudioTime;
        liveAudioPlayer.play().catch(() => {});
      } catch (e) {}
    }
  }

  const keepOrigAudio = $("keep-audio") && $("keep-audio").checked;
  if (curDeck) {
    curDeck.muted = Boolean(aUrl && !keepOrigAudio);
  }

  selectedShotIdx = idx;
  renderTimelineTrack();
  populateInspector();
  previewSelectedShotInMonitor(true, false, inPt + intraShotOffset);
  startPlayheadAnimLoop();
}

if (btnSeqPlay) {
  btnSeqPlay.addEventListener("click", () => {
    if (isPlayingSequence) {
      stopSequencePlayback();
    } else {
      const totalDur = shotPlan.reduce((acc, s) => acc + Number(s.duration || 0), 0);
      const curSeq = getCurrentSequenceTime();
      let startAt = selectedShotIdx >= 0 && selectedShotIdx < shotPlan.length ? selectedShotIdx : 0;
      if (totalDur > 0 && curSeq >= totalDur - 0.05) {
        startAt = 0;
        const curDeck = getVisibleVideoDeck();
        if (curDeck && shotPlan[0]) {
          curDeck.currentTime = getShotDeckIn(shotPlan[0]);
        }
      }
      startSequencePlayback(startAt);
    }
  });
}

// Wire Tactile Source Player Transport Bar (Real-Time Trim Window + Multi-Shot Sequence Loop)
if (btnSrcPlay) {
  btnSrcPlay.addEventListener("click", () => {
    const vid = getVisibleVideoDeck();
    if (!vid) return;
    // Capture play state BEFORE stopping the sequence (stopSequencePlayback pauses
    // every deck, which previously made this toggle always resume playback).
    const wasPlaying = isPlayingSequence || !vid.paused;
    stopSequencePlayback();
    if (wasPlaying) {
      vid.pause();
      return;
    }
    vid.muted = false;
    {
      if (selectedShotIdx >= 0 && selectedShotIdx < shotPlan.length) {
        const s = shotPlan[selectedShotIdx];
        const inPt = getShotDeckIn(s);
        const outPt = inPt + Number(s.duration || 1.0);
        if (vid.currentTime < inPt || vid.currentTime >= outPt - 0.05) {
          vid.currentTime = inPt;
        }
      }
      vid.play().catch(() => {});
    }
  });
}

function setupVideoDeckListeners(vid) {
  if (!vid) return;
  vid.addEventListener("play", () => {
    if (vid === getVisibleVideoDeck() && btnSrcPlay) {
      btnSrcPlay.textContent = "❚❚";
    }
  });
  vid.addEventListener("pause", () => {
    if (vid === getVisibleVideoDeck() && btnSrcPlay) {
      btnSrcPlay.textContent = "▶";
    }
  });
  vid.addEventListener("timeupdate", () => {
    if (vid !== getVisibleVideoDeck()) return;
    const dur = vid.duration || 0;
    const cur = vid.currentTime || 0;

    if (selectedShotIdx >= 0 && selectedShotIdx < shotPlan.length) {
      const shot = shotPlan[selectedShotIdx];
      const inPt = getShotDeckIn(shot);
      const shotDur = Math.max(0.15, Number(shot.duration || 1.0));
      const outPt = inPt + shotDur;

      updateLiveFadeOverlay(cur, shot);

      if (isPlayingSequence) {
        // Check if A1 Audio track has exceeded its custom trimmed length
        if (liveAudioPlayer && !liveAudioPlayer.paused && audioDurationSec > 0.1) {
          const playedAudio = liveAudioPlayer.currentTime - Number(audioStartOffset || 0);
          if (playedAudio >= audioDurationSec) {
            liveAudioPlayer.pause();
          }
        }
        // Advance to next shot in real time when current shot reaches its trimmed out-point
        if (cur >= outPt - 0.03 || vid.ended) {
          if (selectedShotIdx + 1 < shotPlan.length) {
            selectedShotIdx += 1;
            renderTimelineTrack();
            populateInspector();
            previewSelectedShotInMonitor(true, true);
            return;
          } else {
            // End of sequence reached
            stopSequencePlayback();
            vid.pause();
          }
        }
      } else if (!vid.paused) {
        // Single-shot preview: loop strictly within the trimmed [in_point, out_point] window
        if (cur >= outPt - 0.03) {
          vid.currentTime = inPt;
          vid.play().catch(() => {});
        }
      }
    }

    if (srcSeekSlider && dur > 0) {
      srcSeekSlider.max = dur.toFixed(2);
      srcSeekSlider.value = cur.toFixed(2);
    }
    if (srcTimeReadout) {
      if (selectedShotIdx >= 0 && selectedShotIdx < shotPlan.length) {
        const s = shotPlan[selectedShotIdx];
        const inPt = getShotDeckIn(s);
        const outPt = inPt + Number(s.duration || 0);
        srcTimeReadout.textContent = `${cur.toFixed(1)}s [${inPt.toFixed(1)}–${outPt.toFixed(1)}s]`;
      } else {
        srcTimeReadout.textContent = `${cur.toFixed(1)}s / ${dur.toFixed(1)}s`;
      }
    }

    if (!isPlayingSequence && !isScrubbingPlayhead) {
      updatePlayheadPosition(getCurrentSequenceTime());
    }
  });
}

setupVideoDeckListeners(sourcePreview);
setupVideoDeckListeners(sourcePreviewB);

if (srcSeekSlider) {
  srcSeekSlider.addEventListener("input", () => {
    stopSequencePlayback();
    const vid = getVisibleVideoDeck();
    if (!vid) return;
    vid.currentTime = parseFloat(srcSeekSlider.value) || 0;
    if (selectedShotIdx >= 0 && selectedShotIdx < shotPlan.length) {
      updateLiveFadeOverlay(vid.currentTime, shotPlan[selectedShotIdx]);
    }
  });
}

// ---------- Client-Side Thumbnail Helper ----------
function getClientThumb(fileObj, inPointSec, callback) {
  const key = `${fileObj.name}_${Number(inPointSec || 0).toFixed(1)}`;
  if (localThumbCache[key]) {
    callback(localThumbCache[key]);
    return;
  }
  const vid = document.createElement("video");
  vid.muted = true;
  vid.playsInline = true;
  vid.preload = "metadata";
  const objUrl = URL.createObjectURL(fileObj);
  vid.src = objUrl;
  vid.addEventListener(
    "loadeddata",
    () => {
      vid.currentTime = Math.min(Number(inPointSec || 0), Math.max(0, (vid.duration || 1) - 0.1));
    },
    { once: true }
  );
  vid.addEventListener(
    "seeked",
    () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 200;
        canvas.height = Math.round((vid.videoHeight / (vid.videoWidth || 1)) * 200) || 120;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(vid, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
        localThumbCache[key] = dataUrl;
        callback(dataUrl);
      } catch (e) {}
      URL.revokeObjectURL(objUrl);
    },
    { once: true }
  );
}

// ---------- Generic Dropzone Wiring ----------
function wireDropzone(zoneEl, inputEl, multiple, onFiles) {
  if (!zoneEl || !inputEl) return;
  zoneEl.addEventListener("click", (e) => {
    if (e.target.closest("button")) return;
    inputEl.click();
  });
  inputEl.addEventListener("change", () => onFiles(Array.from(inputEl.files)));

  ["dragover", "dragenter"].forEach((evt) =>
    zoneEl.addEventListener(evt, (e) => {
      e.preventDefault();
      zoneEl.classList.add("dragover");
    })
  );
  ["dragleave", "dragend"].forEach((evt) =>
    zoneEl.addEventListener(evt, () => zoneEl.classList.remove("dragover"))
  );
  zoneEl.addEventListener("drop", (e) => {
    e.preventDefault();
    zoneEl.classList.remove("dragover");
    const files = Array.from(e.dataTransfer.files);
    onFiles(multiple ? files : files.slice(0, 1));
  });
}

// ---------- STEP 1: Analyze Reference ----------
const dzReference = $("dz-reference");
const inputReference = $("input-reference");
const fnReference = $("fn-reference");
const thresholdSlider = $("threshold");
const thresholdVal = $("threshold-val");
const btnAnalyze = $("btn-analyze");
const analyzeStatus = $("analyze-status");
const rhythmResult = $("rhythm-result");
const rhythmStrip = $("rhythm-strip");
const shotTableBody = $("shot-table-body");

wireDropzone(dzReference, inputReference, false, (files) => {
  if (!files.length) return;
  referenceFile = files[0];
  fnReference.textContent = referenceFile.name;
  btnAnalyze.disabled = false;

  try {
    sourcePreview.src = URL.createObjectURL(referenceFile);
    sourcePreview.setAttribute("data-clip", referenceFile.name);
    sourcePreview.style.transform = "translate(0%, 0%) scale(1)";
    showMonitorTab("source");
  } catch (e) {}
});

thresholdSlider.addEventListener("input", () => {
  thresholdVal.textContent = thresholdSlider.value;
});

btnAnalyze.addEventListener("click", async () => {
  if (!referenceFile) return;
  btnAnalyze.disabled = true;
  setStatus(analyzeStatus, "Detecting cuts in reference reel…", "working");
  rhythmResult.classList.add("hidden");

  const fd = new FormData();
  fd.append("reference", referenceFile);
  fd.append("threshold", thresholdSlider.value);
  const jobNameEl = $("job-name");
  if (jobNameEl && jobNameEl.value.trim()) {
    fd.append("job_name", jobNameEl.value.trim());
  }
  if (jobId) fd.append("job_id", jobId);

  try {
    const res = await fetch("/api/analyze", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Analyze failed");

    jobId = data.job_id;
    referenceUrl = data.reference_url;
    currentRhythm = data.rhythm;
    if ($("job-id-display")) $("job-id-display").textContent = jobId;
    if ($("top-job-name")) {
      $("top-job-name").value = (jobNameEl && jobNameEl.value.trim()) ? jobNameEl.value.trim() : jobId;
    }
    renderRhythm(data.rhythm);
    setStatus(analyzeStatus, `✅ Detected ${data.rhythm.shot_count} cuts across ${data.rhythm.total_duration}s.`, "success");
    enableStep($("step2"));
    initDraftTimelineFromRhythm();
  } catch (err) {
    setStatus(analyzeStatus, "Error: " + err.message, "error");
  } finally {
    btnAnalyze.disabled = false;
  }
});

function renderRhythm(rhythm) {
  rhythmStrip.innerHTML = "";
  shotTableBody.innerHTML = "";
  const total = rhythm.total_duration || 1;

  rhythm.shots.forEach((s) => {
    const block = document.createElement("div");
    block.className = "bar";
    block.style.width = ((s.duration / total) * 100).toFixed(2) + "%";
    block.title = `Shot ${s.index + 1}: ${fmtTime(s.duration)}`;
    rhythmStrip.appendChild(block);

    const row = document.createElement("tr");
    row.innerHTML = `<td>#${String(s.index + 1).padStart(2, "0")}</td><td>${fmtTime(s.start)}</td><td>${fmtTime(s.end)}</td><td>${fmtTime(s.duration)}</td>`;
    shotTableBody.appendChild(row);
  });

  rhythmResult.classList.remove("hidden");
}

// ---------- STEP 2: Media Library (Thumb & List Views) & Build ----------
const dzClips = $("dz-clips");
const fnClips = $("fn-clips");
const inputClips = $("input-clips");
const clipList = $("clip-list");
const btnBuild = $("btn-build");
const buildStatus = $("build-status");
const btnBrowseFolder = $("btn-browse-folder");
const mediaViewToggle = $("media-view-toggle");

if (mediaViewToggle) {
  mediaViewToggle.addEventListener("click", (e) => {
    const btn = e.target.closest(".view-btn");
    if (!btn || !btn.dataset.view) return;
    mediaViewMode = btn.dataset.view;
    Array.from(mediaViewToggle.querySelectorAll(".view-btn")).forEach((b) =>
      b.classList.toggle("active", b.dataset.view === mediaViewMode)
    );
    clipList.classList.toggle("thumb-grid", mediaViewMode === "thumb");
    renderClipList();
  });
}

wireDropzone(dzClips, inputClips, true, (files) => {
  if (!files.length) return;
  const filtered = files.filter((f) => f.type.startsWith("video/") || f.name.match(/\.(mp4|mov|m4v|mkv|avi|webm)$/i));
  if (!filtered.length) {
    alert("No video files found.");
    return;
  }
  localFolderPath = null;
  clipFiles = filtered.sort((a, b) => a.name.localeCompare(b.name));
  localClipNames = clipFiles.map((f) => f.name);
  availableClips = [...localClipNames];
  shotPlan = [];
  clearInterval(progressInterval);
  markClipsChanged();
  renderClipList();
  fnClips.innerText = `${clipFiles.length} video clip(s) loaded`;
  btnBuild.disabled = false;
  initDraftTimelineFromRhythm();
});

btnBrowseFolder.addEventListener("click", async (e) => {
  e.preventDefault();
  e.stopPropagation();

  btnBrowseFolder.innerText = "Opening...";
  try {
    const res = await fetch("/api/pick_local_folder", { method: "POST" });
    const data = await res.json();

    if (data.path) {
      localFolderPath = data.path;
      clipFiles = [];
      shotPlan = [];
      clearInterval(progressInterval);
      markClipsChanged();

      const fd = new FormData();
      fd.append("local_folder", localFolderPath);
      const infoRes = await fetch("/api/local_clips_info", { method: "POST", body: fd });
      const infoData = await infoRes.json();
      localClipNames = infoData.clips || [];
      availableClips = [...localClipNames];

      renderClipList();
      fnClips.innerText = `📁 ${localClipNames.length} clips in ${data.path}`;
      btnBuild.disabled = false;
      initDraftTimelineFromRhythm();
    } else if (data.error && data.error !== "User cancelled") {
      alert("Error picking folder: " + data.error);
    }
  } catch (err) {
    console.error("Native picker failed", err);
  }
  btnBrowseFolder.innerText = "📁 Pick Folder";
});

function previewMediaBinClip(name, idx) {
  // If this clip is used in a shot on the timeline, select that shot so dragging/resizing saves to it
  const matchingShotIdx = shotPlan.findIndex((s) => s.clip === name);
  if (matchingShotIdx >= 0) {
    selectShot(matchingShotIdx);
    return;
  }
  if (!localFolderPath && clipFiles[idx]) {
    if (!clipFiles[idx]._blobUrl) clipFiles[idx]._blobUrl = URL.createObjectURL(clipFiles[idx]);
    sourcePreview.src = clipFiles[idx]._blobUrl;
    sourcePreview.setAttribute("data-clip", name);
    sourcePreview.style.transform = "translate(0%, 0%) scale(1)";
    showMonitorTab("source");
    sourcePreview.play().catch(() => {});
  } else if (jobId) {
    sourcePreview.src = `/api/clip_preview/${jobId}/${encodeURIComponent(name)}`;
    sourcePreview.setAttribute("data-clip", name);
    sourcePreview.style.transform = "translate(0%, 0%) scale(1)";
    showMonitorTab("source");
    sourcePreview.play().catch(() => {});
  }
}

function renderClipList() {
  clipList.innerHTML = "";
  clipList.classList.toggle("thumb-grid", mediaViewMode === "thumb");
  const names = localFolderPath ? localClipNames : clipFiles.map((f) => f.name);

  names.forEach((name, i) => {
    const shortName = name.replace(/\.(mov|mp4|m4v|mkv|avi|webm)$/i, "");
    if (mediaViewMode === "thumb") {
      const card = document.createElement("div");
      card.className = "clip-thumb-card";
      card.title = name;
      card.innerHTML = `
        <span class="idx">#${String(i + 1).padStart(2, "0")}</span>
        <span class="name">${shortName}</span>
      `;
      if (!localFolderPath && clipFiles[i]) {
        getClientThumb(clipFiles[i], 0.2, (dataUrl) => {
          card.style.backgroundImage = `url("${dataUrl}")`;
        });
      } else if (localFolderPath) {
        const thumbUrl = `/api/folder_thumb?folder=${encodeURIComponent(localFolderPath)}&clip=${encodeURIComponent(name)}`;
        card.style.backgroundImage = `url("${thumbUrl}")`;
      } else if (jobId) {
        const thumbUrl = `/api/clip_thumb/${jobId}/${encodeURIComponent(name)}?t=0.2`;
        card.style.backgroundImage = `url("${thumbUrl}")`;
      }
      card.addEventListener("click", () => previewMediaBinClip(name, i));
      clipList.appendChild(card);
    } else {
      const item = document.createElement("div");
      item.className = "clip-item";
      item.innerHTML = `
        <div style="display:flex; align-items:center; gap:8px; min-width:0;">
          <span class="idx">${String(i + 1).padStart(2, "0")}</span>
          <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${name}</span>
        </div>
        <span style="font-size:10px; color:var(--accent-bright);">▶</span>
      `;
      item.addEventListener("click", () => previewMediaBinClip(name, i));
      clipList.appendChild(item);
    }
  });
}

// ---------- Smart-match: Content Tagging ----------
const smartMatchCheckbox = $("smart-match");
const smartMatchOptions = $("smart-match-options");
const categoriesInput = $("categories");
const btnTag = $("btn-tag");
const tagStatus = $("tag-status");
let contentTagged = false;
let progressInterval = null;

function clearTagWarning() {
  if (buildStatus && buildStatus.textContent.includes("Tag Content")) {
    buildStatus.textContent = "";
    buildStatus.classList.add("hidden");
  }
}

function markClipsChanged() {
  const wasTagged = contentTagged;
  contentTagged = false;
  if (smartMatchCheckbox.checked) {
    setStatus(
      tagStatus,
      wasTagged
        ? '🆕 Footage changed — click "Tag Content with AI" again so the new clips get tagged.'
        : '🏷️ Click "Tag Content with AI" so CLIP Vision can match your clips by content.',
      "error"
    );
  }
}

smartMatchCheckbox.addEventListener("change", () => {
  smartMatchOptions.style.display = smartMatchCheckbox.checked ? "flex" : "none";
  if (!smartMatchCheckbox.checked) {
    clearTagWarning();
    tagStatus.classList.add("hidden");
  } else if (!contentTagged && (clipFiles.length || localFolderPath)) {
    setStatus(tagStatus, '🏷️ Click "Tag Content with AI" so CLIP Vision can match your clips.', "");
  }
});

btnTag.addEventListener("click", async () => {
  clearTagWarning();
  if (!jobId || (!clipFiles.length && !localFolderPath)) {
    alert("Analyze reference and add your footage clips first.");
    return;
  }
  btnTag.disabled = true;
  setStatus(tagStatus, "🤖 AI is visually analyzing and tagging your footage...", "working");

  const fd = new FormData();
  fd.append("job_id", jobId);
  fd.append("categories", categoriesInput.value);
  if (localFolderPath) {
    fd.append("local_folder", localFolderPath);
  } else {
    clipFiles.forEach((f) => fd.append("clips", f));
  }

  progressInterval = setInterval(async () => {
    try {
      const pRes = await fetch(`/api/progress/${jobId}`);
      const pData = await pRes.json();
      if (pData.total > 0) {
        const pct = Math.round((pData.current / pData.total) * 100);
        setStatus(tagStatus, `🤖 ${pData.phase} ${pData.current} / ${pData.total} (${pct}%)`, "working");
      }
    } catch (e) {}
  }, 1000);

  try {
    const res = await fetch("/api/tag", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Tagging failed");
    clearInterval(progressInterval);
    contentTagged = true;
    currentRhythm = data.rhythm || currentRhythm;
    shotPlan = [];
    setStatus(tagStatus, "✅ AI Tagging complete! Clips will be matched by visual category.", "success");
  } catch (err) {
    clearInterval(progressInterval);
    contentTagged = false;
    setStatus(tagStatus, "Error: " + err.message, "error");
  } finally {
    btnTag.disabled = false;
  }
});

// ---------- Interactive Sequence Timeline, Edge Trimming, Audio Track & Grading Inspector ----------
const tlShotsStrip = $("tl-shots-strip");
const tlRulerStrip = $("tl-ruler-strip");
const tlSummary = $("tl-summary");
const btnUndo = $("btn-undo");
const btnRedo = $("btn-redo");
const btnMoveLeft = $("btn-move-left");
const btnMoveRight = $("btn-move-right");
const btnTlReverse = $("btn-tl-reverse");
const btnTlDelete = $("btn-tl-delete");
const btnTlMagnet = $("btn-tl-magnet");
const tlSnapGuide = $("tl-snap-guide");
let isMagnetEnabled = true;
const btnInspReverse = $("btn-insp-reverse");
const inspReverseState = $("insp-reverse-state");
const btnRebuildOrder = $("btn-rebuild-order");
let lastSelectedTrackType = "shot"; // 'shot' | 'text' | 'audio'
let isAudioTrackSelected = false;

// Audio Track DOM
const inputCustomAudio = $("input-custom-audio");
const btnAddAudio = $("btn-add-audio");
const btnClearAudio = $("btn-clear-audio");
const tlAudioClip = $("tl-audio-clip");
const tlAudioTrimLeft = $("tl-audio-trim-left");
const tlAudioTrimRight = $("tl-audio-trim-right");
const tlAudioTitle = $("tl-audio-title");
const tlAudioOffsetLabel = $("tl-audio-offset-label");
const tlAudioVol = $("tl-audio-vol");
const tlAudioVolLabel = $("tl-audio-vol-label");

const inspEmpty = $("insp-empty");
const inspControls = $("insp-controls");
const inspShotBadge = $("insp-shot-badge");
const inspSubtabs = $("insp-subtabs");
const inspPaneTrim = $("insp-pane-trim");
const inspPaneColor = $("insp-pane-color");
const inspPaneText = $("insp-pane-text");

// Timeline Playhead (CTI) & Scrubbing DOM
const timelineTracksWrap = $("timeline-tracks-wrap");
const tlPlayhead = $("tl-playhead");
const tlPlayheadHead = $("tl-playhead-head");
const tlPlayheadReadout = $("tl-playhead-readout");
let isScrubbingPlayhead = false;
let playheadRafId = null;

// Timeline Text Track DOM (CapCut Style T1 Text Track)
const tlTextStrip = $("tl-text-strip");
const btnAddTimelineText = $("btn-add-timeline-text");
const numTxtStart = $("num-txt-start");
const numTxtDur = $("num-txt-dur");
let textTrackItems = [];
let selectedTextTrackId = null;
let activeTextTrim = null; // { id, side: 'left'|'right', startX, origStart, origDur, cardEl, metaEl, totalDur, trackWidth }
let activeTextMove = null; // { id, startX, origStart, dur, cardEl, metaEl, totalDur, trackWidth }

// Text & Title Overlay DOM (Multiple Text Layers Supported)
const textPreviewContainer = $("text-preview-container");
const txtItemsStrip = $("txt-items-strip");
const txtSelectedEditor = $("txt-selected-editor");
const btnTxtAddItem = $("btn-txt-add-item");
const btnTxtDuplicate = $("btn-txt-duplicate");
const btnTxtDeleteSelected = $("btn-txt-delete-selected");

const txtOverlayContent = $("txt-overlay-content");
const selTxtFont = $("sel-txt-font");
const optgrpCustomFonts = $("optgrp-custom-fonts");
const optgrpOsFonts = $("optgrp-os-fonts");
const inputCustomFont = $("input-custom-font");
const btnUploadFont = $("btn-upload-font");
const selTxtBgStyle = $("sel-txt-bg-style");
const slTxtSize = $("sl-txt-size");
const valTxtSize = $("val-txt-size");
const colTxtColor = $("col-txt-color");
const colTxtBg = $("col-txt-bg");
const txtPosReadout = $("txt-pos-readout");
const btnTxtAll = $("btn-txt-all");
const btnTxtClear = $("btn-txt-clear");
const btnTxtMasterClear = $("btn-txt-master-clear");
const loadedCustomFontFaces = new Set();

async function registerCustomFontFace(family, url) {
  if (!family || !url || loadedCustomFontFaces.has(family)) return;
  try {
    const cssName = family.replace(/^Custom:\s*/i, "").trim();
    const ff = new FontFace(cssName, `url(${url})`);
    const loaded = await ff.load();
    document.fonts.add(loaded);
    loadedCustomFontFaces.add(family);
  } catch (e) {}
}

async function loadAvailableFonts(selectFontFamily = null) {
  try {
    const res = await fetch("/api/fonts");
    if (!res.ok) return;
    const data = await res.json();

    if (optgrpCustomFonts) {
      optgrpCustomFonts.innerHTML = "";
      (data.custom_fonts || []).forEach((cf) => {
        registerCustomFontFace(cf.family, cf.url);
        const opt = document.createElement("option");
        opt.value = cf.family;
        opt.textContent = `★ ${cf.name}`;
        optgrpCustomFonts.appendChild(opt);
      });
    }

    if (optgrpOsFonts) {
      optgrpOsFonts.innerHTML = "";
      (data.os_fonts || []).forEach((fname) => {
        const opt = document.createElement("option");
        opt.value = fname;
        opt.textContent = fname;
        optgrpOsFonts.appendChild(opt);
      });
    }

    if (selectFontFamily && selTxtFont) {
      selTxtFont.value = selectFontFamily;
    } else if (selectedShotIdx >= 0 && selectedShotIdx < shotPlan.length && selTxtFont) {
      const texts = ensureShotTexts(shotPlan[selectedShotIdx]);
      const cur = texts[activeTextItemIdx] || texts[0];
      if (cur && cur.font) selTxtFont.value = cur.font;
    }
  } catch (e) {}
}

if (btnUploadFont && inputCustomFont) {
  btnUploadFont.addEventListener("click", () => inputCustomFont.click());
  inputCustomFont.addEventListener("change", async () => {
    const file = inputCustomFont.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("font_file", file);
    btnUploadFont.textContent = "Uploading…";
    try {
      const res = await fetch("/api/upload_font", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Font upload failed");
      await registerCustomFontFace(data.family, data.url);
      await loadAvailableFonts(data.family);
      if (selectedShotIdx >= 0 && selectedShotIdx < shotPlan.length) {
        pushUndoState();
        const texts = ensureShotTexts(shotPlan[selectedShotIdx]);
        if (!texts.length) texts.push(defaultTextOverlay());
        if (activeTextItemIdx < 0 || activeTextItemIdx >= texts.length) activeTextItemIdx = 0;
        texts[activeTextItemIdx].font = data.family;
        if (selTxtFont) selTxtFont.value = data.family;
        applyTextOverlayToPreview();
        markTimelineDirty();
      }
      setStatus(buildStatus, `🔤 Loaded custom font "${data.name}"!`, "success");
    } catch (err) {
      alert("Error loading font: " + err.message);
    } finally {
      btnUploadFont.textContent = "➕ Add Custom Font";
      inputCustomFont.value = "";
    }
  });
}

const inspClipSelect = $("insp-clip-select");
const inspInpointSlider = $("insp-inpoint-slider");
const inspInpoint = $("insp-inpoint");
const inspInpointMax = $("insp-inpoint-max");
const inspDuration = $("insp-duration");
const inspZoomSlider = $("insp-zoom-slider");
const inspZoomVal = $("insp-zoom-val");
const inspPanReadout = $("insp-pan-readout");
const btnResetReframe = $("btn-reset-reframe");
const btnApplyTimeline = $("btn-apply-timeline");

// Grading Inspector DOM
const vignettePreviewLayer = $("vignette-preview-layer");
const slGradeBrightness = $("sl-grade-brightness");
const valGradeBrightness = $("val-grade-brightness");
const slGradeContrast = $("sl-grade-contrast");
const valGradeContrast = $("val-grade-contrast");
const slGradeSaturation = $("sl-grade-saturation");
const valGradeSaturation = $("val-grade-saturation");
const slGradeTemp = $("sl-grade-temp");
const valGradeTemp = $("val-grade-temp");
const slGradeTint = $("sl-grade-tint");
const valGradeTint = $("val-grade-tint");
const slGradeWhites = $("sl-grade-whites");
const valGradeWhites = $("val-grade-whites");
const slGradeBlacks = $("sl-grade-blacks");
const valGradeBlacks = $("val-grade-blacks");
const slGradeVignette = $("sl-grade-vignette");
const valGradeVignette = $("val-grade-vignette");
const selGradeCurve = $("sel-grade-curve");
const numGradeFadeIn = $("num-grade-fadein");
const numGradeFadeOut = $("num-grade-fadeout");
const inputLut = $("input-lut");
const fnLut = $("fn-lut");
const btnClearLut = $("btn-clear-lut");
const btnCopyGrade = $("btn-copy-grade");
const btnPasteGrade = $("btn-paste-grade");
const btnGradeAll = $("btn-grade-all");
const btnResetGrade = $("btn-reset-grade");
const btnMasterResetGrade = $("btn-master-reset-grade");

// ---------- 10-Step Undo / Redo Engine ----------
function captureEditorState() {
  return JSON.stringify({
    shotPlan,
    selectedShotIdx,
    audioStartOffset,
    audioDurationSec,
    audioVolumePct,
    textTrackItems,
    selectedTextTrackId,
  });
}

function updateUndoRedoUI() {
  if (btnUndo) {
    btnUndo.disabled = undoStack.length === 0;
    btnUndo.title = undoStack.length ? `Undo (${undoStack.length} step${undoStack.length > 1 ? "s" : ""}) — ⌘Z` : "Nothing to Undo";
  }
  if (btnRedo) {
    btnRedo.disabled = redoStack.length === 0;
    btnRedo.title = redoStack.length ? `Redo (${redoStack.length} step${redoStack.length > 1 ? "s" : ""}) — ⇧⌘Z` : "Nothing to Redo";
  }
}

function pushUndoState() {
  if (!shotPlan || !shotPlan.length) return;
  const snap = captureEditorState();
  if (undoStack.length > 0 && undoStack[undoStack.length - 1] === snap) return;
  undoStack.push(snap);
  if (undoStack.length > MAX_HISTORY_STEPS) {
    undoStack.shift();
  }
  redoStack = [];
  updateUndoRedoUI();
}

function applySnapshotState(snapStr) {
  try {
    const parsed = JSON.parse(snapStr);
    shotPlan = parsed.shotPlan || [];
    selectedShotIdx = parsed.selectedShotIdx !== undefined ? parsed.selectedShotIdx : -1;
    audioStartOffset = Number(parsed.audioStartOffset || 0);
    audioDurationSec = Number(parsed.audioDurationSec || 0);
    audioVolumePct = Number(parsed.audioVolumePct !== undefined ? parsed.audioVolumePct : 100);
    textTrackItems = parsed.textTrackItems || [];
    selectedTextTrackId = parsed.selectedTextTrackId || null;
    if (tlAudioVol) tlAudioVol.value = audioVolumePct;
    if (tlAudioVolLabel) tlAudioVolLabel.textContent = `${audioVolumePct}%`;
    updateAudioTrackReadout();
    renderTimelineTrack();
    renderTextTrack();
    populateInspector();
    if (selectedShotIdx >= 0) previewSelectedShotInMonitor(false);
    applyTimelineTextOverlayToPreview();
    markTimelineDirty();
  } catch (e) {}
}

function performUndo() {
  if (undoStack.length === 0) return;
  const currentSnap = captureEditorState();
  redoStack.push(currentSnap);
  if (redoStack.length > MAX_HISTORY_STEPS) redoStack.shift();
  const prevSnap = undoStack.pop();
  applySnapshotState(prevSnap);
  updateUndoRedoUI();
}

function performRedo() {
  if (redoStack.length === 0) return;
  const currentSnap = captureEditorState();
  undoStack.push(currentSnap);
  if (undoStack.length > MAX_HISTORY_STEPS) undoStack.shift();
  const nextSnap = redoStack.pop();
  applySnapshotState(nextSnap);
  updateUndoRedoUI();
}

if (btnUndo) btnUndo.addEventListener("click", performUndo);
if (btnRedo) btnRedo.addEventListener("click", performRedo);

function switchInspectorSubtab(subtab) {
  if (subtab === "color") activeInspectorSubtab = "color";
  else if (subtab === "text") activeInspectorSubtab = "text";
  else activeInspectorSubtab = "trim";

  if (activeInspectorSubtab === "text") {
    if (inspEmpty) inspEmpty.classList.add("hidden");
    if (inspControls) inspControls.classList.remove("hidden");
    if (inspShotBadge) inspShotBadge.textContent = selectedTextTrackId ? "Text Layer Selected" : "Timeline Text Track (T1)";
    populateTextControls();
  } else {
    if (selectedShotIdx < 0 || selectedShotIdx >= shotPlan.length) {
      if (inspEmpty) inspEmpty.classList.remove("hidden");
      if (inspControls) inspControls.classList.add("hidden");
      if (inspShotBadge) inspShotBadge.textContent = "No shot selected";
    } else {
      if (inspEmpty) inspEmpty.classList.add("hidden");
      if (inspControls) inspControls.classList.remove("hidden");
      if (inspShotBadge) inspShotBadge.textContent = `Shot #${String(selectedShotIdx + 1).padStart(2, "0")}`;
    }
  }

  if (inspPaneTrim) inspPaneTrim.classList.toggle("hidden", activeInspectorSubtab !== "trim");
  if (inspPaneColor) inspPaneColor.classList.toggle("hidden", activeInspectorSubtab !== "color");
  if (inspPaneText) inspPaneText.classList.toggle("hidden", activeInspectorSubtab !== "text");
  if (inspSubtabs) {
    Array.from(inspSubtabs.querySelectorAll(".insp-subtab")).forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.subtab === activeInspectorSubtab);
    });
  }
}

if (inspSubtabs) {
  inspSubtabs.addEventListener("click", (e) => {
    const btn = e.target.closest(".insp-subtab");
    if (!btn || !btn.dataset.subtab) return;
    switchInspectorSubtab(btn.dataset.subtab);
  });
}

function applyGradeFilterToPreview() {
  if (selectedShotIdx < 0 || selectedShotIdx >= shotPlan.length) {
    if (sourcePreview) sourcePreview.style.filter = "none";
    if (sourcePreviewB) sourcePreviewB.style.filter = "none";
    if (vignettePreviewLayer) vignettePreviewLayer.style.opacity = "0";
    return;
  }
  const g = ensureShotGrade(shotPlan[selectedShotIdx]);
  const b = 1 + (Number(g.brightness || 0) / 100) + (Number(g.whites || 0) / 220) + (Number(g.blacks || 0) / 220);
  let c = 1 + (Number(g.contrast || 0) / 85) + (Number(g.whites || 0) / 260) - (Number(g.blacks || 0) / 260);
  if (g.curve === "medium_contrast") c *= 1.12;
  else if (g.curve === "strong_contrast") c *= 1.25;
  else if (g.curve === "lighter") c *= 0.95;
  else if (g.curve === "darker") c *= 1.08;
  const s = Math.max(0, 1 + Number(g.saturation || 0) / 100);
  const temp = Number(g.temperature || 0);
  const tint = Number(g.tint || 0);

  // Resolve-style White Balance:
  // Temperature (-100..+100): Cool Ice-Blue <-> Warm Golden Amber (R + slight G vs B)
  // Tint (-100..+100): Green <-> Magenta (G vs R+B)
  const tNorm = temp / 100.0;
  const mNorm = tint / 100.0;
  const rGain = Math.max(0.4, Math.min(1.8, 1.0 + 0.28 * tNorm + 0.16 * mNorm));
  const gGain = Math.max(0.4, Math.min(1.8, 1.0 + 0.08 * tNorm - 0.22 * mNorm));
  const bGain = Math.max(0.4, Math.min(1.8, 1.0 - 0.28 * tNorm + 0.16 * mNorm));

  const wbMatrixEl = document.getElementById("nle-wb-matrix");
  const hasWb = Math.abs(temp) > 0.5 || Math.abs(tint) > 0.5;
  if (wbMatrixEl) {
    wbMatrixEl.setAttribute(
      "values",
      `${rGain.toFixed(4)} 0 0 0 0  0 ${gGain.toFixed(4)} 0 0 0  0 0 ${bGain.toFixed(4)} 0 0  0 0 0 1 0`
    );
  }

  const wbFilterPart = hasWb && wbMatrixEl ? " url(#nle-wb-filter)" : "";
  const filterStr = `brightness(${Math.max(0.2, b).toFixed(2)}) contrast(${Math.max(0.3, c).toFixed(2)}) saturate(${s.toFixed(2)})${wbFilterPart}`;
  if (sourcePreview) sourcePreview.style.filter = filterStr;
  if (sourcePreviewB) sourcePreviewB.style.filter = filterStr;
  if (vignettePreviewLayer) {
    const vig = Math.max(0, Math.min(100, Number(g.vignette || 0)));
    vignettePreviewLayer.style.opacity = (vig / 100).toFixed(2);
  }
}

function getCurrentSequenceTime() {
  if (selectedShotIdx < 0 || selectedShotIdx >= shotPlan.length) return 0;
  let offset = 0;
  for (let i = 0; i < selectedShotIdx; i++) {
    offset += Number(shotPlan[i].duration || 0);
  }
  const vid = getVisibleVideoDeck();
  const inPt = getShotDeckIn(shotPlan[selectedShotIdx]);
  const cur = vid ? Math.max(inPt, vid.currentTime) : inPt;
  return Math.max(0, offset + (cur - inPt));
}

function formatTimecode(sec) {
  const s = Math.max(0, Number(sec || 0));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  const wholeSec = Math.floor(rem);
  const centi = Math.floor((rem - wholeSec) * 100);
  return `${String(m).padStart(2, "0")}:${String(wholeSec).padStart(2, "0")}.${String(centi).padStart(2, "0")}`;
}

function getTimelineTrackOrigin() {
  if (tlRulerStrip && timelineTracksWrap) {
    const wrapRect = timelineTracksWrap.getBoundingClientRect();
    const rulerRect = tlRulerStrip.getBoundingClientRect();
    return (rulerRect.left - wrapRect.left) + timelineTracksWrap.scrollLeft;
  }
  return 88;
}

function updatePlayheadPosition(timeSec) {
  if (!tlPlayhead) return;
  const totalDur = shotPlan && shotPlan.length
    ? shotPlan.reduce((acc, s) => acc + Number(s.duration || 0), 0)
    : 10.0;
  const clampedTime = Math.max(0, Math.min(totalDur, Number(timeSec || 0)));
  const ratio = totalDur > 0 ? (clampedTime / totalDur) : 0;

  const originX = getTimelineTrackOrigin();
  const trackWidth = tlRulerStrip
    ? (tlRulerStrip.offsetWidth || parseFloat(tlRulerStrip.style.width) || 800)
    : 800;

  const leftPx = originX + ratio * trackWidth;
  tlPlayhead.style.left = `${leftPx}px`;

  if (tlPlayheadReadout) {
    tlPlayheadReadout.textContent = `⏱️ ${formatTimecode(clampedTime)}`;
  }
}

// ==========================================
// Magnetic Snapping Engine (DaVinci / Premiere Style)
// ==========================================
function toggleMagnetTool(forceState = null) {
  if (forceState !== null) {
    isMagnetEnabled = Boolean(forceState);
  } else {
    isMagnetEnabled = !isMagnetEnabled;
  }
  if (btnTlMagnet) {
    if (isMagnetEnabled) {
      btnTlMagnet.classList.add("magnet-on");
      btnTlMagnet.textContent = "🧲 Magnet [ON]";
      btnTlMagnet.title = "Snapping / Magnet Tool (N) — Snapping is ACTIVE";
    } else {
      btnTlMagnet.classList.remove("magnet-on");
      btnTlMagnet.textContent = "🧲 Magnet [OFF]";
      btnTlMagnet.title = "Snapping / Magnet Tool (N) — Snapping is MUTED";
    }
  }
  if (!isMagnetEnabled) {
    hideTimelineSnapGuide();
  }
}

function showTimelineSnapGuide(timeSec, totalDurSec, trackWidthPx) {
  if (!tlSnapGuide || !isMagnetEnabled || totalDurSec <= 0 || trackWidthPx <= 0) return;
  const originX = getTimelineTrackOrigin();
  const clampedTime = Math.max(0, Math.min(totalDurSec, Number(timeSec || 0)));
  const leftPx = originX + Math.round((clampedTime / totalDurSec) * trackWidthPx);
  tlSnapGuide.style.left = `${leftPx}px`;
  tlSnapGuide.classList.add("active");
}

function hideTimelineSnapGuide() {
  if (tlSnapGuide) {
    tlSnapGuide.classList.remove("active");
  }
}

/**
 * Gathers all magnetic snap targets across Video cuts, Text boundaries, Audio, and Playhead.
 * @param {string|number|null} excludeTextId - optional text item id to exclude
 * @param {number|null} excludeCutTime - optional cut time to exclude
 */
function getTimelineSnapPoints(excludeTextId = null, excludeCutTime = null) {
  const points = [0.0];

  // 1. Video shot cut boundaries (cumulative durations)
  if (shotPlan && shotPlan.length) {
    let acc = 0;
    for (let i = 0; i < shotPlan.length; i++) {
      acc += Number(shotPlan[i].duration || 0);
      const cutTime = Number(acc.toFixed(3));
      if (excludeCutTime === null || Math.abs(cutTime - excludeCutTime) > 0.05) {
        points.push(cutTime);
      }
    }
  }

  // 2. Text track item boundaries
  if (textTrackItems && textTrackItems.length) {
    for (const item of textTrackItems) {
      if (excludeTextId && item.id === excludeTextId) continue;
      const s = Number(item.start_time || 0);
      const e = s + Number(item.duration || 0);
      points.push(Number(s.toFixed(3)));
      points.push(Number(e.toFixed(3)));
    }
  }

  // 3. Audio track boundaries
  const audioIn = Number(audioStartOffset || 0);
  points.push(Number(audioIn.toFixed(3)));
  if (audioDurationSec > 0.1) {
    points.push(Number((audioIn + audioDurationSec).toFixed(3)));
  }

  // 4. Current CTI playhead time
  try {
    const playheadTime = getCurrentSequenceTime();
    if (playheadTime > 0.05) {
      points.push(Number(playheadTime.toFixed(3)));
    }
  } catch (err) {}

  // Filter valid numbers, deduplicate, and sort ascending
  return Array.from(new Set(points.filter((p) => !isNaN(p) && p >= 0))).sort((a, b) => a - b);
}

/**
 * Snaps a target time to the closest snap point if within thresholdPx (default 10px).
 * Returns { time: number, snapped: boolean }
 */
function snapTimeToNearest(targetTimeSec, totalDurSec, trackWidthPx, excludeTextId = null, thresholdPx = 10, excludeCutTime = null) {
  if (!isMagnetEnabled || totalDurSec <= 0 || trackWidthPx <= 0) {
    return { time: targetTimeSec, snapped: false };
  }
  const pxPerSec = trackWidthPx / totalDurSec;
  const thresholdSec = thresholdPx / pxPerSec;

  const points = getTimelineSnapPoints(excludeTextId, excludeCutTime);
  let bestDist = Infinity;
  let bestPoint = null;

  for (const pt of points) {
    const dist = Math.abs(pt - targetTimeSec);
    if (dist <= thresholdSec && dist < bestDist) {
      bestDist = dist;
      bestPoint = pt;
    }
  }

  if (bestPoint !== null) {
    return { time: bestPoint, snapped: true };
  }
  return { time: targetTimeSec, snapped: false };
}

function startPlayheadAnimLoop() {
  if (playheadRafId) {
    cancelAnimationFrame(playheadRafId);
    playheadRafId = null;
  }
  function loop() {
    if (isPlayingSequence) {
      const curSeqTime = getCurrentSequenceTime();
      updatePlayheadPosition(curSeqTime);
      playheadRafId = requestAnimationFrame(loop);
    } else {
      playheadRafId = null;
    }
  }
  playheadRafId = requestAnimationFrame(loop);
}

function stopPlayheadAnimLoop() {
  if (playheadRafId) {
    cancelAnimationFrame(playheadRafId);
    playheadRafId = null;
  }
}

function seekSequenceToTime(targetTimeSec) {
  if (!shotPlan || !shotPlan.length) return;
  const totalDur = shotPlan.reduce((acc, s) => acc + Number(s.duration || 0), 0) || 10.0;
  const clampedTime = Math.max(0, Math.min(totalDur, targetTimeSec));

  // 1. Move playhead indicator
  updatePlayheadPosition(clampedTime);

  // 2. Identify target shot
  let accTime = 0;
  let targetIdx = 0;
  let intraShotOffset = 0;
  for (let i = 0; i < shotPlan.length; i++) {
    const sDur = Number(shotPlan[i].duration || 0);
    if (clampedTime <= accTime + sDur || i === shotPlan.length - 1) {
      targetIdx = i;
      intraShotOffset = Math.max(0, clampedTime - accTime);
      break;
    }
    accTime += sDur;
  }

  const shot = shotPlan[targetIdx];
  if (!shot) return;
  const inPt = getShotDeckIn(shot);
  const targetVideoTime = inPt + intraShotOffset;

  // 3. Switch shot / video deck if different shot
  if (targetIdx !== selectedShotIdx) {
    selectedShotIdx = targetIdx;
    if (tlShotsStrip) {
      const cards = tlShotsStrip.querySelectorAll(".tl-shot-card");
      cards.forEach((c, idx) => {
        c.classList.toggle("selected", idx === targetIdx);
      });
    }
    populateInspector();
    previewSelectedShotInMonitor(false, false, targetVideoTime);
  } else {
    // Within same shot: seek active video deck directly
    const vid = getVisibleVideoDeck();
    if (vid) {
      try {
        if (Math.abs(vid.currentTime - targetVideoTime) > 0.02) {
          vid.currentTime = targetVideoTime;
        }
      } catch (e) {}
    }
  }

  // 4. Update live fade overlay
  updateLiveFadeOverlay(targetVideoTime, shot);

  // 5. Update live audio position
  if (liveAudioPlayer) {
    const targetAudioTime = Number(audioStartOffset || 0) + clampedTime;
    try {
      if (Math.abs(liveAudioPlayer.currentTime - targetAudioTime) > 0.05) {
        liveAudioPlayer.currentTime = targetAudioTime;
      }
    } catch (e) {}
  }

  // 6. Update text overlays for this timecode
  applyTimelineTextOverlayToPreview(clampedTime);
}

function getSelectedTextTrackItem() {
  if (!textTrackItems.length) return null;
  let item = textTrackItems.find((t) => t.id === selectedTextTrackId);
  if (!item) {
    item = textTrackItems[0];
    selectedTextTrackId = item.id;
  }
  return item;
}

function applyTimelineTextOverlayToPreview(currentTime = null) {
  if (!textPreviewContainer) return;
  textPreviewContainer.innerHTML = "";
  if (!textTrackItems || !textTrackItems.length) return;

  let viewTime = currentTime;
  if (viewTime === null || viewTime === undefined) {
    viewTime = getCurrentSequenceTime();
  }

  const vpRect = reframeViewport ? reframeViewport.getBoundingClientRect() : null;
  const vpW = vpRect && vpRect.width ? vpRect.width : 280;
  const scaleRatio = vpW / (projectWidth || 1080);

  const activeItems = textTrackItems.filter((t) => {
    const isSelected = !isPlayingSequence && t.id === selectedTextTrackId;
    if (isSelected) return true;
    const raw = (t.content || "").trim();
    if (!raw) return false;
    const tStart = Number(t.start_time || 0);
    const tEnd = tStart + Math.max(0.1, Number(t.duration || 1.0));
    return viewTime >= tStart - 0.05 && viewTime <= tEnd + 0.05;
  });

  activeItems.forEach((t) => {
    const badgeWrap = document.createElement("div");
    const isSelected = t.id === selectedTextTrackId;
    badgeWrap.className = "text-preview-layer" + (isSelected ? " selected-text-item" : "");
    badgeWrap.dataset.tid = t.id;

    const badge = document.createElement("span");
    badge.className = "text-preview-badge";
    const textStr = t.content !== undefined && t.content !== null ? String(t.content) : "";
    badge.textContent = textStr || (isSelected ? "Type text…" : "");
    if (!textStr && isSelected) {
      badge.style.opacity = "0.75";
      badge.style.fontStyle = "italic";
    }

    const pxSize = Math.max(11, Math.round(Number(t.size || 56) * scaleRatio));
    const rawFont = t.font || "Arial Bold";
    const cssFontName = rawFont.replace(/^Custom:\s*/i, "").trim();
    const cleanOsFontName = cssFontName.replace(/\s+(Bold|Italic|Regular|Medium|Light|Black|Heavy)$/i, "").trim();
    badge.style.fontFamily = `"${cssFontName}", "${cleanOsFontName}", sans-serif`;
    badge.style.fontSize = `${pxSize}px`;
    badge.style.color = t.color || "#FFFFFF";

    const bgStyle = t.bg_style || "plain";
    const bgCol = t.bg_color || "#1F2C38";
    if (bgStyle === "pill") {
      badge.style.background = bgCol;
      badge.style.borderRadius = "999px";
      badge.style.padding = `${Math.max(4, Math.round(pxSize * 0.25))}px ${Math.max(10, Math.round(pxSize * 0.48))}px`;
      badge.style.border = "1px solid rgba(231,237,242,0.22)";
      badge.style.boxShadow = "0 4px 14px rgba(15, 22, 28, 0.55)";
      badge.style.textShadow = "0 1px 2px rgba(15,22,28,0.6)";
    } else if (bgStyle === "box") {
      badge.style.background = bgCol;
      badge.style.borderRadius = "6px";
      badge.style.padding = `${Math.max(4, Math.round(pxSize * 0.25))}px ${Math.max(10, Math.round(pxSize * 0.45))}px`;
      badge.style.border = "1px solid rgba(231,237,242,0.22)";
      badge.style.boxShadow = "0 4px 14px rgba(15, 22, 28, 0.55)";
      badge.style.textShadow = "0 1px 2px rgba(15,22,28,0.6)";
    } else if (bgStyle === "outline") {
      badge.style.background = "transparent";
      badge.style.border = "none";
      badge.style.boxShadow = "none";
      badge.style.padding = "2px 4px";
      badge.style.textShadow = "-1.5px -1.5px 0 #0F161C, 1.5px -1.5px 0 #0F161C, -1.5px 1.5px 0 #0F161C, 1.5px 1.5px 0 #0F161C, 0 3px 8px rgba(15,22,28,0.85)";
    } else if (bgStyle === "plain") {
      badge.style.background = "transparent";
      badge.style.border = "none";
      badge.style.boxShadow = "none";
      badge.style.padding = "2px 4px";
      badge.style.textShadow = "none";
    } else {
      badge.style.background = "transparent";
      badge.style.border = "none";
      badge.style.boxShadow = "none";
      badge.style.padding = "2px 4px";
      badge.style.textShadow = "0 2px 10px rgba(15,22,28,0.95)";
    }

    const posX = Math.max(5, Math.min(95, Number(t.x !== undefined ? t.x : 50)));
    const posY = Math.max(5, Math.min(95, Number(t.y !== undefined ? t.y : 80)));
    badgeWrap.style.left = `${posX.toFixed(1)}%`;
    badgeWrap.style.top = `${posY.toFixed(1)}%`;

    badgeWrap.appendChild(badge);

    // Clicking a text on screen selects it in inspector and initiates drag
    badgeWrap.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      pushUndoState();
      selectTextTrackItem(t.id);

      isDraggingText = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      dragOrigTxtX = Number(t.x !== undefined ? t.x : 50);
      dragOrigTxtY = Number(t.y !== undefined ? t.y : 80);
    });

    // Double-click on screen to immediately focus editor
    badgeWrap.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      e.preventDefault();
      selectTextTrackItem(t.id);
      if (txtOverlayContent) {
        txtOverlayContent.focus();
        txtOverlayContent.select();
      }
    });

    textPreviewContainer.appendChild(badgeWrap);
  });
}

function applyTextOverlayToPreview() {
  applyTimelineTextOverlayToPreview();
}

function renderTextItemPills() {
  if (!txtItemsStrip) return;
  txtItemsStrip.innerHTML = "";

  if (!textTrackItems.length) {
    txtItemsStrip.innerHTML = '<span style="font-size:11px; color:var(--text-dim); padding:2px 4px;">No text layers on the timeline. Click ➕ Add Text above.</span>';
    if (txtSelectedEditor) txtSelectedEditor.classList.add("hidden");
    return;
  }

  if (txtSelectedEditor) txtSelectedEditor.classList.remove("hidden");

  textTrackItems.forEach((t, i) => {
    const pill = document.createElement("div");
    pill.className = "txt-item-pill" + (t.id === selectedTextTrackId ? " active" : "");
    const preview = (t.content || "").trim().slice(0, 14) || `Title #${i + 1}`;
    pill.innerHTML = `
      <span>${preview}</span>
      <span class="pill-del" title="Delete this text layer">✕</span>
    `;
    pill.addEventListener("click", (e) => {
      if (e.target.closest(".pill-del")) {
        e.stopPropagation();
        pushUndoState();
        deleteSelectedTextTrackItem(t.id);
        return;
      }
      selectTextTrackItem(t.id);
    });
    txtItemsStrip.appendChild(pill);
  });
}

function renderTextTrack() {
  if (!tlTextStrip) return;
  tlTextStrip.innerHTML = "";

  const totalDur = shotPlan.reduce((acc, s) => acc + Number(s.duration || 0), 0) || 10.0;
  const trackWidth = tlRulerStrip && tlRulerStrip.style.width ? Math.max(480, parseFloat(tlRulerStrip.style.width)) : (tlRulerStrip ? Math.max(480, tlRulerStrip.getBoundingClientRect().width) : 800);
  tlTextStrip.style.width = `${trackWidth}px`;

  if (!textTrackItems.length) {
    tlTextStrip.innerHTML = `
      <div style="color:var(--text-dim); font-size:11px; display:flex; align-items:center; padding-left:10px; height:100%; pointer-events:none;">
        Double-click track or click "+ Add Text Item" in inspector to add text titles · Drag edges to trim.
      </div>
    `;
    return;
  }

  textTrackItems.forEach((item, idx) => {
    if (!item.id) item.id = `txt_${Date.now()}_${idx}`;
    const startSec = Math.max(0, Number(item.start_time || 0));
    const durSec = Math.max(0.2, Number(item.duration || 2.5));

    const leftPx = Math.round((startSec / totalDur) * trackWidth);
    const widthPx = Math.max(46, Math.round((durSec / totalDur) * trackWidth));

    const isSelected = item.id === selectedTextTrackId;
    const card = document.createElement("div");
    card.className = "tl-text-clip" + (isSelected ? " selected" : "");
    card.dataset.id = item.id;
    card.style.left = `${leftPx}px`;
    card.style.width = `${widthPx}px`;

    const titleText = (item.content || "").trim().slice(0, 24) || `Title #${idx + 1}`;

    card.innerHTML = `
      <div class="tl-trim-handle left" title="Drag to trim start In-Point [">[</div>
      <div class="tl-text-body">
        <span class="tl-text-title">🔤 ${titleText}</span>
        <span class="tl-text-meta mono">${durSec.toFixed(1)}s</span>
      </div>
      <div class="tl-trim-handle right" title="Drag to trim duration / length ]">]</div>
    `;

    // Click to select
    card.addEventListener("click", (e) => {
      e.stopPropagation();
      selectTextTrackItem(item.id);
    });

    // Double-click to focus text input immediately
    card.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      selectTextTrackItem(item.id);
      if (txtOverlayContent) {
        txtOverlayContent.focus();
        txtOverlayContent.select();
      }
    });

    // Left Handle Trim [
    const leftHandle = card.querySelector(".tl-trim-handle.left");
    if (leftHandle) {
      leftHandle.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault();
        pushUndoState();
        selectTextTrackItem(item.id, false);
        card.classList.add("selected");
        const curTrackW = parseFloat(tlTextStrip.style.width) || tlTextStrip.getBoundingClientRect().width || trackWidth;
        activeTextTrim = {
          id: item.id,
          side: "left",
          startX: e.clientX,
          origStart: Number(item.start_time || 0),
          origDur: Number(item.duration || 1.0),
          cardEl: card,
          handleEl: leftHandle,
          metaEl: card.querySelector(".tl-text-meta"),
          totalDur,
          trackWidth: curTrackW,
        };
        card.classList.add("trimming");
        leftHandle.classList.add("active-trim");
        document.body.style.cursor = "col-resize";
      });
    }

    // Right Handle Trim ]
    const rightHandle = card.querySelector(".tl-trim-handle.right");
    if (rightHandle) {
      rightHandle.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault();
        pushUndoState();
        selectTextTrackItem(item.id, false);
        card.classList.add("selected");
        const curTrackW = parseFloat(tlTextStrip.style.width) || tlTextStrip.getBoundingClientRect().width || trackWidth;
        activeTextTrim = {
          id: item.id,
          side: "right",
          startX: e.clientX,
          origStart: Number(item.start_time || 0),
          origDur: Number(item.duration || 1.0),
          cardEl: card,
          handleEl: rightHandle,
          metaEl: card.querySelector(".tl-text-meta"),
          totalDur,
          trackWidth: curTrackW,
        };
        card.classList.add("trimming");
        rightHandle.classList.add("active-trim");
        document.body.style.cursor = "col-resize";
      });
    }

    // Card Body Drag (Slide in time to position when it will appear)
    card.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      if (e.target.closest(".tl-trim-handle")) return; // Let handles trim
      e.stopPropagation();
      e.preventDefault();
      pushUndoState();
      selectTextTrackItem(item.id, false);
      card.classList.add("selected");
      const curTrackW = parseFloat(tlTextStrip.style.width) || tlTextStrip.getBoundingClientRect().width || trackWidth;
      activeTextMove = {
        id: item.id,
        startX: e.clientX,
        origStart: Number(item.start_time || 0),
        dur: Number(item.duration || 1.0),
        cardEl: card,
        metaEl: card.querySelector(".tl-text-meta"),
        totalDur,
        trackWidth: curTrackW,
      };
      card.classList.add("dragging");
      document.body.style.cursor = "grabbing";
    });

    tlTextStrip.appendChild(card);
  });
}

// Global Mouse Listeners for Timeline Text Dragging & Edge Trimming (60 FPS Smooth)
let textDragRafId = null;

window.addEventListener("mousemove", (e) => {
  if (isScrubbingPlayhead) {
    e.preventDefault();
    if (!tlRulerStrip) return;
    const totalDur = shotPlan && shotPlan.length
      ? shotPlan.reduce((acc, s) => acc + Number(s.duration || 0), 0)
      : 10.0;
    const rulerRect = tlRulerStrip.getBoundingClientRect();
    const mouseX = e.clientX - rulerRect.left;
    const trackWidth = rulerRect.width || 800;
    const ratio = Math.max(0, Math.min(1, mouseX / trackWidth));
    let scrubTime = ratio * totalDur;

    if (isMagnetEnabled) {
      const snapRes = snapTimeToNearest(scrubTime, totalDur, trackWidth, null, 8);
      if (snapRes.snapped) {
        scrubTime = snapRes.time;
        showTimelineSnapGuide(snapRes.time, totalDur, trackWidth);
      } else {
        hideTimelineSnapGuide();
      }
    } else {
      hideTimelineSnapGuide();
    }

    seekSequenceToTime(scrubTime);

    // Auto-scroll timeline tracks container if dragging near edges
    if (timelineTracksWrap) {
      const wrapRect = timelineTracksWrap.getBoundingClientRect();
      if (e.clientX > wrapRect.right - 30) {
        timelineTracksWrap.scrollLeft += 15;
      } else if (e.clientX < wrapRect.left + 30) {
        timelineTracksWrap.scrollLeft -= 15;
      }
    }
    return;
  }

  if (activeTextTrim) {
    const { id, side, startX, origStart, origDur, cardEl, metaEl, totalDur, trackWidth } = activeTextTrim;
    const item = textTrackItems.find((t) => t.id === id);
    if (!item || !cardEl) return;

    const dxPx = e.clientX - startX;
    const deltaSec = (dxPx / trackWidth) * totalDur;

    if (side === "left") {
      // Dragging left handle '[' moves In-Point in time, right edge stays fixed at (origStart + origDur)
      const fixedEnd = origStart + origDur;
      const minDur = 0.2;
      let newStart = Math.max(0, Math.min(fixedEnd - minDur, origStart + deltaSec));

      if (isMagnetEnabled) {
        const snapRes = snapTimeToNearest(newStart, totalDur, trackWidth, id, 10);
        if (snapRes.snapped && snapRes.time <= fixedEnd - minDur) {
          newStart = snapRes.time;
          showTimelineSnapGuide(snapRes.time, totalDur, trackWidth);
        } else {
          hideTimelineSnapGuide();
        }
      } else {
        hideTimelineSnapGuide();
      }

      const newDur = Math.max(minDur, fixedEnd - newStart);
      item.start_time = Number(newStart.toFixed(2));
      item.duration = Number(newDur.toFixed(2));
    } else {
      // Dragging right handle ']' reduces/increases length in timeline, left edge stays fixed at origStart
      const minDur = 0.2;
      const maxDur = Math.max(minDur, totalDur - origStart);
      let newDur = Math.max(minDur, Math.min(maxDur, origDur + deltaSec));
      let newEnd = origStart + newDur;

      if (isMagnetEnabled) {
        const snapRes = snapTimeToNearest(newEnd, totalDur, trackWidth, id, 10);
        if (snapRes.snapped && snapRes.time >= origStart + minDur) {
          newEnd = snapRes.time;
          newDur = Math.max(minDur, Math.min(maxDur, newEnd - origStart));
          showTimelineSnapGuide(snapRes.time, totalDur, trackWidth);
        } else {
          hideTimelineSnapGuide();
        }
      } else {
        hideTimelineSnapGuide();
      }

      item.duration = Number(newDur.toFixed(2));
    }

    // Direct pixel styling during drag for 60fps butter-smooth rendering
    const leftPx = Math.round((item.start_time / totalDur) * trackWidth);
    const widthPx = Math.max(46, Math.round((item.duration / totalDur) * trackWidth));
    cardEl.style.left = `${leftPx}px`;
    cardEl.style.width = `${widthPx}px`;

    if (metaEl) {
      metaEl.textContent = `${item.duration.toFixed(1)}s`;
    }

    // Live update inspector timing inputs
    if (numTxtStart && document.activeElement !== numTxtStart) {
      numTxtStart.value = item.start_time.toFixed(2);
    }
    if (numTxtDur && document.activeElement !== numTxtDur) {
      numTxtDur.value = item.duration.toFixed(2);
    }

    // Throttled 60fps monitor update
    if (!textDragRafId) {
      textDragRafId = requestAnimationFrame(() => {
        applyTimelineTextOverlayToPreview(item.start_time);
        textDragRafId = null;
      });
    }
    markTimelineDirty();
    return;
  }

  if (activeTextMove) {
    const { id, startX, origStart, dur, cardEl, metaEl, totalDur, trackWidth } = activeTextMove;
    const item = textTrackItems.find((t) => t.id === id);
    if (!item || !cardEl) return;

    const dxPx = e.clientX - startX;
    const deltaSec = (dxPx / trackWidth) * totalDur;
    const maxStart = Math.max(0, totalDur - dur);
    let newStart = Math.max(0, Math.min(maxStart, origStart + deltaSec));

    if (isMagnetEnabled) {
      const snapStart = snapTimeToNearest(newStart, totalDur, trackWidth, id, 10);
      const snapEnd = snapTimeToNearest(newStart + dur, totalDur, trackWidth, id, 10);
      if (snapStart.snapped) {
        newStart = Math.max(0, Math.min(maxStart, snapStart.time));
        showTimelineSnapGuide(snapStart.time, totalDur, trackWidth);
      } else if (snapEnd.snapped) {
        newStart = Math.max(0, Math.min(maxStart, snapEnd.time - dur));
        showTimelineSnapGuide(snapEnd.time, totalDur, trackWidth);
      } else {
        hideTimelineSnapGuide();
      }
    } else {
      hideTimelineSnapGuide();
    }

    item.start_time = Number(newStart.toFixed(2));

    // Direct pixel styling during slide
    const leftPx = Math.round((item.start_time / totalDur) * trackWidth);
    cardEl.style.left = `${leftPx}px`;

    // Live update inspector timing inputs
    if (numTxtStart && document.activeElement !== numTxtStart) {
      numTxtStart.value = item.start_time.toFixed(2);
    }

    // Throttled 60fps monitor update
    if (!textDragRafId) {
      textDragRafId = requestAnimationFrame(() => {
        applyTimelineTextOverlayToPreview(item.start_time);
        textDragRafId = null;
      });
    }
    markTimelineDirty();
    return;
  }
});

window.addEventListener("mouseup", () => {
  hideTimelineSnapGuide();

  if (isScrubbingPlayhead) {
    isScrubbingPlayhead = false;
    if (tlPlayhead) tlPlayhead.classList.remove("scrubbing");
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    renderTimelineTrack();
  }

  if (activeTextTrim) {
    const item = textTrackItems.find((t) => t.id === activeTextTrim.id);
    if (activeTextTrim.cardEl) {
      activeTextTrim.cardEl.classList.remove("trimming");
    }
    if (activeTextTrim.handleEl) {
      activeTextTrim.handleEl.classList.remove("active-trim");
    }
    document.body.style.cursor = "";
    activeTextTrim = null;
    renderTextTrack();
    populateTextControls();
    if (item) applyTimelineTextOverlayToPreview(item.start_time);
  }

  if (activeTextMove) {
    const item = textTrackItems.find((t) => t.id === activeTextMove.id);
    if (activeTextMove.cardEl) {
      activeTextMove.cardEl.classList.remove("dragging");
    }
    document.body.style.cursor = "";
    activeTextMove = null;
    renderTextTrack();
    populateTextControls();
    if (item) applyTimelineTextOverlayToPreview(item.start_time);
  }
});

function selectTextTrackItem(id, updateTimeline = true) {
  selectedTextTrackId = id;
  lastSelectedTrackType = "text";
  deselectAudioTrack();
  switchInspectorSubtab("text");
  populateTextControls();

  if (updateTimeline) {
    if (tlTextStrip) {
      Array.from(tlTextStrip.querySelectorAll(".tl-text-clip")).forEach((el) => {
        el.classList.toggle("selected", el.dataset.id === id);
      });
    }
  }

  const item = textTrackItems.find((t) => t.id === id);
  if (item) {
    applyTimelineTextOverlayToPreview(item.start_time);
  } else {
    applyTimelineTextOverlayToPreview();
  }
  updateTimelineDeleteButton();
}

function addNewTextTrackItem(customStartTime = null) {
  pushUndoState();
  const totalDur = shotPlan.reduce((acc, s) => acc + Number(s.duration || 0), 0) || 10.0;
  let startAt = 0.0;
  if (customStartTime !== null) {
    startAt = Math.max(0, Math.min(totalDur - 0.5, customStartTime));
  } else if (textTrackItems.length > 0) {
    const lastItem = textTrackItems[textTrackItems.length - 1];
    startAt = Math.min(totalDur - 0.5, Number((lastItem.start_time + lastItem.duration).toFixed(2)));
  }
  const dur = Math.max(0.5, Math.min(3.0, totalDur - startAt));

  const newItem = {
    id: `txt_${Date.now()}`,
    content: `Title #${textTrackItems.length + 1}`,
    font: "Arial Bold",
    size: 56,
    color: "#FFFFFF",
    bg_style: "plain",
    bg_color: "#1F2C38",
    x: 50,
    y: 80,
    start_time: Number(startAt.toFixed(2)),
    duration: Number(dur.toFixed(2)),
  };

  textTrackItems.push(newItem);
  selectTextTrackItem(newItem.id);
  renderTextTrack();
  applyTimelineTextOverlayToPreview(startAt);
  markTimelineDirty();

  if (txtOverlayContent) {
    txtOverlayContent.focus();
    txtOverlayContent.select();
  }
}

function duplicateSelectedTextTrackItem() {
  const item = getSelectedTextTrackItem();
  if (!item) return;
  pushUndoState();
  const cloned = JSON.parse(JSON.stringify(item));
  cloned.id = `txt_${Date.now()}`;
  const totalDur = shotPlan.reduce((acc, s) => acc + Number(s.duration || 0), 0) || 10.0;
  cloned.start_time = Math.min(totalDur - 0.5, cloned.start_time + 1.0);
  cloned.y = Math.min(90, (cloned.y || 80) + 6);
  textTrackItems.push(cloned);
  selectTextTrackItem(cloned.id);
  renderTextTrack();
  applyTimelineTextOverlayToPreview(cloned.start_time);
  markTimelineDirty();
}

function deleteSelectedTextTrackItem(targetId = null) {
  const idToDelete = targetId || selectedTextTrackId;
  if (!idToDelete) return;
  pushUndoState();
  const idx = textTrackItems.findIndex((t) => t.id === idToDelete);
  if (idx >= 0) {
    textTrackItems.splice(idx, 1);
  }
  if (selectedTextTrackId === idToDelete) {
    selectedTextTrackId = textTrackItems.length ? textTrackItems[Math.max(0, idx - 1)].id : null;
  }
  if (!selectedTextTrackId) {
    lastSelectedTrackType = "shot";
  }
  populateTextControls();
  renderTextTrack();
  applyTimelineTextOverlayToPreview();
  markTimelineDirty();
  updateTimelineDeleteButton();
}

function applyReframeTransformToPreview() {
  const curDeck = getVisibleVideoDeck();
  if (!curDeck) return;
  if (selectedShotIdx < 0 || selectedShotIdx >= shotPlan.length) {
    curDeck.style.transform = "translate(0%, 0%) scale(1)";
    applyGradeFilterToPreview();
    applyTextOverlayToPreview();
    return;
  }
  const shot = shotPlan[selectedShotIdx];
  const zoom = Number(shot.zoom !== undefined ? shot.zoom : 100);
  const panX = Number(shot.pan_x || 0);
  const panY = Number(shot.pan_y || 0);

  const transformStyle = `translate(${panX.toFixed(2)}%, ${panY.toFixed(2)}%) scale(${(zoom / 100).toFixed(3)})`;
  if (sourcePreview) sourcePreview.style.transform = transformStyle;
  if (sourcePreviewB) sourcePreviewB.style.transform = transformStyle;

  if (inspZoomSlider) inspZoomSlider.value = Math.round(zoom);
  if (inspZoomVal) inspZoomVal.textContent = `${Math.round(zoom)}%`;
  if (inspPanReadout) {
    inspPanReadout.textContent = `Position: X ${panX > 0 ? "+" : ""}${Math.round(panX)}% · Y ${panY > 0 ? "+" : ""}${Math.round(panY)}% (Drag video in monitor)`;
  }
  applyGradeFilterToPreview();
  applyTextOverlayToPreview();
}

// Mouse Drag to Reposition Text or Video & Wheel to Resize inside #reframe-viewport
let isDraggingReframe = false;
let isDraggingText = false;
let dragStartX = 0;
let dragStartY = 0;
let dragOrigPanX = 0;
let dragOrigPanY = 0;
let dragOrigTxtX = 50;
let dragOrigTxtY = 82;

if (reframeViewport) {
  reframeViewport.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || isDraggingText) return;
    if (selectedShotIdx < 0 && shotPlan.length > 0) {
      selectedShotIdx = 0;
      populateInspector();
      renderTimelineTrack();
    }
    if (selectedShotIdx < 0 || selectedShotIdx >= shotPlan.length) return;
    pushUndoState();
    isDraggingReframe = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragOrigPanX = Number(shotPlan[selectedShotIdx].pan_x || 0);
    dragOrigPanY = Number(shotPlan[selectedShotIdx].pan_y || 0);
    e.preventDefault();
  });

  window.addEventListener("mousemove", (e) => {
    if (isDraggingText) {
      const rect = reframeViewport.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const dxPct = ((e.clientX - dragStartX) / rect.width) * 100;
      const dyPct = ((e.clientY - dragStartY) / rect.height) * 100;
      const cur = getSelectedTextTrackItem();
      if (cur) {
        cur.x = Math.max(5, Math.min(95, dragOrigTxtX + dxPct));
        cur.y = Math.max(5, Math.min(95, dragOrigTxtY + dyPct));
        applyTimelineTextOverlayToPreview();
        if (txtPosReadout) {
          txtPosReadout.textContent = `Position: X ${Math.round(cur.x)}% · Y ${Math.round(cur.y)}% (Drag text in monitor to move)`;
        }
        markTimelineDirty();
      }
      return;
    }
    if (!isDraggingReframe || selectedShotIdx < 0 || selectedShotIdx >= shotPlan.length) return;
    const rect = reframeViewport.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dxPct = ((e.clientX - dragStartX) / rect.width) * 100;
    const dyPct = ((e.clientY - dragStartY) / rect.height) * 100;
    shotPlan[selectedShotIdx].pan_x = Math.max(-100, Math.min(100, dragOrigPanX + dxPct));
    shotPlan[selectedShotIdx].pan_y = Math.max(-100, Math.min(100, dragOrigPanY + dyPct));
    applyReframeTransformToPreview();
    markTimelineDirty();
  });

  window.addEventListener("mouseup", () => {
    if (isDraggingText) {
      isDraggingText = false;
      renderTimelineTrack();
    }
    if (isDraggingReframe) {
      isDraggingReframe = false;
      renderTimelineTrack();
    }
  });

  reframeViewport.addEventListener(
    "wheel",
    (e) => {
      if (selectedShotIdx < 0 || selectedShotIdx >= shotPlan.length) return;
      e.preventDefault();
      pushUndoState();
      const curZoom = Number(shotPlan[selectedShotIdx].zoom !== undefined ? shotPlan[selectedShotIdx].zoom : 100);
      const delta = e.deltaY < 0 ? 4 : -4;
      const nextZoom = Math.max(50, Math.min(300, curZoom + delta));
      shotPlan[selectedShotIdx].zoom = nextZoom;
      applyReframeTransformToPreview();
      markTimelineDirty();
    },
    { passive: false }
  );
}

function resolveClipSourceUrl(clipName) {
  if (!clipName || clipName.includes("(awaiting clips)")) return null;
  if (!localFolderPath && clipFiles.length) {
    const f = clipFiles.find((cf) => cf.name === clipName);
    if (f) {
      if (!f._blobUrl) f._blobUrl = URL.createObjectURL(f);
      return f._blobUrl;
    }
  } else if (jobId) {
    return `/api/clip_preview/${jobId}/${encodeURIComponent(clipName)}`;
  }
  return null;
}

// Preload upcoming shot into the standby deck so there is ZERO black flash when cutting!
function preloadNextShotIntoStandby(nextShotIdx) {
  if (nextShotIdx < 0 || nextShotIdx >= shotPlan.length || !sourcePreviewB) return;
  const nextShot = shotPlan[nextShotIdx];
  const targetSrc = resolveShotSourceUrl(nextShot);
  if (!targetSrc) return;

  const standby = getStandbyVideoDeck();
  if (standby.getAttribute("data-clip") !== nextShot.clip || standby.getAttribute("src") !== targetSrc) {
    standby.src = targetSrc;
    standby.setAttribute("data-clip", nextShot.clip);
  }
  standby.muted = true;
  const seekTo = getShotDeckIn(nextShot);
  const applySeek = () => {
    try {
      standby.currentTime = seekTo;
    } catch (e) {}
  };
  if (standby.readyState >= 1) {
    applySeek();
  } else {
    standby.addEventListener("loadedmetadata", applySeek, { once: true });
  }
}

function previewSelectedShotInMonitor(autoPlay = true, useDeckSwitch = false, customSeekTime = null) {
  if (selectedShotIdx < 0 || selectedShotIdx >= shotPlan.length) return;
  const shot = shotPlan[selectedShotIdx];
  const targetSrc = resolveShotSourceUrl(shot);
  if (!targetSrc) return;

  const keepOrigAudio = $("keep-audio") && $("keep-audio").checked;
  const aUrl = getActiveAudioUrl();

  let activeVideo = getVisibleVideoDeck();
  let outgoingVideo = null;
  if (useDeckSwitch && sourcePreviewB) {
    outgoingVideo = activeVideo;
    activeVideo = getStandbyVideoDeck();
  }

  const isSameClip = (activeVideo.getAttribute("data-clip") === shot.clip) && (activeVideo.getAttribute("src") === targetSrc);
  if (!isSameClip) {
    activeVideo.src = targetSrc;
    activeVideo.setAttribute("data-clip", shot.clip);
  }

  showMonitorTab("source");
  applyReframeTransformToPreview();

  const seekTo = (customSeekTime !== null && customSeekTime !== undefined)
    ? Number(customSeekTime)
    : getShotDeckIn(shot);
  activeVideo.muted = isPlayingSequence ? Boolean(aUrl && !keepOrigAudio) : false;

  const applySeekAndPlay = () => {
    try {
      if (Math.abs(activeVideo.currentTime - seekTo) > 0.02) {
        activeVideo.currentTime = seekTo;
      }
      if (autoPlay) activeVideo.play().catch(() => {});
    } catch (e) {}
    if (useDeckSwitch && sourcePreviewB) {
      switchActiveVideoDeck();
      if (outgoingVideo) {
        outgoingVideo.pause();
        outgoingVideo.muted = true;
      }
    }
  };

  if (activeVideo.readyState >= 1) {
    applySeekAndPlay();
  } else {
    activeVideo.addEventListener("loadedmetadata", applySeekAndPlay, { once: true });
  }

  // Pre-buffer next shot in the background for instant 0ms cut
  if (selectedShotIdx + 1 < shotPlan.length) {
    preloadNextShotIntoStandby(selectedShotIdx + 1);
  }
}

function initDraftTimelineFromRhythm() {
  if (!currentRhythm || !currentRhythm.shots) return;
  const names = localFolderPath ? localClipNames : clipFiles.map((f) => f.name);
  if (!names.length) {
    shotPlan = currentRhythm.shots.map((s, idx) => ({
      index: idx,
      clip: `Shot ${idx + 1} (awaiting clips)`,
      in_point: 0,
      duration: s.duration,
      clip_duration: s.duration,
      crop: "center",
      zoom: 100,
      pan_x: 0,
      pan_y: 0,
      grade: defaultGrade(),
      tag: s.tag || null,
    }));
    renderTimelineTrack();
    return;
  }

  availableClips = [...names];
  shotPlan = currentRhythm.shots.map((s, idx) => ({
    index: idx,
    clip: names[idx % names.length],
    in_point: 0.0,
    duration: s.duration,
    clip_duration: 15.0,
    crop: "center",
    zoom: 100,
    pan_x: 0,
    pan_y: 0,
    grade: defaultGrade(),
    tag: s.tag || null,
  }));
  renderTimelineTrack();
}

// Premiere-style Edge Trim Drag State
let activeEdgeTrim = null; // { idx, side: 'left'|'right', startX, origIn, origDur, clipDur, cardEl, metaEl }

window.addEventListener("mousemove", (e) => {
  if (!activeEdgeTrim) return;
  const { idx, side, startX, origIn, origDur, clipDur, cardEl, metaEl, startSec, totalDur, trackWidth } = activeEdgeTrim;
  const shot = shotPlan[idx];
  if (!shot) return;
  const dxPx = e.clientX - startX;
  const pxPerSec = (trackWidth && totalDur) ? (trackWidth / totalDur) : 120.0;
  const deltaSec = dxPx / pxPerSec;

  // Auto-scroll timeline tracks container if dragging near viewport edges
  if (timelineTracksWrap) {
    const wrapRect = timelineTracksWrap.getBoundingClientRect();
    if (e.clientX > wrapRect.right - 50) {
      timelineTracksWrap.scrollLeft += 18;
    } else if (e.clientX < wrapRect.left + 50) {
      timelineTracksWrap.scrollLeft -= 18;
    }
  }

  if (side === "left") {
    // Dragging left edge '[' adjusts In-Point and inversely adjusts Duration
    const maxIn = Math.max(0, origIn + origDur - 0.15);
    let newIn = Math.max(0, Math.min(maxIn, origIn + deltaSec));
    let actualDelta = newIn - origIn;
    let newDur = Math.max(0.15, origDur - actualDelta);
    let newStartSec = Math.max(0, startSec + actualDelta);

    if (isMagnetEnabled) {
      const snapRes = snapTimeToNearest(newStartSec, totalDur, trackWidth, null, 10, startSec);
      if (snapRes.snapped) {
        newStartSec = snapRes.time;
        actualDelta = newStartSec - startSec;
        newIn = Math.max(0, Math.min(maxIn, origIn + actualDelta));
        newDur = Math.max(0.15, origDur - actualDelta);
        showTimelineSnapGuide(snapRes.time, totalDur, trackWidth);
      } else {
        hideTimelineSnapGuide();
      }
    } else {
      hideTimelineSnapGuide();
    }

    shot.in_point = Number(newIn.toFixed(2));
    shot.duration = Number(newDur.toFixed(2));

    const leftPx = Math.round((newStartSec / totalDur) * trackWidth);
    const widthPx = Math.max(14, Math.round((newDur / totalDur) * trackWidth));
    if (cardEl) {
      cardEl.style.left = `${leftPx}px`;
      cardEl.style.width = `${widthPx}px`;
    }

    if (selectedShotIdx === idx && sourcePreview) {
      showMonitorTab("source");
      try {
        sourcePreview.currentTime = shot.in_point;
      } catch (err) {}
    }
  } else {
    // Dragging right edge ']' adjusts Out-Point / Duration
    const actualClipDur = Math.max(Number(shot.clip_duration || 0), (sourcePreview && sourcePreview.duration > 0) ? sourcePreview.duration : 60.0);
    const maxDur = Math.max(0.5, actualClipDur - origIn);
    let newDur = Math.max(0.15, Math.min(maxDur, origDur + deltaSec));
    let clipEndTime = startSec + newDur;

    if (isMagnetEnabled) {
      const snapRes = snapTimeToNearest(clipEndTime, totalDur, trackWidth, null, 10, startSec + origDur);
      if (snapRes.snapped) {
        clipEndTime = snapRes.time;
        newDur = Math.max(0.15, Math.min(maxDur, clipEndTime - startSec));
        showTimelineSnapGuide(snapRes.time, totalDur, trackWidth);
      } else {
        hideTimelineSnapGuide();
      }
    } else {
      hideTimelineSnapGuide();
    }

    shot.duration = Number(newDur.toFixed(2));

    const widthPx = Math.max(14, Math.round((newDur / totalDur) * trackWidth));
    if (cardEl) {
      cardEl.style.width = `${widthPx}px`;
    }

    if (selectedShotIdx === idx && sourcePreview) {
      showMonitorTab("source");
      try {
        sourcePreview.currentTime = Math.max(0, Number(shot.in_point || 0) + shot.duration - 0.05);
      } catch (err) {}
    }
  }

  if (metaEl) {
    metaEl.innerHTML = `<span>In: ${Number(shot.in_point || 0).toFixed(1)}s</span><span>${Number(shot.duration || 0).toFixed(2)}s</span>`;
  }
  const curTotalDur = shotPlan.reduce((acc, s) => acc + Number(s.duration || 0), 0);
  if (tlSummary) tlSummary.textContent = `${shotPlan.length} shots · ${curTotalDur.toFixed(2)}s total`;
  if (selectedShotIdx === idx) {
    if (inspInpoint) inspInpoint.value = Number(shot.in_point || 0).toFixed(2);
    if (inspInpointSlider) inspInpointSlider.value = shot.in_point || 0;
    if (inspDuration) inspDuration.value = Number(shot.duration || 0).toFixed(2);
  }
  markTimelineDirty();
});

window.addEventListener("mouseup", () => {
  hideTimelineSnapGuide();
  if (activeEdgeTrim) {
    const trimmedIdx = activeEdgeTrim.idx;
    const wasLeft = activeEdgeTrim.side === "left";
    activeEdgeTrim = null;
    renderTimelineTrack();
    if (selectedShotIdx === trimmedIdx && wasLeft) {
      previewSelectedShotInMonitor(false);
    }
  }
});

function updateAudioTrackReadout() {
  if (!tlAudioOffsetLabel) return;
  const lenText = audioDurationSec > 0.1 ? `${audioDurationSec.toFixed(1)}s` : "Auto";
  tlAudioOffsetLabel.textContent = `In: ${audioStartOffset.toFixed(1)}s · Len: ${lenText}`;
}

function renderTimecodeRuler(totalWidthPx, totalDurSec) {
  if (!tlRulerStrip) return;
  tlRulerStrip.innerHTML = "";
  const width = Math.max(600, totalWidthPx);
  tlRulerStrip.style.width = `${width}px`;
  if (tlAudioClip) {
    if (audioDurationSec > 0.1 && totalDurSec > 0.1) {
      const aIn = Number(audioStartOffset || 0);
      const aLeftPx = Math.round((aIn / totalDurSec) * width);
      const ratio = Math.max(0.05, Math.min(2.0, audioDurationSec / totalDurSec));
      tlAudioClip.style.marginLeft = `${aLeftPx}px`;
      tlAudioClip.style.width = `${Math.max(120, Math.round(width * ratio))}px`;
    } else {
      tlAudioClip.style.marginLeft = "0px";
      tlAudioClip.style.width = `${width}px`;
    }
  }
  updateAudioTrackReadout();

  const stepSec = totalDurSec > 40 ? 4 : (totalDurSec > 20 ? 2 : 1);
  const totalTicks = Math.max(5, Math.ceil((totalDurSec || 10) / stepSec));
  const tickWidth = width / totalTicks;

  for (let i = 0; i < totalTicks; i++) {
    const t = i * stepSec;
    const mins = Math.floor(t / 60);
    const secs = Math.floor(t % 60);
    const tick = document.createElement("div");
    tick.className = "tl-ruler-tick";
    tick.style.width = `${tickWidth}px`;
    tick.textContent = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    tlRulerStrip.appendChild(tick);
  }
}

function renderTimelineTrack() {
  if (!shotPlan || !shotPlan.length) return;
  tlShotsStrip.innerHTML = "";

  const totalDur = shotPlan.reduce((acc, s) => acc + Number(s.duration || 0), 0) || 10.0;
  tlSummary.textContent = `${shotPlan.length} shots · ${totalDur.toFixed(2)}s total`;

  // DaVinci Resolve-style 1:1 linear timeline scale (120px/sec)
  const pxPerSec = 120;
  const trackWidth = Math.max(720, Math.round(totalDur * pxPerSec));
  tlShotsStrip.style.width = `${trackWidth}px`;

  let accTime = 0;

  shotPlan.forEach((shot, idx) => {
    shot.index = idx;
    ensureShotGrade(shot);
    const card = document.createElement("div");
    card.className = "tl-shot-card" + (idx === selectedShotIdx ? " selected" : "");
    card.dataset.idx = idx;

    const startSec = accTime;
    const durSec = Math.max(0.1, Number(shot.duration || 1.0));
    accTime += durSec;

    // Linear time-to-pixel positioning matching playhead and text track 1:1
    const leftPx = Math.round((startSec / totalDur) * trackWidth);
    const rightPx = Math.round(((startSec + durSec) / totalDur) * trackWidth);
    const widthPx = Math.max(14, rightPx - leftPx);

    card.style.left = `${leftPx}px`;
    card.style.width = `${widthPx}px`;
    card.draggable = true;

    if (widthPx < 70) card.classList.add("compact");
    if (widthPx < 40) card.classList.add("ultra-compact");

    const shortClip = (shot.clip || "").replace(/\.(mov|mp4|m4v|mkv|avi|webm)$/i, "");
    const zoomNum = Math.round(shot.zoom !== undefined ? shot.zoom : 100);
    const g = shot.grade || {};
    const texts = ensureShotTexts(shot);
    const hasGrade =
      g.brightness || g.contrast || g.saturation || g.temperature || g.tint || g.whites || g.blacks || g.vignette ||
      (g.curve && g.curve !== "none") || g.fade_in > 0 || g.fade_out > 0;
    const hasText = texts.some((tx) => Boolean((tx.content || "").trim()));
    const gradeDot = (hasGrade ? " 🎨" : "") + (hasText ? " 🔤" : "");
    const revBadge = shot.reverse ? `<span class="tl-rev-badge" title="Reversed clip">⏪ REV</span>` : "";
    const tagBadge = shot.tag
      ? `<span class="tl-shot-tag">${shot.tag}${gradeDot}${revBadge}</span>`
      : `<span class="tl-shot-tag">${zoomNum}%${gradeDot}${revBadge}</span>`;
    if (shot.reverse) card.classList.add("reversed");

    if (shot.clip && !shot.clip.includes("(awaiting clips)")) {
      if (!localFolderPath && clipFiles.length) {
        const f = clipFiles.find((cf) => cf.name === shot.clip);
        if (f) {
          getClientThumb(f, shot.in_point || 0, (dataUrl) => {
            card.style.backgroundImage = `url("${dataUrl}")`;
          });
        }
      } else if (jobId) {
        const thumbUrl = `/api/clip_thumb/${jobId}/${encodeURIComponent(shot.clip)}?t=${Number(shot.in_point || 0).toFixed(1)}`;
        card.style.backgroundImage = `url("${thumbUrl}")`;
      } else if (localFolderPath) {
        const thumbUrl = `/api/folder_thumb?folder=${encodeURIComponent(localFolderPath)}&clip=${encodeURIComponent(shot.clip)}`;
        card.style.backgroundImage = `url("${thumbUrl}")`;
      }
    }

    card.innerHTML = `
      <div class="tl-trim-handle left" title="Drag left/right to trim In-Point">[</div>
      <div class="tl-shot-top">
        <span class="tl-shot-num">#${String(idx + 1).padStart(2, "0")}</span>
        ${tagBadge}
      </div>
      <div class="tl-shot-bottom">
        <div class="tl-shot-name" title="${shot.clip}">${shortClip}</div>
        <div class="tl-shot-meta">
          <span>In: ${Number(shot.in_point || 0).toFixed(1)}s</span>
          <span>${Number(shot.duration || 0).toFixed(2)}s</span>
        </div>
      </div>
      <div class="tl-trim-handle right" title="Drag left/right to trim Out-Point / Duration">]</div>
    `;

    const leftHandle = card.querySelector(".tl-trim-handle.left");
    const rightHandle = card.querySelector(".tl-trim-handle.right");
    const metaEl = card.querySelector(".tl-shot-meta");

    [leftHandle, rightHandle].forEach((handleEl, hIdx) => {
      if (!handleEl) return;
      handleEl.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        e.preventDefault();
        pushUndoState();
        selectedShotIdx = idx;
        lastSelectedTrackType = "shot";
        deselectAudioTrack();
        populateInspector();
        activeEdgeTrim = {
          idx,
          side: hIdx === 0 ? "left" : "right",
          startX: e.clientX,
          origIn: Number(shot.in_point || 0),
          origDur: Number(shot.duration || 1.0),
          clipDur: Number(shot.clip_duration || 20.0),
          cardEl: card,
          metaEl,
          startSec,
          totalDur,
          trackWidth,
        };
      });
    });

    card.addEventListener("click", () => selectShot(idx));

    card.addEventListener("dragstart", (e) => {
      if (activeEdgeTrim) {
        e.preventDefault();
        return;
      }
      e.dataTransfer.setData("text/plain", String(idx));
    });
    card.addEventListener("dragover", (e) => {
      e.preventDefault();
      card.classList.add("drag-over");
    });
    card.addEventListener("dragleave", () => {
      card.classList.remove("drag-over");
    });
    card.addEventListener("drop", (e) => {
      e.preventDefault();
      card.classList.remove("drag-over");
      const fromIdx = parseInt(e.dataTransfer.getData("text/plain"), 10);
      if (!isNaN(fromIdx) && fromIdx !== idx) {
        pushUndoState();
        const moved = shotPlan.splice(fromIdx, 1)[0];
        shotPlan.splice(idx, 0, moved);
        selectedShotIdx = idx;
        lastSelectedTrackType = "shot";
        markTimelineDirty();
        renderTimelineTrack();
        populateInspector();
      }
    });

    tlShotsStrip.appendChild(card);
  });

  renderTimecodeRuler(trackWidth, totalDur);
  renderTextTrack();
  updatePlayheadPosition(getCurrentSequenceTime());

  btnMoveLeft.disabled = selectedShotIdx <= 0;
  btnMoveRight.disabled = selectedShotIdx < 0 || selectedShotIdx >= shotPlan.length - 1;
  updateReverseControls();
  updateTimelineDeleteButton();
}

// ---------- A1 Audio Track Controls (Add Audio, Drag Left/Right to Trim Start & Length, Volume) ----------
if (btnAddAudio && inputCustomAudio) {
  btnAddAudio.addEventListener("click", () => inputCustomAudio.click());
  inputCustomAudio.addEventListener("change", () => {
    const f = inputCustomAudio.files[0];
    if (!f) return;
    pushUndoState();
    customAudioFile = f;
    clearCustomAudioFlag = false;
    audioStartOffset = 0.0;
    audioDurationSec = 0.0;
    if (tlAudioTitle) tlAudioTitle.textContent = `🎵 Custom Audio: ${f.name}`;
    updateAudioTrackReadout();
    if (btnClearAudio) btnClearAudio.classList.remove("hidden");
    const overlayCb = $("overlay-audio");
    if (overlayCb) overlayCb.checked = true;
    renderTimelineTrack();
    markTimelineDirty();
  });
}

function selectAudioTrack() {
  lastSelectedTrackType = "audio";
  isAudioTrackSelected = true;
  if (tlAudioClip) tlAudioClip.classList.add("selected");
  if (tlTextStrip) {
    Array.from(tlTextStrip.querySelectorAll(".tl-text-clip")).forEach((el) => {
      el.classList.remove("selected");
    });
  }
  updateTimelineDeleteButton();
}

function deselectAudioTrack() {
  isAudioTrackSelected = false;
  if (tlAudioClip) tlAudioClip.classList.remove("selected");
  updateTimelineDeleteButton();
}

function deleteAudioTrack() {
  pushUndoState();
  customAudioFile = null;
  customAudioPath = null;
  clearCustomAudioFlag = true;
  audioStartOffset = 0.0;
  audioDurationSec = 0.0;
  if (inputCustomAudio) inputCustomAudio.value = "";
  if (tlAudioTitle) tlAudioTitle.textContent = "🔊 Reference Audio Track (Synced)";
  updateAudioTrackReadout();
  if (btnClearAudio) btnClearAudio.classList.add("hidden");
  if (liveAudioPlayer) {
    liveAudioPlayer.pause();
    liveAudioPlayer.removeAttribute("src");
  }
  deselectAudioTrack();
  lastSelectedTrackType = "shot";
  renderTimelineTrack();
  markTimelineDirty();
  updateTimelineDeleteButton();
}

if (tlAudioClip) {
  tlAudioClip.addEventListener("click", (e) => {
    if (e.target && (e.target.classList.contains("tl-trim-handle") || e.target.tagName.toLowerCase() === "input")) return;
    selectAudioTrack();
  });
}

if (btnClearAudio) {
  btnClearAudio.addEventListener("click", () => {
    deleteAudioTrack();
  });
}

if (tlAudioVol) {
  tlAudioVol.addEventListener("mousedown", () => pushUndoState());
  tlAudioVol.addEventListener("input", () => {
    audioVolumePct = parseInt(tlAudioVol.value, 10) || 100;
    if (tlAudioVolLabel) tlAudioVolLabel.textContent = `${audioVolumePct}%`;
    syncLiveAudioVolume();
    markTimelineDirty();
  });
}

let activeAudioTrimSide = null; // 'left' | 'right'
let audioTrimStartX = 0;
let audioOrigOffset = 0;
let audioOrigDur = 0;
let audioOrigWidthPx = 480;

if (tlAudioTrimLeft) {
  tlAudioTrimLeft.addEventListener("mousedown", (e) => {
    e.stopPropagation();
    e.preventDefault();
    pushUndoState();
    activeAudioTrimSide = "left";
    audioTrimStartX = e.clientX;
    audioOrigOffset = audioStartOffset;
    const totalSeqDur = shotPlan.reduce((acc, s) => acc + Number(s.duration || 0), 0) || 10.0;
    audioOrigDur = audioDurationSec > 0.1 ? audioDurationSec : totalSeqDur;
    audioOrigWidthPx = tlAudioClip ? tlAudioClip.getBoundingClientRect().width : 480;
  });
}

if (tlAudioTrimRight) {
  tlAudioTrimRight.addEventListener("mousedown", (e) => {
    e.stopPropagation();
    e.preventDefault();
    pushUndoState();
    activeAudioTrimSide = "right";
    audioTrimStartX = e.clientX;
    const totalSeqDur = shotPlan.reduce((acc, s) => acc + Number(s.duration || 0), 0) || 10.0;
    audioOrigDur = audioDurationSec > 0.1 ? audioDurationSec : totalSeqDur;
    audioOrigWidthPx = tlAudioClip ? tlAudioClip.getBoundingClientRect().width : 480;
  });
}

window.addEventListener("mousemove", (e) => {
  if (!activeAudioTrimSide) return;
  const dx = e.clientX - audioTrimStartX;
  const totalSeqDur = shotPlan.reduce((acc, s) => acc + Number(s.duration || 0), 0) || 10.0;
  const trackWidth = tlRulerStrip ? (tlRulerStrip.getBoundingClientRect().width || 600) : 600;
  const pxPerSec = Math.max(40, trackWidth / totalSeqDur);

  if (activeAudioTrimSide === "left") {
    // Dragging left edge '[' adjusts Audio Start Offset and shrinks/grows length
    const deltaSec = dx / pxPerSec;
    let newOffset = Math.max(0, Number((audioOrigOffset + deltaSec).toFixed(1)));

    if (isMagnetEnabled) {
      const snapRes = snapTimeToNearest(newOffset, totalSeqDur, trackWidth, null, 10);
      if (snapRes.snapped) {
        newOffset = snapRes.time;
        showTimelineSnapGuide(snapRes.time, totalSeqDur, trackWidth);
      } else {
        hideTimelineSnapGuide();
      }
    } else {
      hideTimelineSnapGuide();
    }

    const actualDelta = newOffset - audioOrigOffset;
    audioStartOffset = newOffset;
    audioDurationSec = Math.max(0.5, Number((audioOrigDur - actualDelta).toFixed(1)));
    if (tlAudioClip) {
      const aLeftPx = Math.round((newOffset / totalSeqDur) * trackWidth);
      const ratio = Math.max(0.05, Math.min(2.0, audioDurationSec / totalSeqDur));
      tlAudioClip.style.marginLeft = `${aLeftPx}px`;
      tlAudioClip.style.width = `${Math.max(120, Math.round(trackWidth * ratio))}px`;
    }
  } else if (activeAudioTrimSide === "right") {
    // Dragging right edge ']' adjusts Audio Track Length / Out-Point
    const deltaSec = dx / pxPerSec;
    let rawEnd = audioOrigOffset + audioOrigDur + deltaSec;

    if (isMagnetEnabled) {
      const snapRes = snapTimeToNearest(rawEnd, totalSeqDur, trackWidth, null, 10);
      if (snapRes.snapped && snapRes.time > audioStartOffset + 0.5) {
        rawEnd = snapRes.time;
        showTimelineSnapGuide(snapRes.time, totalSeqDur, trackWidth);
      } else {
        hideTimelineSnapGuide();
      }
    } else {
      hideTimelineSnapGuide();
    }

    audioDurationSec = Math.max(0.5, Number((rawEnd - audioStartOffset).toFixed(1)));
    if (tlAudioClip) {
      const ratio = Math.max(0.05, Math.min(2.0, audioDurationSec / totalSeqDur));
      tlAudioClip.style.width = `${Math.max(120, Math.round(trackWidth * ratio))}px`;
    }
  }
  updateAudioTrackReadout();
  markTimelineDirty();
});

window.addEventListener("mouseup", () => {
  hideTimelineSnapGuide();
  if (activeAudioTrimSide) {
    activeAudioTrimSide = null;
  }
});

function markTimelineDirty() {
  timelineDirty = true;
  if (jobId && (clipFiles.length || localFolderPath || availableClips.length)) {
    btnRebuildOrder.classList.remove("hidden");
    if (btnBuild) btnBuild.disabled = false;
  }
}

function selectShot(idx) {
  stopSequencePlayback();
  if (sourcePreview) sourcePreview.muted = false;
  selectedShotIdx = idx;
  lastSelectedTrackType = "shot";
  deselectAudioTrack();
  renderTimelineTrack();
  populateInspector();
  previewSelectedShotInMonitor(false);
  updateTimelineDeleteButton();
}

function populateGradingControls(shot) {
  const g = ensureShotGrade(shot);
  if (slGradeBrightness) slGradeBrightness.value = g.brightness;
  if (valGradeBrightness) valGradeBrightness.textContent = g.brightness > 0 ? `+${g.brightness}` : String(g.brightness);

  if (slGradeContrast) slGradeContrast.value = g.contrast;
  if (valGradeContrast) valGradeContrast.textContent = g.contrast > 0 ? `+${g.contrast}` : String(g.contrast);

  if (slGradeSaturation) slGradeSaturation.value = g.saturation;
  if (valGradeSaturation) valGradeSaturation.textContent = g.saturation > 0 ? `+${g.saturation}` : String(g.saturation);

  if (slGradeTemp) slGradeTemp.value = g.temperature;
  if (valGradeTemp) valGradeTemp.textContent = g.temperature > 0 ? `+${g.temperature}` : String(g.temperature);

  if (slGradeTint) slGradeTint.value = g.tint;
  if (valGradeTint) valGradeTint.textContent = g.tint > 0 ? `+${g.tint}` : String(g.tint);

  if (slGradeWhites) slGradeWhites.value = g.whites;
  if (valGradeWhites) valGradeWhites.textContent = g.whites > 0 ? `+${g.whites}` : String(g.whites);

  if (slGradeBlacks) slGradeBlacks.value = g.blacks;
  if (valGradeBlacks) valGradeBlacks.textContent = g.blacks > 0 ? `+${g.blacks}` : String(g.blacks);

  if (slGradeVignette) slGradeVignette.value = g.vignette;
  if (valGradeVignette) valGradeVignette.textContent = `${g.vignette}%`;

  if (selGradeCurve) selGradeCurve.value = g.curve || "none";
  if (numGradeFadeIn) numGradeFadeIn.value = Number(g.fade_in || 0).toFixed(1);
  if (numGradeFadeOut) numGradeFadeOut.value = Number(g.fade_out || 0).toFixed(1);
}

function populateInspector() {
  if (activeInspectorSubtab === "text") {
    if (inspEmpty) inspEmpty.classList.add("hidden");
    if (inspControls) inspControls.classList.remove("hidden");
    if (inspShotBadge) inspShotBadge.textContent = selectedTextTrackId ? "Text Layer Selected" : "Timeline Text Track (T1)";
    populateTextControls();
    return;
  }

  if (selectedShotIdx < 0 || selectedShotIdx >= shotPlan.length) {
    if (inspEmpty) inspEmpty.classList.remove("hidden");
    if (inspControls) inspControls.classList.add("hidden");
    if (inspShotBadge) inspShotBadge.textContent = "No shot selected";
    return;
  }

  const shot = shotPlan[selectedShotIdx];
  if (shot.zoom === undefined) shot.zoom = 100;
  if (shot.pan_x === undefined) shot.pan_x = 0;
  if (shot.pan_y === undefined) shot.pan_y = 0;
  ensureShotGrade(shot);

  if (inspEmpty) inspEmpty.classList.add("hidden");
  if (inspControls) inspControls.classList.remove("hidden");
  if (inspShotBadge) inspShotBadge.textContent = `Shot #${String(selectedShotIdx + 1).padStart(2, "0")}`;

  inspClipSelect.innerHTML = "";
  const pool = availableClips.length ? availableClips : [shot.clip];
  pool.forEach((cname) => {
    const opt = document.createElement("option");
    opt.value = cname;
    opt.textContent = cname;
    if (cname === shot.clip) opt.selected = true;
    inspClipSelect.appendChild(opt);
  });

  const maxIn = Math.max(0.5, Number((shot.clip_duration || 12) - shot.duration).toFixed(2));
  inspInpointMax.textContent = `clip len: ${Number(shot.clip_duration || 0).toFixed(1)}s`;
  inspInpointSlider.max = maxIn;
  inspInpointSlider.value = shot.in_point || 0;
  inspInpoint.value = Number(shot.in_point || 0).toFixed(2);
  inspDuration.value = Number(shot.duration || 1.0).toFixed(2);

  populateGradingControls(shot);
  populateTextControls();
  applyReframeTransformToPreview();
  updateReverseControls();
}

// ---------- Per-Clip Reverse Toggle ----------
function updateReverseControls() {
  const hasSel = selectedShotIdx >= 0 && selectedShotIdx < shotPlan.length;
  const on = hasSel && Boolean(shotPlan[selectedShotIdx].reverse);
  if (btnTlReverse) {
    btnTlReverse.disabled = !hasSel;
    btnTlReverse.classList.toggle("reverse-on", on);
  }
  if (btnInspReverse) {
    btnInspReverse.classList.toggle("reverse-on", on);
    btnInspReverse.textContent = on ? "⏪ Reversed — click to play forward" : "⏪ Reverse Clip";
  }
  if (inspReverseState) {
    inspReverseState.textContent = on ? "Reversed" : "Forward";
    inspReverseState.style.color = on ? "var(--accent)" : "var(--text-dim)";
  }
}

function toggleReverseSelectedClip() {
  if (selectedShotIdx < 0 || selectedShotIdx >= shotPlan.length) return;
  const shot = shotPlan[selectedShotIdx];
  if (!shot.clip || shot.clip.includes("(awaiting clips)")) return;
  pushUndoState();
  stopSequencePlayback();
  shot.reverse = !shot.reverse;
  markTimelineDirty();
  renderTimelineTrack();
  updateReverseControls();
  previewSelectedShotInMonitor(false);
  if (shot.reverse && !isShotReversedPreview(shot)) {
    const hintEl = $("tl-hint");
    if (hintEl) hintEl.textContent = "⏪ Reverse will be applied on render (live reverse preview needs a saved job).";
  }
}

if (btnTlReverse) btnTlReverse.addEventListener("click", toggleReverseSelectedClip);
if (btnInspReverse) btnInspReverse.addEventListener("click", toggleReverseSelectedClip);

function populateTextControls() {
  renderTextItemPills();

  if (!textTrackItems.length) {
    if (txtSelectedEditor) txtSelectedEditor.classList.add("hidden");
    return;
  }
  if (txtSelectedEditor) txtSelectedEditor.classList.remove("hidden");

  const item = getSelectedTextTrackItem();
  if (!item) return;

  if (txtOverlayContent && document.activeElement !== txtOverlayContent) {
    txtOverlayContent.value = item.content || "";
  }
  if (numTxtStart && document.activeElement !== numTxtStart) {
    numTxtStart.value = Number(item.start_time || 0).toFixed(2);
  }
  if (numTxtDur && document.activeElement !== numTxtDur) {
    numTxtDur.value = Number(item.duration || 1.0).toFixed(2);
  }
  if (selTxtFont) selTxtFont.value = item.font || "Arial Bold";
  if (selTxtBgStyle) selTxtBgStyle.value = item.bg_style || "plain";
  if (slTxtSize) slTxtSize.value = item.size || 56;
  if (valTxtSize) valTxtSize.textContent = `${item.size || 56}px`;
  if (colTxtColor) colTxtColor.value = item.color || "#FFFFFF";
  if (colTxtBg) colTxtBg.value = item.bg_color || "#1F2C38";
  if (txtPosReadout) {
    txtPosReadout.textContent = `Position: X ${Math.round(item.x !== undefined ? item.x : 50)}% · Y ${Math.round(item.y !== undefined ? item.y : 80)}% (Drag text in monitor to move)`;
  }
}

if (btnTxtAddItem) {
  btnTxtAddItem.addEventListener("click", () => {
    addNewTextTrackItem();
  });
}

if (btnAddTimelineText) {
  btnAddTimelineText.addEventListener("click", (e) => {
    e.stopPropagation();
    addNewTextTrackItem();
  });
}

// Attach CTI Playhead and Timecode Ruler Scrubbing
if (tlPlayheadHead) {
  tlPlayheadHead.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    stopSequencePlayback();
    isScrubbingPlayhead = true;
    if (tlPlayhead) tlPlayhead.classList.add("scrubbing");
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  });
}

if (tlRulerStrip) {
  tlRulerStrip.addEventListener("mousedown", (e) => {
    e.preventDefault();
    stopSequencePlayback();
    isScrubbingPlayhead = true;
    if (tlPlayhead) tlPlayhead.classList.add("scrubbing");
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    const totalDur = shotPlan && shotPlan.length
      ? shotPlan.reduce((acc, s) => acc + Number(s.duration || 0), 0)
      : 10.0;
    const rulerRect = tlRulerStrip.getBoundingClientRect();
    const mouseX = e.clientX - rulerRect.left;
    const ratio = Math.max(0, Math.min(1, mouseX / rulerRect.width));
    seekSequenceToTime(ratio * totalDur);
  });
}

if (tlTextStrip) {
  tlTextStrip.addEventListener("dblclick", (e) => {
    if (e.target.closest(".tl-text-clip")) return;
    const totalDur = shotPlan && shotPlan.length
      ? shotPlan.reduce((acc, s) => acc + Number(s.duration || 0), 0)
      : 10.0;
    const rect = tlTextStrip.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    const startTime = Math.round(ratio * totalDur * 10) / 10;
    addNewTextTrackItem(startTime);
  });
}

if (btnTxtDuplicate) {
  btnTxtDuplicate.addEventListener("click", () => {
    duplicateSelectedTextTrackItem();
  });
}

if (btnTxtDeleteSelected) {
  btnTxtDeleteSelected.addEventListener("click", () => {
    deleteSelectedTextTrackItem();
  });
}

if (txtOverlayContent) {
  txtOverlayContent.addEventListener("focus", () => {
    pushUndoState();
  });
  txtOverlayContent.addEventListener("input", () => {
    let item = getSelectedTextTrackItem();
    if (!item) {
      addNewTextTrackItem();
      item = getSelectedTextTrackItem();
    }
    if (!item) return;
    item.content = txtOverlayContent.value;

    applyTimelineTextOverlayToPreview();
    renderTextTrack();
    renderTextItemPills();
    markTimelineDirty();
  });
}

if (numTxtStart) {
  numTxtStart.addEventListener("change", () => {
    const item = getSelectedTextTrackItem();
    if (!item) return;
    pushUndoState();
    const val = Math.max(0, parseFloat(numTxtStart.value) || 0);
    item.start_time = Number(val.toFixed(2));
    numTxtStart.value = item.start_time.toFixed(2);
    renderTextTrack();
    applyTimelineTextOverlayToPreview(item.start_time);
    markTimelineDirty();
  });
}

if (numTxtDur) {
  numTxtDur.addEventListener("change", () => {
    const item = getSelectedTextTrackItem();
    if (!item) return;
    pushUndoState();
    const val = Math.max(0.2, parseFloat(numTxtDur.value) || 1.0);
    item.duration = Number(val.toFixed(2));
    numTxtDur.value = item.duration.toFixed(2);
    renderTextTrack();
    applyTimelineTextOverlayToPreview(item.start_time);
    markTimelineDirty();
  });
}

if (selTxtFont) {
  selTxtFont.addEventListener("change", () => {
    const item = getSelectedTextTrackItem();
    if (!item) return;
    pushUndoState();
    item.font = selTxtFont.value;
    applyTimelineTextOverlayToPreview();
    markTimelineDirty();
  });
}

if (selTxtBgStyle) {
  selTxtBgStyle.addEventListener("change", () => {
    const item = getSelectedTextTrackItem();
    if (!item) return;
    pushUndoState();
    item.bg_style = selTxtBgStyle.value;
    applyTimelineTextOverlayToPreview();
    markTimelineDirty();
  });
}

if (slTxtSize) {
  slTxtSize.addEventListener("mousedown", () => {
    pushUndoState();
  });
  slTxtSize.addEventListener("input", () => {
    const item = getSelectedTextTrackItem();
    if (!item) return;
    const sz = parseInt(slTxtSize.value, 10) || 56;
    item.size = sz;
    if (valTxtSize) valTxtSize.textContent = `${sz}px`;
    applyTimelineTextOverlayToPreview();
    markTimelineDirty();
  });
}

if (colTxtColor) {
  colTxtColor.addEventListener("input", () => {
    const item = getSelectedTextTrackItem();
    if (!item) return;
    item.color = colTxtColor.value;
    applyTimelineTextOverlayToPreview();
    markTimelineDirty();
  });
}

if (colTxtBg) {
  colTxtBg.addEventListener("input", () => {
    const item = getSelectedTextTrackItem();
    if (!item) return;
    item.bg_color = colTxtBg.value;
    applyTimelineTextOverlayToPreview();
    markTimelineDirty();
  });
}

Array.from(document.querySelectorAll(".txt-pos-btn")).forEach((btn) => {
  btn.addEventListener("click", () => {
    const item = getSelectedTextTrackItem();
    if (!item) return;
    pushUndoState();
    item.x = 50;
    item.y = parseFloat(btn.dataset.y) || 80;
    if (txtPosReadout) {
      txtPosReadout.textContent = `Position: X 50% · Y ${Math.round(item.y)}% (Drag text in monitor to move)`;
    }
    applyTimelineTextOverlayToPreview();
    markTimelineDirty();
  });
});

if (btnTxtAll) {
  btnTxtAll.addEventListener("click", () => {
    const item = getSelectedTextTrackItem();
    if (!item) return;
    pushUndoState();
    const totalDur = shotPlan.reduce((acc, s) => acc + Number(s.duration || 0), 0) || 10.0;
    item.start_time = 0.0;
    item.duration = Number(totalDur.toFixed(2));
    populateTextControls();
    renderTextTrack();
    applyTimelineTextOverlayToPreview();
    markTimelineDirty();
    setStatus(buildStatus, `⏱️ Expanded "${item.content || "Title"}" to cover entire ${totalDur.toFixed(1)}s reel.`, "success");
  });
}

if (btnTxtClear) {
  btnTxtClear.addEventListener("click", () => {
    deleteSelectedTextTrackItem();
  });
}

if (btnTxtMasterClear) {
  btnTxtMasterClear.addEventListener("click", () => {
    if (!shotPlan || !shotPlan.length) return;
    pushUndoState();
    shotPlan.forEach((s) => {
      s.texts = [];
      s.text = defaultTextOverlay();
    });
    activeTextItemIdx = 0;
    if (selectedShotIdx >= 0 && selectedShotIdx < shotPlan.length) {
      populateTextControls(shotPlan[selectedShotIdx]);
    }
    applyTextOverlayToPreview();
    renderTimelineTrack();
    markTimelineDirty();
    setStatus(buildStatus, "🔄 Master Reset: Cleared all text overlays from all shots on the timeline.", "success");
  });
}

// Wire Grading Sliders & Controls
function wireGradeSlider(sliderEl, valEl, key, isPct = false) {
  if (!sliderEl) return;
  sliderEl.addEventListener("mousedown", () => {
    if (selectedShotIdx >= 0 && selectedShotIdx < shotPlan.length) {
      pushUndoState();
    }
  });
  sliderEl.addEventListener("input", () => {
    if (selectedShotIdx < 0 || selectedShotIdx >= shotPlan.length) return;
    const v = parseInt(sliderEl.value, 10) || 0;
    const g = ensureShotGrade(shotPlan[selectedShotIdx]);
    g[key] = v;
    if (valEl) {
      valEl.textContent = isPct ? `${v}%` : v > 0 ? `+${v}` : String(v);
    }
    showMonitorTab("source");
    applyGradeFilterToPreview();
    markTimelineDirty();
  });
  sliderEl.addEventListener("change", () => {
    renderTimelineTrack();
  });
}

wireGradeSlider(slGradeBrightness, valGradeBrightness, "brightness");
wireGradeSlider(slGradeContrast, valGradeContrast, "contrast");
wireGradeSlider(slGradeSaturation, valGradeSaturation, "saturation");
wireGradeSlider(slGradeTemp, valGradeTemp, "temperature");
wireGradeSlider(slGradeTint, valGradeTint, "tint");
wireGradeSlider(slGradeWhites, valGradeWhites, "whites");
wireGradeSlider(slGradeBlacks, valGradeBlacks, "blacks");
wireGradeSlider(slGradeVignette, valGradeVignette, "vignette", true);

if (selGradeCurve) {
  selGradeCurve.addEventListener("change", () => {
    if (selectedShotIdx < 0 || selectedShotIdx >= shotPlan.length) return;
    pushUndoState();
    const g = ensureShotGrade(shotPlan[selectedShotIdx]);
    g.curve = selGradeCurve.value || "none";
    showMonitorTab("source");
    applyGradeFilterToPreview();
    renderTimelineTrack();
    markTimelineDirty();
  });
}

if (numGradeFadeIn) {
  numGradeFadeIn.addEventListener("change", () => {
    if (selectedShotIdx < 0 || selectedShotIdx >= shotPlan.length) return;
    pushUndoState();
    const g = ensureShotGrade(shotPlan[selectedShotIdx]);
    g.fade_in = Math.max(0, parseFloat(numGradeFadeIn.value) || 0);
    renderTimelineTrack();
    markTimelineDirty();
  });
}

if (numGradeFadeOut) {
  numGradeFadeOut.addEventListener("change", () => {
    if (selectedShotIdx < 0 || selectedShotIdx >= shotPlan.length) return;
    pushUndoState();
    const g = ensureShotGrade(shotPlan[selectedShotIdx]);
    g.fade_out = Math.max(0, parseFloat(numGradeFadeOut.value) || 0);
    renderTimelineTrack();
    markTimelineDirty();
  });
}

if (inputLut) {
  inputLut.addEventListener("change", () => {
    const f = inputLut.files[0];
    if (!f) return;
    lutFile = f;
    clearLutFlag = false;
    if (fnLut) fnLut.textContent = `LUT: ${f.name}`;
    if (btnClearLut) btnClearLut.classList.remove("hidden");
    markTimelineDirty();
  });
}

if (btnClearLut) {
  btnClearLut.addEventListener("click", () => {
    lutFile = null;
    clearLutFlag = true;
    if (inputLut) inputLut.value = "";
    if (fnLut) fnLut.textContent = "";
    btnClearLut.classList.add("hidden");
    markTimelineDirty();
  });
}

function copySelectedClipGrade() {
  if (selectedShotIdx < 0 || selectedShotIdx >= shotPlan.length) return;
  copiedGradeClipboard = JSON.parse(JSON.stringify(ensureShotGrade(shotPlan[selectedShotIdx])));
  if (btnPasteGrade) {
    btnPasteGrade.disabled = false;
    btnPasteGrade.title = `Paste copied grade from Shot #${String(selectedShotIdx + 1).padStart(2, "0")}`;
  }
  setStatus(buildStatus, `📋 Copied grade from Shot #${String(selectedShotIdx + 1).padStart(2, "0")}. Select any shot and click Paste Grade.`, "success");
}

function pasteGradeToSelectedClip() {
  if (!copiedGradeClipboard || selectedShotIdx < 0 || selectedShotIdx >= shotPlan.length) return;
  pushUndoState();
  shotPlan[selectedShotIdx].grade = JSON.parse(JSON.stringify(copiedGradeClipboard));
  populateGradingControls(shotPlan[selectedShotIdx]);
  showMonitorTab("source");
  applyGradeFilterToPreview();
  renderTimelineTrack();
  markTimelineDirty();
  setStatus(buildStatus, `📥 Pasted grade onto Shot #${String(selectedShotIdx + 1).padStart(2, "0")}!`, "success");
}

function masterResetAllGrading() {
  if (!shotPlan || !shotPlan.length) return;
  pushUndoState();
  shotPlan.forEach((s) => {
    s.grade = defaultGrade();
  });
  lutFile = null;
  clearLutFlag = true;
  if (inputLut) inputLut.value = "";
  if (fnLut) fnLut.textContent = "";
  if (btnClearLut) btnClearLut.classList.add("hidden");
  if (selectedShotIdx >= 0 && selectedShotIdx < shotPlan.length) {
    populateGradingControls(shotPlan[selectedShotIdx]);
  }
  applyGradeFilterToPreview();
  renderTimelineTrack();
  markTimelineDirty();
  setStatus(buildStatus, "🔄 Master Reset: All clip grading, fades & LUT cleared across the timeline.", "success");
}

if (btnCopyGrade) btnCopyGrade.addEventListener("click", copySelectedClipGrade);
if (btnPasteGrade) btnPasteGrade.addEventListener("click", pasteGradeToSelectedClip);
if (btnMasterResetGrade) btnMasterResetGrade.addEventListener("click", masterResetAllGrading);

if (btnResetGrade) {
  btnResetGrade.addEventListener("click", () => {
    if (selectedShotIdx < 0 || selectedShotIdx >= shotPlan.length) return;
    pushUndoState();
    shotPlan[selectedShotIdx].grade = defaultGrade();
    populateGradingControls(shotPlan[selectedShotIdx]);
    applyGradeFilterToPreview();
    renderTimelineTrack();
    markTimelineDirty();
  });
}

if (btnGradeAll) {
  btnGradeAll.addEventListener("click", () => {
    if (selectedShotIdx < 0 || selectedShotIdx >= shotPlan.length) return;
    pushUndoState();
    const srcGrade = JSON.parse(JSON.stringify(ensureShotGrade(shotPlan[selectedShotIdx])));
    shotPlan.forEach((s) => {
      s.grade = JSON.parse(JSON.stringify(srcGrade));
    });
    renderTimelineTrack();
    markTimelineDirty();
    setStatus(buildStatus, "✨ Copied current shot's grading & fades to all shots! Click Apply to render.", "success");
  });
}

if (inspClipSelect) {
  inspClipSelect.addEventListener("change", () => {
    if (selectedShotIdx < 0) return;
    pushUndoState();
    shotPlan[selectedShotIdx].clip = inspClipSelect.value;
    shotPlan[selectedShotIdx].in_point = 0;
    inspInpoint.value = "0.00";
    inspInpointSlider.value = 0;
    markTimelineDirty();
    renderTimelineTrack();
    previewSelectedShotInMonitor(true);
  });
}

if (inspInpointSlider) {
  inspInpointSlider.addEventListener("mousedown", () => {
    if (selectedShotIdx >= 0) pushUndoState();
  });
  inspInpointSlider.addEventListener("input", () => {
    if (selectedShotIdx < 0) return;
    const val = parseFloat(inspInpointSlider.value) || 0;
    inspInpoint.value = val.toFixed(2);
    shotPlan[selectedShotIdx].in_point = val;
    markTimelineDirty();
    if (!isShotReversedPreview(shotPlan[selectedShotIdx])) {
      previewSelectedShotInMonitor(false);
    }
  });
  inspInpointSlider.addEventListener("change", () => {
    renderTimelineTrack();
    if (selectedShotIdx >= 0 && isShotReversedPreview(shotPlan[selectedShotIdx])) {
      previewSelectedShotInMonitor(false);
    }
  });
}

if (inspInpoint) {
  inspInpoint.addEventListener("change", () => {
    if (selectedShotIdx < 0) return;
    pushUndoState();
    const val = Math.max(0, parseFloat(inspInpoint.value) || 0);
    inspInpointSlider.value = val;
    shotPlan[selectedShotIdx].in_point = val;
    markTimelineDirty();
    renderTimelineTrack();
    previewSelectedShotInMonitor(false);
  });
}

if (inspDuration) {
  inspDuration.addEventListener("change", () => {
    if (selectedShotIdx < 0) return;
    pushUndoState();
    const val = Math.max(0.1, parseFloat(inspDuration.value) || 0.5);
    shotPlan[selectedShotIdx].duration = val;
    markTimelineDirty();
    renderTimelineTrack();
  });
}

if (inspZoomSlider) {
  inspZoomSlider.addEventListener("mousedown", () => {
    if (selectedShotIdx >= 0) pushUndoState();
  });
  inspZoomSlider.addEventListener("input", () => {
    if (selectedShotIdx < 0) return;
    const z = parseFloat(inspZoomSlider.value) || 100;
    shotPlan[selectedShotIdx].zoom = z;
    showMonitorTab("source");
    applyReframeTransformToPreview();
    markTimelineDirty();
  });
  inspZoomSlider.addEventListener("change", () => {
    renderTimelineTrack();
  });
}

if (btnResetReframe) {
  btnResetReframe.addEventListener("click", () => {
    if (selectedShotIdx < 0) return;
    pushUndoState();
    shotPlan[selectedShotIdx].zoom = 100;
    shotPlan[selectedShotIdx].pan_x = 0;
    shotPlan[selectedShotIdx].pan_y = 0;
    applyReframeTransformToPreview();
    renderTimelineTrack();
    markTimelineDirty();
  });
}

if (btnMoveLeft) {
  btnMoveLeft.addEventListener("click", () => {
    if (selectedShotIdx <= 0) return;
    pushUndoState();
    const idx = selectedShotIdx;
    const temp = shotPlan[idx - 1];
    shotPlan[idx - 1] = shotPlan[idx];
    shotPlan[idx] = temp;
    selectedShotIdx = idx - 1;
    markTimelineDirty();
    renderTimelineTrack();
    populateInspector();
  });
}

if (btnMoveRight) {
  btnMoveRight.addEventListener("click", () => {
    if (selectedShotIdx < 0 || selectedShotIdx >= shotPlan.length - 1) return;
    pushUndoState();
    const idx = selectedShotIdx;
    const temp = shotPlan[idx + 1];
    shotPlan[idx + 1] = shotPlan[idx];
    shotPlan[idx] = temp;
    selectedShotIdx = idx + 1;
    markTimelineDirty();
    renderTimelineTrack();
    populateInspector();
  });
}

// ---------- Build / Rebuild Execution ----------
async function runBuild(useCustomShotPlan = false) {
  clearTagWarning();
  if (!jobId) {
    setStatus(buildStatus, "⚠️ Please run Step 1 (Analyze Cuts) first.", "error");
    alert("Missing Job ID! Please run Step 1 (Analyze Cuts) first.");
    return;
  }
  if (!clipFiles.length && !localFolderPath && !availableClips.length) {
    setStatus(buildStatus, "⚠️ No clips selected! Pick a Mac folder or drop clips first.", "error");
    alert("No clips selected! Please pick a folder or upload clips first.");
    return;
  }

  if (!useCustomShotPlan && smartMatchCheckbox.checked && !contentTagged) {
    setStatus(buildStatus, '⚠️ Click "Tag Content with AI" first, or untick Smart-match.', "error");
    alert('Click "Tag Content with AI" first, or untick Smart-match to build in filename order.');
    return;
  }

  btnBuild.disabled = true;
  if (btnApplyTimeline) btnApplyTimeline.disabled = true;
  btnRebuildOrder.classList.add("hidden");
  setStatus(buildStatus, `Cutting, grading & stitching (${projectWidth}×${projectHeight} @ ${projectFps}fps)…`, "working");

  const fd = new FormData();
  fd.append("job_id", jobId);
  fd.append("width", String(projectWidth));
  fd.append("height", String(projectHeight));
  fd.append("fps", String(projectFps));
  fd.append("keep_audio", $("keep-audio").checked ? "true" : "false");
  fd.append("overlay_audio", $("overlay-audio").checked ? "true" : "false");
  fd.append("smart_match", smartMatchCheckbox.checked && contentTagged ? "true" : "false");
  fd.append("crop_mode", "center");
  fd.append("audio_in", String(audioStartOffset || 0));
  fd.append("audio_duration", String(audioDurationSec || 0));
  fd.append("audio_volume", String((audioVolumePct / 100.0).toFixed(2)));
  const hdrCb = $("export-hdr");
  fd.append("hdr_output", hdrCb && hdrCb.checked ? "true" : "false");

  if (lutFile) {
    fd.append("lut_file", lutFile);
  } else if (clearLutFlag) {
    fd.append("clear_lut", "true");
  }

  if (customAudioFile) {
    fd.append("custom_audio", customAudioFile);
  } else if (clearCustomAudioFlag) {
    fd.append("clear_custom_audio", "true");
  }

  // Always send current timeline settings if shots exist, so all trims, grades,
  // reframes, reverse states & zooms across all clips are automatically baked into the new MP4!
  if (shotPlan && shotPlan.length) {
    fd.append("shot_plan", JSON.stringify(shotPlan));
  }

  if (textTrackItems && textTrackItems.length) {
    fd.append("text_track", JSON.stringify(textTrackItems));
  }

  if (localFolderPath) {
    fd.append("local_folder", localFolderPath);
  } else if (clipFiles.length) {
    clipFiles.forEach((f) => fd.append("clips", f));
  }

  let buildProgressInterval = setInterval(async () => {
    try {
      const pRes = await fetch(`/api/progress/${jobId}`);
      const pData = await pRes.json();
      if (pData.total > 0) {
        const pct = Math.round((pData.current / pData.total) * 100);
        setStatus(buildStatus, `🚀 ${pData.phase} ${pData.current} / ${pData.total} (${pct}%)`, "working");
      }
    } catch (e) {}
  }, 900);

  try {
    const res = await fetch("/api/build", { method: "POST", body: fd });
    const data = await res.json();
    clearInterval(buildProgressInterval);
    if (!res.ok) throw new Error(data.error || "Build failed");

    builtPreview.src = data.video_url + "?t=" + Date.now();
    showMonitorTab("program");
    builtPreview.play().catch(() => {});

    if (data.available_clips && data.available_clips.length) {
      availableClips = data.available_clips;
    }
    if (data.shot_plan && data.shot_plan.length) {
      shotPlan = data.shot_plan;
      timelineDirty = false;
      if (selectedShotIdx < 0) selectedShotIdx = 0;
      renderTimelineTrack();
      populateInspector();
    }

    const fcpxmlLink = $("direct-fcpxml-link");
    const edlLink = $("direct-edl-link");
    if (fcpxmlLink) fcpxmlLink.href = `/api/media/${jobId}/timeline.fcpxml?t=${Date.now()}`;
    if (edlLink) edlLink.href = `/api/media/${jobId}/timeline.edl?t=${Date.now()}`;

    setStatus(buildStatus, "✅ Reel & Resolve Timelines Built!", "success");
    enableStep($("step3"));
  } catch (err) {
    clearInterval(buildProgressInterval);
    setStatus(buildStatus, "Error: " + err.message, "error");
  } finally {
    btnBuild.disabled = false;
    if (btnApplyTimeline) btnApplyTimeline.disabled = false;
  }
}

btnBuild.addEventListener("click", () => runBuild(true));
if (btnApplyTimeline) btnApplyTimeline.addEventListener("click", () => runBuild(true));
if (btnRebuildOrder) btnRebuildOrder.addEventListener("click", () => runBuild(true));

// ---------- STEP 3: Export (MP4 / QuickTime MOV + H.264 / H.265 + 10-bit HDR) ----------
const inputLogo = $("input-logo");
const fnLogo = $("fn-logo");
const inputSrt = $("input-srt");
const fnSrt = $("fn-srt");
const btnExport = $("btn-export");
const exportStatus = $("export-status");
const exportResult = $("export-result");
const selExportContainer = $("export-container");
const selExportCodec = $("export-codec");
const cbExportHdr = $("export-hdr");
const hdrCodecNote = $("hdr-codec-note");

if (cbExportHdr) {
  cbExportHdr.addEventListener("change", () => {
    const isHdr = cbExportHdr.checked;
    if (hdrCodecNote) hdrCodecNote.classList.toggle("hidden", !isHdr);
    if (selExportCodec) {
      if (isHdr) {
        selExportCodec.value = "h265";
        selExportCodec.disabled = true;
      } else {
        selExportCodec.disabled = false;
      }
    }
  });
}

inputLogo.addEventListener("change", () => {
  logoFile = inputLogo.files[0] || null;
  fnLogo.textContent = logoFile ? logoFile.name : "";
});
inputSrt.addEventListener("change", () => {
  srtFile = inputSrt.files[0] || null;
  fnSrt.textContent = srtFile ? srtFile.name : "";
});

btnExport.addEventListener("click", async () => {
  if (!jobId) return;
  const formats = Array.from(document.querySelectorAll(".fmt:checked")).map((el) => el.value);
  if (!formats.length) {
    setStatus(exportStatus, "Pick at least one format.", "error");
    return;
  }

  // If the user made real-time timeline/grade/trim edits without manually clicking Bake/Re-Render,
  // automatically bake the edits into the master file before exporting!
  if (timelineDirty) {
    setStatus(exportStatus, "⚡ Auto-baking your real-time timeline & grading edits before export…", "working");
    await runBuild(true);
  }

  const isHdr = Boolean(cbExportHdr && cbExportHdr.checked);
  const container = selExportContainer ? selExportContainer.value : "mp4";
  const codec = isHdr ? "h265" : (selExportCodec ? selExportCodec.value : "h264");

  btnExport.disabled = true;
  setStatus(exportStatus, `Exporting (${codec.toUpperCase()}${isHdr ? " 10-bit HDR" : ""} · .${container})…`, "working");
  exportResult.classList.add("hidden");
  exportResult.innerHTML = "";

  const fd = new FormData();
  fd.append("job_id", jobId);
  fd.append("formats", formats.join(","));
  fd.append("container", container);
  fd.append("codec", codec);
  fd.append("hdr", isHdr ? "true" : "false");
  fd.append("fps", String(projectFps));
  fd.append("width", String(projectWidth));
  fd.append("height", String(projectHeight));
  if (logoFile) fd.append("logo", logoFile);
  if (srtFile) fd.append("srt", srtFile);

  try {
    const res = await fetch("/api/export", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Export failed");

    data.exports.forEach((exp) => {
      const item = document.createElement("div");
      item.className = "export-item";
      item.innerHTML = `
        <video src="${exp.url}?t=${Date.now()}" controls></video>
        <div class="export-label">
          <span>${exp.format}</span>
          <a class="download" href="${exp.url}?dl=1" download="${exp.filename}">Download ↓</a>
        </div>`;
      exportResult.appendChild(item);
    });

    if (formats.includes("edl")) {
      const edlItem = document.createElement("div");
      edlItem.className = "export-item";
      edlItem.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:8px;">
          <span style="font-weight:600; color:var(--accent-bright);">✂️ DaVinci Resolve Timelines</span>
          <div style="display:flex; gap:6px;">
            <a class="btn btn-primary btn-sm" style="flex:1; text-decoration:none;" href="/api/media/${jobId}/timeline.fcpxml" download="timeline.fcpxml">Download FCPXML ↓</a>
            <a class="btn btn-secondary btn-sm" style="flex:1; text-decoration:none;" href="/api/media/${jobId}/timeline.edl" download="timeline.edl">Download EDL ↓</a>
          </div>
        </div>
      `;
      exportResult.appendChild(edlItem);
    }

    exportResult.classList.remove("hidden");
    setStatus(exportStatus, `✅ Exported ${data.exports.length} deliverable(s).`, "success");
  } catch (err) {
    setStatus(exportStatus, "Error: " + err.message, "error");
  } finally {
    btnExport.disabled = false;
  }
});

// =====================================================================
// TAB 2: SPEECH CLEANER LOGIC
// =====================================================================
let cleanVideoFile = null;
wireDropzone($("dz-clean-video"), $("input-clean-video"), false, (files) => {
  if (!files.length) return;
  cleanVideoFile = files[0];
  $("fn-clean-video").textContent = cleanVideoFile.name;
  enableStep($("cleaner-step2"));
});

if ($("sl-clean-gap")) {
  $("sl-clean-gap").addEventListener("input", () => {
    $("val-clean-gap").textContent = $("sl-clean-gap").value + " s";
  });
}
if ($("sl-clean-padding")) {
  $("sl-clean-padding").addEventListener("input", () => {
    $("val-clean-padding").textContent = $("sl-clean-padding").value + " s";
  });
}

if ($("btn-clean-run")) {
  $("btn-clean-run").addEventListener("click", async () => {
    if (!cleanVideoFile) return;
    $("btn-clean-run").disabled = true;
    setStatus($("clean-status"), "Transcribing and slicing filler words with Whisper AI...", "working");
    $("clean-result-area").classList.add("hidden");

    const fd = new FormData();
    fd.append("video", cleanVideoFile);
    fd.append("model_size", $("sel-clean-model").value);
    fd.append("min_gap", $("sl-clean-gap").value);
    fd.append("padding", $("sl-clean-padding").value);
    fd.append("remove_fillers", $("cb-clean-fillers").checked);

    try {
      const res = await fetch("/api/clean", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Clean failed");

      const s = data.stats;
      const pct = ((s.time_saved / s.original_duration) * 100).toFixed(0);
      $("clean-stat-grid").innerHTML = `
        <div class="stat-box"><span class="stat-val">${Math.round(s.original_duration)}s</span><span class="stat-label">Original</span></div>
        <div class="stat-box"><span class="stat-val">${Math.round(s.cleaned_duration)}s</span><span class="stat-label">Cleaned</span></div>
        <div class="stat-box"><span class="stat-val">${s.fillers_removed}</span><span class="stat-label">Fillers Cut</span></div>
        <div class="stat-box"><span class="stat-val">${s.words_total}</span><span class="stat-label">Words Total</span></div>
        <div class="stat-box"><span class="stat-val">${pct}%</span><span class="stat-label">Tighter</span></div>
      `;

      $("clean-preview").src = data.video_url;
      $("btn-clean-download").href = data.video_url + "?dl=1";
      if (data.edl_url) $("btn-clean-edl").href = data.edl_url;

      $("clean-result-area").classList.remove("hidden");
      enableStep($("cleaner-step3"));
      setStatus($("clean-status"), `✅ Removed ${s.fillers_removed} filler words (${pct}% shorter).`, "success");
    } catch (err) {
      setStatus($("clean-status"), "Error: " + err.message, "error");
    } finally {
      $("btn-clean-run").disabled = false;
    }
  });
}

// =====================================================================
// TAB 3: MEDIA SORTER LOGIC
// =====================================================================
let sortSelectedFolder = null;
if ($("btn-sort-pick-folder")) {
  $("btn-sort-pick-folder").addEventListener("click", async () => {
    $("btn-sort-pick-folder").innerText = "Opening Finder...";
    try {
      const res = await fetch("/api/pick_local_folder", { method: "POST" });
      const data = await res.json();
      if (data.path) {
        sortSelectedFolder = data.path;
        $("sort-folder-display").innerText = data.path;
        $("btn-sort-run").disabled = false;
      }
    } catch (e) {
      alert("Error picking folder");
    } finally {
      $("btn-sort-pick-folder").innerText = "📁 Pick Mac Folder";
    }
  });
}

if ($("btn-sort-run")) {
  $("btn-sort-run").addEventListener("click", async () => {
    if (!sortSelectedFolder) return;
    $("btn-sort-run").disabled = true;
    setStatus($("sort-status"), "Warming up OpenAI CLIP Vision model...", "working");

    const fd = new FormData();
    fd.append("folder", sortSelectedFolder);
    fd.append("categories", $("sort-categories").value);

    try {
      const res = await fetch("/api/sort_media", { method: "POST", body: fd });
      const data = await res.json();

      if (data.warning) {
        $("btn-sort-run").disabled = false;
        $("sort-status").classList.add("hidden");
        const existing = data.existing.join(", ");
        const confirmed = confirm(
          `⚠️ These category folders already exist and have files:\n\n${existing}\n\nDo you want to continue sorting and add new files into them?`
        );
        if (!confirmed) return;

        const fd2 = new FormData();
        fd2.append("folder", sortSelectedFolder);
        fd2.append("categories", $("sort-categories").value);
        fd2.append("force", "true");
        $("btn-sort-run").disabled = true;
        setStatus($("sort-status"), "Sorting videos with AI Vision...", "working");
        await fetch("/api/sort_media", { method: "POST", body: fd2 });
      }

      const intv = setInterval(async () => {
        try {
          const r = await fetch("/api/sort_progress");
          const d = await r.json();
          if (d.error) {
            clearInterval(intv);
            setStatus($("sort-status"), "Error: " + d.error, "error");
            $("btn-sort-run").disabled = false;
            return;
          }
          if (d.phase === "Done!") {
            clearInterval(intv);
            setStatus($("sort-status"), `✅ Successfully sorted ${d.total} videos into folders!`, "success");
            $("btn-sort-run").disabled = false;
          } else if (d.total > 0) {
            setStatus($("sort-status"), `🚀 ${d.phase} (${d.current}/${d.total})`, "working");
          }
        } catch (e) {}
      }, 1000);
    } catch (e) {
      setStatus($("sort-status"), "Error starting sort", "error");
      $("btn-sort-run").disabled = false;
    }
  });
}

// =====================================================================
// TAB 4: JOB HISTORY LOGIC
// =====================================================================
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return "0 Bytes";
  const k = 1024,
    sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function formatDate(isoString) {
  const d = new Date(isoString);
  return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

window.openJobFolder = async function (jid) {
  try {
    await fetch(`/api/jobs/open/${jid}`, { method: "POST" });
  } catch (err) {}
};

let cachedProjectsList = [];

async function loadHistoryJobs() {
  const grid = $("projects-grid");
  if (!grid) return;
  try {
    const res = await fetch("/api/jobs");
    const data = await res.json();

    cachedProjectsList = data.jobs || [];

    if (data.disk_free && $("hist-disk-free")) {
      $("hist-disk-free").innerText = formatBytes(data.disk_free);
    }
    const totalSize = cachedProjectsList.reduce((acc, j) => acc + (j.size_bytes || 0), 0);
    if ($("hist-total-size")) {
      $("hist-total-size").innerText = formatBytes(totalSize);
    }

    renderProjectsGrid(cachedProjectsList);
  } catch (err) {
    grid.innerHTML = '<div style="color:var(--danger); padding:30px; text-align:center;">Failed to load projects.</div>';
  }
}

function renderProjectsGrid(jobsToRender) {
  const grid = $("projects-grid");
  if (!grid) return;
  grid.innerHTML = "";

  const query = ($("proj-search-input") ? $("proj-search-input").value : "").trim().toLowerCase();
  const filtered = query
    ? jobsToRender.filter((j) => (j.job_name || "").toLowerCase().includes(query) || (j.job_id || "").toLowerCase().includes(query))
    : jobsToRender;

  if ($("proj-count-badge")) {
    $("proj-count-badge").innerText = `${filtered.length} project${filtered.length === 1 ? "" : "s"}`;
  }

  // 1. "➕ New Project" Card (First in the grid, matching CapCut)
  const newCard = document.createElement("div");
  newCard.className = "project-card new-project-card";
  newCard.title = "Create a new project in the editor";
  newCard.innerHTML = `
    <div class="new-project-inner">
      <div class="new-project-icon">➕</div>
      <div class="new-project-title">New Project</div>
      <div class="new-project-sub">Beat-synced video reel</div>
    </div>
  `;
  newCard.addEventListener("click", () => {
    startNewJob();
    switchMainTab("beatsync");
  });
  grid.appendChild(newCard);

  // 2. Project Cards
  filtered.forEach((job) => {
    const card = document.createElement("div");
    card.className = "project-card";
    card.dataset.jid = job.job_id;

    const dur = job.formatted_duration || "00:00";
    const statusClass = (job.status || "draft").toLowerCase();
    const sizeStr = formatBytes(job.size_bytes);
    const dateStr = formatDate(job.timestamp);

    card.innerHTML = `
      <div class="project-thumb-wrap">
        <img class="project-thumb-img" src="${job.thumb_url}" alt="${job.job_name}" loading="lazy">
        <div class="project-thumb-gradient"></div>
        <span class="project-dur-badge">${dur}</span>
        <span class="project-status-badge ${statusClass}">${job.status || "Draft"}</span>

        <input type="checkbox" class="project-cb" value="${job.job_id}" title="Select for batch delete">

        <div class="project-hover-overlay">
          <button type="button" class="btn-proj-card-open">▶ Open Project</button>
          <div class="project-hover-tools">
            <button type="button" class="btn-proj-icon-btn btn-proj-rename" title="Rename Project">✏️</button>
            <button type="button" class="btn-proj-icon-btn btn-proj-reveal" title="Show in Finder">📁</button>
            <button type="button" class="btn-proj-icon-btn btn-proj-del" title="Delete Project">🗑️</button>
          </div>
        </div>
      </div>

      <div class="project-card-footer">
        <div class="project-card-title-row">
          <div class="project-card-title" title="${job.job_name}">${job.job_name}</div>
        </div>
        <div class="project-card-meta">
          <span>${sizeStr}</span>
          <span>·</span>
          <span>${dateStr}</span>
        </div>
      </div>
    `;

    // Click on thumbnail or Open button -> opens project
    card.addEventListener("click", (e) => {
      if (e.target.closest(".project-cb") || e.target.closest(".project-hover-tools")) return;
      window.loadJobIntoEditor(job.job_id);
    });

    // Checkbox click
    const cb = card.querySelector(".project-cb");
    if (cb) {
      cb.addEventListener("click", (e) => e.stopPropagation());
      cb.addEventListener("change", () => {
        card.classList.toggle("selected", cb.checked);
        updateBatchDeleteUI();
      });
    }

    // Rename
    const btnRename = card.querySelector(".btn-proj-rename");
    if (btnRename) {
      btnRename.addEventListener("click", async (e) => {
        e.stopPropagation();
        const curName = job.job_name || job.job_id;
        const newName = prompt("Rename project:", curName);
        if (!newName || newName.trim() === "" || newName.trim() === curName) return;
        try {
          await fetch("/api/job_rename", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ job_id: job.job_id, job_name: newName.trim() }),
          });
          job.job_name = newName.trim();
          const titleEl = card.querySelector(".project-card-title");
          if (titleEl) {
            titleEl.textContent = job.job_name;
            titleEl.title = job.job_name;
          }
          if (jobId === job.job_id && topJobInput) {
            topJobInput.value = job.job_name;
          }
        } catch (err) {
          alert("Error renaming project: " + err.message);
        }
      });
    }

    // Reveal in Finder
    const btnReveal = card.querySelector(".btn-proj-reveal");
    if (btnReveal) {
      btnReveal.addEventListener("click", async (e) => {
        e.stopPropagation();
        try {
          await fetch(`/api/jobs/open/${job.job_id}`, { method: "POST" });
        } catch (err) {}
      });
    }

    // Delete single project
    const btnDel = card.querySelector(".btn-proj-del");
    if (btnDel) {
      btnDel.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!confirm(`Are you sure you want to permanently delete project "${job.job_name}"?`)) return;
        try {
          await fetch("/api/jobs/delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ job_ids: [job.job_id] }),
          });
          card.style.transition = "all 0.25s ease";
          card.style.opacity = "0";
          card.style.transform = "scale(0.85)";
          setTimeout(() => {
            card.remove();
            cachedProjectsList = cachedProjectsList.filter((j) => j.job_id !== job.job_id);
            if ($("proj-count-badge")) {
              $("proj-count-badge").innerText = `${cachedProjectsList.length} projects`;
            }
          }, 250);
        } catch (err) {
          alert("Failed to delete project: " + err.message);
        }
      });
    }

    grid.appendChild(card);
  });
}

function updateBatchDeleteUI() {
  const selectedCbs = Array.from(document.querySelectorAll(".project-cb:checked"));
  const btnBatchDel = $("btn-proj-batch-delete");
  const countEl = $("proj-del-count");
  if (!btnBatchDel) return;
  if (selectedCbs.length > 0) {
    btnBatchDel.classList.remove("hidden");
    if (countEl) countEl.innerText = String(selectedCbs.length);
  } else {
    btnBatchDel.classList.add("hidden");
  }
}

// Search input live filter
if ($("proj-search-input")) {
  $("proj-search-input").addEventListener("input", () => {
    renderProjectsGrid(cachedProjectsList);
  });
}

// Top Bar Action Buttons in Projects View
if ($("btn-proj-new")) {
  $("btn-proj-new").addEventListener("click", () => {
    startNewJob();
    switchMainTab("beatsync");
  });
}

if ($("btn-proj-open-file")) {
  $("btn-proj-open-file").addEventListener("click", () => {
    if (inputOpenProject) inputOpenProject.click();
  });
}

if ($("btn-proj-batch-delete")) {
  $("btn-proj-batch-delete").addEventListener("click", async () => {
    const selected = Array.from(document.querySelectorAll(".project-cb:checked")).map((cb) => cb.value);
    if (!selected.length) return;
    if (!confirm(`Are you sure you want to permanently delete ${selected.length} selected project(s)?`)) return;
    $("btn-proj-batch-delete").disabled = true;
    try {
      await fetch("/api/jobs/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_ids: selected }),
      });
      await loadHistoryJobs();
    } catch (e) {
      alert("Error deleting projects: " + e.message);
    } finally {
      $("btn-proj-batch-delete").disabled = false;
      updateBatchDeleteUI();
    }
  });
}

// ---------- Hydrate Editor from Job State, Rename, Save/Open .reelproj, & Relink ----------
const topJobInput = $("top-job-name");
const btnSaveProject = $("btn-save-project");
const btnOpenProject = $("btn-open-project");
const inputOpenProject = $("input-open-project");
const btnRelinkFolder = $("btn-relink-folder");
const relinkBanner = $("relink-banner");

function hydrateEditorFromJobState(data) {
  if (!data || !data.job_id) return;
  stopSequencePlayback();
  jobId = data.job_id;
  referenceUrl = data.reference_url || null;
  customAudioUrl = data.custom_audio_url || null;
  if ($("job-id-display")) $("job-id-display").textContent = jobId;
  if (topJobInput) topJobInput.value = data.job_name || jobId;
  if ($("job-name")) $("job-name").value = data.job_name || "";

  if (data.settings) {
    projectWidth = parseInt(data.settings.width, 10) || 1080;
    projectHeight = parseInt(data.settings.height, 10) || 1920;
    projectFps = parseFloat(data.settings.fps) || 30;
    updateProjectSettingsUI();
  }

  if (data.rhythm) {
    currentRhythm = data.rhythm;
    renderRhythm(data.rhythm);
    enableStep($("step2"));
  }

  if (relinkBanner) {
    relinkBanner.classList.toggle("hidden", !data.folder_missing);
  }

  if (data.local_folder) {
    localFolderPath = data.local_folder;
    localClipNames = data.available_clips || [];
    availableClips = [...localClipNames];
    renderClipList();
    fnClips.innerText = data.folder_missing
      ? `⚠️ Missing folder: ${localFolderPath}`
      : `📁 ${localClipNames.length} clips in ${localFolderPath}`;
    btnBuild.disabled = Boolean(data.folder_missing);
  } else if (data.available_clips && data.available_clips.length) {
    localFolderPath = null;
    localClipNames = data.available_clips;
    availableClips = [...localClipNames];
    renderClipList();
    fnClips.innerText = `${availableClips.length} clips in job`;
    btnBuild.disabled = false;
  }

  contentTagged = Boolean(data.tagged);

  lutFile = null;
  clearLutFlag = false;
  if (data.lut_name) {
    if (fnLut) fnLut.textContent = `LUT: ${data.lut_name}`;
    if (btnClearLut) btnClearLut.classList.remove("hidden");
  } else {
    if (fnLut) fnLut.textContent = "";
    if (btnClearLut) btnClearLut.classList.add("hidden");
  }

  customAudioFile = null;
  clearCustomAudioFlag = false;
  if (data.custom_audio_name) {
    if (tlAudioTitle) tlAudioTitle.textContent = `🎵 Custom Audio: ${data.custom_audio_name}`;
    if (btnClearAudio) btnClearAudio.classList.remove("hidden");
  } else {
    if (tlAudioTitle) tlAudioTitle.textContent = "🔊 Reference Audio Track (Synced)";
    if (btnClearAudio) btnClearAudio.classList.add("hidden");
  }

  if (data.shot_plan && data.shot_plan.length) {
    shotPlan = data.shot_plan;
    selectedShotIdx = 0;
    renderTimelineTrack();
    populateInspector();
    previewSelectedShotInMonitor(false);
  } else if (currentRhythm) {
    initDraftTimelineFromRhythm();
  }

  textTrackItems = Array.isArray(data.text_track) ? data.text_track : [];
  if (!textTrackItems.length && data.shot_plan) {
    let cumOffset = 0;
    data.shot_plan.forEach((s, idx) => {
      const dur = Math.max(0.2, Number(s.duration || 1.0));
      const sTexts = (s.texts && s.texts.length) ? s.texts : (s.text && (s.text.content || "").trim()) ? [s.text] : [];
      sTexts.forEach((st, sidx) => {
        if ((st.content || "").trim()) {
          textTrackItems.push({
            id: `txt_mig_${idx}_${sidx}_${Date.now()}`,
            content: st.content,
            font: st.font || "Arial Bold",
            size: st.size || 56,
            color: st.color || "#FFFFFF",
            bg_style: st.bg_style || "plain",
            bg_color: st.bg_color || "#1F2C38",
            x: st.x !== undefined ? st.x : 50,
            y: st.y !== undefined ? st.y : 80,
            start_time: Number(cumOffset.toFixed(2)),
            duration: Number(dur.toFixed(2)),
          });
        }
      });
      cumOffset += dur;
    });
  }
  selectedTextTrackId = textTrackItems.length ? textTrackItems[0].id : null;
  renderTextTrack();
  applyTimelineTextOverlayToPreview();

  if (data.built_exists && data.video_url) {
    builtPreview.src = data.video_url + "?t=" + Date.now();
    enableStep($("step3"));
    const fcpxmlLink = $("direct-fcpxml-link");
    const edlLink = $("direct-edl-link");
    if (fcpxmlLink) fcpxmlLink.href = `/api/media/${jobId}/timeline.fcpxml?t=${Date.now()}`;
    if (edlLink) edlLink.href = `/api/media/${jobId}/timeline.edl?t=${Date.now()}`;
  }
}

window.loadJobIntoEditor = async function (jid) {
  try {
    const res = await fetch(`/api/job_state/${jid}`);
    if (!res.ok) throw new Error("Could not load job");
    const data = await res.json();
    hydrateEditorFromJobState(data);
    switchMainTab("beatsync");
  } catch (err) {
    alert("Error loading job: " + err.message);
  }
};

// Rename Job inline in Top Bar
async function saveJobNameChange() {
  if (!jobId || !topJobInput) return;
  const newName = topJobInput.value.trim();
  if (!newName || newName === "—") return;
  if ($("job-name")) $("job-name").value = newName;
  try {
    await fetch("/api/job_rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job_id: jobId, job_name: newName }),
    });
  } catch (e) {}
}

if (topJobInput) {
  topJobInput.addEventListener("change", saveJobNameChange);
  topJobInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      topJobInput.blur();
      saveJobNameChange();
    }
  });
}

// Save Job as .reelproj File
if (btnSaveProject) {
  btnSaveProject.addEventListener("click", async () => {
    if (!jobId) {
      alert("Analyze a reference reel or load a job first before saving.");
      return;
    }
    const nameVal = (topJobInput && topJobInput.value.trim() !== "—" ? topJobInput.value.trim() : "") || jobId;
    btnSaveProject.disabled = true;
    try {
      const res = await fetch("/api/project_save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: jobId,
          job_name: nameVal,
          settings: { width: projectWidth, height: projectHeight, fps: projectFps },
          shot_plan: shotPlan,
          text_track: textTrackItems,
          local_folder: localFolderPath,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");

      const a = document.createElement("a");
      a.href = data.download_url;
      a.download = data.filename || `${jobId}.reelproj`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      alert("Save failed: " + err.message);
    } finally {
      btnSaveProject.disabled = false;
    }
  });
}

// Open Job from .reelproj File
if (btnOpenProject && inputOpenProject) {
  btnOpenProject.addEventListener("click", () => inputOpenProject.click());
  inputOpenProject.addEventListener("change", async () => {
    const file = inputOpenProject.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("project_file", file);
    try {
      const res = await fetch("/api/project_open", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not open project file");
      hydrateEditorFromJobState(data);
      switchMainTab("beatsync");
    } catch (err) {
      alert("Error opening project: " + err.message);
    } finally {
      inputOpenProject.value = "";
    }
  });
}

// Relink Footage Folder if Location Changed
if (btnRelinkFolder) {
  btnRelinkFolder.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!jobId) {
      alert("Load or start a job first.");
      return;
    }
    btnRelinkFolder.innerText = "Relinking...";
    try {
      const pickRes = await fetch("/api/pick_local_folder", { method: "POST" });
      const pickData = await pickRes.json();
      if (pickData.path) {
        const relRes = await fetch("/api/relink_folder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ job_id: jobId, local_folder: pickData.path }),
        });
        const stateData = await relRes.json();
        if (!relRes.ok) throw new Error(stateData.error || "Relink failed");
        hydrateEditorFromJobState(stateData);
        if (selectedShotIdx >= 0) previewSelectedShotInMonitor(false);
        setStatus(buildStatus, `✅ Footage relinked to ${pickData.path} (Resolve timelines updated!).`, "success");
      }
    } catch (err) {
      alert("Error relinking footage: " + err.message);
    } finally {
      btnRelinkFolder.innerText = "🔗 Relink";
    }
  });
}

// ---------- Full In-App macOS Menu Bar (File, Edit, Clip, Timeline, View, Help) ----------
const macMenubar = $("mac-menubar");

function closeAllMenus() {
  if (!macMenubar) return;
  Array.from(macMenubar.querySelectorAll(".file-menu-wrap.open")).forEach((el) => el.classList.remove("open"));
}

if (macMenubar) {
  const wraps = Array.from(macMenubar.querySelectorAll(".file-menu-wrap"));
  wraps.forEach((wrap) => {
    const btn = wrap.querySelector(".file-menu-btn");
    if (!btn) return;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const wasOpen = wrap.classList.contains("open");
      closeAllMenus();
      if (!wasOpen) wrap.classList.add("open");
    });
    btn.addEventListener("mouseenter", () => {
      const anyOpen = wraps.some((w) => w.classList.contains("open"));
      if (anyOpen && !wrap.classList.contains("open")) {
        closeAllMenus();
        wrap.classList.add("open");
      }
    });
  });

  macMenubar.addEventListener("click", (e) => {
    if (e.target.closest(".file-menu-item")) {
      closeAllMenus();
    }
  });
}

window.addEventListener("click", () => {
  closeAllMenus();
});

function closeCurrentJob() {
  jobId = null;
  referenceFile = null;
  referenceUrl = null;
  clipFiles = [];
  localFolderPath = null;
  localClipNames = [];
  availableClips = [];
  currentRhythm = null;
  shotPlan = [];
  selectedShotIdx = -1;
  timelineDirty = false;
  contentTagged = false;
  lutFile = null;
  clearLutFlag = false;
  customAudioFile = null;
  clearCustomAudioFlag = false;
  audioStartOffset = 0.0;
  audioDurationSec = 0.0;
  undoStack = [];
  redoStack = [];
  updateUndoRedoUI();

  if ($("job-id-display")) $("job-id-display").textContent = "—";
  if (topJobInput) topJobInput.value = "—";
  if ($("job-name")) $("job-name").value = "";
  if (fnReference) fnReference.textContent = "";
  if (fnClips) fnClips.textContent = "";
  if (fnLut) fnLut.textContent = "";
  if (btnClearLut) btnClearLut.classList.add("hidden");
  if (tlAudioTitle) tlAudioTitle.textContent = "🔊 Reference Audio Track (Synced)";
  if (tlAudioOffsetLabel) tlAudioOffsetLabel.textContent = "In: 0.0s · Len: Auto";
  if (btnClearAudio) btnClearAudio.classList.add("hidden");
  if (clipList) clipList.innerHTML = "";
  if (rhythmResult) rhythmResult.classList.add("hidden");
  if (analyzeStatus) analyzeStatus.classList.add("hidden");
  if (buildStatus) buildStatus.classList.add("hidden");
  if (tagStatus) tagStatus.classList.add("hidden");
  if (exportStatus) exportStatus.classList.add("hidden");
  if (exportResult) exportResult.classList.add("hidden");
  if (relinkBanner) relinkBanner.classList.add("hidden");
  if (btnRebuildOrder) btnRebuildOrder.classList.add("hidden");

  if ($("step2")) $("step2").classList.add("disabled");
  if ($("step3")) $("step3").classList.add("disabled");
  if (btnAnalyze) btnAnalyze.disabled = true;
  if (btnBuild) btnBuild.disabled = true;

  if (builtPreview) {
    builtPreview.pause();
    builtPreview.removeAttribute("src");
  }
  if (sourcePreview) {
    sourcePreview.pause();
    sourcePreview.removeAttribute("src");
    sourcePreview.removeAttribute("data-clip");
    sourcePreview.style.filter = "none";
  }
  if (vignettePreviewLayer) vignettePreviewLayer.style.opacity = "0";
  if (buildResult) buildResult.classList.add("hidden");
  if (sourcePreviewWrap) sourcePreviewWrap.classList.add("hidden");
  if (monitorEmpty) monitorEmpty.classList.remove("hidden");

  if (tlShotsStrip) {
    tlShotsStrip.innerHTML = `<div style="color:var(--text-dim); font-size:11.5px; display:flex; align-items:center; padding-left:8px;">Timeline tracks will populate here as soon as you analyze a reference video or build a reel.</div>`;
  }
  if (tlSummary) tlSummary.textContent = "0 shots · 0.00s";
  populateInspector();
  switchMainTab("beatsync");
}

function startNewJob() {
  closeCurrentJob();
  if ($("job-name")) $("job-name").focus();
}

async function quitSwiftReel() {
  try {
    await fetch("/api/quit_app", { method: "POST" });
  } catch (e) {}
  window.close();
}

function deleteSelectedShot() {
  if (selectedShotIdx < 0 || selectedShotIdx >= shotPlan.length) return;
  if (shotPlan.length <= 1) {
    alert("Timeline must keep at least 1 video shot.");
    return;
  }
  pushUndoState();
  shotPlan.splice(selectedShotIdx, 1);
  if (selectedShotIdx >= shotPlan.length) selectedShotIdx = shotPlan.length - 1;
  markTimelineDirty();
  renderTimelineTrack();
  populateInspector();
  previewSelectedShotInMonitor(false);
  updateTimelineDeleteButton();
}

function deleteSelectedTimelineItem() {
  if (lastSelectedTrackType === "text" && selectedTextTrackId) {
    deleteSelectedTextTrackItem();
    return;
  }
  if (lastSelectedTrackType === "audio" && isAudioTrackSelected) {
    deleteAudioTrack();
    return;
  }
  if (selectedShotIdx >= 0 && selectedShotIdx < shotPlan.length) {
    deleteSelectedShot();
    return;
  }
}

function updateTimelineDeleteButton() {
  if (!btnTlDelete) return;
  if (lastSelectedTrackType === "text" && selectedTextTrackId) {
    btnTlDelete.disabled = false;
    const item = textTrackItems.find((t) => t.id === selectedTextTrackId);
    const label = item && item.content ? `"${item.content.slice(0, 15)}"` : "Text";
    btnTlDelete.title = `Delete selected text layer ${label} (⌫ Delete / Backspace)`;
    btnTlDelete.textContent = "🗑️ Delete Text";
    return;
  }
  if (lastSelectedTrackType === "audio" && isAudioTrackSelected) {
    const hasCustom = Boolean(customAudioFile || customAudioPath);
    btnTlDelete.disabled = !hasCustom;
    btnTlDelete.title = hasCustom ? "Remove custom audio track (⌫ Delete / Backspace)" : "Reference audio cannot be deleted";
    btnTlDelete.textContent = "🗑️ Clear Audio";
    return;
  }
  const hasShots = shotPlan && shotPlan.length > 1;
  btnTlDelete.disabled = !hasShots;
  btnTlDelete.title = hasShots
    ? `Delete video shot #${selectedShotIdx + 1} (⌫ Delete / Backspace)`
    : "Timeline must keep at least 1 video shot";
  btnTlDelete.textContent = "🗑️ Delete Shot";
}

if (btnTlDelete) {
  btnTlDelete.addEventListener("click", () => {
    deleteSelectedTimelineItem();
  });
}

if (btnTlMagnet) {
  btnTlMagnet.addEventListener("click", () => {
    toggleMagnetTool();
  });
}

function applyReframeToAllShots() {
  if (selectedShotIdx < 0 || selectedShotIdx >= shotPlan.length) return;
  pushUndoState();
  const cur = shotPlan[selectedShotIdx];
  const z = cur.zoom !== undefined ? cur.zoom : 100;
  const px = cur.pan_x || 0;
  const py = cur.pan_y || 0;
  shotPlan.forEach((s) => {
    s.zoom = z;
    s.pan_x = px;
    s.pan_y = py;
  });
  renderTimelineTrack();
  markTimelineDirty();
  setStatus(buildStatus, `✨ Applied ${Math.round(z)}% reframe & position to all shots! Click Apply to render.`, "success");
}

window.swiftReelFileAction = function (action) {
  if (action === "new") startNewJob();
  else if (action === "open" && inputOpenProject) inputOpenProject.click();
  else if (action === "save" && btnSaveProject) btnSaveProject.click();
  else if (action === "close") closeCurrentJob();
  else if (action === "quit") quitSwiftReel();
};

function bindMenuItem(id, fn) {
  const el = $(id);
  if (el) el.addEventListener("click", fn);
}

// FILE menu bindings
bindMenuItem("menu-new-job", () => startNewJob());
bindMenuItem("menu-open-job", () => inputOpenProject && inputOpenProject.click());
bindMenuItem("menu-save-job", () => btnSaveProject && btnSaveProject.click());
bindMenuItem("menu-relink-media", () => btnRelinkFolder && btnRelinkFolder.click());
bindMenuItem("menu-export-video", () => btnExport && !btnExport.disabled && btnExport.click());
bindMenuItem("menu-export-fcpxml", () => $("direct-fcpxml-link") && $("direct-fcpxml-link").click());
bindMenuItem("menu-export-edl", () => $("direct-edl-link") && $("direct-edl-link").click());
bindMenuItem("menu-close-job", () => closeCurrentJob());
bindMenuItem("menu-quit-app", () => quitSwiftReel());

// EDIT menu bindings
bindMenuItem("menu-undo", () => performUndo());
bindMenuItem("menu-redo", () => performRedo());
bindMenuItem("menu-rename-job", () => {
  if (topJobInput) {
    topJobInput.focus();
    topJobInput.select();
  }
});
bindMenuItem("menu-select-all-clips", () => {
  if (shotPlan.length > 0) selectShot(0);
});
bindMenuItem("menu-deselect-all-clips", () => {
  selectedShotIdx = -1;
  renderTimelineTrack();
  populateInspector();
});
bindMenuItem("menu-edit-settings", () => openSettingsModal());

// CLIP menu bindings
bindMenuItem("menu-clip-trim-tab", () => switchInspectorSubtab("trim"));
bindMenuItem("menu-clip-color-tab", () => switchInspectorSubtab("color"));
bindMenuItem("menu-clip-text-tab", () => switchInspectorSubtab("text"));
bindMenuItem("menu-clip-copy-grade", () => copySelectedClipGrade());
bindMenuItem("menu-clip-paste-grade", () => pasteGradeToSelectedClip());
bindMenuItem("menu-clip-reframe-all", () => applyReframeToAllShots());
bindMenuItem("menu-clip-grade-all", () => btnGradeAll && btnGradeAll.click());
bindMenuItem("menu-clip-reset-reframe", () => btnResetReframe && btnResetReframe.click());
bindMenuItem("menu-clip-reset-grade", () => btnResetGrade && btnResetGrade.click());
bindMenuItem("menu-clip-master-reset-grade", () => masterResetAllGrading());
bindMenuItem("menu-clip-load-lut", () => {
  switchInspectorSubtab("color");
  if (inputLut) inputLut.click();
});

// TIMELINE menu bindings
bindMenuItem("menu-tl-rebuild", () => runBuild(true));
bindMenuItem("menu-tl-add-audio", () => btnAddAudio && btnAddAudio.click());
bindMenuItem("menu-tl-clear-audio", () => btnClearAudio && btnClearAudio.click());
bindMenuItem("menu-tl-move-left", () => btnMoveLeft && !btnMoveLeft.disabled && btnMoveLeft.click());
bindMenuItem("menu-tl-move-right", () => btnMoveRight && !btnMoveRight.disabled && btnMoveRight.click());
bindMenuItem("menu-tl-delete-shot", () => deleteSelectedTimelineItem());

// VIEW menu bindings
bindMenuItem("menu-view-beatsync", () => switchMainTab("beatsync"));
bindMenuItem("menu-view-cleaner", () => switchMainTab("cleaner"));
bindMenuItem("menu-view-sorter", () => switchMainTab("sorter"));
bindMenuItem("menu-view-history", () => switchMainTab("history"));
bindMenuItem("menu-view-grid", () => {
  const btn = mediaViewToggle && mediaViewToggle.querySelector('[data-view="thumb"]');
  if (btn) btn.click();
});
bindMenuItem("menu-view-list", () => {
  const btn = mediaViewToggle && mediaViewToggle.querySelector('[data-view="list"]');
  if (btn) btn.click();
});

// HELP menu bindings
bindMenuItem("menu-help-resolve", () => {
  alert(
    "DaVinci Resolve Import Guide:\n\n1. In Swift Reel, click 'FCPXML ↓' in Step 03 (Export & Resolve).\n2. In DaVinci Resolve, go to File → Import → Timeline… and choose timeline.fcpxml.\n3. All clips link directly to your footage folder with exact filenames and timecodes!"
  );
});
bindMenuItem("menu-help-about", () => {
  alert(
    "Swift Reel Studio NLE v2.5\n\n• Beat-Synced Reference Cut Detector\n• Premiere-Style Multi-Track Timeline with Edge Trimming [ ]\n• Interactive Monitor Drag-to-Reframe & Resize\n• Full Color Grading, Levels, Curves, 3D LUT (.cube) & Fades\n• 10-Step Undo / Redo & 10-bit HDR HEVC Output\n• DaVinci Resolve FCPXML & CMX 3600 EDL Export"
  );
});

// Keyboard shortcuts
window.addEventListener("keydown", (e) => {
  const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : "";
  const isTyping = activeTag === "input" || activeTag === "textarea" || activeTag === "select";

  if (e.code === "Space" && !isTyping && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    if (btnSeqPlay) {
      btnSeqPlay.click();
    }
    return;
  }

  if (!isTyping && !e.metaKey && !e.ctrlKey && !e.altKey && (e.key === "r" || e.key === "R")) {
    e.preventDefault();
    toggleReverseSelectedClip();
    return;
  }

  if (!isTyping && !e.metaKey && !e.ctrlKey && !e.altKey && (e.key === "n" || e.key === "N")) {
    e.preventDefault();
    toggleMagnetTool();
    return;
  }

  if ((e.metaKey || e.ctrlKey) && e.altKey && !isTyping) {
    const k = e.key.toLowerCase();
    if (k === "c") {
      e.preventDefault();
      copySelectedClipGrade();
      return;
    } else if (k === "v") {
      e.preventDefault();
      pasteGradeToSelectedClip();
      return;
    }
  }

  if (!isTyping && !e.metaKey && !e.ctrlKey && !e.altKey && (e.key === "Delete" || e.key === "Backspace")) {
    e.preventDefault();
    deleteSelectedTimelineItem();
    return;
  }

  if (e.metaKey || e.ctrlKey) {
    const k = e.key.toLowerCase();
    if (k === "z" && !isTyping) {
      e.preventDefault();
      if (e.shiftKey) {
        performRedo();
      } else {
        performUndo();
      }
      return;
    } else if (k === "y" && !isTyping) {
      e.preventDefault();
      performRedo();
      return;
    } else if (k === "n") {
      e.preventDefault();
      startNewJob();
    } else if (k === "o") {
      e.preventDefault();
      if (inputOpenProject) inputOpenProject.click();
    } else if (k === "s") {
      e.preventDefault();
      if (btnSaveProject) btnSaveProject.click();
    } else if (k === "w") {
      e.preventDefault();
      closeCurrentJob();
    } else if (k === ",") {
      e.preventDefault();
      openSettingsModal();
    } else if (k === "b") {
      e.preventDefault();
      runBuild(true);
    } else if (k === "1") {
      e.preventDefault();
      switchMainTab("beatsync");
    } else if (k === "2") {
      e.preventDefault();
      switchMainTab("cleaner");
    } else if (k === "3") {
      e.preventDefault();
      switchMainTab("sorter");
    } else if (k === "4") {
      e.preventDefault();
      switchMainTab("history");
    }
  } else if (e.altKey && !isTyping) {
    if (e.key === "1") {
      e.preventDefault();
      switchInspectorSubtab("trim");
    } else if (e.key === "2") {
      e.preventDefault();
      switchInspectorSubtab("color");
    } else if (e.key === "3") {
      e.preventDefault();
      switchInspectorSubtab("text");
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (btnMoveLeft && !btnMoveLeft.disabled) btnMoveLeft.click();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      if (btnMoveRight && !btnMoveRight.disabled) btnMoveRight.click();
    }
  }
});

// ---------- Startup Initialization: Start with Clean Blank Project ----------
window.addEventListener("DOMContentLoaded", async () => {
  updateProjectSettingsUI();
  loadAvailableFonts();
  closeCurrentJob();
});
