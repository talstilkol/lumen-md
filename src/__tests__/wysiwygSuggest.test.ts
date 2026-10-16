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
    // Firefox: typing "i" over "Hello" can arrive as a diff over "ello" only.
    const handled = e.view.someProp("handleTextInput", (f) => f(e.view, from + 1, from + 5, "i", () => e.view.state.tr));
    expect(handled).toBe(true);
    expect(e.md()).toBe("{~~Hello~>i~~}{>>@Tal<<} world.");
  });

  it("deleting your own suggested insertion really deletes it", async () => {
    const e = await open("Hello world.", true);
    e.select(e.at(" world"));
    e.type("!!");
    e.backspace();
    e.backspace();
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
    expect(jumpToChange(same.view, 1)).toBe(false); // one substitution, nothing after it
    same.select(same.at("old", 1));
    expect(resolveAtCursor(same.view, "accept")).toBe(true); // one substitution
    expect(same.md()).toBe("Keep new end.");
  });
});
