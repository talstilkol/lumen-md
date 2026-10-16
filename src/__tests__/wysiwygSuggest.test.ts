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
    // The serializer keeps whitespace at a mark's edge outside it.
    expect(e.md()).toBe("Hello {++big++}{>>@Tal<<} world.");
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
});
