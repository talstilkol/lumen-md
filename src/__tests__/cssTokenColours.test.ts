/**
 * The app's colour tokens are HSL triplets (`--bg: 0 0% 100%`), so a
 * stylesheet that writes `background: var(--bg)` gets no colour at all. The
 * file viewer overlay (W12.F4/F5/F7) was transparent over the editor that
 * way, and its toolbar buttons had no border; the sheet block had the same
 * slip. Every stylesheet under src/ is checked.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Every .css file under src/ (not tests). */
function stylesheets(dir = "src"): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "__tests__" ? [] : stylesheets(p);
    return p.endsWith(".css") ? [p] : [];
  });
}

describe("the app's colour tokens are used as colours", () => {
  it("no stylesheet writes an HSL-triplet token as a bare colour (var(--bg) instead of hsl(var(--bg)))", () => {
    const index = readFileSync("src/index.css", "utf8");
    // The tokens whose value is an HSL triplet (`--bg: 0 0% 100%;`).
    const triplets = [...new Set([...index.matchAll(/^\s*(--[a-z-]+):\s*\d+(?:\.\d+)?\s+\d+(?:\.\d+)?%\s+\d+(?:\.\d+)?%\s*;/gm)].map((m) => m[1]))];
    expect(triplets).toEqual(expect.arrayContaining(["--bg", "--fg", "--border", "--border-strong", "--fg-muted"]));
    const bare = new RegExp(`(?<!hsla?\\(|,\\s*)var\\((${triplets.join("|")})\\)(?![\\s]*\\/)`, "g");
    const found: string[] = [];
    for (const f of stylesheets()) {
      const css = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      for (const line of css.split("\n")) {
        // Only colour properties; a token copied into another custom property stays a triplet on purpose.
        if (!/^\s*(color|background(-color)?|border(-[a-z-]+)?|outline(-color)?|fill|stroke|caret-color|box-shadow|text-decoration-color)\s*:/.test(line)) continue;
        for (const m of line.matchAll(bare)) found.push(`${f}: ${line.trim()} (${m[1]})`);
      }
    }
    expect(found).toEqual([]);
  });

  it("the file viewer overlay has an opaque background", () => {
    const css = readFileSync("src/viewers/FileViewer.css", "utf8");
    expect(css).toMatch(/\.fv-overlay\s*\{[^}]*background:\s*hsl\(var\(--bg\)\)/);
  });
});

