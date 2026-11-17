/**
 * F13 (audit r4 A1.5, A2.5; INT7 counted 35 more): every dialog carries the app's look, whichever opens first.
 *  - The palette's surface (.cmd-palette-backdrop, .cmd-palette) and its keyframes live in src/index.css,
 *    which the app always loads: dozens of dialogs borrow that look and used to be a bare page when they
 *    opened before the palette had loaded src/ui/CommandPalette.css.
 *  - A button with no class inside any dialog (Modal's dialog.lumen-modal, role=dialog/alertdialog,
 *    .cmd-palette) has a border, padding, background and a focus ring: under the preflight it had none.
 * The rendered result, with the app's compiled CSS, is checked in Chromium by the F13 harness screenshots.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..");
const css = readFileSync(join(SRC, "index.css"), "utf8");
const palette = readFileSync(join(SRC, "ui/CommandPalette.css"), "utf8");
const rule = (sel: RegExp) => new RegExp(`(?:^|\\n)${sel.source}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? null;
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? (f === "__tests__" ? [] : walk(join(d, f))) : /\.tsx$/.test(f) ? [join(d, f)] : []));

describe("the shared dialog look (F13)", () => {
  it("the app always loads index.css", () => {
    expect(readFileSync(join(SRC, "main.tsx"), "utf8")).toMatch(/import "\.\/index\.css";/);
  });

  it("the palette's surface and keyframes are in index.css, once", () => {
    expect(rule(/\.cmd-palette-backdrop/)).toMatch(/position:\s*fixed[\s\S]*background:/);
    expect(rule(/\.cmd-palette/)).toMatch(/background:\s*hsl\(var\(--bg\)\)[\s\S]*border:/);
    expect(css).toMatch(/@keyframes cmdFadeIn/);
    expect(css).toMatch(/@keyframes cmdSlideIn/);
    expect(palette).not.toMatch(/(?:^|\n)\.cmd-palette(?:-backdrop)?\s*\{/);
    expect(palette).not.toMatch(/@keyframes/);
  });

  it("every dialog that borrows the palette's look gets it without the palette (35+ files)", () => {
    const users = walk(SRC).filter((f) => /className="cmd-palette(?:-backdrop)?"/.test(readFileSync(f, "utf8")));
    expect(users.length).toBeGreaterThanOrEqual(35);
    const unstyled = users.filter((_f) => !/\.cmd-palette\b/.test(css)).map((f) => relative(SRC, f));
    expect(unstyled).toEqual([]);
  });

  it("a class-less button inside any dialog is styled: border, padding, background, disabled, pressed, focus ring", () => {
    // Review 14 / F15: the button part has the specificity of one element (the preflight's own `button`), so the rule
    // wins over the preflight; with zero specificity (`:where(button:not([class]))`) the preflight won.
    const sel = String.raw`:where\(\.cmd-palette, dialog\.lumen-modal, \[role="dialog"\], \[role="alertdialog"\]\) button:where\(:not\(\[class\]\)\)`;
    const base = rule(new RegExp(sel));
    expect(base).toMatch(/border:\s*1px solid/);
    expect(base).toMatch(/padding-block:/);
    expect(base).toMatch(/padding-inline:/);
    expect(base).toMatch(/background:/);
    expect(base).toMatch(/cursor:\s*pointer/);
    for (const state of [String.raw`:hover:not\(:disabled\)`, String.raw`\[aria-pressed="true"\]`, ":disabled", ":focus-visible"]) expect(rule(new RegExp(sel + state)), state).not.toBeNull();
    expect(rule(new RegExp(sel + ":focus-visible"))).toMatch(/outline:\s*2px solid/);
    // Never the zero-specificity form again.
    expect(css.includes(":where(button:not([class]))")).toBe(false);
  });
});
