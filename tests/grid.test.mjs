import test from "node:test";
import assert from "node:assert/strict";

import {
  cellsToRect,
  collides,
  createBlock,
  moveBlock,
  resizeBlock,
} from "../lib/grid.mjs";

test("cellsToRect merges any drag direction into integer grid coordinates", () => {
  assert.deepEqual(cellsToRect({ column: 5, row: 4 }, { column: 2, row: 2 }), {
    column: 2,
    row: 2,
    columnSpan: 4,
    rowSpan: 3,
  });
});

test("createBlock enforces a one-cell minimum", () => {
  const block = createBlock({
    id: "block-1",
    column: 3.8,
    row: -2,
    columnSpan: 0,
    rowSpan: 0,
    html: "<p>Hello</p>",
  });

  assert.deepEqual(block, {
    id: "block-1",
    column: 4,
    row: 0,
    columnSpan: 1,
    rowSpan: 1,
    type: "rich-text",
    html: "<p>Hello</p>",
  });
});

test("collides detects occupied structural cells but permits touching edges", () => {
  const fixed = createBlock({
    id: "fixed",
    column: 2,
    row: 2,
    columnSpan: 2,
    rowSpan: 2,
  });

  assert.equal(
    collides(
      { column: 3, row: 3, columnSpan: 1, rowSpan: 1 },
      [fixed],
    ),
    true,
  );
  assert.equal(
    collides(
      { column: 4, row: 2, columnSpan: 1, rowSpan: 2 },
      [fixed],
    ),
    false,
  );
});

test("moveBlock snaps coordinates and rejects overlap", () => {
  const moving = createBlock({
    id: "moving",
    column: 0,
    row: 0,
    columnSpan: 2,
    rowSpan: 1,
  });
  const fixed = createBlock({
    id: "fixed",
    column: 4,
    row: 2,
    columnSpan: 2,
    rowSpan: 2,
  });

  assert.deepEqual(moveBlock(moving, 3.2, 1.7, [moving, fixed]), {
    ok: false,
    block: moving,
  });
  assert.deepEqual(moveBlock(moving, 1.6, 0.3, [moving, fixed]), {
    ok: true,
    block: { ...moving, column: 2, row: 0 },
  });
});

test("resizeBlock grows in whole cells and rejects occupied cells", () => {
  const block = createBlock({
    id: "block",
    column: 0,
    row: 0,
    columnSpan: 2,
    rowSpan: 2,
  });
  const neighbor = createBlock({
    id: "neighbor",
    column: 3,
    row: 0,
    columnSpan: 1,
    rowSpan: 2,
  });

  assert.deepEqual(resizeBlock(block, 4.2, 2, [block, neighbor]), {
    ok: false,
    block,
  });
  assert.deepEqual(resizeBlock(block, 2.2, 3.6, [block, neighbor]), {
    ok: true,
    block: { ...block, columnSpan: 2, rowSpan: 4 },
  });
});
