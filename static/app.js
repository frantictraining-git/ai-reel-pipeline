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
let clearCustomAudioFlag = false;
let audioStartOffset = 0.0;
let audioVolumePct = 100;
let activeInspectorSubtab = "trim"; // "trim" | "color"

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

// ---------- Monitor Tabs (Program vs Source) ----------
const tabProgram = $("tab-program");
const tabSource = $("tab-source");
const monitorEmpty = $("monitor-empty");
const buildResult = $("build-result");
const builtPreview = $("built-preview");
const sourcePreviewWrap = $("source-preview-wrap");
const sourcePreview = $("source-preview");
const btnSrcPlay = $("btn-src-play");
const srcSeekSlider = $("src-seek-slider");
const srcTimeReadout = $("src-time-readout");

function showMonitorTab(which) {
  if (which === "source") {
    tabSource.classList.add("active");
    tabProgram.classList.remove("active");
    buildResult.classList.add("hidden");
    if (sourcePreview.getAttribute("src")) {
      monitorEmpty.classList.add("hidden");
      sourcePreviewWrap.classList.remove("hidden");
      updateProjectSettingsUI();
    } else {
      sourcePreviewWrap.classList.add("hidden");
      monitorEmpty.classList.remove("hidden");
    }
  } else {
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

// Wire Tactile Source Player Transport Bar
if (btnSrcPlay && sourcePreview) {
  btnSrcPlay.addEventListener("click", () => {
    if (sourcePreview.paused) {
      sourcePreview.play().catch(() => {});
    } else {
      sourcePreview.pause();
    }
  });
  sourcePreview.addEventListener("play", () => {
    btnSrcPlay.textContent = "❚❚";
  });
  sourcePreview.addEventListener("pause", () => {
    btnSrcPlay.textContent = "▶";
  });
  sourcePreview.addEventListener("timeupdate", () => {
    const dur = sourcePreview.duration || 0;
    const cur = sourcePreview.currentTime || 0;
    if (srcSeekSlider && dur > 0) {
      srcSeekSlider.max = dur.toFixed(2);
      srcSeekSlider.value = cur.toFixed(2);
    }
    if (srcTimeReadout) {
      srcTimeReadout.textContent = `${cur.toFixed(1)}s / ${dur.toFixed(1)}s`;
    }
  });
}

if (srcSeekSlider && sourcePreview) {
  srcSeekSlider.addEventListener("input", () => {
    sourcePreview.currentTime = parseFloat(srcSeekSlider.value) || 0;
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
const btnMoveLeft = $("btn-move-left");
const btnMoveRight = $("btn-move-right");
const btnRebuildOrder = $("btn-rebuild-order");

// Audio Track DOM
const inputCustomAudio = $("input-custom-audio");
const btnAddAudio = $("btn-add-audio");
const btnClearAudio = $("btn-clear-audio");
const tlAudioClip = $("tl-audio-clip");
const tlAudioTrimLeft = $("tl-audio-trim-left");
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
const btnGradeAll = $("btn-grade-all");
const btnResetGrade = $("btn-reset-grade");

function switchInspectorSubtab(subtab) {
  activeInspectorSubtab = subtab === "color" ? "color" : "trim";
  if (inspPaneTrim) inspPaneTrim.classList.toggle("hidden", activeInspectorSubtab !== "trim");
  if (inspPaneColor) inspPaneColor.classList.toggle("hidden", activeInspectorSubtab !== "color");
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
  if (!sourcePreview) return;
  if (selectedShotIdx < 0 || selectedShotIdx >= shotPlan.length) {
    sourcePreview.style.filter = "none";
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
  const sepia = Math.min(0.35, Math.abs(temp) / 260);
  const hue = Math.round((temp * -0.15) + (tint * 0.25));

  sourcePreview.style.filter = `brightness(${Math.max(0.2, b).toFixed(2)}) contrast(${Math.max(0.3, c).toFixed(2)}) saturate(${s.toFixed(2)}) sepia(${sepia.toFixed(2)}) hue-rotate(${hue}deg)`;
  if (vignettePreviewLayer) {
    const vig = Math.max(0, Math.min(100, Number(g.vignette || 0)));
    vignettePreviewLayer.style.opacity = (vig / 100).toFixed(2);
  }
}

function applyReframeTransformToPreview() {
  if (!sourcePreview) return;
  if (selectedShotIdx < 0 || selectedShotIdx >= shotPlan.length) {
    sourcePreview.style.transform = "translate(0%, 0%) scale(1)";
    applyGradeFilterToPreview();
    return;
  }
  const shot = shotPlan[selectedShotIdx];
  const zoom = Number(shot.zoom !== undefined ? shot.zoom : 100);
  const panX = Number(shot.pan_x || 0);
  const panY = Number(shot.pan_y || 0);

  sourcePreview.style.transform = `translate(${panX.toFixed(2)}%, ${panY.toFixed(2)}%) scale(${(zoom / 100).toFixed(3)})`;
  if (inspZoomSlider) inspZoomSlider.value = Math.round(zoom);
  if (inspZoomVal) inspZoomVal.textContent = `${Math.round(zoom)}%`;
  if (inspPanReadout) {
    inspPanReadout.textContent = `Position: X ${panX > 0 ? "+" : ""}${Math.round(panX)}% · Y ${panY > 0 ? "+" : ""}${Math.round(panY)}% (Drag video in monitor)`;
  }
  applyGradeFilterToPreview();
}

// Mouse Drag to Reposition & Wheel to Resize inside #reframe-viewport
let isDraggingReframe = false;
let dragStartX = 0;
let dragStartY = 0;
let dragOrigPanX = 0;
let dragOrigPanY = 0;

if (reframeViewport) {
  reframeViewport.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    if (selectedShotIdx < 0 && shotPlan.length > 0) {
      selectedShotIdx = 0;
      populateInspector();
      renderTimelineTrack();
    }
    if (selectedShotIdx < 0 || selectedShotIdx >= shotPlan.length) return;
    isDraggingReframe = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragOrigPanX = Number(shotPlan[selectedShotIdx].pan_x || 0);
    dragOrigPanY = Number(shotPlan[selectedShotIdx].pan_y || 0);
    e.preventDefault();
  });

  window.addEventListener("mousemove", (e) => {
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

function previewSelectedShotInMonitor(autoPlay = true) {
  if (selectedShotIdx < 0 || selectedShotIdx >= shotPlan.length) return;
  const shot = shotPlan[selectedShotIdx];
  if (!shot || !shot.clip || shot.clip.includes("(awaiting clips)")) return;

  let targetSrc = null;
  if (!localFolderPath && clipFiles.length) {
    const f = clipFiles.find((cf) => cf.name === shot.clip);
    if (f) {
      if (!f._blobUrl) f._blobUrl = URL.createObjectURL(f);
      targetSrc = f._blobUrl;
    }
  } else if (jobId) {
    targetSrc = `/api/clip_preview/${jobId}/${encodeURIComponent(shot.clip)}`;
  }

  if (targetSrc) {
    if (sourcePreview.getAttribute("data-clip") !== shot.clip) {
      sourcePreview.src = targetSrc;
      sourcePreview.setAttribute("data-clip", shot.clip);
    }
    showMonitorTab("source");
    applyReframeTransformToPreview();
    const seekTo = Number(shot.in_point || 0);
    const applySeek = () => {
      try {
        sourcePreview.currentTime = seekTo;
        if (autoPlay) sourcePreview.play().catch(() => {});
      } catch (e) {}
    };
    if (sourcePreview.readyState >= 1) {
      applySeek();
    } else {
      sourcePreview.addEventListener("loadedmetadata", applySeek, { once: true });
    }
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
  const { idx, side, startX, origIn, origDur, clipDur, cardEl, metaEl } = activeEdgeTrim;
  const shot = shotPlan[idx];
  if (!shot) return;
  const dxPx = e.clientX - startX;
  const deltaSec = dxPx / 110.0; // 110px per second scale

  if (side === "left") {
    // Dragging left edge '[' adjusts In-Point and inversely adjusts Duration
    const maxIn = Math.max(0, origIn + origDur - 0.15);
    const newIn = Math.max(0, Math.min(maxIn, origIn + deltaSec));
    const actualDelta = newIn - origIn;
    const newDur = Math.max(0.15, origDur - actualDelta);
    shot.in_point = Number(newIn.toFixed(2));
    shot.duration = Number(newDur.toFixed(2));
  } else {
    // Dragging right edge ']' adjusts Out-Point / Duration
    const maxDur = Math.max(0.5, clipDur - origIn);
    const newDur = Math.max(0.15, Math.min(maxDur, origDur + deltaSec));
    shot.duration = Number(newDur.toFixed(2));
  }

  const widthPx = Math.max(96, Math.min(340, Math.round(shot.duration * 110)));
  if (cardEl) cardEl.style.width = `${widthPx}px`;
  if (metaEl) {
    metaEl.innerHTML = `<span>In: ${Number(shot.in_point || 0).toFixed(1)}s</span><span>${Number(shot.duration || 0).toFixed(2)}s</span>`;
  }
  const totalDur = shotPlan.reduce((acc, s) => acc + Number(s.duration || 0), 0);
  if (tlSummary) tlSummary.textContent = `${shotPlan.length} shots · ${totalDur.toFixed(2)}s total`;
  if (selectedShotIdx === idx) {
    if (inspInpoint) inspInpoint.value = Number(shot.in_point || 0).toFixed(2);
    if (inspInpointSlider) inspInpointSlider.value = shot.in_point || 0;
    if (inspDuration) inspDuration.value = Number(shot.duration || 0).toFixed(2);
  }
  markTimelineDirty();
});

window.addEventListener("mouseup", () => {
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

function renderTimecodeRuler(totalWidthPx, totalDurSec) {
  if (!tlRulerStrip) return;
  tlRulerStrip.innerHTML = "";
  const width = Math.max(480, totalWidthPx);
  tlRulerStrip.style.width = `${width}px`;
  if (tlAudioClip) tlAudioClip.style.width = `${width}px`;

  const stepSec = totalDurSec > 25 ? 2 : 1;
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

  const totalDur = shotPlan.reduce((acc, s) => acc + Number(s.duration || 0), 0);
  tlSummary.textContent = `${shotPlan.length} shots · ${totalDur.toFixed(2)}s total`;

  let cumulativeWidth = 0;

  shotPlan.forEach((shot, idx) => {
    shot.index = idx;
    ensureShotGrade(shot);
    const card = document.createElement("div");
    card.className = "tl-shot-card" + (idx === selectedShotIdx ? " selected" : "");
    const widthPx = Math.max(96, Math.min(340, Math.round(shot.duration * 110)));
    card.style.width = `${widthPx}px`;
    cumulativeWidth += widthPx + 5;
    card.draggable = true;

    const shortClip = (shot.clip || "").replace(/\.(mov|mp4|m4v|mkv|avi|webm)$/i, "");
    const zoomNum = Math.round(shot.zoom !== undefined ? shot.zoom : 100);
    const g = shot.grade || {};
    const hasGrade =
      g.brightness || g.contrast || g.saturation || g.temperature || g.tint || g.whites || g.blacks || g.vignette ||
      (g.curve && g.curve !== "none") || g.fade_in > 0 || g.fade_out > 0;
    const gradeDot = hasGrade ? " 🎨" : "";
    const tagBadge = shot.tag
      ? `<span class="tl-shot-tag">${shot.tag}${gradeDot}</span>`
      : `<span class="tl-shot-tag">${zoomNum}%${gradeDot}</span>`;

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
        selectedShotIdx = idx;
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
        const moved = shotPlan.splice(fromIdx, 1)[0];
        shotPlan.splice(idx, 0, moved);
        selectedShotIdx = idx;
        markTimelineDirty();
        renderTimelineTrack();
        populateInspector();
      }
    });

    tlShotsStrip.appendChild(card);
  });

  renderTimecodeRuler(cumulativeWidth, totalDur);

  btnMoveLeft.disabled = selectedShotIdx <= 0;
  btnMoveRight.disabled = selectedShotIdx < 0 || selectedShotIdx >= shotPlan.length - 1;
}

// ---------- A1 Audio Track Controls (Add Audio, Trim Start Offset, Volume) ----------
if (btnAddAudio && inputCustomAudio) {
  btnAddAudio.addEventListener("click", () => inputCustomAudio.click());
  inputCustomAudio.addEventListener("change", () => {
    const f = inputCustomAudio.files[0];
    if (!f) return;
    customAudioFile = f;
    clearCustomAudioFlag = false;
    audioStartOffset = 0.0;
    if (tlAudioTitle) tlAudioTitle.textContent = `🎵 Custom Audio: ${f.name}`;
    if (tlAudioOffsetLabel) tlAudioOffsetLabel.textContent = `Start: 0.0s`;
    if (btnClearAudio) btnClearAudio.classList.remove("hidden");
    const overlayCb = $("overlay-audio");
    if (overlayCb) overlayCb.checked = true;
    markTimelineDirty();
  });
}

if (btnClearAudio) {
  btnClearAudio.addEventListener("click", () => {
    customAudioFile = null;
    clearCustomAudioFlag = true;
    audioStartOffset = 0.0;
    if (inputCustomAudio) inputCustomAudio.value = "";
    if (tlAudioTitle) tlAudioTitle.textContent = "🔊 Reference Audio Track (Synced)";
    if (tlAudioOffsetLabel) tlAudioOffsetLabel.textContent = "Start: 0.0s";
    btnClearAudio.classList.add("hidden");
    markTimelineDirty();
  });
}

if (tlAudioVol) {
  tlAudioVol.addEventListener("input", () => {
    audioVolumePct = parseInt(tlAudioVol.value, 10) || 100;
    if (tlAudioVolLabel) tlAudioVolLabel.textContent = `${audioVolumePct}%`;
    markTimelineDirty();
  });
}

let isTrimmingAudio = false;
let audioTrimStartX = 0;
let audioOrigOffset = 0;

if (tlAudioTrimLeft) {
  tlAudioTrimLeft.addEventListener("mousedown", (e) => {
    e.stopPropagation();
    e.preventDefault();
    isTrimmingAudio = true;
    audioTrimStartX = e.clientX;
    audioOrigOffset = audioStartOffset;
  });
  window.addEventListener("mousemove", (e) => {
    if (!isTrimmingAudio) return;
    const dx = e.clientX - audioTrimStartX;
    audioStartOffset = Math.max(0, Number((audioOrigOffset + dx / 60.0).toFixed(1)));
    if (tlAudioOffsetLabel) tlAudioOffsetLabel.textContent = `Start: ${audioStartOffset.toFixed(1)}s`;
    markTimelineDirty();
  });
  window.addEventListener("mouseup", () => {
    isTrimmingAudio = false;
  });
}

function markTimelineDirty() {
  timelineDirty = true;
  if (jobId && (clipFiles.length || localFolderPath || availableClips.length)) {
    btnRebuildOrder.classList.remove("hidden");
  }
}

function selectShot(idx) {
  selectedShotIdx = idx;
  renderTimelineTrack();
  populateInspector();
  previewSelectedShotInMonitor(true);
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
  if (selectedShotIdx < 0 || selectedShotIdx >= shotPlan.length) {
    inspEmpty.classList.remove("hidden");
    inspControls.classList.add("hidden");
    inspShotBadge.textContent = "No shot selected";
    return;
  }

  const shot = shotPlan[selectedShotIdx];
  if (shot.zoom === undefined) shot.zoom = 100;
  if (shot.pan_x === undefined) shot.pan_x = 0;
  if (shot.pan_y === undefined) shot.pan_y = 0;
  ensureShotGrade(shot);

  inspEmpty.classList.add("hidden");
  inspControls.classList.remove("hidden");
  inspShotBadge.textContent = `Shot #${String(selectedShotIdx + 1).padStart(2, "0")}`;

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
  applyReframeTransformToPreview();
}

// Wire Grading Sliders & Controls
function wireGradeSlider(sliderEl, valEl, key, isPct = false) {
  if (!sliderEl) return;
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
    const g = ensureShotGrade(shotPlan[selectedShotIdx]);
    g.fade_in = Math.max(0, parseFloat(numGradeFadeIn.value) || 0);
    renderTimelineTrack();
    markTimelineDirty();
  });
}

if (numGradeFadeOut) {
  numGradeFadeOut.addEventListener("change", () => {
    if (selectedShotIdx < 0 || selectedShotIdx >= shotPlan.length) return;
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

if (btnResetGrade) {
  btnResetGrade.addEventListener("click", () => {
    if (selectedShotIdx < 0 || selectedShotIdx >= shotPlan.length) return;
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
  inspInpointSlider.addEventListener("input", () => {
    if (selectedShotIdx < 0) return;
    const val = parseFloat(inspInpointSlider.value) || 0;
    inspInpoint.value = val.toFixed(2);
    shotPlan[selectedShotIdx].in_point = val;
    markTimelineDirty();
    previewSelectedShotInMonitor(false);
  });
  inspInpointSlider.addEventListener("change", () => {
    renderTimelineTrack();
  });
}

if (inspInpoint) {
  inspInpoint.addEventListener("change", () => {
    if (selectedShotIdx < 0) return;
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
    const val = Math.max(0.1, parseFloat(inspDuration.value) || 0.5);
    shotPlan[selectedShotIdx].duration = val;
    markTimelineDirty();
    renderTimelineTrack();
  });
}

if (inspZoomSlider) {
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
  fd.append("audio_volume", String((audioVolumePct / 100.0).toFixed(2)));

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

  if (useCustomShotPlan && shotPlan && shotPlan.length) {
    fd.append("shot_plan", JSON.stringify(shotPlan));
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

btnBuild.addEventListener("click", () => runBuild(false));
if (btnApplyTimeline) btnApplyTimeline.addEventListener("click", () => runBuild(true));
if (btnRebuildOrder) btnRebuildOrder.addEventListener("click", () => runBuild(true));

// ---------- STEP 3: Export (MP4 / QuickTime MOV + H.264 / H.265) ----------
const inputLogo = $("input-logo");
const fnLogo = $("fn-logo");
const inputSrt = $("input-srt");
const fnSrt = $("fn-srt");
const btnExport = $("btn-export");
const exportStatus = $("export-status");
const exportResult = $("export-result");
const selExportContainer = $("export-container");
const selExportCodec = $("export-codec");

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

  const container = selExportContainer ? selExportContainer.value : "mp4";
  const codec = selExportCodec ? selExportCodec.value : "h264";

  btnExport.disabled = true;
  setStatus(exportStatus, `Exporting (${codec.toUpperCase()} · .${container})…`, "working");
  exportResult.classList.add("hidden");
  exportResult.innerHTML = "";

  const fd = new FormData();
  fd.append("job_id", jobId);
  fd.append("formats", formats.join(","));
  fd.append("container", container);
  fd.append("codec", codec);
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

async function loadHistoryJobs() {
  const list = $("hist-job-list");
  if (!list) return;
  try {
    const res = await fetch("/api/jobs");
    const data = await res.json();
    list.innerHTML = "";

    if (data.disk_free) $("hist-disk-free").innerText = formatBytes(data.disk_free);
    if (!data.jobs || data.jobs.length === 0) {
      list.innerHTML = '<div style="text-align:center; padding:30px; color:var(--text-faint);">No past jobs found.</div>';
      $("hist-total-jobs").innerText = "0";
      $("hist-total-size").innerText = "0 Bytes";
      return;
    }

    let totalSize = 0;
    data.jobs.forEach((job) => {
      totalSize += job.size_bytes;
      const videoUrl = `/api/media/${job.job_id}/${job.video_file || "built_reel.mp4"}`;
      const edlUrl = `/api/media/${job.job_id}/timeline.edl`;
      const fcpxmlUrl = `/api/media/${job.job_id}/timeline.fcpxml`;

      const card = document.createElement("div");
      card.className = "job-card";
      card.innerHTML = `
        <input type="checkbox" class="hist-job-cb" value="${job.job_id}">
        <div class="job-info">
          <span class="job-name">${job.filename || "Unknown"}</span>
          <div class="job-meta">
            <span>${formatDate(job.timestamp)}</span>
            <span>${formatBytes(job.size_bytes)}</span>
            <span>${job.job_id}</span>
          </div>
        </div>
        <div class="job-actions">
          <button type="button" class="btn btn-primary btn-sm" onclick="loadJobIntoEditor('${job.job_id}')">▶ Load in Editor</button>
          <button type="button" class="btn btn-secondary btn-sm" onclick="openJobFolder('${job.job_id}')">📂 Folder</button>
          <a href="${videoUrl}?dl=1" download class="btn btn-secondary btn-sm" style="text-decoration:none;">Video ↓</a>
          <a href="${fcpxmlUrl}" download="timeline.fcpxml" class="btn btn-secondary btn-sm" style="text-decoration:none;">FCPXML ↓</a>
          <a href="${edlUrl}" download="timeline.edl" class="btn btn-secondary btn-sm" style="text-decoration:none;">EDL ↓</a>
        </div>
      `;
      list.appendChild(card);
    });

    $("hist-total-jobs").innerText = data.jobs.length;
    $("hist-total-size").innerText = formatBytes(totalSize);

    const cbs = document.querySelectorAll(".hist-job-cb");
    const selAll = $("hist-select-all");
    const btnDel = $("btn-hist-delete");

    const updateDel = () => {
      const count = document.querySelectorAll(".hist-job-cb:checked").length;
      btnDel.disabled = count === 0;
      btnDel.innerText = count > 0 ? `🗑️ Delete Selected (${count})` : "🗑️ Delete Selected";
    };

    cbs.forEach((cb) =>
      cb.addEventListener("change", () => {
        selAll.checked = document.querySelectorAll(".hist-job-cb:not(:checked)").length === 0;
        updateDel();
      })
    );
    if (selAll) {
      selAll.onchange = (e) => {
        cbs.forEach((cb) => (cb.checked = e.target.checked));
        updateDel();
      };
    }
  } catch (e) {
    list.innerHTML = '<div style="color:var(--danger); padding:20px;">Error loading jobs.</div>';
  }
}

if ($("btn-hist-delete")) {
  $("btn-hist-delete").addEventListener("click", async () => {
    const selected = Array.from(document.querySelectorAll(".hist-job-cb:checked")).map((cb) => cb.value);
    if (!selected.length) return;
    if (!confirm(`Are you sure you want to permanently delete ${selected.length} job folder(s)?`)) return;
    $("btn-hist-delete").disabled = true;
    try {
      await fetch("/api/jobs/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_ids: selected }),
      });
      await loadHistoryJobs();
    } catch (e) {}
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
  jobId = data.job_id;
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
  } else if (currentRhythm) {
    initDraftTimelineFromRhythm();
  }

  if (data.built_exists && data.video_url) {
    builtPreview.src = data.video_url + "?t=" + Date.now();
    showMonitorTab("program");
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

  if ($("job-id-display")) $("job-id-display").textContent = "—";
  if (topJobInput) topJobInput.value = "—";
  if ($("job-name")) $("job-name").value = "";
  if (fnReference) fnReference.textContent = "";
  if (fnClips) fnClips.textContent = "";
  if (fnLut) fnLut.textContent = "";
  if (btnClearLut) btnClearLut.classList.add("hidden");
  if (tlAudioTitle) tlAudioTitle.textContent = "🔊 Reference Audio Track (Synced)";
  if (tlAudioOffsetLabel) tlAudioOffsetLabel.textContent = "Start: 0.0s";
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
    alert("Timeline must keep at least 1 shot.");
    return;
  }
  shotPlan.splice(selectedShotIdx, 1);
  if (selectedShotIdx >= shotPlan.length) selectedShotIdx = shotPlan.length - 1;
  markTimelineDirty();
  renderTimelineTrack();
  populateInspector();
}

function applyReframeToAllShots() {
  if (selectedShotIdx < 0 || selectedShotIdx >= shotPlan.length) return;
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
bindMenuItem("menu-clip-reframe-all", () => applyReframeToAllShots());
bindMenuItem("menu-clip-grade-all", () => btnGradeAll && btnGradeAll.click());
bindMenuItem("menu-clip-reset-reframe", () => btnResetReframe && btnResetReframe.click());
bindMenuItem("menu-clip-reset-grade", () => btnResetGrade && btnResetGrade.click());
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
bindMenuItem("menu-tl-delete-shot", () => deleteSelectedShot());

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
    "Swift Reel Studio NLE v2.5\n\n• Beat-Synced Reference Cut Detector\n• Premiere-Style Multi-Track Timeline with Edge Trimming [ ]\n• Interactive Monitor Drag-to-Reframe & Resize\n• Full Color Grading, Levels, Curves, 3D LUT (.cube) & Fades\n• DaVinci Resolve FCPXML & CMX 3600 EDL Export"
  );
});

// Keyboard shortcuts
window.addEventListener("keydown", (e) => {
  const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : "";
  const isTyping = activeTag === "input" || activeTag === "textarea" || activeTag === "select";

  if (e.metaKey || e.ctrlKey) {
    const k = e.key.toLowerCase();
    if (k === "n") {
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
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (btnMoveLeft && !btnMoveLeft.disabled) btnMoveLeft.click();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      if (btnMoveRight && !btnMoveRight.disabled) btnMoveRight.click();
    }
  }
});

// ---------- Auto-Load Latest Built Job on Startup ----------
window.addEventListener("DOMContentLoaded", async () => {
  updateProjectSettingsUI();
  try {
    const res = await fetch("/api/job_state/ede3406fe924");
    if (!res.ok) return;
    const data = await res.json();
    hydrateEditorFromJobState(data);
  } catch (e) {}
});
