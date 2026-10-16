/**
 * Suggesting mode (track changes) — pure CriticMarkup logic.
 */
import { describe, it, expect } from "vitest";
import {
  applyChange,
  editKindFor,
  findCodeRanges,
  mayContainCriticMarkup,
  nextSuggestion,
  parseSuggestions,
  prevSuggestion,
  resolveAll,
  resolutionChanges,
  resolvedText,
  suggestionAt,
  transformEdit,
} from "../editor/suggesting";
import type { EditKind } from "../editor/suggesting";

/** Apply a user edit in suggesting mode; returns [text, cursor]. */
function edit(text: string, from: number, to: number, insert: string, kind?: EditKind): [string, number] {
  const k = kind ?? (insert ? (from === to ? "insert" : "replace") : "selection");
  const r = transformEdit(text, { from, to, insert, kind: k });
  if (!r) return [applyChange(text, { from, to, insert }), from + insert.length];
  return [applyChange(text, r.change), r.cursor];
}

/** Text with `|` marking the cursor. */
function show([text, cursor]: [string, number]): string {
  return text.slice(0, cursor) + "|" + text.slice(cursor);
}

/** Parse "ab|cd" into [text, cursor]. */
function at(s: string): [string, number] {
  const i = s.indexOf("|");
  return [s.slice(0, i) + s.slice(i + 1), i];
}

/** Type `chars` one keystroke at a time starting from a "|" cursor string. */
function type(start: string, chars: string): string {
  let [text, cur] = at(start);
  for (const ch of chars) [text, cur] = edit(text, cur, cur, ch);
  return show([text, cur]);
}

/** Press Backspace `n` times. */
function backspace(start: string, n = 1): string {
  let [text, cur] = at(start);
  for (let i = 0; i < n; i++) {
    if (cur === 0) break;
    [text, cur] = edit(text, cur - 1, cur, "", "backward");
  }
  return show([text, cur]);
}

/** Press Delete `n` times. */
function del(start: string, n = 1): string {
  let [text, cur] = at(start);
  for (let i = 0; i < n; i++) {
    if (cur >= text.length) break;
    [text, cur] = edit(text, cur, cur + 1, "", "forward");
  }
  return show([text, cur]);
}

/* ─── Parsing ─────────────────────────────────────────────────────────── */

describe("parseSuggestions", () => {
  it("finds all five CriticMarkup kinds with correct ranges", () => {
    const text = "a{++ins++}b{--del--}c{~~old~>new~~}d{>>note<<}e{==hl==}";
    const s = parseSuggestions(text);
    expect(s.map((x) => x.kind)).toEqual(["insert", "delete", "substitute", "comment", "highlight"]);
    expect(s.map((x) => text.slice(x.from, x.to))).toEqual([
      "{++ins++}",
      "{--del--}",
      "{~~old~>new~~}",
      "{>>note<<}",
      "{==hl==}",
    ]);
    expect(s.map((x) => text.slice(x.contentFrom, x.contentTo))).toEqual(["ins", "del", "old", "note", "hl"]);
    expect(text.slice(s[2].newFrom, s[2].newTo)).toBe("new");
  });

  it("supports multi-line and empty content", () => {
    const s = parseSuggestions("{++line1\nline2++}{++++}");
    expect(s).toHaveLength(2);
    expect(s[0].contentTo - s[0].contentFrom).toBe(11);
  });

  it("ignores markup inside fenced code blocks and code spans", () => {
    const text = [
      "{++real++}",
      "```",
      "{++in fence++}",
      "```",
      "`{--in span--}` and ``{==two ticks==}``",
      "~~~md",
      "{>>tilde fence<<}",
      "~~~",
      "{--real too--}",
    ].join("\n");
    const s = parseSuggestions(text);
    expect(s.map((x) => text.slice(x.contentFrom, x.contentTo))).toEqual(["real", "real too"]);
  });

  it("unclosed fences run to the end of the document", () => {
    expect(parseSuggestions("```\n{++x++}")).toEqual([]);
  });

  it("returns [] fast for docs without markup", () => {
    expect(mayContainCriticMarkup("plain {text}")).toBe(false);
    expect(parseSuggestions("plain {text}")).toEqual([]);
  });

  it("leaves unterminated markup alone", () => {
    expect(parseSuggestions("{++open but never closed")).toEqual([]);
  });
});

describe("findCodeRanges", () => {
  it("handles fences, longer closing fences and backtick spans", () => {
    const text = "x `a` y\n````\ncode\n`````\nz ``b`c`` w";
    const r = findCodeRanges(text);
    expect(r.map((c) => [c.type, text.slice(c.from, c.to)])).toEqual([
      ["inline", "`a`"],
      ["fence", "````\ncode\n`````"],
      ["inline", "``b`c``"],
    ]);
  });

  it("does not treat an escaped backtick as a code span", () => {
    expect(findCodeRanges("\\`not code`")).toEqual([]);
  });
});

/* ─── Accept / reject ─────────────────────────────────────────────────── */

describe("accept / reject", () => {
  const doc = "a{++b++}c{--d--}e{~~f~>g~~}h{>>note<<}i{==j==}k";

  it("accept all", () => {
    expect(resolveAll(doc, "accept")).toBe("abcegh" + "ijk");
  });

  it("reject all", () => {
    expect(resolveAll(doc, "reject")).toBe("acdefh" + "ijk");
  });

  it("resolvedText per kind", () => {
    const s = parseSuggestions(doc);
    expect(s.map((x) => resolvedText(doc, x, "accept"))).toEqual(["b", "", "g", "", "j"]);
    expect(s.map((x) => resolvedText(doc, x, "reject"))).toEqual(["", "d", "f", "", "j"]);
  });

  it("resolutionChanges are in document order and non-overlapping", () => {
    const ch = resolutionChanges(doc, parseSuggestions(doc), "accept");
    for (let i = 1; i < ch.length; i++) expect(ch[i].from).toBeGreaterThanOrEqual(ch[i - 1].to);
  });

  it("leaves markup in code untouched", () => {
    const t = "`{++x++}` {++y++}";
    expect(resolveAll(t, "accept")).toBe("`{++x++}` y");
  });
});

describe("navigation", () => {
  const doc = "a{++b++}c{--d--}e";
  const s = parseSuggestions(doc);

  it("suggestionAt finds the span under the cursor (inclusive edges)", () => {
    expect(suggestionAt(s, 0)).toBeNull();
    expect(suggestionAt(s, 1)?.kind).toBe("insert");
    expect(suggestionAt(s, 4)?.kind).toBe("insert");
    expect(suggestionAt(s, 8)?.kind).toBe("insert"); // just after `}`
    expect(suggestionAt(s, 9)?.kind).toBe("delete");
  });

  it("next / prev wrap around", () => {
    expect(nextSuggestion(s, 0)?.kind).toBe("insert");
    expect(nextSuggestion(s, 2)?.kind).toBe("delete");
    expect(nextSuggestion(s, 12)?.kind).toBe("insert");
    expect(prevSuggestion(s, 12)?.kind).toBe("delete");
    expect(prevSuggestion(s, 9)?.kind).toBe("insert");
    expect(prevSuggestion(s, 0)?.kind).toBe("delete");
    expect(nextSuggestion([], 0)).toBeNull();
  });
});

/* ─── Edit transforms ─────────────────────────────────────────────────── */

describe("transformEdit — insertions", () => {
  it("wraps typed text in a new insertion", () => {
    expect(type("hello| world", "x")).toBe("hello{++x|++} world");
  });

  it("keeps typing into the same insertion", () => {
    expect(type("hello| world", "abc")).toBe("hello{++abc|++} world");
  });

  it("merges into an insertion that ends at the cursor", () => {
    expect(type("a{++b++}|c", "x")).toBe("a{++bx|++}c");
  });

  it("merges into an insertion that starts at the cursor", () => {
    expect(type("a|{++b++}c", "x")).toBe("a{++x|b++}c");
  });

  it("typing inside a deletion inserts after it", () => {
    expect(type("a{--x|y--}b", "z")).toBe("a{--xy--}{++z|++}b");
  });

  it("typing inside delimiters goes outside the markup", () => {
    expect(type("a{-|-x--}b", "z")).toBe("a{--x--}{++z|++}b");
  });

  it("typing inside a comment inserts after it", () => {
    expect(type("a{>>no|te<<}b", "z")).toBe("a{>>note<<}{++z|++}b");
  });

  it("extends the new side of a substitution", () => {
    expect(type("{~~a~>b|~~}", "c")).toBe("{~~a~>bc|~~}");
    expect(type("{~~a~>b~~}|", "c")).toBe("{~~a~>bc|~~}");
  });

  it("multi-character paste becomes one insertion", () => {
    const [t, c] = edit("ab", 1, 1, "XYZ");
    expect(show([t, c])).toBe("a{++XYZ|++}b");
  });
});

describe("transformEdit — backspace / delete", () => {
  it("Backspace marks the previous char deleted and moves before it", () => {
    expect(backspace("hello| world")).toBe("hell|{--o--} world");
  });

  it("consecutive Backspaces merge into one deletion", () => {
    expect(backspace("hello| world", 3)).toBe("he|{--llo--} world");
  });

  it("Delete marks the next char deleted and moves after it", () => {
    expect(del("hello| world")).toBe("hello{-- --}| world".replace("| world", "|world"));
  });

  it("consecutive Deletes merge", () => {
    expect(del("hello| world", 3)).toBe("hello{-- wo--}|rld");
  });

  it("Backspace right after a deletion skips it and extends it", () => {
    expect(backspace("ab{--c--}|d")).toBe("a|{--bc--}d");
  });

  it("Delete right before a deletion skips it and extends it", () => {
    expect(del("a|{--b--}cd")).toBe("a{--bc--}|d");
  });

  it("Backspace inside your own insertion really deletes", () => {
    expect(backspace("a{++xy|++}b")).toBe("a{++x|++}b");
  });

  it("deleting the last char of your insertion removes the markup", () => {
    expect(backspace("a{++x|++}b")).toBe("a|b");
  });

  it("Backspace right after an insertion deletes into it", () => {
    expect(backspace("a{++xy++}|b")).toBe("a{++x|++}b");
  });

  it("Delete right before an insertion deletes into it", () => {
    expect(del("a|{++xy++}b")).toBe("a|{++y++}b");
  });

  it("Backspace after an insertion that was fully consumed continues as a deletion", () => {
    expect(backspace("ab{++x++}|c", 2)).toBe("a|{--b--}c");
  });

  it("Backspace inside a substitution's new text really deletes", () => {
    expect(backspace("{~~a~>bc|~~}")).toBe("{~~a~>b|~~}");
  });

  it("Backspace removing all new text of a substitution leaves a deletion", () => {
    expect(backspace("{~~a~>b|~~}")).toBe("{--a--}|");
  });

  it("Backspace at document start is a no-op", () => {
    const r = transformEdit("{--a--}b", { from: 6, to: 7, insert: "", kind: "backward" });
    expect(r?.change).toBeNull();
  });

  it("handles surrogate pairs as one character", () => {
    // CodeMirror deletes the whole pair; the transform keeps it intact.
    expect(show(edit("a😀b", 1, 3, "", "backward"))).toBe("a|{--😀--}b");
    // Retargeted Backspace (past a deletion) also steps over the pair.
    expect(backspace("😀{--x--}|b")).toBe("|{--😀x--}b");
  });
});

describe("transformEdit — selections", () => {
  it("replacing a plain selection produces a substitution", () => {
    expect(show(edit("hello world", 6, 11, "there"))).toBe("hello {~~world~>there|~~}");
  });

  it("deleting a plain selection produces a deletion", () => {
    expect(show(edit("hello world", 5, 11, ""))).toBe("hello{-- world--}|");
  });

  it("deleting a selection that covers your own insertion drops the insertion text", () => {
    // a b {++XY++} c d → select b..c
    const text = "ab{++XY++}cd";
    expect(show(edit(text, 1, 11, ""))).toBe("a{--bc--}|d");
  });

  it("deleting a selection merges with an adjacent deletion", () => {
    expect(show(edit("ab{--c--}de", 9, 10, ""))).toBe("ab{--cd--}|e");
  });

  it("replacing a selection next to an insertion keeps both", () => {
    expect(show(edit("{++ab++}cd", 8, 10, "z"))).toBe("{++ab++}{~~cd~>z|~~}");
  });

  it("replacing text inside your own insertion edits it in place", () => {
    expect(show(edit("{++abcd++}", 4, 6, "z"))).toBe("{++az|d++}");
  });

  it("replacing a selection that spans a deletion keeps the deleted text deleted", () => {
    // x {--y--} z → select all and type Q
    const text = "x{--y--}z";
    expect(show(edit(text, 0, 9, "Q"))).toBe("{~~xyz~>Q|~~}");
  });

  it("deleting a selection preserves comments inside it", () => {
    expect(show(edit("ab{>>c<<}de", 1, 10, ""))).toBe("a{--b--}{>>c<<}{--d--}|e");
  });
});

describe("transformEdit — code exclusion", () => {
  it("passes edits inside a fenced code block through untouched", () => {
    const text = "```js\nconst a = 1\n```";
    expect(transformEdit(text, { from: 10, to: 10, insert: "x", kind: "insert" })).toBeNull();
    expect(transformEdit(text, { from: 10, to: 11, insert: "", kind: "backward" })).toBeNull();
  });

  it("passes edits inside an inline code span through untouched", () => {
    expect(transformEdit("a `code` b", { from: 4, to: 4, insert: "x", kind: "insert" })).toBeNull();
  });

  it("tracks edits right next to (outside) a code span", () => {
    expect(show(edit("a `c` b", 1, 1, "x"))).toBe("a{++x|++} `c` b");
  });

  it("treats markup-looking text in code as literal", () => {
    const text = "`{++x++}`";
    expect(transformEdit(text, { from: 4, to: 4, insert: "y", kind: "insert" })).toBeNull();
  });
});

describe("editKindFor", () => {
  it("maps CodeMirror user events", () => {
    expect(editKindFor("input.type", 1, 1, "a")).toBe("insert");
    expect(editKindFor("input.type", 1, 3, "a")).toBe("replace");
    expect(editKindFor("delete.backward", 1, 2, "")).toBe("backward");
    expect(editKindFor("delete.forward", 1, 2, "")).toBe("forward");
    expect(editKindFor("delete.selection", 1, 4, "")).toBe("selection");
    expect(editKindFor("delete.cut", 1, 4, "")).toBe("selection");
    expect(editKindFor("input.type", 1, 1, "")).toBeNull();
  });
});

describe("round trip", () => {
  it("rejecting all suggestions restores the original text", () => {
    let [text, cur] = at("The quick brown| fox");
    [text, cur] = edit(text, cur - 5, cur, "", "backward"); // delete "brown" by selection-ish backspace
    [text, cur] = edit(text, cur, cur, "red");
    expect(resolveAll(text, "reject")).toBe("The quick brown fox");
    expect(resolveAll(text, "accept")).toBe("The quick red fox");
  });
});

describe("transformEdit — text that contains CriticMarkup delimiters", () => {
  it("refuses (untrackable) instead of corrupting: pasting a++}b", () => {
    const r = transformEdit("xy", { from: 1, to: 1, insert: "a++}b", kind: "insert" });
    expect(r).toMatchObject({ change: null, untrackable: true });
  });

  it("refuses a replacement whose old or new text holds ~> / ~~}", () => {
    expect(transformEdit("p~>q", { from: 0, to: 4, insert: "z", kind: "replace" })).toMatchObject({ untrackable: true });
    expect(transformEdit("abc", { from: 0, to: 3, insert: "n~~}m", kind: "replace" })).toMatchObject({ untrackable: true });
  });

  it("refuses deleting text that contains --}", () => {
    expect(transformEdit("a--}b", { from: 0, to: 5, insert: "", kind: "selection" })).toMatchObject({ untrackable: true });
  });

  it("refuses typing into an insertion when it would close it early", () => {
    // {++a+|++}  typing "+}" would make the content contain ++}.
    expect(transformEdit("{++a+++}", { from: 5, to: 5, insert: "+}", kind: "insert" })).toMatchObject({ untrackable: true });
  });

  it("still tracks delimiter-adjacent characters that are unambiguous", () => {
    for (const s of ["+", "++", "a+", "-", "~", ">", "}", "{"]) {
      const [out] = edit("xy", 1, 1, s);
      expect(resolveAll(out, "accept")).toBe(`x${s}y`);
      expect(resolveAll(out, "reject")).toBe("xy");
    }
  });
});
