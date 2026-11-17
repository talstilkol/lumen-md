/**
 * INT7 — the reading modes look like the app (screenshots with the app's own
 * CSS, in Hebrew, audit r4 design check):
 *  - a mode that borrows the palette's dialog look (.cmd-palette) loads that
 *    stylesheet itself: it can open (from the toolbar) before the palette has
 *    ever loaded it;
 *  - a mode drawn as a plain Modal (no class of its own) gets a surface from
 *    index.css: lumen-modal dialogs are transparent and unpadded by design;
 *  - the daf view's toolbar controls are styled (plain buttons have no border
 *    or padding under the preflight).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { READING_MODES } from "../reading/modes";

const SRC = join(__dirname, "..");
const read = (f: string) => readFileSync(join(SRC, f), "utf8");
const css = read("index.css");

describe("reading modes carry the app's look (INT7)", () => {
  const files = [...new Set([...READING_MODES.map((m) => m.file.replace(/^src\//, "")), "ui/ReadingModeMenu.tsx"])];

  it("a mode that uses the palette's dialog classes imports their stylesheet", () => {
    const users = files.filter((f) => /className="cmd-palette(-backdrop)?"/.test(read(f)) && f !== "ui/CommandPalette.tsx");
    expect(users).toEqual(expect.arrayContaining(["ui/ReadingModeMenu.tsx", "ui/RsvpReader.tsx"]));
    for (const f of users) expect(read(f), f).toMatch(/import "\.\/CommandPalette\.css";/);
  });

  it("a mode drawn as a plain Modal gets a surface and a backdrop from index.css", () => {
    const plain = READING_MODES.filter((m) => {
      const src = read(m.file.replace(/^src\//, ""));
      const tag = new RegExp(`<Modal\\b[^\\n]*data-reading-mode="${m.id}"[^\\n]*`).exec(src)?.[0]; // the opening tag, on its line
      return tag && !/className=/.test(tag) && !/background/.test(tag);
    }).map((m) => m.id);
    expect(plain).toEqual(expect.arrayContaining(["daf", "bilingual", "side-by-side"]));
    const rule = /dialog\.lumen-modal:is\(([^)]*)\)\s*\{([^}]*)\}/.exec(css);
    expect(rule).not.toBeNull();
    for (const id of plain) expect(rule![1], id).toContain(`[data-reading-mode="${id}"]`);
    expect(rule![2]).toMatch(/background:\s*hsl\(var\(--bg\)\)/);
    expect(rule![2]).toMatch(/padding:/);
    expect(css).toMatch(/dialog\.lumen-modal:is\([^)]*\)::backdrop\s*\{\s*background:/);
  });

  it("the daf view's toolbar controls are styled", () => {
    const src = read("ui/DafView.tsx");
    expect(src).toMatch(/className="daf-toolbar"/);
    expect(src).toMatch(/\.daf-toolbar button[^{]*\{[^}]*border:[^}]*padding:|\.daf-toolbar button[^{]*\{[^}]*padding:[^}]*border:/);
    expect(src).toMatch(/aria-pressed="true"\]\s*\{[^}]*background/);
  });
});
