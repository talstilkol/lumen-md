/**
 * W10.E50 (plan W7.3 step 4b): global search finds text inside code blocks and
 * folded lists, and opening such a hit shows it.
 *
 * The index part pins what the vault index already does: it holds the note's
 * whole text, code and nested list items included, and gives a snippet at the
 * match. The editor part is the fix. A hit inside a folded range used to be
 * scrolled to while it stayed hidden under the fold. Now the fold that hides it
 * is opened first. The notes are SYNTHETIC.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Decoration } from "@codemirror/view";
import { VaultIndex } from "../storage/vaultIndexCore";
import { rangesOver } from "../editor/searchHighlight";

const NOTE = [
  "# Build notes",
  "",
  "```ts",
  "const flux = computeWidget(42);",
  "let compute_widget_total = 3;",
  "```",
  "",
  "- parent item",
  "  - folded child zebrafish",
  "    - deeper קוּלמוס",
  "",
  "Plain closing line.",
].join("\n");

describe("global search: code blocks and folded lists (W10.E50)", () => {
  const ix = new VaultIndex();
  ix.upsert({ path: "notes/build.md", name: "build.md", content: NOTE, modified: 1 } as never);
  ix.upsert({ path: "notes/other.md", name: "other.md", content: "Nothing to see here.", modified: 1 } as never);

  for (const [q, where] of [
    ["computeWidget", "an identifier in a fenced code block"],
    ["compute_widget_total", "a snake_case name in code"],
    ["zebrafish", "a nested (foldable) list item"],
    ["קולמוס", "a pointed Hebrew word deep in a list, searched without niqqud"],
  ] as const) {
    it(`finds ${where}, with the snippet at the match`, () => {
      const hits = ix.search(q);
      expect(hits.map((h) => h.path)).toEqual(["notes/build.md"]);
      expect(hits[0].snippet?.toLowerCase()).toContain(q === "קולמוס" ? "קוּלמוס" : q.toLowerCase());
    });
  }
});

describe("opening a hit that a fold hides (W10.E50)", () => {
  // The folded ranges as CodeMirror keeps them (a RangeSet of replace decorations). @codemirror/language
  // itself is not installed offline, so the dispatch that unfolds is checked on the Mac (see the PR).
  const child = NOTE.indexOf("\n  - folded");
  const end = NOTE.indexOf("\n\nPlain");
  const code = NOTE.indexOf("\nconst");
  const codeEnd = NOTE.indexOf("\n```\n", code);
  const folded = Decoration.set([Decoration.replace({}).range(code, codeEnd), Decoration.replace({}).range(child, end)]);

  it("names the fold over the list match, and only it", () => {
    const z = NOTE.indexOf("zebrafish");
    expect(rangesOver(folded, z, z + 9)).toEqual([{ from: child, to: end }]);
    const c = NOTE.indexOf("computeWidget");
    expect(rangesOver(folded, c, c + 13)).toEqual([{ from: code, to: codeEnd }]);
    expect(rangesOver(folded, 0, 5)).toEqual([]);
    expect(rangesOver(folded, NOTE.indexOf("Plain"), NOTE.length)).toEqual([]);
  });

  it("the search target's handler opens those folds before it scrolls (the effects it dispatches)", () => {
    const src = readFileSync(resolve(__dirname, "../editor/searchHighlight.ts"), "utf8");
    expect(src).toMatch(/effects: \[\.\.\.foldsHiding\(view\.state, idx, idx \+ detail\.query\.trim\(\)\.length\)\.map\(\(f\) => unfoldEffect\.of\(f\)\), EditorView\.scrollIntoView\(idx/);
  });
});
