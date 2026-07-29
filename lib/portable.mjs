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

const supportedBlockTypes = new Set([
  "rich-text",
  "image",
  "table",
  "shape",
  "attachment",
  "drawing",
]);

const whole = (value, minimum, maximum) =>
  Math.max(
    minimum,
    Math.min(maximum, Math.round(Number.isFinite(Number(value)) ? Number(value) : minimum)),
  );

const safeText = (value, fallback = "") =>
  typeof value === "string" ? value : fallback;

function overlaps(a, b) {
  return (
    a.column < b.column + b.columnSpan &&
    a.column + a.columnSpan > b.column &&
    a.row < b.row + b.rowSpan &&
    a.row + a.rowSpan > b.row
  );
}

export function recoverNotebook(input) {
  const warnings = [];
  let recoveredId = 0;
  const nextId = (prefix) => `${prefix}-recovered-${++recoveredId}`;
  const source =
    input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const sourceAssets = Array.isArray(source.assets) ? source.assets : [];
  const assetIds = new Set();
  const assets = [];

  for (const candidate of sourceAssets) {
    if (!candidate || typeof candidate !== "object") {
      warnings.push("Skipped an invalid asset record.");
      continue;
    }
    const id = safeText(candidate.id) || nextId("asset");
    const filename = safeText(candidate.filename).replaceAll("/", "-");
    if (!filename || assetIds.has(id)) {
      warnings.push("Skipped an invalid or duplicate asset.");
      continue;
    }
    assetIds.add(id);
    assets.push({
      id,
      filename,
      mimeType: safeText(candidate.mimeType, "application/octet-stream"),
      ...(typeof candidate.dataUrl === "string"
        ? { dataUrl: candidate.dataUrl }
        : {}),
    });
  }

  const sourcePages = Array.isArray(source.pages) ? source.pages : [];
  const pageIds = new Set();
  const pages = [];

  for (const candidatePage of sourcePages) {
    if (!candidatePage || typeof candidatePage !== "object") {
      warnings.push("Skipped an invalid page.");
      continue;
    }
    let pageId = safeText(candidatePage.id) || nextId("page");
    if (pageIds.has(pageId)) {
      pageId = nextId("page");
      warnings.push("Renamed a duplicate page identifier.");
    }
    pageIds.add(pageId);
    const blocks = [];
    const blockIds = new Set();
    const sourceBlocks = Array.isArray(candidatePage.blocks)
      ? candidatePage.blocks
      : [];

    for (const candidate of sourceBlocks) {
      if (
        !candidate ||
        typeof candidate !== "object" ||
        !supportedBlockTypes.has(candidate.type)
      ) {
        warnings.push("Skipped an unsupported block.");
        continue;
      }
      let id = safeText(candidate.id) || nextId("block");
      if (blockIds.has(id)) {
        id = nextId("block");
        warnings.push("Renamed a duplicate block identifier.");
      }
      const column = whole(candidate.column, 0, 39);
      const row = whole(candidate.row, 0, 29);
      const placement = {
        id,
        type: candidate.type,
        column,
        row,
        columnSpan: whole(candidate.columnSpan, 1, 40 - column),
        rowSpan: whole(candidate.rowSpan, 1, 30 - row),
      };
      if (blocks.some((block) => overlaps(placement, block))) {
        warnings.push("Skipped an overlapping block.");
        continue;
      }
      blockIds.add(id);

      if (candidate.type === "rich-text") {
        blocks.push({
          ...placement,
          html: sanitizeRichText(safeText(candidate.html, "<p></p>")),
        });
      } else if (candidate.type === "image") {
        blocks.push({
          ...placement,
          assetId: safeText(candidate.assetId),
          alt: safeText(candidate.alt, "Notebook image"),
        });
      } else if (candidate.type === "attachment") {
        blocks.push({
          ...placement,
          assetId: safeText(candidate.assetId),
          label: safeText(candidate.label, "Attachment"),
        });
      } else if (candidate.type === "table") {
        const cells = Array.isArray(candidate.cells)
          ? candidate.cells
              .slice(0, 100)
              .map((row) =>
                Array.isArray(row)
                  ? row.slice(0, 50).map((cell) => safeText(cell))
                  : [],
              )
          : [];
        blocks.push({
          ...placement,
          cells: cells.length ? cells : [["Column 1", "Column 2"]],
        });
      } else if (candidate.type === "shape") {
        blocks.push({
          ...placement,
          shape: ["rounded", "circle", "note"].includes(candidate.shape)
            ? candidate.shape
            : "rounded",
          color: /^#[0-9a-f]{6}$/i.test(candidate.color)
            ? candidate.color
            : "#dce6d5",
          text: safeText(candidate.text),
        });
      } else {
        const strokes = Array.isArray(candidate.strokes)
          ? candidate.strokes.slice(0, 5000).map((stroke) => ({
              id: safeText(stroke?.id, nextId("stroke")),
              color: /^#[0-9a-f]{6}$/i.test(stroke?.color)
                ? stroke.color
                : "#556b5d",
              width: whole(stroke?.width, 1, 12),
              points: Array.isArray(stroke?.points)
                ? stroke.points.slice(0, 10000).map((point) => ({
                    x: Math.max(0, Math.min(1, Number(point?.x) || 0)),
                    y: Math.max(0, Math.min(1, Number(point?.y) || 0)),
                  }))
                : [],
            }))
          : [];
        blocks.push({ ...placement, strokes });
      }
    }

    pages.push({
      id: pageId,
      title:
        safeText(candidatePage.title) || `Recovered page ${pages.length + 1}`,
      blocks,
    });
  }

  if (!pages.length) {
    pages.push({ id: "page-recovered-1", title: "Recovered page", blocks: [] });
    warnings.push("Created an empty page because no valid pages were found.");
  }
  const requestedActivePage = safeText(source.activePageId);
  const activePageId = pages.some((page) => page.id === requestedActivePage)
    ? requestedActivePage
    : pages[0].id;

  return {
    notebook: {
      id: safeText(source.id) || "recovered-notebook",
      title: safeText(source.title) || "Recovered notebook",
      activePageId,
      pages,
      assets,
      updatedAt:
        typeof source.updatedAt === "string" &&
        !Number.isNaN(Date.parse(source.updatedAt))
          ? source.updatedAt
          : new Date(0).toISOString(),
    },
    warnings,
  };
}

const VIEWER_CSS = `:root{--cell:32px;--ink:#344055;--muted:#7b8798;--line:#e4e8ee;--panel:#e4e8ef;--accent:#8298b8}*{box-sizing:border-box}body{margin:0;color:var(--ink);font:15px/1.5 system-ui,sans-serif;background:#edf0f5}.notebook{min-height:100vh;display:grid;grid-template-columns:230px 1fr}.sidebar{padding:24px 16px;background:var(--panel);border-right:1px solid #d4dae4}.brand{font-weight:750;margin-bottom:24px}.page-tab{width:100%;border:0;background:transparent;color:#687486;text-align:left;padding:10px 12px;border-radius:9px;cursor:pointer}.page-tab.active{background:#f7f8fa;color:#354155}.viewer{padding:28px;overflow:auto}.page{position:relative;min-width:960px;min-height:720px;background-color:#fdfdfd;background-image:linear-gradient(var(--line) 1px,transparent 1px),linear-gradient(90deg,var(--line) 1px,transparent 1px);background-size:var(--cell) var(--cell);border:1px solid #dce1e8;border-radius:14px;box-shadow:0 16px 40px #44536b18}.page[hidden]{display:none}.page-title{position:absolute;left:24px;top:18px;margin:0;font-size:18px;z-index:2}.block{position:absolute;left:calc(var(--column) * var(--cell));top:calc(var(--row) * var(--cell));width:calc(var(--column-span) * var(--cell));height:calc(var(--row-span) * var(--cell));overflow:auto;padding:10px;background:#fff;border:1px solid #d8dee7;border-radius:8px;box-shadow:0 4px 12px #53657c12}.block.image-block{padding:0;overflow:hidden}.image-block img{display:block;width:100%;height:100%;object-fit:cover}.table-block{padding:6px}.table-block table{width:100%;height:100%;border-collapse:collapse;table-layout:fixed}.table-block th,.table-block td{padding:5px;border:1px solid #cfd7e1;text-align:left;font-size:12px}.table-block th{background:#eef2f6}.shape-block{display:grid;place-items:center;padding:12px;text-align:center;font-weight:650}.shape-circle{border-radius:50%}.shape-note{border-radius:2px;box-shadow:6px 6px 0 #9aa9b733}.attachment-block{display:flex;align-items:center;gap:10px;text-decoration:none;color:var(--ink)}.attachment-icon{display:grid;width:38px;height:38px;place-items:center;border-radius:10px;background:#e8edf4;font-weight:800}.attachment-block small{display:block;color:var(--muted)}.drawing-block{padding:0;overflow:hidden}.drawing-view{display:block;width:100%;height:100%;background:#fff}.block>*:first-child{margin-top:0}.block>*:last-child{margin-bottom:0}@media(max-width:700px){.notebook{display:block}.sidebar{position:sticky;top:0;z-index:4;padding:10px;display:flex;gap:6px;overflow:auto;border-right:0;border-bottom:1px solid #d4dae4}.brand{margin:8px 6px;white-space:nowrap}.page-tab{width:auto;white-space:nowrap}.viewer{padding:12px}.page{transform-origin:top left}}`;

const VIEWER_JS = `(()=>{const tabs=[...document.querySelectorAll(".page-tab")];const pages=[...document.querySelectorAll(".page")];function show(id){tabs.forEach(t=>t.classList.toggle("active",t.dataset.pageTarget===id));pages.forEach(p=>p.hidden=p.dataset.pageId!==id)}tabs.forEach(t=>t.addEventListener("click",()=>show(t.dataset.pageTarget)));if(tabs[0])show(tabs.find(t=>t.classList.contains("active"))?.dataset.pageTarget||tabs[0].dataset.pageTarget)})();`;

function renderBlock(block, assets) {
  if (block.type === "image") {
    const asset = assets.find((item) => item.id === block.assetId);
    const source = asset ? `assets/${encodeURIComponent(asset.filename)}` : "";
    return `<figure class="block image-block" data-block-id="${escapeHtml(block.id)}" data-block-type="image" data-asset-id="${escapeHtml(block.assetId)}" data-column="${block.column}" data-row="${block.row}" data-column-span="${block.columnSpan}" data-row-span="${block.rowSpan}" style="--column:${block.column};--row:${block.row};--column-span:${block.columnSpan};--row-span:${block.rowSpan}"><img src="${source}" alt="${escapeHtml(block.alt)}"></figure>`;
  }
  if (block.type === "table") {
    const rows = block.cells
      .map(
        (row, rowIndex) =>
          `<tr>${row.map((cell) => `<${rowIndex === 0 ? "th" : "td"}>${escapeHtml(cell)}</${rowIndex === 0 ? "th" : "td"}>`).join("")}</tr>`,
      )
      .join("");
    return `<article class="block table-block" data-block-id="${escapeHtml(block.id)}" data-block-type="table" data-column="${block.column}" data-row="${block.row}" data-column-span="${block.columnSpan}" data-row-span="${block.rowSpan}" style="--column:${block.column};--row:${block.row};--column-span:${block.columnSpan};--row-span:${block.rowSpan}"><table><tbody>${rows}</tbody></table></article>`;
  }
  if (block.type === "shape") {
    const color = /^#[0-9a-f]{6}$/i.test(block.color)
      ? block.color
      : "#dce6d5";
    return `<div class="block shape-block shape-${escapeHtml(block.shape)}" data-block-id="${escapeHtml(block.id)}" data-block-type="shape" data-column="${block.column}" data-row="${block.row}" data-column-span="${block.columnSpan}" data-row-span="${block.rowSpan}" style="--column:${block.column};--row:${block.row};--column-span:${block.columnSpan};--row-span:${block.rowSpan};background:${color}">${escapeHtml(block.text)}</div>`;
  }
  if (block.type === "attachment") {
    const asset = assets.find((item) => item.id === block.assetId);
    const source = asset ? `assets/${encodeURIComponent(asset.filename)}` : "#";
    const filename = asset?.filename ?? "Missing file";
    return `<a class="block attachment-block" href="${source}" download data-block-id="${escapeHtml(block.id)}" data-block-type="attachment" data-asset-id="${escapeHtml(block.assetId)}" data-column="${block.column}" data-row="${block.row}" data-column-span="${block.columnSpan}" data-row-span="${block.rowSpan}" style="--column:${block.column};--row:${block.row};--column-span:${block.columnSpan};--row-span:${block.rowSpan}"><span class="attachment-icon">↓</span><span><strong>${escapeHtml(block.label)}</strong><small>${escapeHtml(filename)}</small></span></a>`;
  }
  if (block.type === "drawing") {
    const lines = block.strokes
      .map((stroke) => {
        const color = /^#[0-9a-f]{6}$/i.test(stroke.color)
          ? stroke.color
          : "#556b5d";
        const width = Math.max(1, Math.min(12, Number(stroke.width) || 3));
        const points = stroke.points
          .map(
            (point) =>
              `${Math.round(Math.max(0, Math.min(1, point.x)) * 100)},${Math.round(Math.max(0, Math.min(1, point.y)) * 100)}`,
          )
          .join(" ");
        return `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"></polyline>`;
      })
      .join("");
    return `<figure class="block drawing-block" data-block-id="${escapeHtml(block.id)}" data-block-type="drawing" data-column="${block.column}" data-row="${block.row}" data-column-span="${block.columnSpan}" data-row-span="${block.rowSpan}" style="--column:${block.column};--row:${block.row};--column-span:${block.columnSpan};--row-span:${block.rowSpan}"><svg class="drawing-view" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Freehand drawing">${lines}</svg></figure>`;
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
  return recoverNotebookFromPortableHtml(html).notebook;
}

export function recoverNotebookFromPortableHtml(html) {
  const match = String(html).match(/\sdata-gridnote="([^"]+)"/);
  if (!match) {
    throw new Error("This file does not contain Gridnote notebook metadata.");
  }
  return recoverNotebook(JSON.parse(decodeURIComponent(match[1])));
}
