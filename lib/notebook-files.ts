import JSZip from "jszip";
import {
  createPortableFiles,
  recoverNotebookFromPortableHtml,
} from "./portable.mjs";
import type { AssetRef, Notebook } from "./notebook-types";

type ImportResult = {
  notebook: Notebook;
  warnings: string[];
};

type PickerWindow = Window & {
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
};

function directoryPicker() {
  return (window as PickerWindow).showDirectoryPicker;
}

function dataUrlForFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function hydrateFolderAssets(
  notebook: Notebook,
  directory: FileSystemDirectoryHandle,
) {
  const assetsDirectory = await directory.getDirectoryHandle("assets");
  const assets = await Promise.all(
    notebook.assets.map(async (asset): Promise<AssetRef> => {
      try {
        const handle = await assetsDirectory.getFileHandle(asset.filename);
        return { ...asset, dataUrl: await dataUrlForFile(await handle.getFile()) };
      } catch {
        return asset;
      }
    }),
  );
  return { ...notebook, assets };
}

export function canUseFolders() {
  return Boolean(directoryPicker());
}

export async function exportPortableZip(
  notebook: Notebook,
  onProgress: (percent: number) => void,
) {
  const missingAssets = notebook.assets.filter((asset) => !asset.dataUrl);
  if (missingAssets.length) {
    throw new Error(
      `${missingAssets.length} asset${missingAssets.length === 1 ? " is" : "s are"} missing. Reopen the original ZIP or folder before exporting.`,
    );
  }
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
  const blob = await zip.generateAsync(
    { type: "blob", compression: "STORE" },
    ({ percent }) => onProgress(percent),
  );
  download(blob, `${notebook.title.replace(/[^\w-]+/g, "-")}.zip`);
}

export async function importPortableZip(file: File): Promise<ImportResult> {
  const zip = await JSZip.loadAsync(file);
  const htmlEntry = zip.file("index.html");
  if (!htmlEntry) throw new Error("index.html is missing");
  const recovery = recoverNotebookFromPortableHtml(
    await htmlEntry.async("string"),
  ) as ImportResult;
  const assets = await Promise.all(
    recovery.notebook.assets.map(async (asset) => {
      const entry = zip.file(`assets/${asset.filename}`);
      if (!entry) return asset;
      const base64 = await entry.async("base64");
      return {
        ...asset,
        dataUrl: `data:${asset.mimeType};base64,${base64}`,
      };
    }),
  );
  return { ...recovery, notebook: { ...recovery.notebook, assets } };
}

export async function savePortableFolder(notebook: Notebook) {
  const picker = directoryPicker();
  if (!picker) throw new Error("Folder saving is unavailable; use Export ZIP");
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
}

export async function openPortableFolder(): Promise<ImportResult> {
  const picker = directoryPicker();
  if (!picker) {
    throw new Error("Folder opening is unavailable; import a ZIP instead");
  }
  const directory = await picker();
  const file = await (await directory.getFileHandle("index.html")).getFile();
  const recovery = recoverNotebookFromPortableHtml(
    await file.text(),
  ) as ImportResult;
  return {
    ...recovery,
    notebook: await hydrateFolderAssets(recovery.notebook, directory),
  };
}

export { dataUrlForFile };
