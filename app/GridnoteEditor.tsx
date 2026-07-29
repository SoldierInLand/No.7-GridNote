"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import JSZip from "jszip";
import type {
  AssetRef,
  GridBlock,
  ImageBlock,
  Notebook,
  NotebookPage,
} from "@/lib/types";
import {
  cellsToRect,
  collides,
  createBlock,
  moveBlock,
  resizeBlock,
} from "@/lib/grid.mjs";
import {
  createPortableFiles,
  notebookFromPortableHtml,
  sanitizeRichText,
} from "@/lib/portable.mjs";

const CELL = 32;
const COLUMNS = 40;
const ROWS = 30;
const DRAFT_KEY = "gridnote-core-draft";

const initialNotebook: Notebook = {
  id: "gridnote-welcome",
  title: "Field Notes",
  activePageId: "page-garden",
  updatedAt: "",
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
          html: "<h3>Try it</h3><p>☐ Select this block</p><p>☐ Drag its top handle</p><p>☐ Resize from the corner</p>",
        },
      ],
    },
    { id: "page-reading", title: "Reading list", blocks: [] },
  ],
};

type Rect = {
  column: number;
  row: number;
  columnSpan: number;
  rowSpan: number;
};

type Interaction =
  | { kind: "create"; start: { column: number; row: number } }
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

function uid(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function openDraftDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("gridnote", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("drafts");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveDraft(notebook: Notebook) {
  const database = await openDraftDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction("drafts", "readwrite");
    transaction.objectStore("drafts").put(notebook, DRAFT_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

async function loadDraft(): Promise<Notebook | undefined> {
  const database = await openDraftDatabase();
  const result = await new Promise<Notebook | undefined>((resolve, reject) => {
    const request = database
      .transaction("drafts", "readonly")
      .objectStore("drafts")
      .get(DRAFT_KEY);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return result;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

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
    const timer = window.setTimeout(() => {
      saveDraft(notebook)
        .then(() => setStatus("Saved locally"))
        .catch(() => setStatus("Could not save locally"));
    }, 450);
    return () => window.clearTimeout(timer);
  }, [notebook]);

  const activePage =
    notebook.pages.find((page) => page.id === notebook.activePageId) ??
    notebook.pages[0];

  const selectedBlock = activePage?.blocks.find(
    (block) => block.id === selectedId,
  );

  const commit = useCallback((next: Notebook, message = "Saved locally") => {
    setPast((items) => [...items.slice(-39), notebookRef.current]);
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
      setFuture((nextItems) => [notebookRef.current, ...nextItems].slice(0, 40));
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
      setPast((previousItems) => [...previousItems, notebookRef.current]);
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
    if (event.button !== 0 || event.target !== canvasRef.current) return;
    const cell = pointToCell(event.clientX, event.clientY);
    setSelectedId(null);
    setSelection({ ...cell, columnSpan: 1, rowSpan: 1 });
    setInteraction({ kind: "create", start: cell });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onCanvasPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!interaction) return;
    if (interaction.kind === "create") {
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
        column: Math.max(0, interaction.startColumn + deltaColumn),
        row: Math.max(0, interaction.startRow + deltaRow),
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
        columnSpan: Math.max(1, interaction.startColumnSpan + deltaColumn),
        rowSpan: Math.max(1, interaction.startRowSpan + deltaRow),
      };
      setGhost({
        ...candidate,
        invalid: collides(candidate, activePage.blocks, block.id),
      });
    }
  };

  const onCanvasPointerUp = () => {
    if (!interaction) return;
    if (interaction.kind === "create" && selection) {
      if (!collides(selection, activePage.blocks)) {
        const block = createBlock({
          id: uid("block"),
          ...selection,
          html: "<p>Start writing…</p>",
        }) as GridBlock;
        updateActivePage(
          (page) => ({ ...page, blocks: [...page.blocks, block] }),
          "Block created",
        );
        setSelectedId(block.id);
      } else {
        setStatus("Those cells are already occupied");
      }
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

  const startMove = (
    event: ReactPointerEvent<HTMLButtonElement>,
    block: GridBlock,
  ) => {
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

  const runFormat = (command: string, value?: string) => {
    document.execCommand(command, false, value);
    const editor = document.querySelector<HTMLElement>(
      `[data-editor-id="${selectedId}"]`,
    );
    if (editor && selectedId) saveBlockHtml(selectedId, editor.innerHTML);
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

  const exportZip = async () => {
    setStatus("Preparing portable notebook…");
    const files = createPortableFiles(notebook);
    const zip = new JSZip();
    zip.file("index.html", files.html);
    zip.file("styles.css", files.css);
    zip.file("script.js", files.js);
    const assetFolder = zip.folder("assets");
    for (const asset of files.assets) {
      const base64 = asset.dataUrl?.split(",")[1];
      if (base64) assetFolder?.file(asset.filename, base64, { base64: true });
    }
    const blob = await zip.generateAsync({ type: "blob" });
    downloadBlob(blob, `${notebook.title.replace(/[^\w-]+/g, "-")}.zip`);
    setStatus("Portable ZIP downloaded");
  };

  const saveFolder = async () => {
    const picker = (
      window as Window & {
        showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
      }
    ).showDirectoryPicker;
    if (!picker) {
      setStatus("Folder saving is unavailable here; use Export ZIP");
      return;
    }
    const directory = await picker();
    const files = createPortableFiles(notebook);
    for (const [name, content] of Object.entries({
      "index.html": files.html,
      "styles.css": files.css,
      "script.js": files.js,
    })) {
      const handle = await directory.getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
    }
    const assetsDirectory = await directory.getDirectoryHandle("assets", {
      create: true,
    });
    for (const asset of files.assets) {
      if (!asset.dataUrl) continue;
      const handle = await assetsDirectory.getFileHandle(asset.filename, {
        create: true,
      });
      const writable = await handle.createWritable();
      await writable.write(await (await fetch(asset.dataUrl)).blob());
      await writable.close();
    }
    setStatus("Portable folder saved");
  };

  const hydrateFolderAssets = async (
    imported: Notebook,
    directory: FileSystemDirectoryHandle,
  ) => {
    const assetsDirectory = await directory.getDirectoryHandle("assets");
    const assets = await Promise.all(
      imported.assets.map(async (asset) => {
        try {
          const file = await (
            await assetsDirectory.getFileHandle(asset.filename)
          ).getFile();
          return {
            ...asset,
            dataUrl: await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result));
              reader.onerror = () => reject(reader.error);
              reader.readAsDataURL(file);
            }),
          };
        } catch {
          return asset;
        }
      }),
    );
    return { ...imported, assets };
  };

  const openFolder = async () => {
    const picker = (
      window as Window & {
        showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
      }
    ).showDirectoryPicker;
    if (!picker) {
      setStatus("Folder opening is unavailable here; import a ZIP instead");
      return;
    }
    try {
      const directory = await picker();
      const file = await (await directory.getFileHandle("index.html")).getFile();
      const parsed = notebookFromPortableHtml(await file.text()) as Notebook;
      const imported = await hydrateFolderAssets(parsed, directory);
      setPast((items) => [...items, notebookRef.current]);
      setFuture([]);
      notebookRef.current = imported;
      setNotebook(imported);
      setSelectedId(null);
      setStatus(`Opened ${imported.title}`);
    } catch (error) {
      if ((error as DOMException)?.name === "AbortError") return;
      setStatus(
        error instanceof Error ? error.message : "Could not open that folder",
      );
    }
  };

  const importZip = async (file: File) => {
    try {
      const zip = await JSZip.loadAsync(file);
      const htmlEntry = zip.file("index.html");
      if (!htmlEntry) throw new Error("index.html is missing");
      const html = await htmlEntry.async("string");
      const parsed = notebookFromPortableHtml(html) as Notebook;
      const assets = await Promise.all(
        parsed.assets.map(async (asset) => {
          const entry = zip.file(`assets/${asset.filename}`);
          if (!entry) return asset;
          const base64 = await entry.async("base64");
          return {
            ...asset,
            dataUrl: `data:${asset.mimeType};base64,${base64}`,
          };
        }),
      );
      const imported = { ...parsed, assets };
      setPast((items) => [...items, notebookRef.current]);
      setFuture([]);
      notebookRef.current = imported;
      setNotebook(imported);
      setSelectedId(null);
      setStatus(`Imported ${imported.title}`);
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Could not import that ZIP",
      );
    }
  };

  const findImageRect = (blocks: GridBlock[]): Rect | undefined => {
    const columnSpan = 6;
    const rowSpan = 5;
    for (let row = 0; row <= ROWS - rowSpan; row += 1) {
      for (let column = 0; column <= COLUMNS - columnSpan; column += 1) {
        const candidate = { column, row, columnSpan, rowSpan };
        if (!collides(candidate, blocks)) return candidate;
      }
    }
  };

  const insertImage = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setStatus("Choose an image file");
      return;
    }
    const rect = findImageRect(activePage.blocks);
    if (!rect) {
      setStatus("This page has no open 6 × 5 area for an image");
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
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

  const toolbar = useMemo(
    () => [
      { label: "H1", command: "formatBlock", value: "h1" },
      { label: "H2", command: "formatBlock", value: "h2" },
      { label: "B", command: "bold" },
      { label: "I", command: "italic" },
      { label: "• List", command: "insertUnorderedList" },
      { label: "☐", command: "insertText", value: "☐ " },
    ],
    [],
  );

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
        <nav className="page-list" aria-label="Notebook pages">
          {notebook.pages.map((page) => (
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
                className="page-delete"
                onClick={() => deletePage(page.id)}
                aria-label={`Delete ${page.title}`}
              >
                ×
              </button>
            </div>
          ))}
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
              <small>{status}</small>
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

        <div className="formatbar" aria-label="Text formatting">
          <button onClick={() => imageInputRef.current?.click()}>+ Image</button>
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
          <span className="toolbar-divider" />
          {toolbar.map((item) => (
            <button
              key={`${item.command}-${item.label}`}
              disabled={selectedBlock?.type !== "rich-text"}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => runFormat(item.command, item.value)}
              aria-label={item.label}
            >
              {item.label}
            </button>
          ))}
          <button
            disabled={selectedBlock?.type !== "rich-text"}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => {
              const url = window.prompt("Link URL");
              if (url) runFormat("createLink", url);
            }}
          >
            Link
          </button>
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

        <div className="canvas-scroll">
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
              onPointerDown={onCanvasPointerDown}
              onPointerMove={onCanvasPointerMove}
              onPointerUp={onCanvasPointerUp}
              onPointerCancel={onCanvasPointerUp}
              aria-label="Structural note grid"
            >
              {activePage.blocks.map((block) => {
                const live =
                  interaction?.id === block.id && ghost ? ghost : block;
                return (
                  <article
                    key={block.id}
                    className={`note-block ${block.id === selectedId ? "selected" : ""} ${ghost?.invalid && interaction?.id === block.id ? "invalid" : ""}`}
                    style={{
                      left: live.column * CELL,
                      top: live.row * CELL,
                      width: live.columnSpan * CELL,
                      height: live.rowSpan * CELL,
                    }}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      setSelectedId(block.id);
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
                      <div
                        className="rich-editor"
                        data-editor-id={block.id}
                        contentEditable
                        suppressContentEditableWarning
                        dangerouslySetInnerHTML={{ __html: block.html }}
                        onBlur={(event) =>
                          saveBlockHtml(block.id, event.currentTarget.innerHTML)
                        }
                      />
                    ) : (
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
          <button onClick={() => runFormat("bold")}>Text</button>
          <button
            onClick={() => {
              setStatus("Drag across empty cells to insert a block");
            }}
          >
            + Block
          </button>
          <button onClick={exportZip}>Export</button>
        </nav>
      </section>
    </main>
  );
}
