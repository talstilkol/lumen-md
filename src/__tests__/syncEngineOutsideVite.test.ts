/**
 * Plan W1.8: the sync benchmark (`npm run bench:sync`, scripts/bench/sync-first.ts)
 * runs the real encrypted sync engine under tsx, outside Vite. The engine
 * must therefore load without the i18n module, whose import.meta.glob only
 * Vite provides: before this fix, conflict.ts imported the e2ee strings (and
 * so src/i18n/index.ts) at the top, and the benchmark died at startup with
 * "import.meta.glob is not a function" before measuring anything.
 *
 * The check loads the engine and the WebDAV provider in a plain Node process
 * with tsx, as the benchmark does.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(__dirname, "../..");

describe("the sync engine outside Vite (bench:sync)", () => {
  it("loads under tsx without reaching import.meta.glob", () => {
    const urls = ["src/sync/e2ee/engine.ts", "src/sync/e2ee/providers/webdav.ts", "src/sync/e2ee/conflict.ts"].map((p) => pathToFileURL(resolve(ROOT, p)).href);
    const code = `for (const u of ${JSON.stringify(urls)}) await import(u); console.log("loaded");`;
    const r = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], { cwd: ROOT, encoding: "utf8", timeout: 60_000 });
    expect(r.stderr).not.toMatch(/import\.meta\.glob/);
    expect(`${r.stdout}${r.stderr}`).toContain("loaded");
    expect(r.status).toBe(0);
  }, 90_000);
});
