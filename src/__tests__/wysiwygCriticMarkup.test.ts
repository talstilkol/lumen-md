/**
 * WYSIWYG keeps CriticMarkup suggestions intact: Milkdown's serializer
 * escapes the `~>` of a substitution, which would silently turn the
 * suggestion into plain text after any WYSIWYG edit.
 */
import { describe, it, expect } from "vitest";
import { Editor, rootCtx, defaultValueCtx } from "@milkdown/core";
import { commonmark } from "@milkdown/preset-commonmark";
import { gfm } from "@milkdown/preset-gfm";
import { getMarkdown } from "@milkdown/utils";
import { repairCriticMarkup } from "../editor/WysiwygEditor";
import { parseSuggestions } from "../editor/suggesting";

async function roundTrip(src: string): Promise<string> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const ed = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, host);
      ctx.set(defaultValueCtx, src);
    })
    .use(commonmark)
    .use(gfm)
    .create();
  const out = ed.action(getMarkdown());
  await ed.destroy();
  host.remove();
  return out;
}

describe("CriticMarkup through the WYSIWYG serializer", () => {
  it("Milkdown alone breaks substitutions; the repair restores them", async () => {
    const src = "Keep {~~old~>new~~}{>>@Tal<<}, {++added++} and {--gone--}.\n";
    const raw = await roundTrip(src);
    expect(raw).toContain("\\~>"); // the bug being repaired
    const fixed = repairCriticMarkup(raw);
    expect(fixed.trim()).toBe(src.trim());
    expect(parseSuggestions(fixed).map((s) => s.kind)).toEqual(["substitute", "insert", "delete"]);
  });

  it("only touches the delimiter of a substitution", () => {
    expect(repairCriticMarkup("a \\~> b")).toBe("a \\~> b");
    expect(repairCriticMarkup("{~~a\\_b\\~>c~~} and {~~x\\~>y~~}")).toBe("{~~a\\_b~>c~~} and {~~x~>y~~}");
  });
});
