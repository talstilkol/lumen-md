// @vitest-environment node
/**
 * Review Z7-M4 (#938): "End session" rewrote every backup to take the room out, and a backup it failed to rewrite
 * was deleted, though each backup holds every room. Now a failure (busy, disk full, read-only) keeps the file and
 * names it for a retry; only a file SQLite says is not a database is removed; VACUUM only runs with the free space
 * it needs. The server side (purge after the answer, retry with the next backup round) is in
 * backupPurgeServer.test.ts, which needs yjs and @hocuspocus/server.
 */
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error -- plain ESM module
import { openStore } from "../../../sync-server/collab/sqliteStore.mjs";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});
const tmp = () => {
  const dir = mkdtempSync(join(tmpdir(), "lumen-z7m4-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const doc = () => new Uint8Array([0, 0]); // an empty Yjs update; the store keeps bytes
type Store = {
  save(name: string, state: Uint8Array, at?: number): void;
  backup(at?: number): string;
  purgeBackups(room: string, opts?: object): { purged: number; removed: number; failed: string[]; unvacuumed: number };
  close(): void;
};
const rooms = (file: string) => {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return (db.prepare("SELECT name FROM documents ORDER BY name").all() as Array<{ name: string }>).map((r) => r.name);
  } finally {
    db.close();
  }
};

function storeWithBackups(n: number) {
  const dir = tmp();
  const store = openStore(dir, { keepBackups: 24 }) as Store;
  cleanups.push(() => store.close());
  store.save("havruta-gone", doc(), Date.now());
  store.save("lumen-keep", doc(), Date.now());
  const files = Array.from({ length: n }, (_, i) => store.backup(Date.now() + i * 1000));
  return { dir, store, files };
}

describe("Z7-M4: purgeBackups never deletes a backup it merely failed to rewrite", () => {
  it("a busy backup (another process holds a write lock) is kept, whole, and named for a retry", async () => {
    const { store, files } = storeWithBackups(3);
    const holder = new DatabaseSync(files[1]);
    holder.exec("BEGIN EXCLUSIVE");
    let r;
    try {
      r = store.purgeBackups("havruta-gone");
    } finally {
      holder.exec("ROLLBACK");
      holder.close();
    }
    expect(r.failed).toEqual([files[1].split("/").pop()]);
    expect(r.removed).toBe(0);
    expect(r.purged).toBe(2);
    for (const f of files) expect(existsSync(f), f).toBe(true);
    expect(rooms(files[1])).toEqual(["havruta-gone", "lumen-keep"]); // kept as it was
    expect(rooms(files[0])).toEqual(["lumen-keep"]);
    // The retry, once the lock is gone, takes it out.
    expect(store.purgeBackups("havruta-gone").failed).toEqual([]);
    expect(rooms(files[1])).toEqual(["lumen-keep"]);
  });

  it("any other failure while rewriting (here: a full disk on DELETE) keeps the file", () => {
    const { store, files } = storeWithBackups(2);
    const full = (file: string) => {
      const db = new DatabaseSync(file);
      return new Proxy(db, {
        get(t, k) {
          if (k === "prepare") return () => ({ run: () => { throw Object.assign(new Error("database or disk is full"), { code: "ERR_SQLITE_ERROR", errcode: 13 }); } });
          const v = Reflect.get(t, k);
          return typeof v === "function" ? v.bind(t) : v;
        },
      });
    };
    const r = store.purgeBackups("havruta-gone", { open: full });
    expect(r).toMatchObject({ purged: 0, removed: 0, failed: files.map((f) => f.split("/").pop()) });
    for (const f of files) expect(rooms(f)).toEqual(["havruta-gone", "lumen-keep"]);
  });

  it("not enough free space for VACUUM: the rows are still taken out, VACUUM is skipped and counted", () => {
    const { store, files } = storeWithBackups(2);
    const r = store.purgeBackups("havruta-gone", { freeBytes: () => 0 });
    expect(r).toEqual({ purged: 2, removed: 0, failed: [], unvacuumed: 2 });
    for (const f of files) expect(rooms(f)).toEqual(["lumen-keep"]);
  });

  it("only a file that is not a database is removed", () => {
    const { dir, store, files } = storeWithBackups(1);
    const junk = join(dir, "backups", "collab-junk.sqlite");
    writeFileSync(junk, "this is not a database, it is some text that is long enough to be read as a header");
    const r = store.purgeBackups("havruta-gone");
    expect(r).toMatchObject({ purged: 1, removed: 1, failed: [] });
    expect(existsSync(junk)).toBe(false);
    expect(existsSync(files[0])).toBe(true);
  });
});

