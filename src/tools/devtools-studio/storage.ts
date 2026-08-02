import { openDB } from "idb";

const STORAGE_KEY = "minitools.devtools.snippets";
const DB_NAME = "minitools";
const STORE_NAME = "devtools";

export type Snippet = {
  id: string;
  name: string;
  tool: string;
  content: string;
  updatedAt: string;
};

function fromLocalStorage(): Snippet[] {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value ? JSON.parse(value) as Snippet[] : [];
  } catch {
    return [];
  }
}

export async function loadSnippets(): Promise<Snippet[]> {
  try {
    const database = await openDB(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      },
    });
    return (await database.get(STORE_NAME, STORAGE_KEY) as Snippet[] | undefined) ?? fromLocalStorage();
  } catch {
    return fromLocalStorage();
  }
}

export async function saveSnippets(snippets: Snippet[]): Promise<void> {
  try {
    const database = await openDB(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      },
    });
    await database.put(STORE_NAME, snippets, STORAGE_KEY);
  } catch {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snippets));
  }
}

export async function clearSnippetStorage(): Promise<void> {
  try {
    const database = await openDB(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      },
    });
    await database.delete(STORE_NAME, STORAGE_KEY);
  } finally {
    localStorage.removeItem(STORAGE_KEY);
  }
}
