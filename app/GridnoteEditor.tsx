"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type {
  AssetRef,
  AttachmentBlock,
  DrawingBlock,
  DrawingStroke,
  GridBlock,
  ImageBlock,
  NotebookPage,
  ShapeBlock,
  TableBlock,
  Notebook,
} from "@/lib/notebook-types";
import {
  cellsToRect,
  collides,
  createBlock,
  moveBlock,
  resizeBlock,
} from "@/lib/grid.mjs";
import {
  sanitizeRichText,
} from "@/lib/portable.mjs";
import { loadDraft, saveDraft } from "@/lib/draft-store";
import {
  dataUrlForFile,
  exportPortableZip,
  importPortableZip,
  openPortableFolder,
  savePortableFolder,
} from "@/lib/notebook-files";
import {
  estimateNotebookSize,
  findOpenRect,
  GRID,
  historyLimit,
  initialNotebook,
  uid,
} from "@/lib/notebook-model";
import {
  emptyTextFormat,
  RichTextEditor,
  type TextFormatState,
} from "./RichTextEditor";

const { cell: CELL, columns: COLUMNS, rows: ROWS } = GRID;

type Rect = {
  column: number;
  row: number;
  columnSpan: number;
  rowSpan: number;
};

type Interaction =
  | {
      kind: "create";
      start: { column: number; row: number };
      pointerX: number;
      pointerY: number;
      dragged: boolean;
    }
  | {
      kind: "move";
      id: string;
      pointerX: number;
      pointerY: number;
      startColumn: number;
      startRow: number;
    }
  | {
      kind: "resize";
      id: string;
      pointerX: number;
      pointerY: number;
      startColumnSpan: number;
      startRowSpan: number;
    };

function contrastTextColor(background: string) {
  const match = /^#([0-9a-f]{6})$/i.exec(background);
  if (!match) return "#344055";
  const value = Number.parseInt(match[1], 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  const luminance = (red * 299 + green * 587 + blue * 114) / 1000;
  return luminance > 150 ? "#344055" : "#ffffff";
}

export function GridnoteEditor() {
  const [notebook, setNotebook] = useState(initialNotebook);
  const notebookRef = useRef(notebook);
  const [past, setPast] = useState<Notebook[]>([]);
  const [future, setFuture] = useState<Notebook[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>("block-welcome");
  const [zoom, setZoom] = useState(1);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selection, setSelection] = useState<Rect | null>(null);
  const [interaction, setInteraction] = useState<Interaction | null>(null);
  const [ghost, setGhost] = useState<(Rect & { invalid?: boolean }) | null>(null);
  const [status, setStatus] = useState("Ready");
  const [warningMessage, setWarningMessage] = useState("");
  const [phoneMode, setPhoneMode] = useState<"edit" | "pan">("edit");
  const [pageQuery, setPageQuery] = useState("");
  const [textFormat, setTextFormat] =
    useState<TextFormatState>(emptyTextFormat);
  const [activeEditorId, setActiveEditorId] = useState<string | null>(null);
  const [formatOpen, setFormatOpen] = useState(true);
  const [drawColor, setDrawColor] = useState("#556b5d");
  const [drawWidth, setDrawWidth] = useState(3);
  const [drawingStrokeId, setDrawingStrokeId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const canvasScrollRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);
  const touchPointsRef = useRef(new Map<number, { x: number; y: number }>());
  const savedRangeRef = useRef<Range | null>(null);
  const pinchRef = useRef<{
    distance: number;
    startZoom: number;
    contentX: number;
    contentY: number;
  } | null>(null);

  useEffect(() => {
    notebookRef.current = notebook;
  }, [notebook]);

  useEffect(() => {
    loadDraft()
      .then((draft) => {
        if (draft?.pages?.length) {
          setNotebook(draft);
          setStatus("Local draft restored");
        }
      })
      .catch(() => setStatus("Local autosave unavailable"));
  }, []);

  useEffect(() => {
    const delay = estimateNotebookSize(notebook) > 1_000_000 ? 1200 : 450;
    const timer = window.setTimeout(() => {
      saveDraft(notebook)
        .then(() => setStatus("Saved locally"))
        .catch(() => {
          setStatus("Could not save locally");
          setWarningMessage(
            "Browser storage is full or unavailable. Export a ZIP now to protect this notebook.",
          );
        });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [notebook]);

  const activePage =
    notebook.pages.find((page) => page.id === notebook.activePageId) ??
    notebook.pages[0];

  const selectedBlock = activePage?.blocks.find(
    (block) => block.id === selectedId,
  );

  useEffect(() => {
    if (
      selectedBlock?.type !== "rich-text" &&
      selectedBlock?.type !== "table" &&
      selectedBlock?.type !== "shape"
    ) {
      setTextFormat(emptyTextFormat);
      setActiveEditorId(null);
    }
  }, [selectedBlock?.type]);
  const interactionBlockId =
    interaction && interaction.kind !== "create" ? interaction.id : null;

  const commit = useCallback((next: Notebook, message = "Saved locally") => {
    const limit = historyLimit(notebookRef.current);
    setPast((items) => [
      ...items.slice(-Math.max(0, limit - 1)),
      notebookRef.current,
    ]);
    setFuture([]);
    const timestamped = { ...next, updatedAt: new Date().toISOString() };
    notebookRef.current = timestamped;
    setNotebook(timestamped);
    setStatus(message);
  }, []);

  const updateActivePage = useCallback(
    (updater: (page: NotebookPage) => NotebookPage, message?: string) => {
      const current = notebookRef.current;
      commit(
        {
          ...current,
          pages: current.pages.map((page) =>
            page.id === current.activePageId ? updater(page) : page,
          ),
        },
        message,
      );
    },
    [commit],
  );

  const undo = useCallback(() => {
    setPast((items) => {
      const previous = items.at(-1);
      if (!previous) return items;
      setFuture((nextItems) =>
        [notebookRef.current, ...nextItems].slice(
          0,
          historyLimit(notebookRef.current),
        ),
      );
      notebookRef.current = previous;
      setNotebook(previous);
      setStatus("Undid change");
      return items.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setFuture((items) => {
      const next = items[0];
      if (!next) return items;
      setPast((previousItems) => {
        const limit = historyLimit(notebookRef.current);
        return [
          ...previousItems.slice(-Math.max(0, limit - 1)),
          notebookRef.current,
        ];
      });
      notebookRef.current = next;
      setNotebook(next);
      setStatus("Redid change");
      return items.slice(1);
    });
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === "z") {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [redo, undo]);

  const pointToCell = useCallback(
    (clientX: number, clientY: number) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return { column: 0, row: 0 };
      return {
        column: Math.max(
          0,
          Math.min(COLUMNS - 1, Math.floor((clientX - rect.left) / (CELL * zoom))),
        ),
        row: Math.max(
          0,
          Math.min(ROWS - 1, Math.floor((clientY - rect.top) / (CELL * zoom))),
        ),
      };
    },
    [zoom],
  );

  const onCanvasPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pinchRef.current) return;
    if (phoneMode === "pan") {
      const scroller = canvasScrollRef.current;
      if (!scroller) return;
      panRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        scrollLeft: scroller.scrollLeft,
        scrollTop: scroller.scrollTop,
      };
      setSelectedId(null);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (event.button !== 0 || event.target !== canvasRef.current) return;
    const cell = pointToCell(event.clientX, event.clientY);
    setSelectedId(null);
    setActiveEditorId(null);
    setTextFormat(emptyTextFormat);
    setSelection(null);
    setInteraction({
      kind: "create",
      start: cell,
      pointerX: event.clientX,
      pointerY: event.clientY,
      dragged: false,
    });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onCanvasPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pinchRef.current) return;
    const pan = panRef.current;
    if (pan?.pointerId === event.pointerId) {
      const scroller = canvasScrollRef.current;
      if (scroller) {
        scroller.scrollLeft = pan.scrollLeft - (event.clientX - pan.startX);
        scroller.scrollTop = pan.scrollTop - (event.clientY - pan.startY);
      }
      return;
    }
    if (!interaction) return;
    if (interaction.kind === "create") {
      const dragged =
        interaction.dragged ||
        Math.hypot(
          event.clientX - interaction.pointerX,
          event.clientY - interaction.pointerY,
        ) >= 8;
      if (!dragged) return;
      if (!interaction.dragged) {
        setInteraction({ ...interaction, dragged: true });
      }
      const next = cellsToRect(
        interaction.start,
        pointToCell(event.clientX, event.clientY),
      );
      setSelection({
        ...next,
        invalid: collides(next, activePage.blocks),
      } as Rect);
      return;
    }

    const block = activePage.blocks.find((item) => item.id === interaction.id);
    if (!block) return;
    const deltaColumn = Math.round(
      (event.clientX - interaction.pointerX) / (CELL * zoom),
    );
    const deltaRow = Math.round(
      (event.clientY - interaction.pointerY) / (CELL * zoom),
    );
    if (interaction.kind === "move") {
      const candidate = {
        column: Math.max(
          0,
          Math.min(
            COLUMNS - block.columnSpan,
            interaction.startColumn + deltaColumn,
          ),
        ),
        row: Math.max(
          0,
          Math.min(ROWS - block.rowSpan, interaction.startRow + deltaRow),
        ),
        columnSpan: block.columnSpan,
        rowSpan: block.rowSpan,
      };
      setGhost({
        ...candidate,
        invalid: collides(candidate, activePage.blocks, block.id),
      });
    } else {
      const candidate = {
        column: block.column,
        row: block.row,
        columnSpan: Math.max(
          1,
          Math.min(
            COLUMNS - block.column,
            interaction.startColumnSpan + deltaColumn,
          ),
        ),
        rowSpan: Math.max(
          1,
          Math.min(ROWS - block.row, interaction.startRowSpan + deltaRow),
        ),
      };
      setGhost({
        ...candidate,
        invalid: collides(candidate, activePage.blocks, block.id),
      });
    }
  };

  const onCanvasPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (panRef.current?.pointerId === event.pointerId) {
      panRef.current = null;
      return;
    }
    if (!interaction) return;
    if (interaction.kind === "create" && interaction.dragged && selection) {
      if (!collides(selection, activePage.blocks)) {
        const block = createBlock({
          id: uid("block"),
          ...selection,
          html: "<p><br></p>",
        }) as GridBlock;
        updateActivePage(
          (page) => ({ ...page, blocks: [...page.blocks, block] }),
          "Block created",
        );
        setSelectedId(block.id);
        window.requestAnimationFrame(() => {
          document
            .querySelector<HTMLElement>(`[data-editor-id="${block.id}"]`)
            ?.focus();
        });
      } else {
        setStatus("Those cells are already occupied");
      }
    } else if (interaction.kind === "create") {
      setStatus("Ready");
    }
    if (
      (interaction.kind === "move" || interaction.kind === "resize") &&
      ghost &&
      !ghost.invalid
    ) {
      updateActivePage(
        (page) => ({
          ...page,
          blocks: page.blocks.map((block) => {
            if (block.id !== interaction.id) return block;
            return interaction.kind === "move"
              ? (moveBlock(
                  block,
                  ghost.column,
                  ghost.row,
                  page.blocks,
                ).block as GridBlock)
              : (resizeBlock(
                  block,
                  ghost.columnSpan,
                  ghost.rowSpan,
                  page.blocks,
                ).block as GridBlock);
          }),
        }),
        interaction.kind === "move" ? "Block moved" : "Block resized",
      );
    }
    setSelection(null);
    setGhost(null);
    setInteraction(null);
  };

  const pinchDistance = () => {
    const points = [...touchPointsRef.current.values()];
    if (points.length < 2) return 0;
    return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
  };

  const pinchMidpoint = () => {
    const points = [...touchPointsRef.current.values()];
    return {
      x: (points[0].x + points[1].x) / 2,
      y: (points[0].y + points[1].y) / 2,
    };
  };

  const onCanvasPointerDownCapture = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (event.pointerType !== "touch") return;
    touchPointsRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    if (touchPointsRef.current.size !== 2) return;
    const scroller = canvasScrollRef.current;
    if (!scroller) return;
    const midpoint = pinchMidpoint();
    const rect = scroller.getBoundingClientRect();
    pinchRef.current = {
      distance: Math.max(1, pinchDistance()),
      startZoom: zoom,
      contentX: (scroller.scrollLeft + midpoint.x - rect.left) / zoom,
      contentY: (scroller.scrollTop + midpoint.y - rect.top) / zoom,
    };
    panRef.current = null;
    setSelection(null);
    setGhost(null);
    setInteraction(null);
  };

  const onCanvasPointerMoveCapture = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (
      event.pointerType !== "touch" ||
      !touchPointsRef.current.has(event.pointerId)
    ) {
      return;
    }
    touchPointsRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    const pinch = pinchRef.current;
    const scroller = canvasScrollRef.current;
    if (!pinch || touchPointsRef.current.size < 2 || !scroller) return;
    event.preventDefault();
    const nextZoom = Math.max(
      0.5,
      Math.min(1.8, pinch.startZoom * (pinchDistance() / pinch.distance)),
    );
    const midpoint = pinchMidpoint();
    const rect = scroller.getBoundingClientRect();
    setZoom(nextZoom);
    scroller.scrollLeft =
      pinch.contentX * nextZoom - (midpoint.x - rect.left);
    scroller.scrollTop = pinch.contentY * nextZoom - (midpoint.y - rect.top);
  };

  const onCanvasPointerEndCapture = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (event.pointerType !== "touch") return;
    touchPointsRef.current.delete(event.pointerId);
    if (touchPointsRef.current.size < 2) pinchRef.current = null;
  };

  const startMove = (
    event: ReactPointerEvent<HTMLButtonElement>,
    block: GridBlock,
  ) => {
    if (phoneMode === "pan") return;
    event.stopPropagation();
    setSelectedId(block.id);
    setInteraction({
      kind: "move",
      id: block.id,
      pointerX: event.clientX,
      pointerY: event.clientY,
      startColumn: block.column,
      startRow: block.row,
    });
    canvasRef.current?.setPointerCapture(event.pointerId);
  };

  const startResize = (
    event: ReactPointerEvent<HTMLButtonElement>,
    block: GridBlock,
  ) => {
    if (phoneMode === "pan") return;
    event.stopPropagation();
    setSelectedId(block.id);
    setInteraction({
      kind: "resize",
      id: block.id,
      pointerX: event.clientX,
      pointerY: event.clientY,
      startColumnSpan: block.columnSpan,
      startRowSpan: block.rowSpan,
    });
    canvasRef.current?.setPointerCapture(event.pointerId);
  };

  const saveBlockHtml = (blockId: string, html: string) => {
    const clean = sanitizeRichText(html);
    const block = activePage.blocks.find((item) => item.id === blockId);
    if (!block || block.type !== "rich-text" || block.html === clean) return;
    updateActivePage(
      (page) => ({
        ...page,
        blocks: page.blocks.map((item) =>
          item.id === blockId && item.type === "rich-text"
            ? { ...item, html: clean }
            : item,
        ),
      }),
      "Text saved",
    );
  };

  const saveEditorHtml = (editorId: string, html: string) => {
    const block = activePage.blocks.find(
      (item) =>
        item.id === editorId ||
        editorId.startsWith(`${item.id}-cell-`) ||
        editorId === `${item.id}-shape`,
    );
    if (!block) return;
    if (block.type === "rich-text") {
      saveBlockHtml(block.id, html);
      return;
    }
    if (block.type === "shape") {
      if (block.text === html) return;
      updateActivePage(
        (page) => ({
          ...page,
          blocks: page.blocks.map((item) =>
            item.id === block.id && item.type === "shape"
              ? { ...item, text: html }
              : item,
          ),
        }),
        "Shape text saved",
      );
      return;
    }
    if (block.type === "table") {
      const match = editorId.match(/-cell-(\d+)-(\d+)$/);
      if (!match) return;
      const rowIndex = Number(match[1]);
      const columnIndex = Number(match[2]);
      if (block.cells[rowIndex]?.[columnIndex] === html) return;
      updateActivePage(
        (page) => ({
          ...page,
          blocks: page.blocks.map((item) =>
            item.id === block.id && item.type === "table"
              ? {
                  ...item,
                  cells: item.cells.map((tableRow, currentRow) =>
                    tableRow.map((cell, currentColumn) =>
                      currentRow === rowIndex &&
                      currentColumn === columnIndex
                        ? html
                        : cell,
                    ),
                  ),
                }
              : item,
          ),
        }),
        "Table text saved",
      );
    }
  };

  const runFormat = (command: string, value?: string) => {
    const editor = document.querySelector<HTMLElement>(
      `[data-editor-id="${activeEditorId}"]`,
    );
    if (!editor || !activeEditorId) return;
    editor.focus();
    const selection = window.getSelection();
    if (selection && savedRangeRef.current) {
      selection.removeAllRanges();
      selection.addRange(savedRangeRef.current);
    }
    document.execCommand(command, false, value);
    saveEditorHtml(activeEditorId, editor.innerHTML);
    document.dispatchEvent(new Event("selectionchange"));
  };

  const toggleHighlight = () => {
    const removing = textFormat.marked === true;
    runFormat("hiliteColor", removing ? "transparent" : "#fff1a8");
    const foreground =
      selectedBlock?.type === "shape"
        ? contrastTextColor(selectedBlock.color)
        : "#344055";
    runFormat("foreColor", removing ? foreground : "#3b3522");
  };

  const rememberTextSelection = (editor: HTMLElement) => {
    setActiveEditorId(editor.dataset.editorId ?? null);
    const selection = window.getSelection();
    if (
      selection?.rangeCount &&
      editor.contains(selection.getRangeAt(0).commonAncestorContainer)
    ) {
      savedRangeRef.current = selection.getRangeAt(0).cloneRange();
    }
  };

  const addPage = () => {
    const page: NotebookPage = {
      id: uid("page"),
      title: `Page ${notebook.pages.length + 1}`,
      blocks: [],
    };
    commit(
      {
        ...notebook,
        activePageId: page.id,
        pages: [...notebook.pages, page],
      },
      "Page created",
    );
    setSelectedId(null);
    setSidebarOpen(false);
  };

  const duplicateSelected = () => {
    if (!selectedBlock) return;
    const candidate = {
      ...selectedBlock,
      id: uid("block"),
      column: selectedBlock.column + 1,
      row: selectedBlock.row + selectedBlock.rowSpan,
    };
    if (collides(candidate, activePage.blocks)) {
      setStatus("No empty cells below this block");
      return;
    }
    updateActivePage((page) => ({
      ...page,
      blocks: [...page.blocks, candidate],
    }));
    setSelectedId(candidate.id);
  };

  const deleteSelected = () => {
    if (!selectedId) return;
    updateActivePage((page) => ({
      ...page,
      blocks: page.blocks.filter((block) => block.id !== selectedId),
    }));
    setSelectedId(null);
  };

  const renamePage = (page: NotebookPage) => {
    const title = window.prompt("Page name", page.title)?.trim();
    if (!title || title === page.title) return;
    commit({
      ...notebook,
      pages: notebook.pages.map((item) =>
        item.id === page.id ? { ...item, title } : item,
      ),
    });
  };

  const deletePage = (pageId: string) => {
    if (notebook.pages.length === 1) {
      setStatus("A notebook must keep at least one page");
      return;
    }
    const pages = notebook.pages.filter((page) => page.id !== pageId);
    commit(
      {
        ...notebook,
        pages,
        activePageId:
          notebook.activePageId === pageId
            ? pages[0].id
            : notebook.activePageId,
      },
      "Page deleted",
    );
    setSelectedId(null);
  };

  const reorderPage = (pageId: string, direction: -1 | 1) => {
    const index = notebook.pages.findIndex((page) => page.id === pageId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= notebook.pages.length) return;
    const pages = [...notebook.pages];
    [pages[index], pages[target]] = [pages[target], pages[index]];
    commit({ ...notebook, pages }, "Page order saved");
  };

  const moveSelectedBlockByKeyboard = (
    block: GridBlock,
    deltaColumn: number,
    deltaRow: number,
    resize: boolean,
  ) => {
    const result = resize
      ? resizeBlock(
          block,
          Math.max(
            1,
            Math.min(COLUMNS - block.column, block.columnSpan + deltaColumn),
          ),
          Math.max(
            1,
            Math.min(ROWS - block.row, block.rowSpan + deltaRow),
          ),
          activePage.blocks,
        )
      : moveBlock(
          block,
          Math.max(
            0,
            Math.min(
              COLUMNS - block.columnSpan,
              block.column + deltaColumn,
            ),
          ),
          Math.max(
            0,
            Math.min(ROWS - block.rowSpan, block.row + deltaRow),
          ),
          activePage.blocks,
        );
    if (!result.ok) {
      setStatus("That grid position is occupied");
      return;
    }
    updateActivePage(
      (page) => ({
        ...page,
        blocks: page.blocks.map((item) =>
          item.id === block.id ? (result.block as GridBlock) : item,
        ),
      }),
      resize ? "Block resized" : "Block moved",
    );
  };

  const exportZip = async () => {
    try {
      setStatus("Preparing portable notebook…");
      let lastProgress = 0;
      await exportPortableZip(notebook, (percent) => {
          const progress = Math.floor(percent / 25) * 25;
          if (progress > lastProgress && progress < 100) {
            lastProgress = progress;
            setStatus(`Preparing portable notebook… ${progress}%`);
          }
        });
      setStatus("Portable ZIP downloaded");
    } catch (error) {
      setStatus("Could not export this notebook");
      setWarningMessage(
        error instanceof Error
          ? error.message
          : "Export ran out of browser memory. Close other tabs, then try again.",
      );
    }
  };

  const saveFolder = async () => {
    try {
      await savePortableFolder(notebook);
      setStatus("Portable folder saved");
    } catch (error) {
      if ((error as DOMException)?.name === "AbortError") return;
      setStatus(
        error instanceof Error ? error.message : "Could not save that folder",
      );
    }
  };

  const applyImportedNotebook = (
    imported: Notebook,
    warnings: string[],
    action: "Opened" | "Imported",
  ) => {
    setPast((items) => {
      const limit = historyLimit(notebookRef.current);
      return [
        ...items.slice(-Math.max(0, limit - 1)),
        notebookRef.current,
      ];
    });
    setFuture([]);
    notebookRef.current = imported;
    setNotebook(imported);
    setSelectedId(null);
    setStatus(`${action} ${imported.title}`);
    setWarningMessage(
      warnings.length
        ? `Recovered ${warnings.length} issue${warnings.length === 1 ? "" : "s"}. ${warnings[0]}`
        : "",
    );
  };

  const openFolder = async () => {
    try {
      const result = await openPortableFolder();
      applyImportedNotebook(result.notebook, result.warnings, "Opened");
    } catch (error) {
      if ((error as DOMException)?.name === "AbortError") return;
      setStatus(
        error instanceof Error ? error.message : "Could not open that folder",
      );
    }
  };

  const importZip = async (file: File) => {
    try {
      const result = await importPortableZip(file);
      applyImportedNotebook(result.notebook, result.warnings, "Imported");
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Could not import that ZIP",
      );
    }
  };

  const insertTextBlock = () => {
    const rect = findOpenRect(activePage.blocks, 6, 4);
    if (!rect) {
      setStatus("This page has no open 6 × 4 area for a note");
      return;
    }
    const block = createBlock({
      id: uid("block"),
      ...rect,
      html: "<p><br></p>",
    }) as GridBlock;
    updateActivePage(
      (page) => ({ ...page, blocks: [...page.blocks, block] }),
      "Note created",
    );
    setSelectedId(block.id);
    setPhoneMode("edit");
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(`[data-editor-id="${block.id}"]`)
        ?.focus();
    });
  };

  const insertImage = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setStatus("Choose an image file");
      return;
    }
    const rect = findOpenRect(activePage.blocks, 6, 5);
    if (!rect) {
      setStatus("This page has no open 6 × 5 area for an image");
      return;
    }
    const dataUrl = await dataUrlForFile(file);
    const assetId = uid("asset");
    const safeBase =
      file.name.replace(/[^a-zA-Z0-9._-]+/g, "-") || "image.png";
    const duplicate = notebook.assets.some(
      (asset) => asset.filename === safeBase,
    );
    const filename = duplicate
      ? `${assetId.slice(-8)}-${safeBase}`
      : safeBase;
    const asset: AssetRef = {
      id: assetId,
      filename,
      mimeType: file.type,
      dataUrl,
    };
    const block: ImageBlock = {
      id: uid("block"),
      type: "image",
      ...rect,
      assetId,
      alt: file.name.replace(/\.[^.]+$/, ""),
    };
    const current = notebookRef.current;
    commit(
      {
        ...current,
        assets: [...current.assets, asset],
        pages: current.pages.map((page) =>
          page.id === current.activePageId
            ? { ...page, blocks: [...page.blocks, block] }
            : page,
        ),
      },
      "Image added to the structural grid",
    );
    setSelectedId(block.id);
  };

  const insertTable = () => {
    const rect = findOpenRect(activePage.blocks, 7, 6);
    if (!rect) {
      setStatus("This page has no open 7 × 6 area for a table");
      return;
    }
    const block: TableBlock = {
      id: uid("block"),
      type: "table",
      ...rect,
      cells: [
        ["Column 1", "Column 2", "Column 3"],
        ["", "", ""],
        ["", "", ""],
      ],
    };
    updateActivePage(
      (page) => ({ ...page, blocks: [...page.blocks, block] }),
      "Table added to the structural grid",
    );
    setSelectedId(block.id);
  };

  const insertShape = () => {
    const rect = findOpenRect(activePage.blocks, 5, 4);
    if (!rect) {
      setStatus("This page has no open 5 × 4 area for a shape");
      return;
    }
    const block: ShapeBlock = {
      id: uid("block"),
      type: "shape",
      ...rect,
      shape: "rounded",
      color: "#dce6d5",
      text: "Shape label",
    };
    updateActivePage(
      (page) => ({ ...page, blocks: [...page.blocks, block] }),
      "Shape added to the structural grid",
    );
    setSelectedId(block.id);
  };

  const insertDrawing = () => {
    const rect = findOpenRect(activePage.blocks, 8, 6);
    if (!rect) {
      setStatus("This page has no open 8 × 6 area for a drawing");
      return;
    }
    const block: DrawingBlock = {
      id: uid("block"),
      type: "drawing",
      ...rect,
      strokes: [],
    };
    updateActivePage(
      (page) => ({ ...page, blocks: [...page.blocks, block] }),
      "Drawing canvas added to the structural grid",
    );
    setSelectedId(block.id);
  };

  const insertAttachment = async (file: File) => {
    const rect = findOpenRect(activePage.blocks, 6, 3);
    if (!rect) {
      setStatus("This page has no open 6 × 3 area for an attachment");
      return;
    }
    const dataUrl = await dataUrlForFile(file);
    const assetId = uid("asset");
    const safeBase =
      file.name.replace(/[^a-zA-Z0-9._-]+/g, "-") || "attachment";
    const filename = notebook.assets.some(
      (asset) => asset.filename === safeBase,
    )
      ? `${assetId.slice(-8)}-${safeBase}`
      : safeBase;
    const asset: AssetRef = {
      id: assetId,
      filename,
      mimeType: file.type || "application/octet-stream",
      dataUrl,
    };
    const block: AttachmentBlock = {
      id: uid("block"),
      type: "attachment",
      ...rect,
      assetId,
      label: file.name.replace(/\.[^.]+$/, ""),
    };
    const current = notebookRef.current;
    commit(
      {
        ...current,
        assets: [...current.assets, asset],
        pages: current.pages.map((page) =>
          page.id === current.activePageId
            ? { ...page, blocks: [...page.blocks, block] }
            : page,
        ),
      },
      "File attached to the structural grid",
    );
    setSelectedId(block.id);
  };

  const updateBlockDraft = (
    blockId: string,
    updater: (block: GridBlock) => GridBlock,
  ) => {
    setNotebook((current) => {
      const next = {
        ...current,
        pages: current.pages.map((page) => ({
          ...page,
          blocks: page.blocks.map((block) =>
            block.id === blockId ? updater(block) : block,
          ),
        })),
      };
      notebookRef.current = next;
      return next;
    });
  };

  const drawingPoint = (
    event: ReactPointerEvent<SVGSVGElement>,
  ): { x: number; y: number } => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
  };

  const startDrawingStroke = (
    event: ReactPointerEvent<SVGSVGElement>,
    block: DrawingBlock,
  ) => {
    if (phoneMode === "pan" || pinchRef.current) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const stroke: DrawingStroke = {
      id: uid("stroke"),
      color: drawColor,
      width: drawWidth,
      points: [drawingPoint(event)],
    };
    setDrawingStrokeId(stroke.id);
    setSelectedId(block.id);
    updateBlockDraft(block.id, (item) =>
      item.type === "drawing"
        ? { ...item, strokes: [...item.strokes, stroke] }
        : item,
    );
  };

  const continueDrawingStroke = (
    event: ReactPointerEvent<SVGSVGElement>,
    block: DrawingBlock,
  ) => {
    if (!drawingStrokeId || phoneMode === "pan" || pinchRef.current) return;
    event.stopPropagation();
    const point = drawingPoint(event);
    updateBlockDraft(block.id, (item) => {
      if (item.type !== "drawing") return item;
      return {
        ...item,
        strokes: item.strokes.map((stroke) => {
          if (stroke.id !== drawingStrokeId) return stroke;
          const previous = stroke.points.at(-1);
          if (
            previous &&
            Math.abs(previous.x - point.x) + Math.abs(previous.y - point.y) <
              0.004
          ) {
            return stroke;
          }
          return { ...stroke, points: [...stroke.points, point] };
        }),
      };
    });
  };

  const finishDrawingStroke = () => {
    if (!drawingStrokeId) return;
    setDrawingStrokeId(null);
    commit({ ...notebookRef.current }, "Drawing saved");
  };

  const toolbar = useMemo(
    () => [
      { label: "H1", command: "formatBlock", value: "h1" },
      { label: "H2", command: "formatBlock", value: "h2" },
      { label: "B", command: "bold" },
      { label: "I", command: "italic" },
      { label: "• List", command: "insertUnorderedList" },
      { label: "1. List", command: "insertOrderedList" },
      { label: "☐", command: "insertText", value: "☐ " },
    ],
    [],
  );
  const visiblePages = useMemo(() => {
    const query = pageQuery.trim().toLocaleLowerCase();
    if (!query) return notebook.pages;
    return notebook.pages.filter((page) => {
      const searchable = [
        page.title,
        ...page.blocks.map((block) =>
          block.type === "rich-text"
            ? block.html.replace(/<[^>]+>/g, " ")
            : block.type,
        ),
      ]
        .join(" ")
        .toLocaleLowerCase();
      return searchable.includes(query);
    });
  }, [notebook.pages, pageQuery]);

  return (
    <main className="gridnote-shell">
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="brand-row">
          <span className="brand-mark" aria-hidden="true" />
          <div>
            <strong>Gridnote</strong>
            <small>Portable notebook</small>
          </div>
          <button
            className="icon-button close-sidebar"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close pages"
          >
            ×
          </button>
        </div>
        <label className="notebook-title-label">
          Notebook
          <input
            value={notebook.title}
            onChange={(event) =>
              setNotebook({ ...notebook, title: event.target.value })
            }
            onBlur={() =>
              commit({ ...notebookRef.current }, "Notebook renamed")
            }
          />
        </label>
        <div className="sidebar-heading">Pages</div>
        <label className="page-search">
          <span className="sr-only">Search pages</span>
          <input
            type="search"
            value={pageQuery}
            onChange={(event) => setPageQuery(event.target.value)}
            placeholder="Search pages…"
          />
        </label>
        <nav className="page-list" aria-label="Notebook pages">
          {visiblePages.map((page) => {
            const pageIndex = notebook.pages.findIndex(
              (item) => item.id === page.id,
            );
            return (
            <div
              className={`page-row ${page.id === notebook.activePageId ? "active" : ""}`}
              key={page.id}
            >
              <button
                className="page-select"
                onClick={() => {
                  setNotebook({ ...notebook, activePageId: page.id });
                  setSelectedId(null);
                  setSidebarOpen(false);
                }}
                onDoubleClick={() => renamePage(page)}
              >
                <span>{page.title}</span>
                <small>{page.blocks.length} blocks</small>
              </button>
              <button
                className="page-order"
                onClick={() => reorderPage(page.id, -1)}
                disabled={pageIndex === 0}
                aria-label={`Move ${page.title} up`}
              >
                ↑
              </button>
              <button
                className="page-order"
                onClick={() => reorderPage(page.id, 1)}
                disabled={pageIndex === notebook.pages.length - 1}
                aria-label={`Move ${page.title} down`}
              >
                ↓
              </button>
              <button
                className="page-delete"
                onClick={() => deletePage(page.id)}
                aria-label={`Delete ${page.title}`}
              >
                ×
              </button>
            </div>
            );
          })}
          {!visiblePages.length && (
            <p className="page-empty">No matching pages</p>
          )}
        </nav>
        <button className="new-page-button" onClick={addPage}>
          + New page
        </button>
        <div className="sidebar-footer">
          <span className="status-dot" />
          <span>{status}</span>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="topbar-title">
            <button
              className="icon-button menu-button"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open pages"
            >
              ☰
            </button>
            <div>
              <input
                className="page-title-input"
                value={activePage.title}
                onChange={(event) =>
                  setNotebook({
                    ...notebook,
                    pages: notebook.pages.map((page) =>
                      page.id === activePage.id
                        ? { ...page, title: event.target.value }
                        : page,
                    ),
                  })
                }
                onBlur={() => commit({ ...notebookRef.current })}
                aria-label="Page title"
              />
              <small role="status" aria-live="polite">{status}</small>
            </div>
          </div>
          <div className="topbar-actions">
            <button onClick={undo} disabled={!past.length} aria-label="Undo">
              ↶
            </button>
            <button onClick={redo} disabled={!future.length} aria-label="Redo">
              ↷
            </button>
            <span className="toolbar-divider" />
            <button onClick={() => setZoom((value) => Math.max(0.5, value - 0.1))}>
              −
            </button>
            <span className="zoom-label">{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom((value) => Math.min(1.8, value + 0.1))}>
              +
            </button>
            <span className="toolbar-divider" />
            <button onClick={() => fileInputRef.current?.click()}>Import</button>
            <button onClick={openFolder}>Open folder</button>
            <button onClick={saveFolder}>Save folder</button>
            <button className="primary-button" onClick={exportZip}>
              Export ZIP
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip,application/zip"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importZip(file);
                event.currentTarget.value = "";
              }}
            />
          </div>
        </header>

        <div
          className="formatbar"
          aria-label={activeEditorId ? "Text formatting" : "Add content"}
        >
          <>
              <button className="primary-add" onClick={insertTextBlock}>
                + Note
              </button>
              <button onClick={() => imageInputRef.current?.click()}>
                Image
              </button>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void insertImage(file);
                  event.currentTarget.value = "";
                }}
              />
              <button onClick={insertTable}>Table</button>
              <button onClick={insertShape}>Shape</button>
              <button onClick={insertDrawing}>Draw</button>
              <button onClick={() => attachmentInputRef.current?.click()}>
                File
              </button>
              <input
                ref={attachmentInputRef}
                type="file"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void insertAttachment(file);
                  event.currentTarget.value = "";
                }}
              />
          </>
          <button
            className={formatOpen ? "active" : ""}
            aria-expanded={formatOpen}
            onClick={() => setFormatOpen((open) => !open)}
          >
            Format {formatOpen ? "−" : "+"}
          </button>
          {formatOpen && (
            <>
          <span className="toolbar-divider" />
          <label className="format-select">
            <span className="sr-only">Font</span>
            <select
              aria-label="Font"
              value={textFormat.font}
              disabled={!activeEditorId}
              onChange={(event) => {
                if (event.target.value) {
                  runFormat("fontName", event.target.value);
                }
              }}
            >
              <option value="mixed" disabled>Mixed fonts</option>
              <option value="system-ui">System</option>
              <option value="Arial">Sans</option>
              <option value="Georgia">Serif</option>
              <option value="Courier New">Mono</option>
            </select>
          </label>
          <label className="format-select">
            <span className="sr-only">Text size</span>
            <select
              aria-label="Text size"
              value={textFormat.size}
              disabled={!activeEditorId}
              onChange={(event) => {
                if (event.target.value) {
                  runFormat("fontSize", event.target.value);
                }
              }}
            >
              <option value="mixed" disabled>Mixed sizes</option>
              <option value="1">Small · 10</option>
              <option value="2">Normal · 13</option>
              <option value="3">Medium · 16</option>
              <option value="4">Large · 18</option>
              <option value="5">Title · 24</option>
            </select>
          </label>
          {toolbar.map((item) => (
            <button
              key={`${item.command}-${item.label}`}
              className={
                (item.command === "bold" && textFormat.bold === true) ||
                (item.command === "italic" && textFormat.italic === true) ||
                (item.command === "insertUnorderedList" &&
                  textFormat.unorderedList === true) ||
                (item.command === "insertOrderedList" &&
                  textFormat.orderedList === true) ||
                (item.command === "formatBlock" &&
                  textFormat.block === item.value)
                  ? "active"
                  : ""
              }
              disabled={!activeEditorId}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => runFormat(item.command, item.value)}
              aria-label={item.label}
              aria-pressed={
                item.command === "bold"
                  ? textFormat.bold === true
                  : item.command === "italic"
                    ? textFormat.italic === true
                    : item.command === "insertUnorderedList"
                      ? textFormat.unorderedList === true
                      : item.command === "insertOrderedList"
                        ? textFormat.orderedList === true
                      : item.command === "formatBlock"
                        ? textFormat.block === item.value
                        : undefined
              }
            >
              {item.label}
            </button>
          ))}
          <button
            className={textFormat.link === true ? "active" : ""}
            disabled={!activeEditorId}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => {
              const url = window.prompt("Link URL");
              if (url) runFormat("createLink", url);
            }}
          >
            Link
          </button>
              <button
                className={textFormat.marked === true ? "active mark-button" : "mark-button"}
                disabled={!activeEditorId}
                onPointerDown={(event) => event.preventDefault()}
                onClick={toggleHighlight}
                aria-pressed={textFormat.marked === true}
              >
                Mark
              </button>
              {activeEditorId && (
              <button
                className="done-editing"
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => {
                  (document.activeElement as HTMLElement | null)?.blur();
                  setActiveEditorId(null);
                }}
              >
                Done
              </button>
              )}
            </>
          )}
          <span className="toolbar-spacer" />
          <button disabled={!selectedBlock} onClick={duplicateSelected}>
            Duplicate
          </button>
          <button
            className="danger-button"
            disabled={!selectedBlock}
            onClick={deleteSelected}
          >
            Delete
          </button>
        </div>

        <div className="canvas-scroll" ref={canvasScrollRef}>
          {warningMessage && (
            <div className="recovery-banner" role="status">
              <span>{warningMessage}</span>
              <button
                onClick={() => setWarningMessage("")}
                aria-label="Dismiss warning"
              >
                ×
              </button>
            </div>
          )}
          <div
            className="canvas-scale-space"
            style={{ width: COLUMNS * CELL * zoom, height: ROWS * CELL * zoom }}
          >
            <div
              ref={canvasRef}
              className="grid-canvas"
              style={{
                width: COLUMNS * CELL,
                height: ROWS * CELL,
                transform: `scale(${zoom})`,
              }}
              onPointerDownCapture={onCanvasPointerDownCapture}
              onPointerMoveCapture={onCanvasPointerMoveCapture}
              onPointerUpCapture={onCanvasPointerEndCapture}
              onPointerCancelCapture={onCanvasPointerEndCapture}
              onPointerDown={onCanvasPointerDown}
              onPointerMove={onCanvasPointerMove}
              onPointerUp={onCanvasPointerUp}
              onPointerCancel={onCanvasPointerUp}
              aria-label="Structural note grid"
              role="application"
            >
              {activePage.blocks.map((block) => {
                const live =
                  interactionBlockId === block.id && ghost ? ghost : block;
                return (
                  <article
                    key={block.id}
                    className={`note-block block-${block.type} ${block.id === selectedId ? "selected" : ""} ${ghost?.invalid && interactionBlockId === block.id ? "invalid" : ""}`}
                    style={{
                      left: live.column * CELL,
                      top: live.row * CELL,
                      width: live.columnSpan * CELL,
                      height: live.rowSpan * CELL,
                    }}
                    tabIndex={phoneMode === "pan" ? -1 : 0}
                    aria-label={`${block.type} block, ${block.columnSpan} by ${block.rowSpan} cells`}
                    onPointerDown={(event) => {
                      if (phoneMode === "pan") return;
                      event.stopPropagation();
                      if (selectedId !== block.id) {
                        setActiveEditorId(null);
                        setTextFormat(emptyTextFormat);
                      }
                      setSelectedId(block.id);
                    }}
                    onFocus={() => setSelectedId(block.id)}
                    onKeyDown={(event) => {
                      if (event.currentTarget !== event.target) return;
                      const deltas: Record<string, [number, number]> = {
                        ArrowLeft: [-1, 0],
                        ArrowRight: [1, 0],
                        ArrowUp: [0, -1],
                        ArrowDown: [0, 1],
                      };
                      if (
                        (event.key === "Delete" ||
                          event.key === "Backspace") &&
                        selectedId === block.id
                      ) {
                        event.preventDefault();
                        deleteSelected();
                        return;
                      }
                      const delta = deltas[event.key];
                      if (!delta) return;
                      event.preventDefault();
                      moveSelectedBlockByKeyboard(
                        block,
                        delta[0],
                        delta[1],
                        event.shiftKey,
                      );
                    }}
                  >
                    <button
                      className="move-handle"
                      onPointerDown={(event) => startMove(event, block)}
                      aria-label="Move block"
                    >
                      <span>⋮⋮</span>
                      <small>
                        {block.columnSpan} × {block.rowSpan}
                      </small>
                    </button>
                    {block.type === "rich-text" ? (
                      <RichTextEditor
                        blockId={block.id}
                        html={block.html}
                        onSave={(html) => saveBlockHtml(block.id, html)}
                        onSelectionChange={rememberTextSelection}
                        onFormatChange={setTextFormat}
                      />
                    ) : block.type === "image" ? (
                      <div className="image-editor">
                        {notebook.assets.find(
                          (asset) => asset.id === block.assetId,
                        )?.dataUrl ? (
                          <img
                            src={
                              notebook.assets.find(
                                (asset) => asset.id === block.assetId,
                              )?.dataUrl
                            }
                            alt={block.alt}
                          />
                        ) : (
                          <span>Image asset missing</span>
                        )}
                        <label>
                          Alt text
                          <input
                            value={block.alt}
                            onChange={(event) => {
                              const alt = event.target.value;
                              setNotebook({
                                ...notebook,
                                pages: notebook.pages.map((page) => ({
                                  ...page,
                                  blocks: page.blocks.map((item) =>
                                    item.id === block.id &&
                                    item.type === "image"
                                      ? { ...item, alt }
                                      : item,
                                  ),
                                })),
                              });
                            }}
                            onBlur={() =>
                              commit(
                                { ...notebookRef.current },
                                "Image description saved",
                              )
                            }
                          />
                        </label>
                      </div>
                    ) : block.type === "table" ? (
                      <div className="table-editor">
                        <table>
                          <tbody>
                            {block.cells.map((row, rowIndex) => (
                              <tr key={rowIndex}>
                                {row.map((cell, columnIndex) => {
                                  const Cell = rowIndex === 0 ? "th" : "td";
                                  const editorId = `${block.id}-cell-${rowIndex}-${columnIndex}`;
                                  return (
                                    <Cell key={columnIndex}>
                                      <RichTextEditor
                                        blockId={editorId}
                                        html={cell}
                                        className="table-cell-editor"
                                        ariaLabel={`Row ${rowIndex + 1}, column ${columnIndex + 1}`}
                                        onSave={(html) =>
                                          saveEditorHtml(editorId, html)
                                        }
                                        onSelectionChange={rememberTextSelection}
                                        onFormatChange={setTextFormat}
                                      />
                                    </Cell>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : block.type === "shape" ? (
                      <div
                        className={`shape-editor shape-${block.shape}`}
                        style={{
                          backgroundColor: block.color,
                          color: contrastTextColor(block.color),
                        }}
                      >
                        <RichTextEditor
                          blockId={`${block.id}-shape`}
                          html={block.text}
                          className="shape-text"
                          ariaLabel="Shape text"
                          onSave={(html) =>
                            saveEditorHtml(`${block.id}-shape`, html)
                          }
                          onSelectionChange={rememberTextSelection}
                          onFormatChange={setTextFormat}
                        />
                        <div className="shape-controls">
                          <select
                            value={block.shape}
                            aria-label="Shape type"
                            onChange={(event) => {
                              const shape = event.target
                                .value as ShapeBlock["shape"];
                              updateBlockDraft(block.id, (item) =>
                                item.type === "shape" ? { ...item, shape } : item,
                              );
                            }}
                            onBlur={() =>
                              commit(
                                { ...notebookRef.current },
                                "Shape style saved",
                              )
                            }
                          >
                            <option value="rounded">Rounded</option>
                            <option value="circle">Circle</option>
                            <option value="note">Note</option>
                          </select>
                          <input
                            type="color"
                            value={block.color}
                            aria-label="Shape color"
                            onChange={(event) => {
                              const color = event.target.value;
                              updateBlockDraft(block.id, (item) =>
                                item.type === "shape" ? { ...item, color } : item,
                              );
                            }}
                            onBlur={() =>
                              commit(
                                { ...notebookRef.current },
                                "Shape color saved",
                              )
                            }
                          />
                        </div>
                      </div>
                    ) : block.type === "attachment" ? (
                      <div className="attachment-editor">
                        <span className="attachment-editor-icon">↓</span>
                        <label>
                          Attachment label
                          <input
                            value={block.label}
                            onChange={(event) => {
                              const label = event.target.value;
                              updateBlockDraft(block.id, (item) =>
                                item.type === "attachment"
                                  ? { ...item, label }
                                  : item,
                              );
                            }}
                            onBlur={() =>
                              commit(
                                { ...notebookRef.current },
                                "Attachment label saved",
                              )
                            }
                          />
                        </label>
                        <small>
                          {
                            notebook.assets.find(
                              (asset) => asset.id === block.assetId,
                            )?.filename
                          }
                        </small>
                      </div>
                    ) : (
                      <div className="drawing-editor">
                        <svg
                          viewBox="0 0 100 100"
                          preserveAspectRatio="none"
                          aria-label="Editable freehand drawing"
                          onPointerDown={(event) =>
                            startDrawingStroke(event, block)
                          }
                          onPointerMove={(event) =>
                            continueDrawingStroke(event, block)
                          }
                          onPointerUp={finishDrawingStroke}
                          onPointerCancel={finishDrawingStroke}
                        >
                          {block.strokes.map((stroke) => (
                            <polyline
                              key={stroke.id}
                              points={stroke.points
                                .map(
                                  (point) =>
                                    `${point.x * 100},${point.y * 100}`,
                                )
                                .join(" ")}
                              fill="none"
                              stroke={stroke.color}
                              strokeWidth={stroke.width}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              vectorEffect="non-scaling-stroke"
                            />
                          ))}
                        </svg>
                        <div className="drawing-controls">
                          <label>
                            Ink
                            <input
                              type="color"
                              value={drawColor}
                              onChange={(event) =>
                                setDrawColor(event.target.value)
                              }
                            />
                          </label>
                          <label>
                            Size
                            <input
                              type="range"
                              min="1"
                              max="10"
                              value={drawWidth}
                              onChange={(event) =>
                                setDrawWidth(Number(event.target.value))
                              }
                            />
                          </label>
                          <button
                            onClick={() => {
                              updateBlockDraft(block.id, (item) =>
                                item.type === "drawing"
                                  ? {
                                      ...item,
                                      strokes: item.strokes.slice(0, -1),
                                    }
                                  : item,
                              );
                              commit(
                                { ...notebookRef.current },
                                "Last stroke removed",
                              );
                            }}
                            disabled={!block.strokes.length}
                          >
                            Undo stroke
                          </button>
                          <button
                            onClick={() => {
                              updateBlockDraft(block.id, (item) =>
                                item.type === "drawing"
                                  ? { ...item, strokes: [] }
                                  : item,
                              );
                              commit(
                                { ...notebookRef.current },
                                "Drawing cleared",
                              );
                            }}
                            disabled={!block.strokes.length}
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                    )}
                    <button
                      className="resize-handle"
                      onPointerDown={(event) => startResize(event, block)}
                      aria-label="Resize block"
                    />
                  </article>
                );
              })}
              {selection && (
                <div
                  className={`selection-rect ${collides(selection, activePage.blocks) ? "invalid" : ""}`}
                  style={{
                    left: selection.column * CELL,
                    top: selection.row * CELL,
                    width: selection.columnSpan * CELL,
                    height: selection.rowSpan * CELL,
                  }}
                >
                  {selection.columnSpan} × {selection.rowSpan}
                </div>
              )}
            </div>
          </div>
        </div>

        <nav className="mobile-tools" aria-label="Mobile tools">
          <button onClick={() => setSidebarOpen(true)}>Pages</button>
          <button
            className={phoneMode === "pan" ? "active" : ""}
            onClick={() => {
              setPhoneMode("pan");
              setStatus("Pan mode: drag with one finger");
            }}
          >
            Pan
          </button>
          <button
            className={phoneMode === "edit" ? "active" : ""}
            onClick={() => {
              setPhoneMode("edit");
              setStatus("Edit mode");
            }}
          >
            Edit
          </button>
          <button
            onClick={insertTextBlock}
          >
            + Note
          </button>
          <button onClick={exportZip}>Export</button>
        </nav>
      </section>
    </main>
  );
}
