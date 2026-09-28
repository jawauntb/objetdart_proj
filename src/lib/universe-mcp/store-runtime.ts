// The one place the universe touches a disk. Everything else takes an injected
// io; this builds the real one. An unwritable directory means memory only.

import { createStore } from "@/lib/universe-mcp/store";
import type { Store, StoreIo } from "@/lib/universe-mcp/store";

export type PersistenceMode = "volume" | "disk" | "memory";

type G = { __universeStore?: { store: Store; mode: PersistenceMode } };

export function dataDirFor(env: Record<string, string | undefined>): { dir: string; mode: PersistenceMode } {
  if (env.UNIVERSE_DATA_DIR) return { dir: env.UNIVERSE_DATA_DIR, mode: "volume" };
  if (env.RAILWAY_VOLUME_MOUNT_PATH) return { dir: env.RAILWAY_VOLUME_MOUNT_PATH, mode: "volume" };
  return { dir: "./.universe-data", mode: "disk" };
}

export function makeFileIo(fs: typeof import("node:fs"), path: typeof import("node:path"), dir: string): StoreIo | null {
  const file = path.join(dir, "universe.json");
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
  } catch {
    return null;
  }
  return {
    read: () => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null),
    write: (s) => {
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, s);
      fs.renameSync(tmp, file);
    },
  };
}

export function getUniverseStore(env: Record<string, string | undefined> = process.env): Store {
  const g = globalThis as unknown as G;
  if (g.__universeStore) return g.__universeStore.store;
  let mode: PersistenceMode = "memory";
  let io: StoreIo = (() => {
    let mem: string | null = null;
    return { read: () => mem, write: (s: string) => { mem = s; } };
  })();
  try {
    // required lazily so importing the tool registry never needs node built-ins
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const where = dataDirFor(env);
    const fileIo = makeFileIo(fs, path, where.dir);
    if (fileIo) { io = fileIo; mode = where.mode; }
  } catch {
    mode = "memory";
  }
  const store = createStore({ io, now: Date.now });
  g.__universeStore = { store, mode };
  try { process.on("exit", () => store.flush()); } catch { /* not a node process */ }
  return store;
}

export function persistenceMode(): PersistenceMode {
  return (globalThis as unknown as G).__universeStore?.mode ?? "memory";
}

export function persistenceText(mode: PersistenceMode = persistenceMode()): string {
  if (mode === "volume") return "Worlds and inhabitants are written to a mounted volume and survive restarts and redeploys.";
  if (mode === "disk") return "Worlds and inhabitants are written to the server's local disk. They survive restarts but not redeploys, because no volume is mounted.";
  return "Worlds and inhabitants are held in memory only and are lost when the server restarts.";
}
