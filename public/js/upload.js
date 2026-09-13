/* =========================================================
   FILE UPLOAD
   ========================================================= */
const dropzone = $("#dropzone");
const fileInput = $("#file-input");

dropzone.addEventListener("click", ()=> fileInput.click());
dropzone.addEventListener("dragover", e=>{ e.preventDefault(); dropzone.classList.add("drag"); });
dropzone.addEventListener("dragleave", ()=> dropzone.classList.remove("drag"));
dropzone.addEventListener("drop", e=>{
  e.preventDefault(); dropzone.classList.remove("drag");
  handleFiles(e.dataTransfer.files);
});
fileInput.addEventListener("change", e=> handleFiles(e.target.files));

async function handleFiles(fileListRaw){
  clearError();
  const meta = OP_META[state.op];
  const files = Array.from(fileListRaw);
  for (const file of files){
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    const isImage = file.type.startsWith("image/") || /\.(jpe?g|png|webp|bmp)$/i.test(file.name);

    if (meta.accept === "image" && !isImage){
      showError(`"${file.name}" is not a supported image format (JPG, PNG, WebP, BMP). Skipped.`);
      continue;
    }
    if (meta.accept === "pdf" && !isPdf){
      showError(`"${file.name}" is not a PDF file. Skipped.`);
      continue;
    }
    if (file.size > 80*1024*1024){
      showError(`"${file.name}" is larger than 80 MB, which may exceed your browser's memory limits. Try a smaller file.`);
      continue;
    }

    const entry = { id: uid(), file, name: file.name, size: file.size };

    try{
      if (isImage){
        const { img, url } = await loadImageFromFile(file);
        entry.kind = "image";
        entry.width = img.naturalWidth;
        entry.height = img.naturalHeight;
        entry.previewUrl = url;
        entry.img = img;
      } else if (isPdf){
        const buf = await file.arrayBuffer();
        const pdfDoc = await pdfjsLib.getDocument({ data: buf }).promise;
        entry.kind = "pdf";
        entry.pdfDoc = pdfDoc;
        entry.pageCount = pdfDoc.numPages;
      }
      state.files.push(entry);
    } catch(err){
      showError(`Couldn't read "${file.name}": ${err.message || "the file may be corrupted."}`);
    }
  }
  fileInput.value = "";
  renderFileList();
  renderControls();
  renderProcessBar();
}

function renderFileList(){
  const list = $("#filelist");
  list.innerHTML = "";
  state.files.forEach((f, idx)=>{
    const row = document.createElement("div");
    row.className = "file-row";
    row.draggable = state.op === "img2pdf";
    row.dataset.id = f.id;

    let thumbHtml;
    if (f.kind === "image"){
      thumbHtml = `<img class="thumb" src="${f.previewUrl}" alt="">`;
    } else {
      thumbHtml = `<div class="pdf-thumb">PDF<br>${f.pageCount}p</div>`;
    }
    const sub = f.kind === "image"
      ? `${f.width}×${f.height}px · ${formatBytes(f.size)}`
      : `${f.pageCount} page${f.pageCount>1?"s":""} · ${formatBytes(f.size)}`;

    row.innerHTML = `
      ${state.op === "img2pdf" ? '<span class="drag-handle">⠿</span>' : ""}
      ${thumbHtml}
      <div class="meta">
        <div class="fname">${f.name}</div>
        <div class="fsub">${sub}</div>
      </div>
      <button class="remove" title="Remove" data-remove="${f.id}">×</button>
    `;
    list.appendChild(row);
  });

  $("#filelist-actions").style.display = state.files.length ? "flex" : "none";

  $$("[data-remove]", list).forEach(btn=>{
    btn.addEventListener("click", ()=>{
      state.files = state.files.filter(f=>f.id !== btn.dataset.remove);
      renderFileList(); renderProcessBar();
    });
  });

  if (state.op === "img2pdf") enableDragReorder(list);
}

$("#clear-all").addEventListener("click", ()=>{
  state.files = [];
  renderFileList(); renderProcessBar(); hideResults();
});

let dragSrcId = null;
function enableDragReorder(list){
  $$(".file-row", list).forEach(row=>{
    row.addEventListener("dragstart", ()=>{ dragSrcId = row.dataset.id; row.classList.add("dragging"); });
    row.addEventListener("dragend", ()=> row.classList.remove("dragging"));
    row.addEventListener("dragover", e=> e.preventDefault());
    row.addEventListener("drop", e=>{
      e.preventDefault();
      const targetId = row.dataset.id;
      if (!dragSrcId || dragSrcId === targetId) return;
      const srcIdx = state.files.findIndex(f=>f.id===dragSrcId);
      const tgtIdx = state.files.findIndex(f=>f.id===targetId);
      const [moved] = state.files.splice(srcIdx,1);
      state.files.splice(tgtIdx,0,moved);
      renderFileList();
    });
  });
}

/* =========================================================
   OPERATION / MODE SWITCHING
   ========================================================= */
$$(".op-item").forEach(item=>{
  item.addEventListener("click", ()=>{
    $$(".op-item").forEach(i=>i.classList.remove("active"));
    item.classList.add("active");
    state.op = item.dataset.op;
    const meta = OP_META[state.op];
    $("#op-title").textContent = meta.title;
    $("#op-desc").textContent = meta.desc;
    $("#dz-sub").textContent = "or click to choose files — " + meta.dz;
    $("#process-btn").textContent = meta.processLabel;
    hideResults(); clearError();
    renderFileList(); renderControls(); renderProcessBar();
  });
});

$("#mode-simple").addEventListener("click", ()=> setMode("simple"));
$("#mode-advanced").addEventListener("click", ()=> setMode("advanced"));
function setMode(m){
  state.mode = m;
  document.body.classList.toggle("advanced", m==="advanced");
  document.body.classList.toggle("simple", m==="simple");
  $("#mode-simple").classList.toggle("active", m==="simple");
  $("#mode-advanced").classList.toggle("active", m==="advanced");
}

/* =========================================================
   CONTROLS RENDERING (per operation)
   ========================================================= */
function outputFormatOptions(){
  return `
    <option value="jpg">JPG</option>
    <option value="png">PNG</option>
    <option value="webp">WebP</option>
  `;
}

function renderControls(){
  const c = $("#controls");
  c.innerHTML = "";
  if (!state.files.length){
    c.innerHTML = `<div class="op-empty">Upload files above to see conversion options.</div>`;
    return;
  }

  if (state.op === "convert"){
    c.innerHTML = `
      <div class="control-group">
        <h3>Output format</h3>
        <div class="row">
          <div class="field">
            <label>Convert to</label>
            <select id="ctl-format">
              ${outputFormatOptions()}
              <option value="pdf">PDF (combine all)</option>
            </select>
          </div>
          <div class="field adv-only" id="ctl-quality-wrap">
            <label>Quality</label>
            <input type="range" id="ctl-quality" min="1" max="100" value="90">
          </div>
        </div>
      </div>
      <div class="control-group" id="convert-target-group">
        <h3>Target file size (optional)</h3>
        <p class="hint" style="margin:0 0 12px;">Choose exactly how big or small you want the converted file — pick the unit and the number yourself.</p>
        <div class="checkbox-field" style="margin-bottom:14px;">
          <input type="checkbox" id="ctl-convert-target-on">
          <label for="ctl-convert-target-on">Target a specific file size</label>
        </div>
        <div class="row" id="convert-target-fields" style="display:none;">
          <div class="field">
            <label>Target size</label>
            <div class="target-input">
              <input type="number" id="ctl-convert-target-value" min="0" step="0.1" value="100">
              <select id="ctl-convert-target-unit">
                <option value="B">B</option>
                <option value="KB" selected>KB</option>
                <option value="MB">MB</option>
              </select>
            </div>
          </div>
          <div class="field adv-only">
            <label>Strategy</label>
            <select id="ctl-convert-target-mode">
              <option value="both">Resize + Compress</option>
              <option value="compress">Compress only</option>
              <option value="resize">Resize only</option>
            </select>
          </div>
        </div>
      </div>
    `;
  }

  if (state.op === "resize"){
    c.innerHTML = `
      <div class="control-group">
        <h3>Resize mode</h3>
        <div class="pill-group" id="resize-mode">
          <button class="active" data-val="dimensions">Dimensions</button>
          <button data-val="percentage">Percentage</button>
        </div>
        <div class="row" id="resize-dims-fields" style="margin-top:16px;">
          <div class="field">
            <label>Width (px)</label>
            <input type="number" id="ctl-width" min="1" placeholder="1000">
          </div>
          <div class="field">
            <label>Height (px)</label>
            <input type="number" id="ctl-height" min="1" placeholder="auto">
          </div>
          <div class="checkbox-field">
            <input type="checkbox" id="ctl-aspect" checked>
            <label for="ctl-aspect">Maintain aspect ratio</label>
          </div>
        </div>
        <div class="row" id="resize-pct-fields" style="display:none;margin-top:16px;">
          <div class="pill-group" id="pct-presets">
            <button data-val="25">25%</button>
            <button data-val="50">50%</button>
            <button data-val="75">75%</button>
            <button class="active" data-val="100">100%</button>
          </div>
          <div class="field">
            <label>Custom %</label>
            <input type="number" id="ctl-pct" min="1" max="500" value="100">
          </div>
        </div>
        <div class="hint" id="dims-preview" style="margin-top:12px;"></div>
      </div>
      <div class="control-group">
        <h3>Output format</h3>
        <div class="row">
          <div class="field">
            <label>Format</label>
            <select id="ctl-format">${outputFormatOptions()}</select>
          </div>
        </div>
      </div>
      <div class="control-group">
        <h3>Also limit file size (optional)</h3>
        <p class="hint" style="margin:0 0 12px;">Useful for forms that ask for an exact photo size, e.g. "200×230 px, under 50 KB". Dimensions above stay fixed — only quality is adjusted to fit.</p>
        <div class="checkbox-field" style="margin-bottom:14px;">
          <input type="checkbox" id="ctl-limit-size-on">
          <label for="ctl-limit-size-on">Keep file size under a limit</label>
        </div>
        <div class="row" id="limit-size-fields" style="display:none;">
          <div class="field">
            <label>Maximum size</label>
            <div class="target-input">
              <input type="number" id="ctl-limit-value" min="0" step="0.1" value="50">
              <select id="ctl-limit-unit">
                <option value="B">B</option>
                <option value="KB" selected>KB</option>
                <option value="MB">MB</option>
              </select>
            </div>
          </div>
        </div>
        <div class="hint" id="limit-size-note" style="display:none;margin-top:10px;">Works best with JPG or WebP output — PNG has no quality control, so it may not be able to hit small size limits at fixed dimensions.</div>
      </div>
    `;
  }

  if (state.op === "compress"){
    c.innerHTML = `
      <div class="control-group">
        <h3>Compression goal</h3>
        <div class="pill-group" id="compress-goal">
          <button class="active" data-val="quality">By quality</button>
          <button data-val="target">By target size</button>
        </div>

        <div id="quality-fields" style="margin-top:16px;">
          <div class="row">
            <div class="field">
              <label>Quality preset</label>
              <select id="ctl-quality-preset">
                <option value="100">Maximum</option>
                <option value="80" selected>High</option>
                <option value="60">Medium</option>
                <option value="35">Low</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            <div class="field" id="quality-slider-field">
              <label>Quality: <span id="quality-val">80</span></label>
              <input type="range" id="ctl-quality-slider" min="1" max="100" value="80">
            </div>
          </div>
        </div>

        <div id="target-fields" style="display:none;margin-top:16px;">
          <div class="row">
            <div class="field">
              <label>Target size</label>
              <div class="target-input">
                <input type="number" id="ctl-target-value" min="0" step="0.1" value="100">
                <select id="ctl-target-unit">
                  <option value="B">B</option>
                  <option value="KB" selected>KB</option>
                  <option value="MB">MB</option>
                </select>
              </div>
            </div>
            <div class="field">
              <label>Strategy</label>
              <select id="ctl-target-mode">
                <option value="both">Resize + Compress</option>
                <option value="compress">Compress only</option>
                <option value="resize">Resize only</option>
              </select>
            </div>
            <div class="field adv-only">
              <label>Prioritize</label>
              <select id="ctl-priority">
                <option value="quality">Quality</option>
                <option value="size">Small file size</option>
              </select>
            </div>
          </div>
        </div>
      </div>
      <div class="control-group">
        <h3>Output format</h3>
        <div class="row">
          <div class="field">
            <label>Format</label>
            <select id="ctl-format">
              <option value="jpg" selected>JPG</option>
              <option value="webp">WebP</option>
              <option value="png">PNG (quality lever limited)</option>
            </select>
          </div>
        </div>
      </div>
    `;
  }

  if (state.op === "img2pdf"){
    c.innerHTML = `
      <div class="control-group">
        <h3>Page setup</h3>
        <div class="row">
          <div class="field">
            <label>Page size</label>
            <select id="ctl-pagesize">
              <option value="a4" selected>A4</option>
              <option value="a3">A3</option>
              <option value="letter">Letter</option>
              <option value="legal">Legal</option>
              <option value="original">Original size</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          <div class="field" id="custom-size-fields" style="display:none;">
            <label>Width × Height (mm)</label>
            <div class="row" style="gap:8px;">
              <input type="number" id="ctl-custom-w" style="width:70px;" placeholder="210">
              <input type="number" id="ctl-custom-h" style="width:70px;" placeholder="297">
            </div>
          </div>
          <div class="field">
            <label>Orientation</label>
            <div class="pill-group" id="ctl-orientation">
              <button class="active" data-val="portrait">Portrait</button>
              <button data-val="landscape">Landscape</button>
            </div>
          </div>
        </div>
        <div class="row" style="margin-top:14px;">
          <div class="field">
            <label>Image fit</label>
            <select id="ctl-fit">
              <option value="contain" selected>Contain</option>
              <option value="cover">Cover</option>
              <option value="original">Original</option>
            </select>
          </div>
          <div class="field adv-only">
            <label>Margin</label>
            <select id="ctl-margin">
              <option value="0">None</option>
              <option value="10" selected>Small</option>
              <option value="20">Medium</option>
              <option value="35">Large</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          <div class="field adv-only" id="custom-margin-field" style="display:none;">
            <label>Custom margin (mm)</label>
            <input type="number" id="ctl-margin-custom" value="10">
          </div>
        </div>
      </div>
      <div class="control-group adv-only block">
        <h3>Image quality &amp; compression</h3>
        <div class="row">
          <div class="field">
            <label>Image quality</label>
            <select id="ctl-img-quality">
              <option value="0.92" selected>High</option>
              <option value="0.7">Medium</option>
              <option value="0.45">Low</option>
            </select>
          </div>
          <div class="checkbox-field">
            <input type="checkbox" id="ctl-pdf-compress" checked>
            <label for="ctl-pdf-compress">Enable PDF compression</label>
          </div>
        </div>
      </div>
    `;
  }

  if (state.op === "pdf2img"){
    const maxPages = Math.max(...state.files.filter(f=>f.kind==="pdf").map(f=>f.pageCount||1), 1);
    c.innerHTML = `
      <div class="control-group">
        <h3>Pages</h3>
        <div class="pill-group" id="page-range-mode">
          <button class="active" data-val="all">All pages</button>
          <button data-val="range">Page range</button>
        </div>
        <div class="row" id="page-range-field" style="display:none;margin-top:14px;">
          <div class="field">
            <label>Range (e.g. 1-5)</label>
            <input type="text" id="ctl-page-range" placeholder="1-${maxPages}">
          </div>
        </div>
      </div>
      <div class="control-group">
        <h3>Output</h3>
        <div class="row">
          <div class="field">
            <label>Format</label>
            <select id="ctl-format">${outputFormatOptions()}</select>
          </div>
          <div class="field">
            <label>Resolution (DPI)</label>
            <select id="ctl-dpi">
              <option value="72">72 (screen)</option>
              <option value="150" selected>150 (standard)</option>
              <option value="300">300 (print)</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          <div class="field adv-only" id="custom-dpi-field" style="display:none;">
            <label>Custom DPI</label>
            <input type="number" id="ctl-dpi-custom" value="200">
          </div>
        </div>
        <div class="row adv-only" style="margin-top:14px;">
          <div class="field">
            <label>Max width (px, optional)</label>
            <input type="number" id="ctl-max-w" placeholder="e.g. 1600">
          </div>
          <div class="field">
            <label>Quality</label>
            <input type="range" id="ctl-quality" min="1" max="100" value="90">
          </div>
        </div>
      </div>
    `;
  }

  if (state.op === "pdfcompress"){
    c.innerHTML = `
      <div class="control-group">
        <h3>Compression level</h3>
        <div class="row">
          <div class="field">
            <label>Preset</label>
            <select id="ctl-preset">
              <option value="light">Light (150 DPI, high quality)</option>
              <option value="balanced" selected>Balanced (120 DPI, medium quality)</option>
              <option value="aggressive">Aggressive (85 DPI, low quality)</option>
              <option value="custom">Custom</option>
            </select>
          </div>
        </div>
        <div class="row adv-only" id="pdfcompress-custom" style="display:none;margin-top:14px;">
          <div class="field">
            <label>DPI</label>
            <input type="number" id="ctl-c-dpi" value="120">
          </div>
          <div class="field">
            <label>JPEG quality</label>
            <input type="range" id="ctl-c-quality" min="10" max="100" value="65">
          </div>
        </div>
      </div>
    `;
  }

  wireControlEvents();
  updateDimsPreview();
}

function wireControlEvents(){
  // pill groups (generic)
  $$(".pill-group").forEach(group=>{
    $$("button", group).forEach(btn=>{
      btn.addEventListener("click", ()=>{
        $$("button", group).forEach(b=>b.classList.remove("active"));
        btn.classList.add("active");
        onPillChange(group.id, btn.dataset.val);
      });
    });
  });

  const pageSize = $("#ctl-pagesize");
  if (pageSize) pageSize.addEventListener("change", ()=>{
    $("#custom-size-fields").style.display = pageSize.value === "custom" ? "flex" : "none";
  });

  const margin = $("#ctl-margin");
  if (margin) margin.addEventListener("change", ()=>{
    $("#custom-margin-field").style.display = margin.value === "custom" ? "flex" : "none";
  });

  const dpi = $("#ctl-dpi");
  if (dpi) dpi.addEventListener("change", ()=>{
    $("#custom-dpi-field").style.display = dpi.value === "custom" ? "flex" : "none";
  });

  const preset = $("#ctl-preset");
  if (preset) preset.addEventListener("change", ()=>{
    $("#pdfcompress-custom").style.display = preset.value === "custom" ? "flex" : "none";
  });

  const qPreset = $("#ctl-quality-preset");
  if (qPreset) qPreset.addEventListener("change", ()=>{
    if (qPreset.value !== "custom"){
      $("#ctl-quality-slider").value = qPreset.value;
      $("#quality-val").textContent = qPreset.value;
    }
  });
  const qSlider = $("#ctl-quality-slider");
  if (qSlider) qSlider.addEventListener("input", ()=>{
    $("#quality-val").textContent = qSlider.value;
    $("#ctl-quality-preset").value = "custom";
  });

  ["ctl-width","ctl-height","ctl-pct"].forEach(id=>{
    const el = $("#"+id);
    if (el) el.addEventListener("input", ()=> onResizeInput(id));
  });
  const aspect = $("#ctl-aspect");
  if (aspect) aspect.addEventListener("change", updateDimsPreview);

  const limitOn = $("#ctl-limit-size-on");
  if (limitOn) limitOn.addEventListener("change", ()=>{
    $("#limit-size-fields").style.display = limitOn.checked ? "flex" : "none";
    updateLimitSizeNote();
  });
  const formatSel = $("#ctl-format");
  if (formatSel && $("#ctl-limit-size-on")) formatSel.addEventListener("change", updateLimitSizeNote);

  const convertTargetOn = $("#ctl-convert-target-on");
  if (convertTargetOn) convertTargetOn.addEventListener("change", ()=>{
    $("#convert-target-fields").style.display = convertTargetOn.checked ? "flex" : "none";
  });
}

function updateLimitSizeNote(){
  const note = $("#limit-size-note");
  if (!note) return;
  const on = $("#ctl-limit-size-on") && $("#ctl-limit-size-on").checked;
  const isPng = $("#ctl-format") && $("#ctl-format").value === "png";
  note.style.display = (on && isPng) ? "block" : "none";
}

function onPillChange(groupId, val){
  if (groupId === "resize-mode"){
    $("#resize-dims-fields").style.display = val === "dimensions" ? "flex" : "none";
    $("#resize-pct-fields").style.display = val === "percentage" ? "flex" : "none";
    updateDimsPreview();
  }
  if (groupId === "compress-goal"){
    $("#quality-fields").style.display = val === "quality" ? "block" : "none";
    $("#target-fields").style.display = val === "target" ? "block" : "none";
  }
  if (groupId === "pct-presets"){
    $("#ctl-pct").value = val;
    updateDimsPreview();
  }
  if (groupId === "page-range-mode"){
    $("#page-range-field").style.display = val === "range" ? "flex" : "none";
  }
  updateDimsPreview();
}

function onResizeInput(id){
  const aspectOn = $("#ctl-aspect") ? $("#ctl-aspect").checked : true;
  const ref = state.files.find(f=>f.kind==="image");
  if (!ref) return;
  if (aspectOn && id === "ctl-width"){
    const w = parseFloat($("#ctl-width").value);
    if (w) $("#ctl-height").value = Math.round(w * ref.height/ref.width);
  }
  if (aspectOn && id === "ctl-height"){
    const h = parseFloat($("#ctl-height").value);
    if (h) $("#ctl-width").value = Math.round(h * ref.width/ref.height);
  }
  updateDimsPreview();
}

function updateDimsPreview(){
  const box = $("#dims-preview");
  if (!box) return;
  const ref = state.files.find(f=>f.kind==="image");
  if (!ref){ box.textContent = ""; return; }

  const modeBtn = $("#resize-mode .active");
  const mode = modeBtn ? modeBtn.dataset.val : "dimensions";
  let newW, newH;
  if (mode === "percentage"){
    const pct = parseFloat($("#ctl-pct") ? $("#ctl-pct").value : 100) || 100;
    newW = Math.round(ref.width * pct/100);
    newH = Math.round(ref.height * pct/100);
  } else {
    newW = parseFloat($("#ctl-width") ? $("#ctl-width").value : "") || ref.width;
    newH = parseFloat($("#ctl-height") ? $("#ctl-height").value : "") || ref.height;
  }
  box.innerHTML = `Original: <b>${ref.width}×${ref.height}px</b>, ${formatBytes(ref.size)} &nbsp;→&nbsp; New: <b>${newW}×${newH}px</b> (est.)`;
}

