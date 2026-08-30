let jobId = null;
let referenceFile = null;
let clipFiles = [];
let logoFile = null;
let srtFile = null;

const $ = (id) => document.getElementById(id);

function fmtTime(s) {
  return s.toFixed(2) + "s";
}

function setStatus(el, msg, kind) {
  el.textContent = msg;
  el.className = "status" + (kind ? " " + kind : "");
  el.classList.remove("hidden");
}

function enableStep(stepEl) {
  stepEl.classList.remove("disabled");
}

// ---------- generic dropzone wiring ----------
function wireDropzone(zoneEl, inputEl, multiple, onFiles) {
  zoneEl.addEventListener("click", () => inputEl.click());
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

// ---------- STEP 1: analyze ----------
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
});

thresholdSlider.addEventListener("input", () => {
  thresholdVal.textContent = thresholdSlider.value;
});

btnAnalyze.addEventListener("click", async () => {
  if (!referenceFile) return;
  btnAnalyze.disabled = true;
  setStatus(analyzeStatus, "Detecting cuts…", "working");
  rhythmResult.classList.add("hidden");

  const fd = new FormData();
  fd.append("reference", referenceFile);
  fd.append("threshold", thresholdSlider.value);
  if (jobId) fd.append("job_id", jobId);

  try {
    const res = await fetch("/api/analyze", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Analyze failed");

    jobId = data.job_id;
    $("job-id-display").textContent = jobId;
    renderRhythm(data.rhythm);
    setStatus(analyzeStatus, `Detected ${data.rhythm.shot_count} shots across ${data.rhythm.total_duration}s.`, "");
    enableStep($("step2"));
  } catch (err) {
    setStatus(analyzeStatus, "Error: " + err.message, "error");
  } finally {
    btnAnalyze.disabled = false;
  }
});

function renderRhythm(rhythm) {
  rhythmStrip.innerHTML = "";
  shotTableBody.innerHTML = "";
  const total = rhythm.total_duration;
  const hue = (i) => 38 + ((i * 27) % 30) - 15; // subtle amber-family variation per block

  rhythm.shots.forEach((s) => {
    const block = document.createElement("div");
    block.className = "rhythm-block";
    block.style.width = ((s.duration / total) * 100).toFixed(2) + "%";
    block.style.background = `hsl(${hue(s.index)}, 55%, ${58 - (s.index % 3) * 6}%)`;
    block.title = `Shot ${s.index}: ${fmtTime(s.duration)}`;
    if (s.duration / total > 0.06) block.textContent = fmtTime(s.duration);
    rhythmStrip.appendChild(block);

    const row = document.createElement("tr");
    row.innerHTML = `<td>${String(s.index).padStart(2, "0")}</td><td>${fmtTime(s.start)}</td><td>${fmtTime(s.end)}</td><td>${fmtTime(s.duration)}</td>`;
    shotTableBody.appendChild(row);
  });

  rhythmResult.classList.remove("hidden");
}

// ---------- STEP 2: build ----------
const dzClips = $("dz-clips");
const fnClips = $("fn-clips");
const inputClips = $("input-clips");
const clipList = $("clip-list");
const btnBuild = $("btn-build");
const buildStatus = $("build-status");
const buildResult = $("build-result");
const builtPreview = $("built-preview");

wireDropzone(dzClips, inputClips, true, (files) => {
  if (!files.length) return;
  clipFiles = files.filter(f => f.type.startsWith('video/') || f.name.match(/\.(mp4|mov|mkv|avi|webm)$/i));
  if (!clipFiles.length) {
    alert("No video files found.");
    return;
  }
  localFolderPath = null; // Clear native path if dropped
  clearInterval(progressInterval);
    contentTagged = false; // New footage — any previous tagging no longer applies
  renderClipList();
  fnClips.innerText = files.length + ' files selected';
  btnBuild.disabled = false;
});

const btnBrowseFolder = $("btn-browse-folder");
const inputClipsFolder = $("input-clips-folder");

let localFolderPath = null;

btnBrowseFolder.addEventListener("click", async (e) => {
  e.stopPropagation();
  
  btnBrowseFolder.innerText = "Opening Finder...";
  try {
    const res = await fetch("/api/pick_local_folder", { method: "POST" });
    const data = await res.json();
    
    if (data.path) {
      localFolderPath = data.path;
      clipFiles = []; // Clear any standard files
      clearInterval(progressInterval);
    contentTagged = false; // New footage — any previous tagging no longer applies
      clipList.innerHTML = `<div class="clip-item" style="color:var(--accent); font-weight:bold; padding: 12px; background: rgba(30, 215, 96, 0.1);">✅ Linked directly to Mac Folder:<br><span style="font-size:11.5px; font-family:monospace; color:var(--text);">${data.path}</span></div>`;
      fnClips.innerText = "📁 " + data.path;
      btnBuild.disabled = false;
    } else if (data.error && data.error !== "User cancelled") {
      alert("Error picking folder: " + data.error);
    }
  } catch (err) {
    console.error("Native picker failed", err);
  }
  btnBrowseFolder.innerText = "Pick Folder";
});

inputClipsFolder.addEventListener("change", (e) => {
  if (!inputClipsFolder.files.length) return;
  const files = Array.from(inputClipsFolder.files).filter(f => f.type.startsWith('video/') || f.name.match(/\.(mp4|mov|mkv|avi|webm)$/i));
  if (!files.length) {
    alert("No video files found in the selected folder.");
    return;
  }
  localFolderPath = null; // Clear native path
  clipFiles = files;
  clearInterval(progressInterval);
    contentTagged = false; // New footage — any previous tagging no longer applies
  renderClipList();
  fnClips.innerText = files.length + ' files selected';
  btnBuild.disabled = false;
});

function renderClipList() {
  clipList.innerHTML = "";
  clipFiles.forEach((f, i) => {
    const item = document.createElement("div");
    item.className = "clip-item";
    item.innerHTML = `<span class="idx">${String(i).padStart(2, "0")}</span><span>${f.name}</span>`;
    clipList.appendChild(item);
  });
}

// ---------- Smart-match: content tagging ----------
const smartMatchCheckbox = $("smart-match");
const smartMatchOptions = $("smart-match-options");
const categoriesInput = $("categories");
const btnTag = $("btn-tag");
const tagStatus = $("tag-status");
let contentTagged = false;
let progressInterval = null;

smartMatchCheckbox.addEventListener("change", () => {
  smartMatchOptions.style.display = smartMatchCheckbox.checked ? "flex" : "none";
});

btnTag.addEventListener("click", async () => {
  if (!jobId || (!clipFiles.length && !localFolderPath)) {
    alert("Add your footage clips first.");
    return;
  }
  btnTag.disabled = true;
  setStatus(tagStatus, "🤖 AI is visually analyzing and matching your footage...", "working");

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
    } catch(e) {}
  }, 1000);

  try {
    const res = await fetch("/api/tag", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Tagging failed");
    clearInterval(progressInterval);
    contentTagged = true;
    setStatus(tagStatus, "✅ AI Tagging complete! Your clips will now be matched by content.", "success");
  } catch (err) {
    clearInterval(progressInterval);
    contentTagged = false;
    setStatus(tagStatus, "Error: " + err.message, "error");
  } finally {
    btnTag.disabled = false;
  }
});

btnBuild.addEventListener("click", async () => {
  if (!jobId) {
    alert("Missing Job ID! Please run Step 1 (Analyze reference) first.");
    return;
  }
  if (!clipFiles.length && !localFolderPath) {
    alert("No clips selected! Please pick a folder or upload clips first.");
    return;
  }

  if (smartMatchCheckbox.checked && !contentTagged) {
    alert("Click \"Tag content\" first, or untick Smart-match to build in filename order.");
    return;
  }

  btnBuild.disabled = true;
  setStatus(buildStatus, "Cutting and stitching your footage…", "working");
  buildResult.classList.add("hidden");

  const fd = new FormData();
  fd.append("job_id", jobId);
  fd.append("keep_audio", $("keep-audio").checked ? "true" : "false");
  fd.append("overlay_audio", $("overlay-audio").checked ? "true" : "false");
  fd.append("smart_match", (smartMatchCheckbox.checked && contentTagged) ? "true" : "false");

  if (localFolderPath) {
    fd.append("local_folder", localFolderPath);
  } else {
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
    } catch(e) {}
  }, 1000);

  try {
    const res = await fetch("/api/build", { method: "POST", body: fd });
    const data = await res.json();
    clearInterval(buildProgressInterval);
    if (!res.ok) throw new Error(data.error || "Build failed");

    builtPreview.src = data.video_url;
    buildResult.classList.remove("hidden");
    setStatus(buildStatus, "Built. Preview below.", "");
    enableStep($("step3"));
  } catch (err) {
    clearInterval(buildProgressInterval);
    setStatus(buildStatus, "Error: " + err.message, "error");
  } finally {
    btnBuild.disabled = false;
  }
});

// ---------- STEP 3: export ----------
const inputLogo = $("input-logo");
const fnLogo = $("fn-logo");
const inputSrt = $("input-srt");
const fnSrt = $("fn-srt");
const btnExport = $("btn-export");
const btnDownloadEdl = $("btn-download-edl");
const exportStatus = $("export-status");
const exportResult = $("export-result");

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

  btnExport.disabled = true;
  setStatus(exportStatus, "Exporting…", "working");
  exportResult.classList.add("hidden");
  exportResult.innerHTML = "";

  const fd = new FormData();
  fd.append("job_id", jobId);
  fd.append("formats", formats.join(","));
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
        <video src="${exp.url}" controls></video>
        <div class="export-label">
          <span>${exp.format}</span>
          <a class="download" href="${exp.url}" download="${exp.filename}">Download ↓</a>
        </div>`;
      exportResult.appendChild(item);
    });

    

        if (formats.includes("edl")) {
      const edlItem = document.createElement("div");
      edlItem.className = "export-item";
      edlItem.style = "display:flex; flex-direction:column; justify-content:center; align-items:center; background: rgba(255,255,255,0.25); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 24px; text-align:center; min-height: 250px;";
      edlItem.innerHTML = `
        <div style="font-size: 48px; margin-bottom: 16px;">✂️</div>
        <div class="export-label" style="display:flex; flex-direction:column; gap: 12px; align-items:center; border:none; padding:0; background:transparent;">
          <span style="font-weight: 600; font-size:16px;">DaVinci Resolve Timeline</span>
          <span style="font-size: 11.5px; color: var(--text-dim); margin-bottom: 8px; line-height:1.4;">Import into DaVinci Resolve. FCPXML is recommended — it links directly to your source files by absolute path.</span>
          <div style="display:flex; gap: 8px; flex-wrap: wrap; justify-content: center;">
            <a class="btn btn-primary" style="text-decoration: none; font-size: 12px; padding: 8px 16px;" href="/api/media/${jobId}/timeline.fcpxml" download="timeline.fcpxml">Download FCPXML ↓</a>
            <a class="btn btn-secondary" style="text-decoration: none; font-size: 12px; padding: 8px 16px;" href="/api/media/${jobId}/timeline.edl" download="timeline.edl">Download EDL ↓</a>
          </div>
        </div>
      `;
      exportResult.appendChild(edlItem);
    }

    exportResult.classList.remove("hidden");
    let statusText = `✅ Exported ${data.exports.length} video format(s).`;
    if (formats.includes("edl") && data.exports.length > 0) {
      statusText = `✅ Exported ${data.exports.length} video format(s) + DaVinci EDL.`;
    } else if (formats.includes("edl") && data.exports.length === 0) {
      statusText = `✅ Exported DaVinci EDL.`;
    }
    setStatus(exportStatus, statusText, "success");
  } catch (err) {
    setStatus(exportStatus, "Error: " + err.message, "error");
  } finally {
    btnExport.disabled = false;
  }
});
