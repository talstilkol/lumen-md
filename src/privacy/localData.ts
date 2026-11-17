/**
 * What is stored on this device (plan W13.P4; GDPR art. 17 and Israel's
 * Privacy Protection Law amendment 13: a right to erasure that a local app
 * must let the person use themselves). Each category, with its size, can be
 * deleted on its own, and the report can be saved as JSON:
 *
 *   notes     the vault in the browser's private file system (OPFS)
 *   history   saved versions (IndexedDB)
 *   models    downloaded AI models (Cache Storage / OPFS model folders)
 *   caches    other cached files (fonts, tiles, the app shell)
 *   keyring   encryption keys and secrets — deleting it crypto-shreds an
 *             encrypted vault: any copy of it left anywhere can no longer
 *             be decrypted
 *   settings  preferences (localStorage)
 */

import { isOpfsSupported, opfsRoot, removeOpfsTop } from "../storage/vault/opfs";

export type DataCategory = "notes" | "history" | "models" | "caches" | "keyring" | "settings";
export const CATEGORIES: readonly DataCategory[] = ["notes", "history", "models", "caches", "keyring", "settings"];

export interface CacheLike {
  keys(): Promise<string[]>;
  delete(name: string): Promise<boolean>;
  size?(name: string): Promise<number>;
}
export interface IdbLike {
  databases(): Promise<Array<{ name?: string }>>;
  deleteDatabase(name: string): Promise<void>;
}
export interface DirLike {
  entries(): AsyncIterable<[string, { kind: "file" | "directory"; getFile?: () => Promise<{ size: number }> } & Partial<DirLike>]>;
  removeEntry(name: string, o?: { recursive?: boolean }): Promise<void>;
}
export interface StorageDeps {
  estimate(): Promise<{ usage?: number; quota?: number; usageDetails?: Record<string, number> }>;
  caches?: CacheLike;
  idb?: IdbLike;
  opfs?: () => Promise<DirLike>;
  local?: Storage;
}

const MODEL_CACHE = /transformers|webllm|web-llm|onnx|model|whisper|piper|kokoro|tvmjs|mlc/i;
const MODEL_DIR = /^(models?|\.?model-cache|hf-cache)$/i;
const HISTORY_DB = /history|versions/i;
const KEY_DB = /keyring|keys|e2ee|vault-key|secret/i;
const KEY_LOCAL = /key|token|secret|password|credential|passphrase|keyring|jwt/i;

export interface CategoryReport {
  category: DataCategory;
  bytes: number | null;
  items: string[];
}
export interface InventoryReport {
  created: string;
  usage: number | null;
  quota: number | null;
  categories: CategoryReport[];
}

async function dirSize(dir: DirLike): Promise<number> {
  let n = 0;
  for await (const [, h] of dir.entries()) {
    if (h.kind === "file") n += (await h.getFile?.())?.size ?? 0;
    else if (h.entries) n += await dirSize(h as DirLike);
  }
  return n;
}

const utf16 = (s: string) => s.length * 2;

/** The inventory: every category with its size (null when the platform can't say) and what it holds. */
export async function inventory(deps: StorageDeps, now = new Date()): Promise<InventoryReport> {
  const cats: Record<DataCategory, CategoryReport> = Object.fromEntries(CATEGORIES.map((c) => [c, { category: c, bytes: 0, items: [] as string[] }])) as Record<DataCategory, CategoryReport>;
  if (deps.opfs) {
    const root = await deps.opfs();
    for await (const [name, h] of root.entries()) {
      const size = h.kind === "file" ? ((await h.getFile?.())?.size ?? 0) : h.entries ? await dirSize(h as DirLike) : 0;
      const c = MODEL_DIR.test(name) ? cats.models : cats.notes;
      c.bytes = (c.bytes ?? 0) + size;
      c.items.push(name);
    }
  }
  if (deps.caches) {
    for (const name of await deps.caches.keys()) {
      const c = MODEL_CACHE.test(name) ? cats.models : cats.caches;
      c.items.push(name);
      const size = deps.caches.size ? await deps.caches.size(name) : null;
      c.bytes = size === null || c.bytes === null ? null : c.bytes + size;
    }
  }
  if (deps.idb) {
    for (const { name } of await deps.idb.databases()) {
      if (!name) continue;
      const c = KEY_DB.test(name) ? cats.keyring : HISTORY_DB.test(name) ? cats.history : cats.notes;
      c.items.push(`indexedDB:${name}`);
    }
    // IndexedDB sizes per database aren't exposed; the browser's own total is (usageDetails.indexedDB).
    const est = await deps.estimate();
    const idbTotal = est.usageDetails?.indexedDB;
    for (const c of [cats.history, cats.keyring]) if (c.items.some((i) => i.startsWith("indexedDB:"))) c.bytes = idbTotal === undefined ? null : c.bytes;
    if (idbTotal !== undefined && cats.history.items.length) cats.history.bytes = idbTotal;
  }
  if (deps.local) {
    for (let i = 0; i < deps.local.length; i++) {
      const k = deps.local.key(i)!;
      const c = KEY_LOCAL.test(k) ? cats.keyring : cats.settings;
      c.items.push(`localStorage:${k}`);
      if (c.bytes !== null) c.bytes += utf16(k) + utf16(deps.local.getItem(k) ?? "");
    }
  }
  const est = await deps.estimate().catch(() => ({}) as { usage?: number; quota?: number });
  return { created: now.toISOString(), usage: est.usage ?? null, quota: est.quota ?? null, categories: CATEGORIES.map((c) => cats[c]) };
}

/** Deletes one category (or all). Returns what was removed. */
export async function wipe(category: DataCategory | "all", deps: StorageDeps): Promise<string[]> {
  const removed: string[] = [];
  const want = (c: DataCategory) => category === "all" || category === c;
  if (deps.opfs && (want("notes") || want("models"))) {
    const gone = await removeOpfsTop(await deps.opfs(), (name) => (MODEL_DIR.test(name) ? want("models") : want("notes")));
    for (const name of gone) removed.push(`opfs:${name}`);
  }
  if (deps.caches) {
    for (const name of await deps.caches.keys()) {
      const isModel = MODEL_CACHE.test(name);
      if ((isModel && want("models")) || (!isModel && want("caches"))) {
        await deps.caches.delete(name);
        removed.push(`cache:${name}`);
      }
    }
  }
  if (deps.idb) {
    for (const { name } of await deps.idb.databases()) {
      if (!name) continue;
      const c: DataCategory = KEY_DB.test(name) ? "keyring" : HISTORY_DB.test(name) ? "history" : "notes";
      if (want(c)) {
        await deps.idb.deleteDatabase(name);
        removed.push(`indexedDB:${name}`);
      }
    }
  }
  if (deps.local) {
    const keys: string[] = [];
    for (let i = 0; i < deps.local.length; i++) keys.push(deps.local.key(i)!);
    for (const k of keys) {
      const c: DataCategory = KEY_LOCAL.test(k) ? "keyring" : "settings";
      if (want(c)) {
        deps.local.removeItem(k);
        removed.push(`localStorage:${k}`);
      }
    }
  }
  return removed;
}

/** The report as a JSON file's text. */
export function reportJson(r: InventoryReport): string {
  return JSON.stringify({ format: "lumen-local-data/1", ...r }, null, 2) + "\n";
}

/** The browser's own storage, as StorageDeps. */
export function browserStorage(): StorageDeps {
  const cs = globalThis.caches;
  const idb = globalThis.indexedDB as (IDBFactory & { databases?: () => Promise<Array<{ name?: string }>> }) | undefined;
  return {
    estimate: async () => (await navigator.storage?.estimate?.()) ?? {},
    caches: cs && {
      keys: () => cs.keys(),
      delete: (n) => cs.delete(n),
      size: async (n) => {
        let total = 0;
        const c = await cs.open(n);
        for (const req of await c.keys()) total += (await (await c.match(req))?.blob())?.size ?? 0;
        return total;
      },
    },
    idb: idb?.databases && {
      databases: () => idb.databases!(),
      deleteDatabase: (n) =>
        new Promise<void>((ok, fail) => {
          const r = idb.deleteDatabase(n);
          r.onsuccess = () => ok();
          r.onerror = () => fail(r.error);
          r.onblocked = () => ok();
        }),
    },
    opfs: isOpfsSupported() ? async () => (await opfsRoot()) as unknown as DirLike : undefined,
    local: globalThis.localStorage,
  };
}
