/**
 * Decision D1 §2 (16.11.2026, plan/decisions-2026-11-16-d1.md): the vault
 * relay keeps a space nobody read or wrote for 90 days, the same retention as
 * the share server's rooms (decision 5.16: one public service, one privacy
 * policy). Before, the relay said 180. This pins the default on both hosts,
 * the deployed Worker's variable, and every document that states it, to the
 * collab number, and runs a sweep at the default.
 * @vitest-environment node
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import type { IncomingMessage, ServerResponse } from "node:http";

const ROOT = resolve(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createVaultRelay, memoryStore } = require("../../sync-server/vault-relay.js") as {
  createVaultRelay: (o?: Record<string, unknown>) => { handle(req: IncomingMessage, res: ServerResponse): boolean; sweep(): Promise<unknown>; close(): void };
  memoryStore: () => unknown;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createServer } = require("node:http") as typeof import("node:http");
const DAY = 86_400_000;

afterEach(() => vi.restoreAllMocks());

describe("relay retention is the share server's: 90 days (D1 §2)", () => {
  const collab = Number(/retentionDays = (\d+),/.exec(read("sync-server/collab-server.mjs"))![1]);
  const collabToml = Number(/^RETENTION_DAYS = "(\d+)"$/m.exec(read("edge-workers/collab/wrangler.toml"))![1]);

  it("the collab number is 90 on both of its hosts", () => {
    expect(collab).toBe(90);
    expect(collabToml).toBe(90);
  });

  it("the relay's default (Node and Worker) and its deployed variable equal it", () => {
    expect(Number(/VAULT_RELAY_RETENTION_DAYS, (\d+)\)/.exec(read("sync-server/vault-relay.js"))![1])).toBe(collab);
    expect(Number(/num\(e\.VAULT_RELAY_RETENTION_DAYS, (\d+)\)/.exec(read("edge-workers/vault-relay/worker.mjs"))![1])).toBe(collab);
    expect(Number(/^VAULT_RELAY_RETENTION_DAYS = "(\d+)"$/m.exec(read("edge-workers/vault-relay/wrangler.toml"))![1])).toBe(collab);
  });

  it("every page that states the relay's retention says 90, and none says 180", () => {
    const pages = {
      "docs/legal/ropa.md": "for 90 days is deleted",
      "docs/src/content/docs/sync/two-clicks.md": "for 90 days",
      "docs/src/content/docs/he/sync/two-clicks.md": "90 יום",
      "docs/src/content/docs/sync/classroom.md": "for 90 days",
      "docs/src/content/docs/he/sync/classroom.md": "90 יום",
    };
    for (const [f, s] of Object.entries(pages)) {
      expect(read(f), f).toContain(s);
      expect(read(f), f).not.toMatch(/\b180 (days|יום)/);
    }
  });

  it("at the default (no option, no variable), a space untouched for 91 days is swept and one read 89 days ago is kept", async () => {
    const saved = process.env.VAULT_RELAY_RETENTION_DAYS;
    delete process.env.VAULT_RELAY_RETENTION_DAYS;
    let now = Date.UTC(2026, 0, 1);
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const r = createVaultRelay({ store: memoryStore() });
    const server = createServer((req, res) => {
      if (!r.handle(req, res)) (res.statusCode = 404), res.end();
    });
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const tok = (n: number) => `retention_${String(n).padStart(4, "0")}_${"x".repeat(24)}`;
    const call = (method: string, t: string, body?: string) => fetch(`${origin}/v1/vault/o/a`, { method, body, headers: { authorization: `Bearer ${t}` } });
    try {
      expect((await call("PUT", tok(1), "kept")).status).toBe(201);
      expect((await call("PUT", tok(2), "forgotten")).status).toBe(201);
      now += 2 * DAY;
      expect((await call("GET", tok(1))).status).toBe(200);
      now += 89 * DAY; // tok(1) last read 89 days ago, tok(2) untouched for 91
      await r.sweep();
      expect((await call("GET", tok(1))).status).toBe(200);
      expect((await call("GET", tok(2))).status).toBe(404);
    } finally {
      if (saved !== undefined) process.env.VAULT_RELAY_RETENTION_DAYS = saved;
      r.close();
      await new Promise<void>((ok) => server.close(() => ok()));
    }
  });
});
