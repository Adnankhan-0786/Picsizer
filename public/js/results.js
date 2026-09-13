/* =========================================================
   RESULTS RENDERING
   ========================================================= */
function renderResults(outputs){
  const list = $("#results-list");
  list.innerHTML = "";
  const totalOriginal = outputs.reduce((s,o)=>s+(o.originalSize||0),0);
  const totalOutput = outputs.reduce((s,o)=>s+o.blob.size,0);
  const pct = totalOriginal ? Math.round((1 - totalOutput/totalOriginal)*100) : 0;
  $("#results-title").textContent = `${OP_META[state.op].processLabel} complete — ${outputs.length} file${outputs.length>1?"s":""}`;

  outputs.forEach(out=>{
    const card = document.createElement("div");
    card.className = "result-card";
    const url = URL.createObjectURL(out.blob);
    const reduction = out.originalSize ? Math.round((1 - out.blob.size/out.originalSize)*100) : null;

    const origPreview = out.originalPreview
      ? `<img src="${out.originalPreview}">`
      : `<div class="pdf-box">ORIGINAL</div>`;
    const outPreview = out.format === "pdf"
      ? `<div class="pdf-box">PDF OUTPUT</div>`
      : `<img src="${url}">`;

    card.innerHTML = `
      <div class="result-top">
        <div class="compare">
          <div class="side">
            ${origPreview}
            <div class="label">ORIGINAL</div>
            <div class="size">${formatBytes(out.originalSize)}</div>
            ${out.originalDims ? `<div class="dims">${out.originalDims}</div>` : ""}
          </div>
          <div class="arrow">→</div>
          <div class="side">
            ${outPreview}
            <div class="label">OUTPUT</div>
            <div class="size">${formatBytes(out.blob.size)}</div>
            ${out.dims ? `<div class="dims">${out.dims}</div>` : ""}
          </div>
        </div>
        ${reduction !== null ? `<div class="reduction-badge">${reduction>=0?"−"+reduction:"+"+Math.abs(reduction)}% size<br>${formatBytes(out.originalSize)} → ${formatBytes(out.blob.size)}</div>` : ""}
      </div>
      ${out.targetBytes ? `<div class="target-note ${out.achievedExactly ? "ok" : "warn"}">
        Target: ${formatBytes(out.targetBytes)} · Final: ${formatBytes(out.blob.size)}
        ${out.achievedExactly ? "" : " — exact target wasn't reachable without unacceptable quality loss; this is the best achievable size."}
      </div>` : ""}
      <div class="result-actions">
        <button class="btn small" data-download="${out.name}">Download</button>
        <span class="hint mono">${out.name}</span>
      </div>
    `;
    card.querySelector("[data-download]").addEventListener("click", ()=> {
      if (!paymentUnlocked) return;
      downloadBlob(out.blob, out.name);
    });
    list.appendChild(card);
  });

  $("#download-zip").style.display = outputs.length > 1 ? "inline-block" : "none";
  $("#results").classList.add("show");
  $("#results").scrollIntoView({ behavior:"smooth", block:"start" });
  lockResultsForPayment();
}

$("#download-zip").addEventListener("click", async ()=>{
  if (!paymentUnlocked) return;
  const zip = new JSZip();
  state.results.forEach(out => zip.file(out.name, out.blob));
  const content = await zip.generateAsync({ type:"blob" });
  downloadBlob(content, "picsizer-output.zip");
});

/* init */
renderControls();
renderProcessBar();
