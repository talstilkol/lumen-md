/**
 * Suggesting mode in WYSIWYG, on the real Milkdown editor: CriticMarkup
 * round-trips through marks, user edits become tracked changes, and
 * accept / reject resolve them.
 */
import { describe, it, expect, afterEach } from "vitest";
import { Editor, rootCtx, defaultValueCtx, editorViewCtx } from "@milkdown/core";
import { commonmark } from "@milkdown/preset-commonmark";
import { gfm } from "@milkdown/preset-gfm";
import { history } from "@milkdown/plugin-history";
import { getMarkdown } from "@milkdown/utils";
import { TextSelection } from "@milkdown/prose/state";
import type { EditorView } from "@milkdown/prose/view";
import {
  configureWysiwygSuggest,
  encodeCriticForWysiwyg,
  jumpToChange,
  resolveAtCursor,
  wysiwygSuggestPlugins,
} from "../editor/wysiwygSuggest";

let editors: Editor[] = [];
afterEach(async () => {
  for (const e of editors) await e.destroy();
  editors = [];
  configureWysiwygSuggest({ enabled: () => false, author: () => null });
});

async function open(md: string, suggesting = false, author: string | null = "Tal") {
  configureWysiwygSuggest({ enabled: () => suggesting, author: () => author });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const ed = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, host);
      ctx.set(defaultValueCtx, encodeCriticForWysiwyg(md));
    })
    .use(wysiwygSuggestPlugins)
    .use(commonmark)
    .use(gfm)
    .use(history)
    .create();
  editors.push(ed);
  const view = ed.action((ctx) => ctx.get(editorViewCtx)) as EditorView;
  const md2 = () => ed.action(getMarkdown()).trim();
  /** Document position of the first occurrence of `text` (+ offset). */
  const at = (text: string, offset = 0) => {
    let found = -1;
    view.state.doc.descendants((n, pos) => {
      if (found === -1 && n.isText && n.text!.includes(text)) found = pos + n.text!.indexOf(text) + offset;
    });
    if (found === -1) throw new Error(`not found: ${text}`);
    return found;
  };
  const select = (from: number, to = from) => view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
  const type = (text: string) => view.dispatch(view.state.tr.insertText(text));
  const backspace = () => {
    const { from, to, empty } = view.state.selection;
    view.dispatch(view.state.tr.delete(empty ? from - 1 : from, to));
  };
  return { view, md: md2, at, select, type, backspace };
}

describe("CriticMarkup ↔ marks", () => {
  it("round-trips insertions, deletions, substitutions and authors unchanged", async () => {
    const src = "Keep {++new **bold**++}{>>@Tal<<}, {--gone--}, {~~old~>fresh~~}{>>@Dana<<} and {>>a note<<}.";
    const e = await open(src);
    expect(e.md()).toBe(src);
    expect(e.view.dom.querySelectorAll("ins.critic-ins").length).toBe(2);
    expect(e.view.dom.querySelector("ins.critic-ins")?.getAttribute("title")).toBe("@Tal");
  });

  it("keeps CriticMarkup in link destinations and titles as literal markup", async () => {
    const src = '[x](https://example.test/{++version++} "a {--b--}") and {++y++}.';
    const e = await open(src);
    expect(e.md()).toBe(src);
    expect(e.md()).not.toMatch(/[\uE000-\uE00B]/);
  });

  it("leaves CriticMarkup in code alone", async () => {
    const src = "Literal `{++x++}` here.";
    expect((await open(src)).md()).toBe(src);
  });
});

describe("tracking edits while suggesting", () => {
  it("typed text becomes an insertion with the author", async () => {
    const e = await open("Hello world.", true);
    e.select(e.at(" world"));
    e.type(" big");
    // The inserted space is part of the suggestion (rejecting it removes it).
    expect(e.md()).toBe("Hello{++ big++}{>>@Tal<<} world.");
  });

  it("keeps separate suggestions and their unmarked whitespace apart", async () => {
    for (const src of [
      "{++one++}{>>@Tal<<} {++two++}{>>@Tal<<} end.",
      "Keep {--old--}{>>@Alice<<}{++new++}{>>@Bob<<} end.",
      "Keep {++a trailing ++}{>>@Tal<<}word.",
    ]) {
      const e = await open(src, false);
      expect(e.md()).toBe(src);
    }
  });

  it("backspace keeps the text as a deletion and moves the caret past it", async () => {
    const e = await open("Hello world.", true);
    e.select(e.at(" world", 6));
    for (let i = 0; i < 5; i++) e.backspace();
    expect(e.md()).toBe("Hello {--world--}{>>@Tal<<}.");
    expect(e.view.state.selection.head).toBe(e.at("world"));
  });

  it("forward Delete steps over each character it marks", async () => {
    const e = await open("Hello world.", true);
    e.select(e.at("world"));
    for (let i = 0; i < 3; i++) {
      const head = e.view.state.selection.head;
      e.view.dispatch(e.view.state.tr.delete(head, head + 1));
    }
    expect(e.md()).toBe("Hello {--wor--}{>>@Tal<<}ld.");
    expect(e.view.state.selection.head).toBe(e.at("ld."));
  });

  it("blocks inline atoms (a hard break) while suggesting", async () => {
    const e = await open("Hello world.", true);
    const at = e.at(" world");
    const br = e.view.state.schema.nodes.hardbreak ?? e.view.state.schema.nodes.hard_break;
    e.view.dispatch(e.view.state.tr.insert(at, br.create()));
    expect(e.md()).toBe("Hello world.");
  });

  it("typing over a selection across paragraphs keeps the structure and drops the typed text", async () => {
    const e = await open("First para.\n\nSecond para.", true);
    const from = e.at("para.");
    const to = e.at("Second") + 6;
    e.select(from, to);
    e.view.someProp("handleTextInput", (f) => f(e.view, from, to, "X", () => e.view.state.tr));
    // Accepting couldn't remove a paragraph break: the edit is refused.
    expect(e.md()).toBe("First para.\n\nSecond para.");
  });

  it("refuses structure changes that can't be suggested (wrapping in a list)", async () => {
    const e = await open("One paragraph here.", true);
    const { wrapInList } = await import("@milkdown/prose/schema-list");
    const list = e.view.state.schema.nodes.bullet_list;
    e.select(e.at("One"));
    wrapInList(list)(e.view.state, e.view.dispatch);
    expect(e.md()).toBe("One paragraph here.");
  });

  it("refuses formatting and delimiter deletions; pasted inline text is suggested", async () => {
    const e = await open("Hello a--}b world.", true);
    const { Slice, Fragment } = await import("@milkdown/prose/model");
    const sc = e.view.state.schema;
    // Bold on existing text: a mark step.
    const strong = sc.marks.strong;
    e.view.dispatch(e.view.state.tr.addMark(e.at("Hello"), e.at("Hello", 5), strong.create()));
    // Deleting text that contains `--}`.
    e.view.dispatch(e.view.state.tr.delete(e.at("a--}b"), e.at("a--}b", 5)));
    expect(e.md()).toBe("Hello a--}b world.");
    // Pasting inline text (an open paragraph slice) is a normal suggestion.
    const at = e.at(" world");
    e.view.dispatch(e.view.state.tr.replace(at, at, new Slice(Fragment.from(sc.nodes.paragraph.create(null, sc.text(" pasted"))), 1, 1)));
    expect(e.md()).toBe("Hello a--}b{++ pasted++}{>>@Tal<<} world.");
  });

  it("edits inside a fenced code block pass untracked", async () => {
    const e = await open("```\ncode here\n```", true);
    const at = e.at("here");
    e.view.dispatch(e.view.state.tr.delete(at, at + 4));
    expect(e.md()).toBe("```\ncode \n```");
    // An edit that reaches past the code block is tracked (here: blocked join).
    const t = await open("```\ncode\n```\n\nAfter text.", true);
    t.view.dispatch(t.view.state.tr.delete(t.at("code") + 2, t.at("After") + 3));
    expect(t.view.state.doc.childCount).toBe(2);
    expect(t.md()).toBe("```\ncode\n```\n\nAfter text."); // crosses a block boundary: refused
  });

  it("edits inside an inline code span pass untracked, delimiter-like text included", async () => {
    const e = await open("Run `npm test` now.", true);
    e.select(e.at(" test"));
    e.type("++}");
    expect(e.md()).toBe("Run `npm++} test` now.");
    e.select(e.at("test"), e.at("test", 4));
    e.backspace();
    expect(e.md()).toBe("Run `npm++} ` now.");
    // Outside the span: tracked as usual.
    e.select(e.at("now"));
    e.type("!");
    expect(e.md()).toBe("Run `npm++} ` {++!++}{>>@Tal<<}now.");
  });

  it("typing over a selection is a substitution", async () => {
    const e = await open("Hello world.", true);
    e.select(e.at("world"), e.at("world", 5));
    e.type("there");
    expect(e.md()).toBe("Hello {~~world~>there~~}{>>@Tal<<}.");
  });

  it("typing over a selection reported as a minimal DOM diff replaces the whole selection", async () => {
    const e = await open("Hello world.", true);
    const from = e.at("Hello");
    e.select(from, from + 5);
    // Firefox: typing "H" over "Hello" arrives as a diff that deletes "ello"
    // (the "H" already matches).
    const handled = e.view.someProp("handleTextInput", (f) => f(e.view, from + 1, from + 5, "", () => e.view.state.tr));
    expect(handled).toBe(true);
    expect(e.md()).toBe("{~~Hello~>H~~}{>>@Tal<<} world.");
    e.type("i");
    expect(e.md()).toBe("{~~Hello~>Hi~~}{>>@Tal<<} world.");
  });

  it("a block join is restored (not inlined) and existing deletions keep their author", async () => {
    const e = await open("First para.\n\nSecond para.", true, "Bob");
    // Backspace at the start of the second paragraph: delete the boundary.
    const start = e.at("Second");
    e.view.dispatch(e.view.state.tr.delete(start - 2, start));
    expect(e.view.state.doc.childCount).toBe(2);
    expect(e.md()).toBe("First para.\n\nSecond para.");
    // Bob deletes across Alice's deletion: Alice's stays Alice's.
    const a = await open("Keep {--old--}{>>@Alice<<} text.", true, "Bob");
    const from = a.at("Keep ");
    a.select(from + 3, a.at(" text"));
    a.backspace();
    expect(a.md()).toBe("Kee{--p --}{>>@Bob<<}{--old--}{>>@Alice<<} text.");
  });

  it("blocks structural insertions and keeps the author when typing inside an insertion", async () => {
    const e = await open("One paragraph here.", true, "Bob");
    // Enter in the middle of the paragraph: a block split.
    e.select(e.at(" here"));
    e.view.dispatch(e.view.state.tr.split(e.at(" here")));
    expect(e.view.state.doc.childCount).toBe(1);
    expect(e.md()).toBe("One paragraph here.");
    // Bob types inside Alice's insertion: still Alice's suggestion.
    const a = await open("Say {++hello there++}{>>@Alice<<} now.", true, "Bob");
    a.select(a.at("hello", 5));
    a.type(" big");
    expect(a.md()).toBe("Say {++hello big there++}{>>@Alice<<} now.");
  });

  it("refuses insertions that would form a CriticMarkup delimiter", async () => {
    const e = await open("Hello world.", true);
    e.select(e.at(" world"));
    e.type("a++}b");
    expect(e.md()).toBe("Hello world.");
    // Typed one character at a time: the last one completes `++}`.
    const t = await open("Hello world.", true);
    t.select(t.at(" world"));
    for (const ch of "x++}") t.type(ch);
    expect(t.md()).toBe("Hello{++x++++}{>>@Tal<<} world.");
  });

  it("deleting your own suggested insertion really deletes it", async () => {
    const e = await open("Hello world.", true);
    e.select(e.at(" world"));
    e.type("!!");
    e.backspace();
    e.backspace();
    expect(e.md()).toBe("Hello world.");
  });

  it("deleting own insertion plus a hard break keeps the break", async () => {
    const e = await open("Hello world.", true);
    e.select(e.at(" world"));
    e.type("!!");
    const at = e.at("!!");
    const br = e.view.state.schema.nodes.hardbreak ?? e.view.state.schema.nodes.hard_break;
    // Put an unmarked hard break right after the insertion (outside suggesting's tracking).
    e.view.dispatch(e.view.state.tr.insert(at + 2, br.create()).setMeta("lumenSuggest", true));
    e.view.dispatch(e.view.state.tr.delete(at, at + 3));
    let breaks = 0;
    e.view.state.doc.descendants((n) => void (n.type === br && breaks++));
    expect(breaks).toBe(1);
    expect(e.view.state.doc.textContent).toBe("Hello\n world."); // own "!!" goes, the break stays
  });

  it("deleting own insertion across a paragraph boundary keeps the boundary", async () => {
    const e = await open("First.\n\nSecond.", true);
    e.select(e.at("First", 5));
    e.type(" added");
    const from = e.at(" added");
    e.view.dispatch(e.view.state.tr.delete(from, e.at("Second")));
    expect(e.view.state.doc.childCount).toBe(2);
  });

  it("an open single-paragraph slice is inline content, two paragraphs are structure", async () => {
    const { isStructural } = await import("../editor/wysiwygSuggest");
    const e = await open("x", true);
    const { Slice, Fragment } = await import("@milkdown/prose/model");
    const sc = e.view.state.schema;
    const p = (t: string) => sc.nodes.paragraph.create(null, sc.text(t));
    expect(isStructural(new Slice(Fragment.from(p("a")), 1, 1))).toBe(false);
    expect(isStructural(new Slice(Fragment.from([p("a"), p("b")]), 1, 1))).toBe(true);
    expect(isStructural(new Slice(Fragment.from(p("a")), 0, 0))).toBe(true);
  });

  it("refuses deleting a whole block and deletions that join into a delimiter", async () => {
    const e = await open("First.\n\nSecond.", true);
    const start = e.at("Second") - 1;
    e.view.dispatch(e.view.state.tr.delete(start, start + e.view.state.doc.child(1).nodeSize));
    expect(e.view.state.doc.childCount).toBe(2);
    const t = await open("Say a+X+}b now.", true);
    t.view.dispatch(t.view.state.tr.delete(t.at("X"), t.at("X") + 1));
    expect(t.md()).toBe("Say a+X+}b now.");
  });

  it("refuses a replacement whose text would form a delimiter, deletion included", async () => {
    const e = await open("Hello world.", true);
    e.select(e.at("world"), e.at("world", 5));
    e.type("a++}b");
    expect(e.md()).toBe("Hello world.");
  });

  it("is off when suggesting is off", async () => {
    const e = await open("Hello world.", false);
    e.select(e.at(" world"));
    e.type(" big");
    expect(e.md()).toBe("Hello big world.");
  });
});

describe("accept / reject in WYSIWYG", () => {
  it("resolves the change at the cursor and jumps between changes", async () => {
    const e = await open("A {++one++} B {--two--} C {~~x~>y~~} D", false);
    e.select(e.at("A"));
    expect(jumpToChange(e.view, 1)).toBe(true);
    expect(resolveAtCursor(e.view, "accept")).toBe(true); // one stays
    expect(jumpToChange(e.view, 1)).toBe(true);
    expect(resolveAtCursor(e.view, "reject")).toBe(true); // two stays
    expect(jumpToChange(e.view, 1)).toBe(true);
    expect(resolveAtCursor(e.view, "accept")).toBe(true); // x → y
    expect(e.md()).toBe("A one B two C y D");
    expect(jumpToChange(e.view, 1)).toBe(false);
  });

  it("next / previous wrap around at the last / first change, as in source mode", async () => {
    const e = await open("A {++one++} B {--two--} C", false);
    e.select(e.at(" C"));
    expect(jumpToChange(e.view, 1)).toBe(true);
    expect(e.view.state.selection.head).toBe(e.at("one"));
    e.select(e.at("A"));
    expect(jumpToChange(e.view, -1)).toBe(true);
    expect(e.view.state.selection.head).toBe(e.at("two"));
  });

  it("resolves different authors' adjacent changes separately", async () => {
    const e = await open("Keep {--old--}{>>@Alice<<}{++new++}{>>@Bob<<} end.", false);
    e.select(e.at("old", 1));
    expect(resolveAtCursor(e.view, "reject")).toBe(true); // only Alice's deletion
    expect(e.md()).toBe("Keep old{++new++}{>>@Bob<<} end.");
    // "Next change" from Alice's deletion moves to Bob's insertion.
    const jump = await open("Keep {--old--}{>>@Alice<<}{++new++}{>>@Bob<<} end.", false);
    jump.select(jump.at("old", 1));
    expect(jumpToChange(jump.view, 1)).toBe(true);
    expect(jump.view.state.selection.head).toBe(jump.at("new"));
    const same = await open("Keep {~~old~>new~~}{>>@Tal<<} end.", false);
    same.select(same.at("old", 1));
    expect(jumpToChange(same.view, 1)).toBe(true); // one substitution: wraps to its own start
    expect(same.view.state.selection.head).toBe(same.at("old"));
    same.select(same.at("old", 1));
    expect(resolveAtCursor(same.view, "accept")).toBe(true); // one substitution
    expect(same.md()).toBe("Keep new end.");
  });
});
