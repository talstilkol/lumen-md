/**
 * Plan W13.Y2 — the stylesheet's half of the forced-colours / contrast /
 * reduced-motion gate (the browser half is e2e/a11y-modes.spec.ts):
 * forced colours keep a system-coloured focus ring, control borders and
 * state without colour; prefers-contrast: more strengthens the tokens;
 * reduced motion stops CSS animation and transitions, and script-driven
 * scrolling goes through lib/motion.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const SRC = resolve(__dirname, "..");
const css = readFileSync(join(SRC, "index.css"), "utf8");

/** The body of the first `@media (<query>)` block. */
function block(query: string): string {
  const at = css.indexOf(`@media (${query})`);
  expect(at, query).toBeGreaterThanOrEqual(0);
  let depth = 0;
  const open = css.indexOf("{", at);
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
  }
  return "";
}

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === "__tests__" || e.name.startsWith(".")) return [];
    const p = join(dir, e.name);
    return e.isDirectory() ? sources(p) : /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}

describe("forced colours", () => {
  const fc = block("forced-colors: active");
  it("focus is a system-coloured outline; controls have borders; state shows without colour", () => {
    expect(fc).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid CanvasText/);
    expect(fc).toMatch(/border:\s*1px solid ButtonText/);
    expect(fc).toMatch(/\[aria-selected="true"\][\s\S]*Highlight/);
    expect(fc).toMatch(/\[data-selected\][\s\S]*outline:\s*2px solid Highlight/);
    expect(fc).toMatch(/\.sidebar-resizer\s*\{[^}]*CanvasText/);
  });
  it("forced-color-adjust: none only where the system highlight is drawn by us", () => {
    const nones = [...css.matchAll(/forced-color-adjust:\s*none/g)].length;
    expect(nones).toBe(1);
  });
});

describe("more contrast", () => {
  it("prefers-contrast: more darkens borders and muted text, and thickens focus", () => {
    const more = block("prefers-contrast: more");
    expect(more).toMatch(/--border:/);
    expect(more).toMatch(/--fg-muted:/);
    expect(more).toMatch(/\.dark/);
    expect(more).toMatch(/outline-width:\s*3px/);
  });
});

describe("reduced motion", () => {
  it("CSS animations and transitions stop", () => {
    const rm = block("prefers-reduced-motion: reduce");
    expect(rm).toMatch(/animation-duration:\s*0\.001ms !important/);
    expect(rm).toMatch(/transition-duration:\s*0\.001ms !important/);
    expect(rm).toMatch(/scroll-behavior:\s*auto !important/);
  });
  it("no script scrolls smoothly by itself: it asks lib/motion (scrollBehavior)", () => {
    const bad = sources(SRC)
      .filter((f) => !f.endsWith("lib/motion.ts"))
      .filter((f) => /behavior:\s*["']smooth["']/.test(readFileSync(f, "utf8")))
      .map((f) => relative(SRC, f));
    expect(bad).toEqual([]);
  });
});
