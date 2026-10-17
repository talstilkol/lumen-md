/**
 * WYSIWYG keeps CriticMarkup suggestions intact. Milkdown alone escapes
 * the `~>` of a substitution in text (`\~>`); with the suggestion plugin a
 * substitution is two marks and its handler writes the separator itself,
 * so the emitted markdown needs no string-level repair — which couldn't
 * tell an escape the serializer added from a backslash in the document.
 */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { Editor, rootCtx, defaultValueCtx } from "@milkdown/core";
import { commonmark } from "@milkdown/preset-commonmark";
import { gfm } from "@milkdown/preset-gfm";
import { getMarkdown } from "@milkdown/utils";
import WysiwygEditor from "../editor/WysiwygEditor";
import { encodeCriticForWysiwyg, getActiveWysiwygView, wysiwygSuggestPlugins } from "../editor/wysiwygSuggest";
import { parseSuggestions } from "../editor/suggesting";

vi.mock("../ai/llm", () => ({
  chat: vi.fn(),
  chatStream: vi.fn(),
  AiError: class AiError extends Error {},
}));

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

async function roundTrip(src: string, plugin: boolean): Promise<string> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  let make = Editor.make().config((ctx) => {
    ctx.set(rootCtx, host);
    ctx.set(defaultValueCtx, plugin ? encodeCriticForWysiwyg(src) : src);
  });
  if (plugin) make = make.use(wysiwygSuggestPlugins);
  const ed = await make.use(commonmark).use(gfm).create();
  const out = ed.action(getMarkdown());
  await ed.destroy();
  host.remove();
  return out;
}

describe("CriticMarkup through the WYSIWYG serializer", () => {
  it("Milkdown alone escapes the separator; the suggestion plugin writes it as is", async () => {
    const src = "Keep {~~old~>new~~}{>>@Tal<<}, {++added++} and {--gone--}.\n";
    expect(await roundTrip(src, false)).toContain("\\~>");
    const out = await roundTrip(src, true);
    expect(out).toBe(src);
    expect(parseSuggestions(out).map((s) => s.kind)).toEqual(["substitute", "insert", "delete"]);
  });

  it("keeps a backslash in the document, and code, byte for byte", async () => {
    const src = "Fix {~~old\\~>new~~} and {~~use `old`~>use `new`~~}, not `{~~a\\~>b~~}`.\n";
    expect(await roundTrip(src, true)).toBe(src);
  });

  it("emits a backslash before a substitution's separator unchanged after an edit", async () => {
    const onChange = vi.fn();
    render(<WysiwygEditor value={"Fix {~~old\\~>new~~} and {~~a~>b~~} now"} onChange={onChange} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    const view = getActiveWysiwygView()!;
    await act(async () => {
      view.dispatch(view.state.tr.insertText("!", view.state.doc.content.size - 1));
      await new Promise((r) => setTimeout(r, 400));
    });
    expect(onChange).toHaveBeenLastCalledWith("Fix {~~old\\~>new~~} and {~~a~>b~~} now!\n");
  });
});
