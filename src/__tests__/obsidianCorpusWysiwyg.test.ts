/**
 * W10.E47 (W4.30) — WYSIWYG round trip over the real Obsidian corpus.
 *
 * obsidianCorpus.test.ts proves the source editor's open → save path on the
 * pinned public vaults (fixtures/obsidian-corpus, manifest.json); this file
 * runs the same notes through the WYSIWYG editor: real Milkdown with the
 * editor's own syntax plugins, in the order WysiwygEditor.tsx uses them, and
 * the source-preserving save (wysiwygSource.ts). The same harness as
 * mdRoundTrip.test.ts, on the Obsidian corpus instead of the repo's docs.
 *
 * For every note (and its CRLF copy):
 * - opened and saved unedited: byte-identical;
 * - one character typed at the end of the last paragraph: the character is
 *   there and every other block keeps its source bytes.
 * Gate: zero differences, except the notes listed in EXCEPTIONS with the
 * reason (none today). The serializer-only half of this check runs without
 * the editor in obsidianCorpusPreserve.test.ts.
 *
 * Report: test-results/obsidian-wysiwyg/report.md (per-note result and
 * Milkdown's own serialization diff).
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Editor, rootCtx, defaultValueCtx, editorViewCtx, remarkStringifyOptionsCtx } from "@milkdown/core";
import { commonmark } from "@milkdown/preset-commonmark";
import { gfm } from "@milkdown/preset-gfm";
import { math } from "@milkdown/plugin-math";
import { getMarkdown } from "@milkdown/utils";
import type { Node as PmNode } from "@milkdown/prose/model";
import type { Options as ToMarkdownOptions } from "mdast-util-to-markdown";
import { listSpreadFix } from "../editor/milkdownListSpread";
import { wysiwygObsidianPlugins } from "../editor/wysiwygObsidian";
import { encodeCriticForWysiwyg, wysiwygSuggestPlugins } from "../editor/wysiwygSuggest";
import { splitFrontmatter } from "../editor/wysiwygFrontmatter";
import { splitMarkdownBlocks, wysiwygSourcePreserver } from "../editor/wysiwygSource";
import { roundTripSafe } from "../editor/markdownSerialize.mjs";
import { keepWikiLinks, protectEscapedWikiLinks } from "../editor/wysiwygWikiLinks";

vi.mock("../ai/llm", () => ({ chat: vi.fn(), chatStream: vi.fn(), AiError: class AiError extends Error {} }));

/** Notes that may differ, each with the reason. Adding one needs the reason and an issue. */
const EXCEPTIONS: Record<string, string> = {};

const root = join(__dirname, "fixtures", "obsidian-corpus");
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")) as {
  vaults: Array<{ id: string; files: Array<{ path: string }> }>;
};
const notes = manifest.vaults.flatMap((v) =>
  v.files.filter((f) => f.path.endsWith(".md")).map((f) => ({ name: `${v.id}/${f.path}`, text: readFileSync(join(root, v.id, f.path), "utf8") })),
);
const corpus = [...notes, ...notes.map((n) => ({ name: `${n.name} (CRLF)`, text: n.text.replace(/\r?\n/g, "\r\n") }))];

function firstDiff(a: string, b: string): string {
  if (a === b) return "";
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const show = (s: string) => JSON.stringify(s.slice(Math.max(0, i - 30), i + 50));
  return `line ${a.slice(0, i).split("\n").length}: file ${show(a)} → saved ${show(b)}`;
}

async function openWysiwyg(text: string) {
  const { fm, body } = splitFrontmatter(text);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const ed = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, host);
      ctx.set(defaultValueCtx, encodeCriticForWysiwyg(protectEscapedWikiLinks(body)));
      ctx.update(remarkStringifyOptionsCtx, (o: ToMarkdownOptions) => roundTripSafe(keepWikiLinks(o)));
    })
    .use(wysiwygSuggestPlugins)
    .use(commonmark)
    .use(gfm)
    .use(listSpreadFix)
    .use(wysiwygObsidianPlugins)
    .use(math)
    .create();
  const loaded = ed.action(getMarkdown());
  return { ed, host, fm, body, loaded, preserver: wysiwygSourcePreserver(body, loaded) };
}

function keptBlocks(original: string, saved: string): { kept: number; total: number } {
  const blocks = splitMarkdownBlocks(original);
  let at = 0;
  let kept = 0;
  for (const b of blocks) {
    const i = saved.indexOf(original.slice(b.start, b.end), at);
    if (i >= 0) {
      kept++;
      at = i + (b.end - b.start);
    }
  }
  return { kept, total: blocks.length };
}

interface Row {
  name: string;
  raw: boolean;
  pass: boolean;
  detail: string;
  rawDiff: string;
}
const rows: Row[] = [];

afterAll(async () => {
  try {
    const fs = await import("node:fs");
    const dir = "test-results/obsidian-wysiwyg";
    fs.mkdirSync(dir, { recursive: true });
    const md = [
      "# WYSIWYG round trip, Obsidian corpus (W10.E47)",
      "",
      `Notes: ${notes.length} (+ ${notes.length} CRLF copies). Pass: ${rows.filter((r) => r.pass).length}/${rows.length}. Milkdown's own serialization identical: ${rows.filter((r) => r.raw).length}.`,
      "",
      "| Note | Result | Milkdown serialization |",
      "| --- | --- | --- |",
      ...rows.map((r) => `| ${r.name} | ${r.pass ? "pass" : r.detail.replace(/\|/g, "\\|")} | ${r.raw ? "identical" : r.rawDiff.replace(/\|/g, "\\|")} |`),
    ];
    fs.writeFileSync(`${dir}/report.md`, md.join("\n"));
    fs.writeFileSync(`${dir}/report.json`, JSON.stringify(rows, null, 2));
  } catch {
    // why: the report is an extra for the reader; the assertions decide the test
  }
});

describe("WYSIWYG (Milkdown) round trip over the Obsidian corpus (W10.E47)", () => {
  it("has the whole corpus", () => {
    expect(notes.length).toBeGreaterThanOrEqual(300);
    for (const name of Object.keys(EXCEPTIONS)) expect(corpus.some((n) => n.name === name), name).toBe(true);
  });

  it(
    "every note saves unedited byte for byte, and an edit touches only its own block",
    async () => {
      for (const f of corpus) {
        const row: Row = { name: f.name, raw: false, pass: false, detail: "", rawDiff: "" };
        rows.push(row);
        let opened: Awaited<ReturnType<typeof openWysiwyg>> | null = null;
        try {
          opened = await openWysiwyg(f.text);
          const { ed, fm, body, loaded, preserver } = opened;
          row.raw = fm + loaded === f.text;
          row.rawDiff = firstDiff(f.text, fm + loaded);
          const unedited = fm + preserver.restore(loaded);
          if (unedited !== f.text) row.detail = `unedited: ${firstDiff(f.text, unedited)}`;
          const view = ed.action((ctx) => ctx.get(editorViewCtx));
          let at = -1;
          view.state.doc.descendants((n: PmNode, pos: number) => {
            if (n.isTextblock && !n.type.spec.code && n.content.size > 0) at = pos + n.nodeSize - 1;
            return true;
          });
          if (at >= 0) {
            view.dispatch(view.state.tr.insertText("Z", at));
            const saved = preserver.restore(ed.action(getMarkdown()));
            const { kept, total } = keptBlocks(body, saved);
            const lead = body.slice(0, splitMarkdownBlocks(body)[0]?.start ?? 0);
            if (!saved.includes("Z") || kept < total - 1 || !saved.startsWith(lead)) row.detail += ` edited: kept ${kept}/${total} blocks`;
          }
        } catch (e) {
          row.detail = `threw: ${e instanceof Error ? e.message : String(e)}`;
        } finally {
          if (opened) {
            await opened.ed.destroy(true).catch(() => {
              // why: teardown of an editor that may already be gone; the row holds the result
            });
            opened.host.remove();
          }
        }
        row.pass = row.detail === "";
      }
      const unexpected = rows.filter((r) => !r.pass && !(r.name in EXCEPTIONS)).map((r) => `${r.name}: ${r.detail}`);
      const stale = Object.keys(EXCEPTIONS).filter((n) => rows.find((r) => r.name === n)?.pass);
      expect(unexpected).toEqual([]);
      expect(stale, "listed as an exception but passes now: remove it").toEqual([]);
    },
    1_800_000,
  );
});
