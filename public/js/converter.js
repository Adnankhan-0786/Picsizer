/* =========================================================
   PROCESS BAR
   ========================================================= */
function renderProcessBar(){
  const bar = $("#process-bar");
  bar.style.display = state.files.length ? "flex" : "none";
  $("#process-hint").textContent = state.files.length > 1 ? `${state.files.length} files queued` : "";
}
$("#process-btn").addEventListener("click", runProcess);
$("#process-another").addEventListener("click", ()=>{
  state.files = []; state.results = [];
  renderFileList(); renderControls(); renderProcessBar(); hideResults();
});

/* =========================================================
   PROGRESS / ERRORS
   ========================================================= */
function showProgress(){ $("#progress-wrap").classList.add("show"); setStep("read"); }
function hideProgress(){ $("#progress-wrap").classList.remove("show"); }
function setStep(step){
  const order = ["read","process","optimize","output","done"];
  const idx = order.indexOf(step);
  $$("#progress-steps span[data-step]").forEach(s=>{
    s.classList.toggle("on", order.indexOf(s.dataset.step) <= idx);
  });
  $("#progress-fill").style.width = `${((idx+1)/order.length)*100}%`;
}
function showError(msg){
  const el = $("#error-banner");
  el.textContent = msg;
  el.classList.add("show");
}
function clearError(){ $("#error-banner").classList.remove("show"); }
function hideResults(){ $("#results").classList.remove("show"); $("#results-list").innerHTML=""; }

/* =========================================================
   MAIN PROCESS DISPATCH
   ========================================================= */
async function runProcess(){
  if (state.processing) return;
  if (!state.files.length){ showError("Please upload at least one file first."); return; }
  clearError(); hideResults();
  state.processing = true;
  $("#process-btn").disabled = true;
  showProgress(); setStep("read");

  try{
    let outputs = [];
    if (state.op === "convert") outputs = await processConvert();
    else if (state.op === "resize") outputs = await processResize();
    else if (state.op === "compress") outputs = await processCompress();
    else if (state.op === "img2pdf") outputs = await processImg2Pdf();
    else if (state.op === "pdf2img") outputs = await processPdf2Img();
    else if (state.op === "pdfcompress") outputs = await processPdfCompress();

    setStep("done");
    state.results = outputs;
    renderResults(outputs);
  } catch(err){
    console.error(err);
    showError(err.message || "Something went wrong while processing your file. Please try a different file or setting.");
  } finally{
    state.processing = false;
    $("#process-btn").disabled = false;
    setTimeout(hideProgress, 600);
  }
}

/* ---------- Image Converter ---------- */
async function processConvert(){
  const format = $("#ctl-format").value;
  const outputs = [];

  if (format === "pdf"){
    setStep("process");
    const opts = defaultPdfOptions();
    const blob = await buildPdfFromImages(state.files.filter(f=>f.kind==="image"), opts);
    setStep("output");
    outputs.push({
      name: "converted.pdf", blob, format:"pdf",
      originalSize: state.files.reduce((s,f)=>s+f.size,0),
      dims: null,
    });
    return outputs;
  }

  const qualityEl = $("#ctl-quality");
  const quality = qualityEl ? parseInt(qualityEl.value)/100 : 0.9;

  const targetOn = $("#ctl-convert-target-on") && $("#ctl-convert-target-on").checked;
  let targetBytes = null, targetMode = "both";
  if (targetOn){
    const val = $("#ctl-convert-target-value").value;
    const unit = $("#ctl-convert-target-unit").value;
    targetBytes = bytesFromInput(val, unit);
    if (!targetBytes || targetBytes <= 0) throw new Error("Please enter a valid target file size.");
    targetMode = $("#ctl-convert-target-mode") ? $("#ctl-convert-target-mode").value : "both";
  }

  setStep("process");
  for (const f of state.files.filter(x=>x.kind==="image")){
    const mime = mimeForFormat(format);
    let blob, dims, achievedExactly = true;

    if (targetOn){
      setStep("optimize");
      const best = await optimizeToTarget(f.img, { targetBytes, format, mode: targetMode });
      if (!best) throw new Error(`Could not hit the target size for "${f.name}" — try a different format or larger target.`);
      blob = best.blob;
      dims = `${Math.round(f.width*best.scale)}×${Math.round(f.height*best.scale)}`;
      achievedExactly = blob.size <= targetBytes * 1.15;
    } else {
      const canvas = canvasFromImage(f.img, f.width, f.height);
      blob = await canvasToBlob(canvas, mime, mime==="image/png" ? undefined : quality);
      dims = `${f.width}×${f.height}`;
    }

    outputs.push({
      name: f.name.replace(/\.[^.]+$/,"") + "." + extForFormat(format),
      blob, format, originalSize: f.size, dims,
      originalPreview: f.previewUrl,
      targetBytes: targetOn ? targetBytes : null, achievedExactly,
    });
  }
  setStep("output");
  return outputs;
}

/* ---------- Image Resizer ---------- */
async function processResize(){
  const modeBtn = $("#resize-mode .active");
  const mode = modeBtn ? modeBtn.dataset.val : "dimensions";
  const format = $("#ctl-format").value;
  const aspectOn = $("#ctl-aspect") ? $("#ctl-aspect").checked : true;
  const outputs = [];
  setStep("process");

  for (const f of state.files.filter(x=>x.kind==="image")){
    let newW, newH;
    if (mode === "percentage"){
      const pct = parseFloat($("#ctl-pct").value) || 100;
      newW = f.width * pct/100; newH = f.height * pct/100;
    } else {
      const w = parseFloat($("#ctl-width").value);
      const h = parseFloat($("#ctl-height").value);
      if (!w && !h) throw new Error("Please enter a width or height to resize to.");
      if (w && (h==null || h==="" || aspectOn)) { newW = w; newH = aspectOn ? w*f.height/f.width : (h||f.height); }
      else { newW = w || f.width; newH = h || f.height; }
      if (aspectOn && h && !w){ newH = h; newW = h*f.width/f.height; }
    }
    if (newW < 1 || newH < 1 || newW > 20000 || newH > 20000){
      throw new Error(`Invalid dimensions for "${f.name}": ${Math.round(newW)}×${Math.round(newH)}px.`);
    }
    const canvas = canvasFromImage(f.img, newW, newH);
    const mime = mimeForFormat(format);

    const limitOn = $("#ctl-limit-size-on") && $("#ctl-limit-size-on").checked;
    let blob, targetBytes = null, achievedExactly = true;

    if (limitOn){
      const limitVal = $("#ctl-limit-value").value;
      const limitUnit = $("#ctl-limit-unit").value;
      targetBytes = bytesFromInput(limitVal, limitUnit);
      if (!targetBytes || targetBytes <= 0) throw new Error("Please enter a valid maximum file size.");
      setStep("optimize");
      const fit = await fitQualityToTarget(canvas, mime, targetBytes);
      blob = fit.blob;
      achievedExactly = blob.size <= targetBytes * 1.1;
    } else {
      blob = await canvasToBlob(canvas, mime, mime==="image/png" ? undefined : 0.92);
    }

    outputs.push({
      name: f.name.replace(/\.[^.]+$/,"") + "_resized." + extForFormat(format),
      blob, format, originalSize: f.size,
      dims: `${Math.round(newW)}×${Math.round(newH)}`, originalDims: `${f.width}×${f.height}`,
      originalPreview: f.previewUrl,
      targetBytes: limitOn ? targetBytes : null, achievedExactly,
    });
  }
  setStep("output");
  return outputs;
}

/* Binary-search JPEG/WebP quality to fit a target size at FIXED dimensions (no resizing). */
async function fitQualityToTarget(canvas, mime, targetBytes){
  const supportsQuality = (mime === "image/jpeg" || mime === "image/webp");
  if (!supportsQuality){
    // PNG: no quality lever available — return as-is at best compression the browser applies.
    const blob = await canvasToBlob(canvas, mime, undefined);
    return { blob };
  }
  let lo = 0.02, hi = 0.97, best = null;
  for (let i=0;i<8;i++){
    const mid = (lo+hi)/2;
    const blob = await canvasToBlob(canvas, mime, mid);
    if (blob.size <= targetBytes){
      if (!best || blob.size > best.blob.size) best = { blob, quality: mid };
      lo = mid;
    } else {
      hi = mid;
    }
  }
  if (!best){
    // Even the lowest quality exceeds the target at this fixed size — return the smallest we found.
    const blob = await canvasToBlob(canvas, mime, 0.02);
    best = { blob, quality: 0.02 };
  }
  return best;
}

/* ---------- Image Compressor ---------- */
async function processCompress(){
  const goalBtn = $("#compress-goal .active");
  const goal = goalBtn ? goalBtn.dataset.val : "quality";
  const format = $("#ctl-format").value;
  const outputs = [];
  setStep("process");

  for (const f of state.files.filter(x=>x.kind==="image")){
    if (goal === "quality"){
      const q = parseInt($("#ctl-quality-slider").value)/100;
      const canvas = canvasFromImage(f.img, f.width, f.height);
      const mime = mimeForFormat(format);
      const blob = await canvasToBlob(canvas, mime, mime==="image/png"?undefined:q);
      outputs.push({
        name: f.name.replace(/\.[^.]+$/,"") + "_compressed." + extForFormat(format),
        blob, format, originalSize: f.size, dims: `${f.width}×${f.height}`, originalPreview: f.previewUrl,
      });
    } else {
      const targetVal = $("#ctl-target-value").value;
      const targetUnit = $("#ctl-target-unit").value;
      const targetBytes = bytesFromInput(targetVal, targetUnit);
      if (!targetBytes || targetBytes <= 0) throw new Error("Please enter a valid target size.");
      const modeSel = $("#ctl-target-mode").value; // both|compress|resize
      setStep("optimize");
      const best = await optimizeToTarget(f.img, { targetBytes, format, mode: modeSel });
      if (!best) throw new Error(`Could not compress "${f.name}" — try a different format or larger target.`);
      const achieved = best.blob.size;
      const within = achieved <= targetBytes * 1.15;
      outputs.push({
        name: f.name.replace(/\.[^.]+$/,"") + "_" + Math.round(targetBytes/1024) + "kb." + extForFormat(format),
        blob: best.blob, format, originalSize: f.size,
        dims: `${Math.round(f.width*best.scale)}×${Math.round(f.height*best.scale)}`,
        originalPreview: f.previewUrl,
        targetBytes, achievedExactly: within,
      });
    }
  }
  setStep("output");
  return outputs;
}

/* ---------- Image → PDF ---------- */
function defaultPdfOptions(){
  const get = (id, fallback) => { const el = $(id); return el ? el.value : fallback; };
  return {
    pageSize: get("#ctl-pagesize","a4"),
    customW: parseFloat(get("#ctl-custom-w", 210)) || 210,
    customH: parseFloat(get("#ctl-custom-h", 297)) || 297,
    orientation: ($("#ctl-orientation .active") ? $("#ctl-orientation .active").dataset.val : "portrait"),
    fit: get("#ctl-fit","contain"),
    margin: (()=>{ const m = get("#ctl-margin","10"); return m === "custom" ? (parseFloat(get("#ctl-margin-custom",10))||10) : parseFloat(m); })(),
    imgQuality: parseFloat(get("#ctl-img-quality",0.92)),
    compress: $("#ctl-pdf-compress") ? $("#ctl-pdf-compress").checked : true,
  };
}

const PAGE_SIZES_MM = { a4:[210,297], a3:[297,420], letter:[215.9,279.4], legal:[215.9,355.6] };

async function processImg2Pdf(){
  const images = state.files.filter(f=>f.kind==="image");
  if (!images.length) throw new Error("Please upload at least one image.");
  setStep("process");
  const opts = defaultPdfOptions();
  const blob = await buildPdfFromImages(images, opts);
  setStep("output");
  return [{
    name: "images.pdf", blob, format:"pdf",
    originalSize: images.reduce((s,f)=>s+f.size,0), dims: `${images.length} page${images.length>1?"s":""}`,
  }];
}

async function buildPdfFromImages(images, opts){
  const { jsPDF } = window.jspdf;
  let pageSize = opts.pageSize;
  let orientation = opts.orientation === "landscape" ? "l" : "p";
  let unit = "mm";
  let firstDims = null;

  if (pageSize === "original"){
    firstDims = [images[0].width * 0.264583, images[0].height * 0.264583]; // px -> mm at 96dpi
  }

  const doc = new jsPDF({
    unit, orientation,
    format: pageSize === "custom" ? [opts.customW, opts.customH]
           : pageSize === "original" ? firstDims
           : (PAGE_SIZES_MM[pageSize] || PAGE_SIZES_MM.a4),
    compress: opts.compress,
  });

  for (let i=0;i<images.length;i++){
    const f = images[i];
    if (i>0){
      let fmt;
      if (pageSize === "original") fmt = [f.width*0.264583, f.height*0.264583];
      else if (pageSize === "custom") fmt = [opts.customW, opts.customH];
      else fmt = PAGE_SIZES_MM[pageSize] || PAGE_SIZES_MM.a4;
      doc.addPage(fmt, orientation);
    }
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const m = opts.margin || 0;
    const availW = pageW - m*2, availH = pageH - m*2;

    const canvas = canvasFromImage(f.img, f.width, f.height);
    const jpegBlob = await canvasToBlob(canvas, "image/jpeg", opts.imgQuality);
    const dataUrl = await blobToDataURL(jpegBlob);

    let drawW, drawH;
    const imgRatio = f.width / f.height;
    const availRatio = availW / availH;

    if (opts.fit === "original"){
      drawW = f.width * 0.264583; drawH = f.height * 0.264583;
      if (drawW > availW || drawH > availH){
        const scale = Math.min(availW/drawW, availH/drawH);
        drawW *= scale; drawH *= scale;
      }
    } else if (opts.fit === "cover"){
      if (imgRatio > availRatio){ drawH = availH; drawW = availH*imgRatio; } else { drawW = availW; drawH = availW/imgRatio; }
    } else { // contain
      if (imgRatio > availRatio){ drawW = availW; drawH = availW/imgRatio; } else { drawH = availH; drawW = availH*imgRatio; }
    }

    const x = m + (availW-drawW)/2;
    const y = m + (availH-drawH)/2;
    doc.addImage(dataUrl, "JPEG", x, y, drawW, drawH, undefined, opts.compress ? "MEDIUM" : "NONE");
  }
  return doc.output("blob");
}

function blobToDataURL(blob){
  return new Promise(resolve=>{
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

/* ---------- PDF → Image ---------- */
function parsePageRange(rangeStr, maxPages){
  if (!rangeStr || !rangeStr.trim()) return Array.from({length:maxPages}, (_,i)=>i+1);
  const pages = new Set();
  for (const part of rangeStr.split(",")){
    const trimmed = part.trim();
    if (/^\d+-\d+$/.test(trimmed)){
      const [a,b] = trimmed.split("-").map(Number);
      for (let p=Math.min(a,b); p<=Math.max(a,b); p++) if (p>=1 && p<=maxPages) pages.add(p);
    } else if (/^\d+$/.test(trimmed)){
      const p = Number(trimmed);
      if (p>=1 && p<=maxPages) pages.add(p);
    }
  }
  if (!pages.size) throw new Error(`"${rangeStr}" is not a valid page range.`);
  return Array.from(pages).sort((a,b)=>a-b);
}

async function processPdf2Img(){
  const format = $("#ctl-format").value;
  const dpiSel = $("#ctl-dpi").value;
  const dpi = dpiSel === "custom" ? (parseFloat($("#ctl-dpi-custom").value)||150) : parseFloat(dpiSel);
  const rangeMode = $("#page-range-mode .active") ? $("#page-range-mode .active").dataset.val : "all";
  const rangeStr = $("#ctl-page-range") ? $("#ctl-page-range").value : "";
  const maxW = $("#ctl-max-w") && $("#ctl-max-w").value ? parseInt($("#ctl-max-w").value) : null;
  const quality = $("#ctl-quality") ? parseInt($("#ctl-quality").value)/100 : 0.9;

  const outputs = [];
  setStep("process");
  for (const f of state.files.filter(x=>x.kind==="pdf")){
    const pages = rangeMode === "range" ? parsePageRange(rangeStr, f.pageCount) : Array.from({length:f.pageCount},(_,i)=>i+1);
    for (const pageNum of pages){
      const page = await f.pdfDoc.getPage(pageNum);
      const scale = dpi/72;
      let viewport = page.getViewport({ scale });
      if (maxW && viewport.width > maxW){
        viewport = page.getViewport({ scale: scale * (maxW/viewport.width) });
      }
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width; canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      const mime = mimeForFormat(format);
      const blob = await canvasToBlob(canvas, mime, mime==="image/png"?undefined:quality);
      outputs.push({
        name: `${f.name.replace(/\.pdf$/i,"")}_page${pageNum}.${extForFormat(format)}`,
        blob, format, originalSize: f.size / f.pageCount,
        dims: `${Math.round(viewport.width)}×${Math.round(viewport.height)}`,
        isPdfPage: true, sourceName: f.name,
      });
    }
  }
  setStep("output");
  return outputs;
}

/* ---------- PDF Compressor ---------- */
async function processPdfCompress(){
  const preset = $("#ctl-preset").value;
  const presets = {
    light:      { dpi:150, quality:0.85 },
    balanced:   { dpi:120, quality:0.65 },
    aggressive: { dpi:85,  quality:0.4 },
  };
  const cfg = preset === "custom"
    ? { dpi: parseFloat($("#ctl-c-dpi").value)||120, quality: parseInt($("#ctl-c-quality").value)/100 }
    : presets[preset];

  const outputs = [];
  setStep("process");
  const { jsPDF } = window.jspdf;

  for (const f of state.files.filter(x=>x.kind==="pdf")){
    setStep("optimize");
    const firstPage = await f.pdfDoc.getPage(1);
    const scale0 = cfg.dpi/72;
    const vp0 = firstPage.getViewport({ scale: scale0 });
    const orientation = vp0.width > vp0.height ? "l" : "p";
    const doc = new jsPDF({ unit:"pt", orientation, format:[vp0.width, vp0.height], compress:true });

    for (let pageNum=1; pageNum<=f.pdfDoc.numPages; pageNum++){
      const page = await f.pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: cfg.dpi/72 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width; canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      const blob = await canvasToBlob(canvas, "image/jpeg", cfg.quality);
      const dataUrl = await blobToDataURL(blob);
      if (pageNum>1) doc.addPage([viewport.width, viewport.height], viewport.width>viewport.height?"l":"p");
      doc.addImage(dataUrl, "JPEG", 0, 0, viewport.width, viewport.height, undefined, "MEDIUM");
    }
    setStep("output");
    const outBlob = doc.output("blob");
    outputs.push({
      name: f.name.replace(/\.pdf$/i,"") + "_compressed.pdf",
      blob: outBlob, format:"pdf", originalSize: f.size, dims: `${f.pageCount} page${f.pageCount>1?"s":""}`,
    });
  }
  return outputs;
}

