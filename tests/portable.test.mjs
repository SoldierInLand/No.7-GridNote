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
    assets: [],
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
      { id: "page-2", title: "Reading", blocks: [] },
    ],
  };

  const files = createPortableFiles(notebook);

  assert.match(files.html, /data-column="2"/);
  assert.match(files.html, /href="styles\.css"/);
  assert.match(files.html, /src="script\.js"/);
  assert.deepEqual(notebookFromPortableHtml(files.html), notebook);
});
