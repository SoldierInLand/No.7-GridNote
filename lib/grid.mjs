const whole = (value, minimum = 0) =>
  Math.max(minimum, Math.round(Number(value) || 0));

export function cellsToRect(start, end) {
  const startColumn = whole(start.column);
  const startRow = whole(start.row);
  const endColumn = whole(end.column);
  const endRow = whole(end.row);
  const column = Math.min(startColumn, endColumn);
  const row = Math.min(startRow, endRow);

  return {
    column,
    row,
    columnSpan: Math.abs(endColumn - startColumn) + 1,
    rowSpan: Math.abs(endRow - startRow) + 1,
  };
}

export function createBlock(input) {
  return {
    id: input.id,
    column: whole(input.column),
    row: whole(input.row),
    columnSpan: whole(input.columnSpan, 1),
    rowSpan: whole(input.rowSpan, 1),
    type: "rich-text",
    html: input.html ?? "<p>Start writing…</p>",
  };
}

function overlaps(a, b) {
  return (
    a.column < b.column + b.columnSpan &&
    a.column + a.columnSpan > b.column &&
    a.row < b.row + b.rowSpan &&
    a.row + a.rowSpan > b.row
  );
}

export function collides(candidate, blocks, ignoredId) {
  return blocks.some(
    (block) => block.id !== ignoredId && overlaps(candidate, block),
  );
}

export function moveBlock(block, column, row, blocks) {
  const moved = {
    ...block,
    column: whole(column),
    row: whole(row),
  };

  return collides(moved, blocks, block.id)
    ? { ok: false, block }
    : { ok: true, block: moved };
}

export function resizeBlock(block, columnSpan, rowSpan, blocks) {
  const resized = {
    ...block,
    columnSpan: whole(columnSpan, 1),
    rowSpan: whole(rowSpan, 1),
  };

  return collides(resized, blocks, block.id)
    ? { ok: false, block }
    : { ok: true, block: resized };
}
