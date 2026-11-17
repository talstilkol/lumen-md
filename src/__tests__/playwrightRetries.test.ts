/**
 * Plan 0.5 / W10.A5 — no Playwright config retries a test: a retry turns a
 * flake into a pass. Every playwright*.config.ts at the root says
 * `retries: 0` and nothing else (the W10.Z3 re-review found
 * playwright.gifs.config.ts at `retries: 1` on verify/train-7).
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "..", "..");
const configs = readdirSync(ROOT).filter((f) => /^playwright(\.[\w-]+)?\.config\.ts$/.test(f));

/** Every Playwright config in the tree, not only the root ones (sr/, scripts/safari/ …): "0 retries in every config". */
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "src-tauri", "vendor", "coverage", "test-results", "playwright-report"]);
function walk(dir: string, rel = ""): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) out.push(...walk(join(dir, e.name), rel ? `${rel}/${e.name}` : e.name));
    } else if (/playwright[\w.-]*\.config\.(?:ts|mts|mjs|js|cjs)$/.test(e.name) && rel) out.push(`${rel}/${e.name}`);
  }
  return out;
}
const nested = walk(ROOT);

describe("Playwright retries (0.5, W10.A5)", () => {
  it("finds the configs", () => {
    expect(configs).toEqual(expect.arrayContaining(["playwright.config.ts", "playwright.gifs.config.ts"]));
  });

  it.each(configs)("%s: retries is 0, set once (or taken from a config checked here)", (f) => {
    const src = readFileSync(join(ROOT, f), "utf8");
    const values = [...src.matchAll(/^\s*retries\s*:\s*([^,\n]+)/gm)].map((m) => m[1]!.trim());
    if (values.length) return expect(values, f).toEqual(["0"]);
    // No key of its own: it must spread a root playwright config, which this test checks too.
    const base = /import (\w+) from "\.\/(playwright(?:\.[\w-]+)?\.config)"/.exec(src);
    expect(base, `${f} sets no retries and spreads no checked config`).not.toBeNull();
    expect(configs).toContain(`${base![2]}.ts`);
    expect(src).toContain(`...${base![1]},`);
  });

  it("finds the configs below the root too", () => {
    expect(nested).toEqual(expect.arrayContaining(["sr/playwright.sr.config.ts", "scripts/safari/playwright.browserstack.config.mjs"]));
  });

  it.each(nested)("%s: retries is 0 and set once", (f) => {
    const src = readFileSync(join(ROOT, f), "utf8");
    const values = [...src.matchAll(/^\s*retries\s*:\s*([^,\n]+)/gm)].map((m) => m[1]!.trim());
    expect(values, f).toEqual(["0"]);
  });

  it("no npm script passes --retries to Playwright", () => {
    const scripts = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;
    const bad = Object.entries(scripts).filter(([, cmd]) => /--retries[= ]+[1-9]/.test(cmd)).map(([k]) => k);
    expect(bad).toEqual([]);
  });
});
