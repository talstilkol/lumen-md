/**
 * Track changes — author attribution via `{>>@name<<}` tags.
 */
import { describe, it, expect } from "vitest";
import {
  applyChange,
  parseSuggestions,
  resolveAll,
  sanitizeAuthor,
  transformEdit,
} from "../editor/suggesting";
import type { EditKind } from "../editor/suggesting";

function edit(
  [text, cursor]: [string, number],
  e: { from?: number; to?: number; insert?: string; kind: EditKind; author?: string | null },
): [string, number] {
  const from = e.from ?? cursor;
  const to = e.to ?? cursor;
  const r = transformEdit(text, { from, to, insert: e.insert ?? "", kind: e.kind, author: e.author ?? null });
  if (!r) return [applyChange(text, { from, to, insert: e.insert ?? "" }), from + (e.insert ?? "").length];
  return [applyChange(text, r.change), r.cursor];
}

const typeAs = (state: [string, number], chars: string, author: string): [string, number] => {
  let st = state;
  for (const ch of chars) st = edit(st, { insert: ch, kind: "insert", author });
  return st;
};

describe("author tags", () => {
  it("parses a trailing @name comment as the change's author", () => {
    const text = "a {++new++}{>>@Tal<<} b {--old--}{>>@Dana Levi<<} {>>plain note<<}";
    const s = parseSuggestions(text);
    expect(s.map((x) => [x.kind, x.author])).toEqual([
      ["insert", "Tal"],
      ["delete", "Dana Levi"],
      ["comment", undefined],
    ]);
    expect(text.slice(s[0].from, s[0].to)).toBe("{++new++}{>>@Tal<<}");
  });

  it("accept / reject remove the tag with its change", () => {
    const text = "a {++new++}{>>@Tal<<} b {~~x~>y~~}{>>@Tal<<}.";
    expect(resolveAll(text, "accept")).toBe("a new b y.");
    expect(resolveAll(text, "reject")).toBe("a  b x.");
  });

  it("tags a new insertion once and keeps typing inside it", () => {
    const [text] = typeAs(["hello world", 5], " there", "Tal");
    expect(text).toBe("hello{++ there++}{>>@Tal<<} world");
    expect(resolveAll(text, "accept")).toBe("hello there world");
  });

  it("tags deletions and substitutions", () => {
    const del = edit(["abc def", 7], { from: 4, to: 7, kind: "selection", author: "Tal" });
    expect(del[0]).toBe("abc {--def--}{>>@Tal<<}");
    const sub = edit(["abc def", 0], { from: 4, to: 7, insert: "xyz", kind: "replace", author: "Tal" });
    expect(sub[0]).toBe("abc {~~def~>xyz~~}{>>@Tal<<}");
  });

  it("backspacing through a tagged deletion extends it without a second tag", () => {
    let st: [string, number] = ["abcdef", 6];
    for (let i = 0; i < 3; i++) st = edit(st, { from: st[1] - 1, to: st[1], kind: "backward", author: "Tal" });
    // Retargeting may move the cursor across the markup; the result has one tag.
    expect((st[0].match(/\{>>@Tal<<\}/g) ?? []).length).toBe(1);
    expect(resolveAll(st[0], "accept")).toBe("abc");
    expect(resolveAll(st[0], "reject")).toBe("abcdef");
  });

  it("without an author nothing changes (legacy behaviour)", () => {
    const [text] = edit(["ab", 1], { insert: "X", kind: "insert" });
    expect(text).toBe("a{++X++}b");
  });

  it("sanitizes names so a tag can't break the markup", () => {
    expect(sanitizeAuthor("  Tal <x@y>  ")).toBe("Tal x y");
    expect(sanitizeAuthor("a++}b")).toBe("a b");
    expect(sanitizeAuthor("")).toBeNull();
    expect(sanitizeAuthor("x".repeat(100))!.length).toBe(64);
  });

  it("random edit sequences keep accept/reject consistent with an author", () => {
    let seed = 7;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    for (let round = 0; round < 200; round++) {
      let st: [string, number] = ["The quick brown fox", 0];
      const original = st[0];
      let accepted = original;
      for (let step = 0; step < 6; step++) {
        const len = st[0].length;
        const kind = (["insert", "backward", "forward", "selection", "replace"] as const)[rnd(5)];
        const a = rnd(len + 1);
        const b = Math.min(len, a + 1 + rnd(4));
        let next: [string, number];
        if (kind === "insert") next = edit(st, { from: a, to: a, insert: "zq", kind, author: rnd(2) ? "Tal" : "Dana" });
        else if (kind === "backward") next = a > 0 ? edit(st, { from: a - 1, to: a, kind, author: "Tal" }) : st;
        else if (kind === "forward") next = a < len ? edit(st, { from: a, to: a + 1, kind, author: "Tal" }) : st;
        else if (a === b) next = st;
        else next = edit(st, { from: a, to: b, insert: kind === "replace" ? "W" : "", kind, author: "Dana" });
        // The original document is always recoverable, and tags never leak.
        expect(resolveAll(next[0], "reject")).toBe(original);
        expect(resolveAll(next[0], "accept")).not.toMatch(/\{>>@/);
        accepted = resolveAll(next[0], "accept");
        st = next;
      }
      expect(accepted).not.toContain("{");
    }
  });
});

describe("author tags in the editor and preview", () => {
  it("the editor tags new suggestions with the facet's author and shows a tooltip", async () => {
    const { EditorState } = await import("@codemirror/state");
    const { suggestingAuthor, suggestingExtension, buildSuggestionDecorations } = await import(
      "../editor/suggestingExtension"
    );
    let state = EditorState.create({
      doc: "hello world",
      selection: { anchor: 5 },
      extensions: [suggestingExtension(true), suggestingAuthor.of(() => "Tal")],
    });
    state = state.update({ changes: { from: 5, insert: "!" }, selection: { anchor: 6 }, userEvent: "input.type" }).state;
    expect(state.doc.toString()).toBe("hello{++!++}{>>@Tal<<} world");
    const decos = buildSuggestionDecorations(parseSuggestions(state.doc.toString()));
    const titles: string[] = [];
    decos.between(0, state.doc.length, (_f, _t, d) => {
      const title = (d.spec as { attributes?: { title?: string } }).attributes?.title;
      if (title) titles.push(title);
    });
    expect(titles).toEqual(["Suggested by Tal"]);
  });

  it("the preview keeps the author visible as a small comment", async () => {
    const { prepareCriticMarkup, stripCriticDelimiters } = await import("../renderer/criticMarkup");
    const prepared = prepareCriticMarkup("a {++b++}{>>@Tal<<} c");
    expect(prepared).toContain("@Tal");
    expect(stripCriticDelimiters("a {++b++}{>>@Tal<<} c")).toBe("a b@Tal c");
  });
});
