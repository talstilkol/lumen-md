/**
 * W11.Q3: the audit table in cm6VisibleRanges.test.ts stays complete. Every
 * source file that makes CodeMirror decorations (imports Decoration from
 * @codemirror/view and builds marks, lines, widgets or replaces) must be in
 * AUDIT with how its range count is bounded. A file marked "visible" must
 * be one that cm6VisibleRanges.test.ts measures. A new plugin cannot skip
 * the check by not being listed. ProseMirror decorations (WYSIWYG) are a
 * separate engine with no viewport (W11.Q4), so they are not listed here.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

type Bound = "visible" | "data" | "constant" | "small-doc-then-visible";
/** Every CodeMirror decoration source, and what bounds its number of ranges. */
const AUDIT: Record<string, Bound> = {
  "src/editor/bidi.ts": "visible",
  "src/editor/bidiMarks.ts": "visible",
  "src/editor/bidiIsolates.ts": "visible",
  "src/editor/tashkeelView.ts": "visible",
  "src/editor/mathBidi.ts": "visible",
  "src/editor/obsidianSource.ts": "small-doc-then-visible",
  "src/editor/embedHintExtension.ts": "visible",
  "src/editor/searchHighlight.ts": "visible",
  "src/editor/outlineExtension.ts": "constant",
  "src/editor/speechHighlight.ts": "data",
  "src/editor/suggestingExtension.ts": "data",
  "src/editor/aiAuthorship.ts": "data",
  "src/editor/commentDecorations.ts": "data",
  "src/editor/nikudAlternatives.ts": "data",
  "src/editor/lintExtension.ts": "data",
  "src/editor/grammarExtension.ts": "data",
  "src/editor/tsCheckExtension.ts": "data",
  "src/editor/collabAwareness.ts": "constant",
  "src/editor/ghostText.ts": "constant",
  "src/editor/inlineSuggestion.ts": "constant",
  "src/related/editorPlugin.ts": "constant",
};

function sources(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "__tests__" && e.name !== "node_modules") sources(p, out);
    } else if (/\.(ts|tsx)$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Files that build CodeMirror decorations. */
export function cmDecorationFiles(root = "src"): string[] {
  return sources(root)
    .filter((f) => {
      const t = readFileSync(f, "utf8");
      return /import\s*\{[^}]*\bDecoration\b[^}]*\}\s*from\s*["']@codemirror\/view["']/.test(t) && /\bDecoration\.(mark|line|widget|replace)\(/.test(t);
    })
    .map((f) => f.split("\\").join("/"))
    .sort();
}

describe("the CodeMirror decoration audit is complete (W11.Q3)", () => {
  it("every file that makes CodeMirror decorations is in the audit, and nothing listed is gone", () => {
    const found = cmDecorationFiles();
    expect(found.filter((f) => !(f in AUDIT)), "add these to AUDIT (and to cm6VisibleRanges.test.ts when they decorate from the text)").toEqual([]);
    expect(Object.keys(AUDIT).filter((f) => !found.includes(f)), "listed but no longer decorating: remove them").toEqual([]);
  });

  it("every 'visible' plugin is measured by cm6VisibleRanges.test.ts", () => {
    const test = readFileSync("src/__tests__/cm6VisibleRanges.test.ts", "utf8");
    for (const [file, bound] of Object.entries(AUDIT)) {
      if (bound !== "visible" && bound !== "small-doc-then-visible") continue;
      const mod = file.replace(/^src\//, "../").replace(/\.tsx?$/, "");
      expect(test, `${file} is marked ${bound} but cm6VisibleRanges.test.ts does not import it`).toContain(`from "${mod}"`);
    }
  });

  it("the scan finds a decorating file and ignores one that only imports the type", () => {
    const t1 = 'import { Decoration, ViewPlugin } from "@codemirror/view";\nconst m = Decoration.mark({ class: "x" });';
    const t2 = 'import { type DecorationSet } from "@codemirror/view";\nexport const none = 1;';
    const re1 = /import\s*\{[^}]*\bDecoration\b[^}]*\}\s*from\s*["']@codemirror\/view["']/;
    expect(re1.test(t1) && /\bDecoration\.(mark|line|widget|replace)\(/.test(t1)).toBe(true);
    expect(re1.test(t2) && /\bDecoration\.(mark|line|widget|replace)\(/.test(t2)).toBe(false);
  });
});
