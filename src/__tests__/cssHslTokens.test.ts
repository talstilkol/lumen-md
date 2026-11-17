/**
 * The app's colour tokens (--bg, --fg, --border, --accent, --danger, …) are
 * HSL triplets ("220 13% 91%"), so a colour is `hsl(var(--border))`. A bare
 * `var(--border)` in a colour property is not a colour: the browser drops the
 * declaration, and the sheet block's grid lost its lines and focus ring that
 * way (g5 L6, W12.X1), as did the file viewer. This scans every stylesheet.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..", "..");
const SRC = join(ROOT, "src");
const index = readFileSync(join(SRC, "index.css"), "utf8");
/** Tokens whose value is an HSL triplet in index.css. */
const TRIPLETS = new Set([...index.matchAll(/(--[\w-]+):\s*(\d+(?:\.\d+)?\s+\d+(?:\.\d+)?%\s+\d+(?:\.\d+)?%)\s*;/g)].map((m) => m[1]));
const COLOUR_PROP = /^\s*(color|background(?:-color)?|border(?:-[\w-]+)?|outline(?:-color)?|fill|stroke|box-shadow|caret-color|text-decoration-color|accent-color)\s*:(.*)$/;

function cssFiles(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) {
      if (n !== "__tests__" && n !== "node_modules") cssFiles(p, out);
    } else if (n.endsWith(".css")) out.push(p);
  }
  return out;
}

export function bareTokens(css: string, triplets: ReadonlySet<string>): string[] {
  const found: string[] = [];
  css.split("\n").forEach((line, i) => {
    const m = COLOUR_PROP.exec(line);
    if (!m) return;
    // Drop every hsl(…)/hsla(…) (balanced parentheses): a token inside one, fallbacks included, is fine.
    let v = m[2];
    for (let at = v.search(/hsla?\(/); at >= 0; at = v.search(/hsla?\(/)) {
      let depth = 0;
      let end = v.indexOf("(", at);
      for (; end < v.length; end++) {
        if (v[end] === "(") depth++;
        else if (v[end] === ")" && --depth === 0) break;
      }
      v = v.slice(0, at) + v.slice(end + 1);
    }
    for (const x of v.matchAll(/var\((--[\w-]+)/g)) if (triplets.has(x[1])) found.push(`${i + 1}: ${line.trim()}`);
  });
  return found;
}

describe("colour tokens are used as hsl(var(--token))", () => {
  it("knows the tokens", () => {
    for (const t of ["--bg", "--fg", "--border", "--accent", "--danger", "--fg-muted"]) expect(TRIPLETS.has(t), t).toBe(true);
  });

  it("finds a bare token, and not one inside hsl()", () => {
    expect(bareTokens(".a {\n  border: 1px solid var(--border);\n}", TRIPLETS)).toHaveLength(1);
    expect(bareTokens(".a {\n  outline: 2px solid var(--accent, red);\n}", TRIPLETS)).toHaveLength(1);
    expect(bareTokens(".a {\n  border: 1px solid hsl(var(--border));\n  color: hsl(var(--fg) / 0.5);\n  background: hsl(var(--bg-muted, var(--bg)));\n}", TRIPLETS)).toEqual([]);
  });

  it("no stylesheet under src/ uses a bare HSL token as a colour", () => {
    const bad = cssFiles(SRC).flatMap((f) => bareTokens(readFileSync(f, "utf8"), TRIPLETS).map((l) => `${relative(ROOT, f)}:${l}`));
    expect(bad).toEqual([]);
  });
});
