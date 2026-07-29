import test from "node:test";
import assert from "node:assert/strict";

import {
  createPortableFiles,
  notebookFromPortableHtml,
} from "../lib/portable.mjs";

test("portable HTML round-trips pages, structural coordinates, and rich text", () => {
  const notebook = {
    id: "notebook-1",
    title: "Field Notes",
    activePageId: "page-2",
    updatedAt: "2026-07-29T12:00:00.000Z",
    assets: [
      {
        id: "asset-1",
        filename: "garden.png",
        mimeType: "image/png",
        dataUrl: "data:image/png;base64,iVBORw0KGgo=",
      },
      {
        id: "asset-2",
        filename: "seed-list.pdf",
        mimeType: "application/pdf",
        dataUrl: "data:application/pdf;base64,JVBERi0=",
      },
    ],
    pages: [
      {
        id: "page-1",
        title: "Garden",
        blocks: [
          {
            id: "block-1",
            type: "rich-text",
            column: 2,
            row: 3,
            columnSpan: 4,
            rowSpan: 2,
            html: "<h2>Rosemary</h2><p>Plant near the kitchen.</p>",
          },
        ],
      },
      {
        id: "page-2",
        title: "Reading",
        blocks: [
          {
            id: "block-image",
            type: "image",
            column: 8,
            row: 1,
            columnSpan: 5,
            rowSpan: 6,
            assetId: "asset-1",
            alt: "Rosemary in the garden",
          },
          {
            id: "block-table",
            type: "table",
            column: 14,
            row: 1,
            columnSpan: 6,
            rowSpan: 5,
            cells: [
              ["Plant", "Season"],
              ["Rosemary", "Spring"],
            ],
          },
          {
            id: "block-shape",
            type: "shape",
            column: 1,
            row: 9,
            columnSpan: 4,
            rowSpan: 3,
            shape: "rounded",
            color: "#dce6d5",
            text: "Sunny area",
          },
          {
            id: "block-attachment",
            type: "attachment",
            column: 7,
            row: 9,
            columnSpan: 6,
            rowSpan: 3,
            assetId: "asset-2",
            label: "Seed list",
          },
        ],
      },
    ],
  };

  const files = createPortableFiles(notebook);

  assert.match(files.html, /data-column="2"/);
  assert.match(files.html, /href="styles\.css"/);
  assert.match(files.html, /src="script\.js"/);
  assert.match(files.html, /src="assets\/garden\.png"/);
  assert.match(files.html, /class="block table-block"/);
  assert.match(files.html, /class="block shape-block shape-rounded"/);
  assert.match(files.html, /href="assets\/seed-list\.pdf"/);
  assert.equal(files.assets[0].filename, "garden.png");
  assert.deepEqual(notebookFromPortableHtml(files.html), {
    ...notebook,
    assets: notebook.assets.map(({ dataUrl: _dataUrl, ...asset }) => asset),
  });
});
