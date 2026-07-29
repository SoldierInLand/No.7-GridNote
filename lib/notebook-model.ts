import type { GridBlock, Notebook } from "./notebook-types";

export const GRID = {
  cell: 32,
  columns: 40,
  rows: 30,
} as const;

export const initialNotebook: Notebook = {
  id: "gridnote-welcome",
  title: "Field Notes",
  activePageId: "page-garden",
  assets: [],
  pages: [
    {
      id: "page-garden",
      title: "Garden ideas",
      blocks: [
        {
          id: "block-welcome",
          type: "rich-text",
          column: 2,
          row: 2,
          columnSpan: 7,
          rowSpan: 4,
          html: "<h2>Welcome to Gridnote</h2><p>Write inside this block, or drag across empty grid cells to create another.</p><ul><li>The grid controls real position and size</li><li>Blocks never overlap</li><li>Your notebook exports as a webpage</li></ul>",
        },
        {
          id: "block-checklist",
          type: "rich-text",
          column: 11,
          row: 2,
          columnSpan: 5,
          rowSpan: 4,
          html: "<h3>Try it</h3><p>☐ Click text to edit</p><p>☐ Use the small grip to move</p><p>☐ Drag the corner edge to resize</p>",
        },
      ],
    },
    { id: "page-reading", title: "Reading list", blocks: [] },
  ],
};

export function uid(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function estimateNotebookSize(notebook: Notebook) {
  const assets = notebook.assets.reduce(
    (total, asset) => total + (asset.dataUrl?.length ?? 0),
    0,
  );
  const content = notebook.pages.reduce(
    (pageTotal, page) =>
      pageTotal +
      page.title.length +
      page.blocks.reduce((blockTotal, block) => {
        if (block.type === "rich-text") return blockTotal + block.html.length;
        if (block.type === "table") {
          return (
            blockTotal +
            block.cells.flat().reduce((total, cell) => total + cell.length, 0)
          );
        }
        if (block.type === "drawing") {
          return (
            blockTotal +
            block.strokes.reduce(
              (total, stroke) => total + stroke.points.length * 24,
              0,
            )
          );
        }
        return blockTotal + 256;
      }, 0),
    0,
  );
  return assets + content;
}

export function historyLimit(notebook: Notebook) {
  const size = estimateNotebookSize(notebook);
  if (size > 5_000_000) return 5;
  if (size > 1_000_000) return 12;
  return 30;
}

export function findOpenRect(
  blocks: GridBlock[],
  columnSpan: number,
  rowSpan: number,
) {
  for (let row = 0; row <= GRID.rows - rowSpan; row += 1) {
    for (let column = 0; column <= GRID.columns - columnSpan; column += 1) {
      const candidate = { column, row, columnSpan, rowSpan };
      const occupied = blocks.some(
        (block) =>
          candidate.column < block.column + block.columnSpan &&
          candidate.column + candidate.columnSpan > block.column &&
          candidate.row < block.row + block.rowSpan &&
          candidate.row + candidate.rowSpan > block.row,
      );
      if (!occupied) return candidate;
    }
  }
}
