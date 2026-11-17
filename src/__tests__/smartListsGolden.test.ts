/**
 * W13.E2 — smart lists: 60 golden behaviours (tests/fixtures/smart-lists),
 * 20 of them on Hebrew lines and Hebrew-numbered lists, plus the extra cases.
 *
 * Every case runs twice: through the pure engine (src/editor/smartLists.ts)
 * and through a real CodeMirror EditorState via the keymap's transaction
 * (src/editor/smartListsExtension.ts), which must agree to the character and
 * the selection. The Milkdown runner needs @milkdown/* installed (the Mac):
 * here it is skipped with that reason.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { EditorSelection, EditorState } from "@codemirror/state";
import { hebrewNumeral, parseHebrewNumeral, parseItem, runSmartList, type ListState, type SmartListOp } from "../editor/smartLists";
import { smartListTransaction } from "../editor/smartListsExtension";

interface Case {
  id: string;
  source: string;
  op: SmartListOp;
  arg?: string;
  before: string;
  after: string | null;
}

const DIR = join(__dirname, "../../tests/fixtures/smart-lists");
const GOLDEN_FILES = ["enter.json", "indent.json", "move.json", "edit.json", "hebrew.json"];
const load = (f: string): Case[] => JSON.parse(readFileSync(join(DIR, f), "utf8"));
const GOLDEN = GOLDEN_FILES.flatMap(load);
const EXTRA = load("extra.json");

/** "a‸b" → caret; "⟦…⟧" → selection from ⟦ (anchor) to ⟧ (head). */
export function decode(s: string): ListState {
  const caret = s.indexOf("‸");
  if (caret >= 0) return { doc: s.replace("‸", ""), sel: { anchor: caret, head: caret } };
  const a = s.indexOf("⟦");
  const h = s.indexOf("⟧");
  if (a < 0 || h < 0) throw new Error(`no caret in ${JSON.stringify(s)}`);
  const doc = s.replace("⟦", "").replace("⟧", "");
  return { doc, sel: { anchor: a, head: h - 1 } };
}
export function encode(s: ListState): string {
  const { anchor, head } = s.sel;
  if (anchor === head) return s.doc.slice(0, head) + "‸" + s.doc.slice(head);
  const [lo, hi] = anchor < head ? [anchor, head] : [head, anchor];
  return s.doc.slice(0, lo) + "⟦" + s.doc.slice(lo, hi) + "⟧" + s.doc.slice(hi);
}

function viaCodeMirror(c: Case): string | null {
  const s = decode(c.before);
  const state = EditorState.create({ doc: s.doc, selection: EditorSelection.single(s.sel.anchor, s.sel.head) });
  const spec = smartListTransaction(state, c.op, c.arg);
  if (!spec) return null;
  const next = state.update(spec).state;
  return encode({ doc: next.doc.toString(), sel: { anchor: next.selection.main.anchor, head: next.selection.main.head } });
}

describe("the golden set", () => {
  it("has 60 behaviours, 20 of them Hebrew, every id unique, every source named", () => {
    expect(GOLDEN).toHaveLength(60);
    expect(load("hebrew.json")).toHaveLength(20);
    expect(new Set([...GOLDEN, ...EXTRA].map((c) => c.id)).size).toBe(GOLDEN.length + EXTRA.length);
    expect(GOLDEN.filter((c) => !/^(obsidian-1\.1[45]\.[01]|commonmark|W13\.H5)$/.test(c.source)).map((c) => c.id)).toEqual([]);
    // Every Hebrew case has Hebrew in it.
    expect(load("hebrew.json").filter((c) => !/[א-ת]/.test(c.before + (c.arg ?? ""))).map((c) => c.id)).toEqual([]);
    expect(readdirSync(DIR).filter((f) => f.endsWith(".json")).sort()).toEqual([...GOLDEN_FILES, "extra.json"].sort());
  });
});

describe.each([
  ["CodeMirror", viaCodeMirror],
  ["engine", (c: Case) => {
    const r = runSmartList(c.op, decode(c.before), c.arg);
    return r ? encode(r) : null;
  }],
] as const)("%s", (_name, run) => {
  it.each(GOLDEN.map((c) => [c.id, c] as const))("golden %s", (_id, c) => {
    expect(run(c)).toBe(c.after);
  });
  it.each(EXTRA.map((c) => [c.id, c] as const))("extra %s", (_id, c) => {
    expect(run(c)).toBe(c.after);
  });
});

describe("Milkdown (WYSIWYG)", () => {
  // @milkdown/* is not installed in this offline checkout; the WYSIWYG runner
  // runs on the Mac (W10.M1). Listed so the count of skipped is never silent.
  it.skip("runs the 60 golden behaviours in Milkdown — skipped: @milkdown/* not installed offline (runs on the Mac, W10.M1)", () => {});
});

describe("Hebrew numerals as list markers", () => {
  it("round-trips 1–999, with טו and טז", () => {
    for (let n = 1; n <= 999; n++) expect(parseHebrewNumeral(hebrewNumeral(n))).toBe(n);
    expect(hebrewNumeral(15)).toBe("טו");
    expect(hebrewNumeral(16)).toBe("טז");
    expect(hebrewNumeral(115)).toBe("קטו");
    expect(hebrewNumeral(11)).toBe("יא");
  });
  it("a Hebrew word before a period is not a marker", () => {
    expect(parseItem("אב. משהו")).toBeNull();
    expect(parseItem("יה. משהו")).toBeNull(); // 15 is written טו
    expect(parseItem("ג. משהו")?.num).toBe(3);
  });
});

describe("on a long list", () => {
  it("Enter at the top of a 2,000-item numbered list renumbers it in well under a frame budget × 10", () => {
    const doc = Array.from({ length: 2000 }, (_, i) => `${i + 1}. item ${i + 1}`).join("\n");
    const t0 = performance.now();
    const r = runSmartList("enter", { doc, sel: { anchor: "1. item 1".length, head: "1. item 1".length } })!;
    const ms = performance.now() - t0;
    expect(r.doc.split("\n")[2000]).toBe("2001. item 2000");
    expect(ms).toBeLessThan(300);
  });
});
