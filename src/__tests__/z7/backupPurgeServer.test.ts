// @vitest-environment node
/**
 * Review Z7-M4 (#938), the server side: the backups are purged after the delete's answer, one room at a time, and
 * a backup that could not be purged is kept and tried again with the next backup round. Needs yjs and
 * @hocuspocus/server (not in the offline shim; run with vitest).
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Y from "yjs";
// @ts-expect-error — plain .mjs module without type declarations (#1304)
import { createCollabServer } from "../../../sync-server/collab-server.mjs";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});
const tmp = () => {
  const dir = mkdtempSync(join(tmpdir(), "lumen-z7m4s-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const doc = () => Y.encodeStateAsUpdate(new Y.Doc());
type Store = { save(name: string, state: Uint8Array, at?: number): void };
const rooms = (file: string) => {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return (db.prepare("SELECT name FROM documents ORDER BY name").all() as Array<{ name: string }>).map((r) => r.name);
  } finally {
    db.close();
  }
};

describe("Z7-M4: the server keeps a failed backup and tries again with the next backup round", () => {
  it("delete → purge after the answer; a busy backup survives and is purged on the next backup", async () => {
    const dir = tmp();
    const logs: string[] = [];
    const app = createCollabServer({ port: 0, host: "127.0.0.1", dataDir: dir, tokenSecret: "y".repeat(40), backupIntervalMs: 0, log: (m: string) => logs.push(m) }) as unknown as {
      store: Store;
      backup(): string;
      purgeLater(room: string): Promise<void>;
      purgesDone(): Promise<void>;
      close(): Promise<void>;
      listen(): Promise<number>;
    };
    await app.listen();
    cleanups.push(() => app.close());
    // The store's own purge, through the server's queue (the token socket path is covered in havrutaOffline).
    app.store.save("havruta-gone", doc(), Date.now());
    app.store.save("lumen-keep", doc(), Date.now());
    const a = app.backup();
    const b = app.backup();
    const holder = new DatabaseSync(b);
    holder.exec("BEGIN EXCLUSIVE");
    void app.purgeLater("havruta-gone");
    await app.purgesDone();
    holder.exec("ROLLBACK");
    holder.close();
    expect(readdirSync(join(dir, "backups")).filter((f) => f.endsWith(".sqlite")).length).toBeGreaterThanOrEqual(2);
    expect(rooms(a)).toEqual(["lumen-keep"]);
    expect(rooms(b)).toEqual(["havruta-gone", "lumen-keep"]);
    expect(logs.some((l) => /kept as they were/.test(l))).toBe(true);
    app.backup(); // the next round retries
    await app.purgesDone();
    expect(rooms(b)).toEqual(["lumen-keep"]);
  });
});
