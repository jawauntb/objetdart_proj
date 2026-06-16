import type { FieldTrace } from "@/lib/types";

const DB = "field_instrument";
const STORE = "traces";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("no idb"));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putTrace(trace: FieldTrace): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(trace);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  } catch {
    // localStorage fallback
    try {
      const all = JSON.parse(localStorage.getItem("field_traces") || "[]");
      all.push(trace);
      localStorage.setItem("field_traces", JSON.stringify(all));
    } catch {
      /* give up quietly */
    }
  }
}

export async function getTraces(): Promise<FieldTrace[]> {
  try {
    const db = await open();
    return await new Promise<FieldTrace[]>((res, rej) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => res(req.result as FieldTrace[]);
      req.onerror = () => rej(req.error);
    });
  } catch {
    try {
      return JSON.parse(localStorage.getItem("field_traces") || "[]");
    } catch {
      return [];
    }
  }
}
