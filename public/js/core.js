pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

/* =========================================================
   UTILITIES
   ========================================================= */
const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

function formatBytes(bytes){
  if (bytes == null || isNaN(bytes)) return "—";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024*1024) return (bytes/1024).toFixed(bytes<10240?1:0) + " KB";
  return (bytes/(1024*1024)).toFixed(2) + " MB";
}
function bytesFromInput(value, unit){
  const v = parseFloat(value);
  if (isNaN(v)) return null;
  if (unit === "B") return v;
  if (unit === "KB") return v*1024;
  if (unit === "MB") return v*1024*1024;
  return v;
}
function uid(){ return Math.random().toString(36).slice(2,10); }

function downloadBlob(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url), 4000);
}

function loadImageFromFile(file){
  return new Promise((resolve, reject)=>{
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({img, url});
    img.onerror = () => reject(new Error("This image file appears to be corrupted or unsupported."));
    img.src = url;
  });
}

function canvasFromImage(img, targetW, targetH){
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(targetW));
  canvas.height = Math.max(1, Math.round(targetH));
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function canvasToBlob(canvas, mime, quality){
  return new Promise(resolve=>{
    if (quality === undefined) canvas.toBlob(b=>resolve(b), mime);
    else canvas.toBlob(b=>resolve(b), mime, quality);
  });
}

function mimeForFormat(fmt){
  return { jpg:"image/jpeg", jpeg:"image/jpeg", png:"image/png", webp:"image/webp" }[fmt] || "image/jpeg";
}
function extForFormat(fmt){ return fmt === "jpeg" ? "jpg" : fmt; }

/* Iterative / binary-search optimizer to approach a target byte size */
async function optimizeToTarget(img, opts){
  const { targetBytes, format, mode /* resize|compress|both */ } = opts;
  const mime = mimeForFormat(format);
  const supportsQuality = (mime === "image/jpeg" || mime === "image/webp");
  const origW = img.naturalWidth || img.width, origH = img.naturalHeight || img.height;

  let best = null; // {blob, scale, quality}
  const scales = mode === "compress" ? [1] : [1, 0.85, 0.7, 0.55, 0.4, 0.28, 0.18, 0.1];

  for (const scale of scales){
    const w = origW*scale, h = origH*scale;
    const canvas = canvasFromImage(img, w, h);

    if (supportsQuality && mode !== "resize"){
      let lo = 0.02, hi = 0.97, candidate = null;
      for (let i=0;i<7;i++){
        const mid = (lo+hi)/2;
        const blob = await canvasToBlob(canvas, mime, mid);
        if (!best || Math.abs(blob.size-targetBytes) < Math.abs(best.blob.size-targetBytes)){
          best = { blob, scale, quality: mid };
        }
        if (blob.size > targetBytes) hi = mid; else { lo = mid; candidate = blob; }
      }
    } else {
      // PNG or resize-only: no quality lever, just measure this scale
      const blob = await canvasToBlob(canvas, mime, undefined);
      if (!best || Math.abs(blob.size-targetBytes) < Math.abs(best.blob.size-targetBytes)){
        best = { blob, scale, quality: null };
      }
    }

    if (best && best.blob.size <= targetBytes * 1.03) break; // close enough, stop shrinking further
    if (mode === "compress") break; // compress-only never resizes
  }
  return best;
}

/* =========================================================
   STATE
   ========================================================= */
const state = {
  op: "convert",
  mode: "simple",
  files: [],       // {id, file, kind:'image'|'pdf', name, size, width, height, previewUrl, pdfDoc, pageCount}
  results: [],
  processing: false,
};

const OP_META = {
  convert:     { title:"Image Converter", desc:"Convert JPG, PNG and WebP files into each other, or bundle them into a PDF.", accept:"image", dz:"JPG, PNG, WebP, BMP", multi:true, processLabel:"Convert" },
  resize:      { title:"Image Resizer", desc:"Resize images by exact pixels or by percentage, with aspect ratio locking.", accept:"image", dz:"JPG, PNG, WebP, BMP", multi:true, processLabel:"Resize" },
  compress:    { title:"Image Compressor", desc:"Shrink file size by quality, or dial in an exact target size like 100 KB.", accept:"image", dz:"JPG, PNG, WebP, BMP", multi:true, processLabel:"Compress" },
  img2pdf:     { title:"Image → PDF", desc:"Combine one or more images into a single PDF, with page size and layout control.", accept:"image", dz:"JPG, PNG, WebP, BMP — reorder before converting", multi:true, processLabel:"Create PDF" },
  pdf2img:     { title:"PDF → Image", desc:"Export PDF pages as JPG, PNG or WebP images, individually or as a ZIP.", accept:"pdf", dz:"PDF files", multi:true, processLabel:"Export images" },
  pdfcompress: { title:"PDF Compressor", desc:"Reduce PDF file size by re-encoding pages at a lower quality and resolution.", accept:"pdf", dz:"PDF files", multi:true, processLabel:"Compress PDF" },
};

