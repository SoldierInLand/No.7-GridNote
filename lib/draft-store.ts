import type { Notebook } from "./notebook-types";

const DRAFT_KEY = "gridnote-core-draft";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("gridnote", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveDraft(notebook: Notebook) {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction("drafts", "readwrite");
    transaction.objectStore("drafts").put(notebook, DRAFT_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

export async function loadDraft(): Promise<Notebook | undefined> {
  const database = await openDatabase();
  const draft = await new Promise<Notebook | undefined>((resolve, reject) => {
    const request = database
      .transaction("drafts", "readonly")
      .objectStore("drafts")
      .get(DRAFT_KEY);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return draft;
}
