const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

export function sanitizeRichText(html) {
  return String(html)
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[\s\S]*?\2/gi, '$1="#"');
}

const VIEWER_CSS = `:root{--cell:32px;--ink:#344055;--muted:#7b8798;--line:#e4e8ee;--panel:#e4e8ef;--accent:#8298b8}*{box-sizing:border-box}body{margin:0;color:var(--ink);font:15px/1.5 system-ui,sans-serif;background:#edf0f5}.notebook{min-height:100vh;display:grid;grid-template-columns:230px 1fr}.sidebar{padding:24px 16px;background:var(--panel);border-right:1px solid #d4dae4}.brand{font-weight:750;margin-bottom:24px}.page-tab{width:100%;border:0;background:transparent;color:#687486;text-align:left;padding:10px 12px;border-radius:9px;cursor:pointer}.page-tab.active{background:#f7f8fa;color:#354155}.viewer{padding:28px;overflow:auto}.page{position:relative;min-width:960px;min-height:720px;background-color:#fdfdfd;background-image:linear-gradient(var(--line) 1px,transparent 1px),linear-gradient(90deg,var(--line) 1px,transparent 1px);background-size:var(--cell) var(--cell);border:1px solid #dce1e8;border-radius:14px;box-shadow:0 16px 40px #44536b18}.page[hidden]{display:none}.page-title{position:absolute;left:24px;top:18px;margin:0;font-size:18px;z-index:2}.block{position:absolute;left:calc(var(--column) * var(--cell));top:calc(var(--row) * var(--cell));width:calc(var(--column-span) * var(--cell));height:calc(var(--row-span) * var(--cell));overflow:auto;padding:10px;background:#fff;border:1px solid #d8dee7;border-radius:8px;box-shadow:0 4px 12px #53657c12}.block.image-block{padding:0;overflow:hidden}.image-block img{display:block;width:100%;height:100%;object-fit:cover}.block>*:first-child{margin-top:0}.block>*:last-child{margin-bottom:0}@media(max-width:700px){.notebook{display:block}.sidebar{position:sticky;top:0;z-index:4;padding:10px;display:flex;gap:6px;overflow:auto;border-right:0;border-bottom:1px solid #d4dae4}.brand{margin:8px 6px;white-space:nowrap}.page-tab{width:auto;white-space:nowrap}.viewer{padding:12px}.page{transform-origin:top left}}`;

const VIEWER_JS = `(()=>{const tabs=[...document.querySelectorAll(".page-tab")];const pages=[...document.querySelectorAll(".page")];function show(id){tabs.forEach(t=>t.classList.toggle("active",t.dataset.pageTarget===id));pages.forEach(p=>p.hidden=p.dataset.pageId!==id)}tabs.forEach(t=>t.addEventListener("click",()=>show(t.dataset.pageTarget)));if(tabs[0])show(tabs.find(t=>t.classList.contains("active"))?.dataset.pageTarget||tabs[0].dataset.pageTarget)})();`;

function renderBlock(block, assets) {
  if (block.type === "image") {
    const asset = assets.find((item) => item.id === block.assetId);
    const source = asset ? `assets/${encodeURIComponent(asset.filename)}` : "";
    return `<figure class="block image-block" data-block-id="${escapeHtml(block.id)}" data-block-type="image" data-asset-id="${escapeHtml(block.assetId)}" data-column="${block.column}" data-row="${block.row}" data-column-span="${block.columnSpan}" data-row-span="${block.rowSpan}" style="--column:${block.column};--row:${block.row};--column-span:${block.columnSpan};--row-span:${block.rowSpan}"><img src="${source}" alt="${escapeHtml(block.alt)}"></figure>`;
  }
  const html = sanitizeRichText(block.html);
  return `<article class="block" data-block-id="${escapeHtml(block.id)}" data-block-type="${escapeHtml(block.type)}" data-column="${block.column}" data-row="${block.row}" data-column-span="${block.columnSpan}" data-row-span="${block.rowSpan}" style="--column:${block.column};--row:${block.row};--column-span:${block.columnSpan};--row-span:${block.rowSpan}">${html}</article>`;
}

export function createPortableFiles(notebook) {
  const portableNotebook = {
    ...notebook,
    assets: notebook.assets.map(({ dataUrl: _dataUrl, ...asset }) => asset),
  };
  const encoded = encodeURIComponent(JSON.stringify(portableNotebook));
  const tabs = notebook.pages
    .map(
      (page) =>
        `<button class="page-tab${page.id === notebook.activePageId ? " active" : ""}" data-page-target="${escapeHtml(page.id)}">${escapeHtml(page.title)}</button>`,
    )
    .join("");
  const pages = notebook.pages
    .map(
      (page) =>
        `<section class="page" data-page-id="${escapeHtml(page.id)}"><h1 class="page-title">${escapeHtml(page.title)}</h1>${page.blocks.map((block) => renderBlock(block, notebook.assets)).join("")}</section>`,
    )
    .join("");

  return {
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(notebook.title)}</title><link rel="stylesheet" href="styles.css"></head><body><main class="notebook" data-gridnote="${encoded}" data-notebook-id="${escapeHtml(notebook.id)}"><nav class="sidebar"><div class="brand">${escapeHtml(notebook.title)}</div>${tabs}</nav><div class="viewer">${pages}</div></main><script src="script.js"></script></body></html>`,
    css: VIEWER_CSS,
    js: VIEWER_JS,
    assets: notebook.assets
      .filter((asset) => asset.dataUrl)
      .map((asset) => ({
        filename: asset.filename,
        mimeType: asset.mimeType,
        dataUrl: asset.dataUrl,
      })),
  };
}

export function notebookFromPortableHtml(html) {
  const match = String(html).match(/\sdata-gridnote="([^"]+)"/);
  if (!match) {
    throw new Error("This file does not contain Gridnote notebook metadata.");
  }
  const notebook = JSON.parse(decodeURIComponent(match[1]));
  notebook.pages = notebook.pages.map((page) => ({
    ...page,
    blocks: page.blocks.map((block) =>
      block.type === "rich-text"
        ? { ...block, html: sanitizeRichText(block.html) }
        : block,
    ),
  }));
  return notebook;
}
