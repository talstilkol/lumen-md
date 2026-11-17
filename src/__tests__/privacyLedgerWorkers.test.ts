/**
 * Plan W13.P2 — the privacy ledger covers every worker, found by what it is
 * (what starts it, what its built file does), not by its file name. The
 * Argon2id worker (argon2Worker.ts) used to escape: the suite only looked
 * at *.worker.ts.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error plain JavaScript
import { BRIDGE_MARKER, builtWorkerGaps, isWorkerBundle, workerSourceGaps, workerSources } from "../../scripts/lib/workerLedgerScan.mjs";
import { LEDGER_CHANNEL } from "../ai/workerLedger";

const ROOT = join(__dirname, "../..");

function fakeDist(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "dist-"));
  mkdirSync(join(dir, "assets"));
  for (const [name, js] of Object.entries(files)) writeFileSync(join(dir, "assets", name), js);
  return dir;
}

describe("built workers, by content (acceptance)", () => {
  it("fails on a fake argon2.worker.js that calls fetch with no ledger bridge", () => {
    const dist = fakeDist({ "argon2.worker.js": 'self.onmessage=async e=>{const r=await fetch("https://example.org/x");self.postMessage(await r.text())};' });
    try {
      const r = builtWorkerGaps(dist);
      expect(r.workers).toBe(1);
      expect(r.gaps.map((g: { file: string }) => g.file)).toEqual(["dist/assets/argon2.worker.js"]);
    } finally {
      rmSync(dist, { recursive: true, force: true });
    }
  });

  it("finds a worker whatever its name, passes one with the bridge, and ignores page code and silent workers", () => {
    const dist = fakeDist({
      "a-Bx91.js": 'globalThis.addEventListener("message",e=>{new WebSocket("wss://x")});',
      "b-77.js": `const c=new BroadcastChannel("${BRIDGE_MARKER}");self.onmessage=()=>fetch("/m.bin");`,
      "index-1.js": 'document.body.onclick=()=>fetch("/api");',
      "hash-2.js": "self.onmessage=e=>self.postMessage(e.data*2);",
      "classic-3.js": 'importScripts("https://cdn.example/lib.js");',
    });
    try {
      const r = builtWorkerGaps(dist);
      expect(r.workers).toBe(4);
      expect(r.gaps.map((g: { file: string }) => g.file)).toEqual(["dist/assets/a-Bx91.js", "dist/assets/classic-3.js"]);
    } finally {
      rmSync(dist, { recursive: true, force: true });
    }
    expect(builtWorkerGaps(join(tmpdir(), "no-such-dist-w13p2"))).toBeNull();
    expect(isWorkerBundle('document.addEventListener("message",f)')).toBe(false);
  });

  it("the marker is the bridge's real channel name, so a minified build keeps it", () => {
    expect(BRIDGE_MARKER).toBe(LEDGER_CHANNEL);
  });
});

describe("worker sources, by what starts them", () => {
  it("argon2Worker.ts is found through the new Worker(new URL(…)) that starts it, and carries the bridge", () => {
    const sources = workerSources(ROOT).map((s: { file: string }) => s.file);
    expect(sources).toContain("src/sync/e2ee/primitives/lib/argon2Worker.ts");
    expect(sources.length).toBeGreaterThanOrEqual(24);
    expect(readFileSync(join(ROOT, "src/sync/e2ee/primitives/lib/argon2Worker.ts"), "utf8").split("\n").find((l) => l.startsWith("import "))).toBe('import "../../../../ai/workerLedgerInstall";');
    expect(workerSourceGaps(ROOT)).toEqual([]);
  });

  it("npm run privacy:ledger fails on a worker without the bridge, whatever its name, and passes on this tree", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ledger-"));
    try {
      for (const d of ["scripts", "src"]) cpSync(join(ROOT, d), join(tmp, d), { recursive: true, filter: (p) => !p.includes("__tests__") && !p.includes("node_modules") });
      const run = () => {
        try {
          execFileSync(process.execPath, [join(tmp, "scripts/privacy-ledger-check.mjs"), "--root", tmp], { stdio: "pipe" });
          return 0;
        } catch (e) {
          return (e as { status: number }).status;
        }
      };
      expect(run()).toBe(0);
      const w = join(tmp, "src/sync/e2ee/primitives/lib/argon2Worker.ts");
      writeFileSync(w, readFileSync(w, "utf8").replace('import "../../../../ai/workerLedgerInstall";\n', ""));
      expect(run()).toBe(1);
      writeFileSync(join(tmp, "src/sync/e2ee/primitives/lib/argon2Worker.ts"), readFileSync(join(ROOT, "src/sync/e2ee/primitives/lib/argon2Worker.ts"), "utf8"));
      mkdirSync(join(tmp, "dist/assets"), { recursive: true });
      writeFileSync(join(tmp, "dist/assets/argon2.worker.js"), 'self.onmessage=()=>fetch("https://evil.example");');
      expect(run()).toBe(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
