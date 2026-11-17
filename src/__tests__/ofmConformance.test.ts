/**
 * Plan 4.7, step 5: Lumen's Obsidian syntax held to Quartz's ofm.ts — the
 * parts embedsOfm.test.ts does not cover: callouts, plain wikilinks and block
 * references.
 *
 * Lumen keeps its own remark implementation (remarkObsidian.ts, remarkEmbeds,
 * remarkBlockIds: workspace resolution, depth and cycle guards, live updates
 * and the WYSIWYG round trip, which ofm.ts does not have). What the plan asked
 * to port is ofm.ts's grammar, and that is ported here verbatim, so the two
 * are compared case by case. Source: jackyzha0/quartz tag v4.5.2
 * (4923affa7722dfc751f1074348e6dad214fe0c08),
 * quartz/plugins/transformers/ofm.ts, MIT License, Copyright (c) 2021
 * jackyzha0: calloutMapping and canonicalizeCallout (lines 63–108),
 * wikilinkRegex (119–121), calloutRegex (134) and blockReferenceRegex (143).
 *
 * Every case must agree, except those in DIVERGENT, where Lumen follows
 * Obsidian's own documentation on purpose.
 *
 * The port found one gap: ofm.ts reads callout metadata (`[!tip|wide]`,
 * Obsidian's `data-callout-metadata`) and Lumen did not, so such a callout
 * rendered as a plain quote. CALLOUT_HEAD now reads it.
 */
import { describe, expect, it } from "vitest";
import { CALLOUT_HEAD, calloutKind, transformCallouts } from "../renderer/remarkObsidian";
import { splitWikiTarget } from "../renderer/wikiLinks";
import { BLOCK_MARK } from "../renderer/remarkBlockIds";

// ── the port (ofm.ts v4.5.2) ──
const calloutMapping = {
  note: "note",
  abstract: "abstract",
  summary: "abstract",
  tldr: "abstract",
  info: "info",
  todo: "todo",
  tip: "tip",
  hint: "tip",
  important: "tip",
  success: "success",
  check: "success",
  done: "success",
  question: "question",
  help: "question",
  faq: "question",
  warning: "warning",
  attention: "warning",
  caution: "warning",
  failure: "failure",
  missing: "failure",
  fail: "failure",
  danger: "danger",
  error: "danger",
  bug: "bug",
  example: "example",
  quote: "quote",
  cite: "quote",
} as const;
function canonicalizeCallout(calloutName: string): string {
  const normalizedCallout = calloutName.toLowerCase() as keyof typeof calloutMapping;
  return calloutMapping[normalizedCallout] ?? calloutName;
}
const wikilinkRegex = /!?\[\[([^[\]|#\\]+)?(#+[^[\]|#\\]+)?(\\?\|[^[\]#]*)?\]\]/;
const calloutRegex = /^\[!([\w-]+)\|?(.+?)?\]([+-]?)/;
const blockReferenceRegex = /\^([-_A-Za-z0-9]+)$/;

/* eslint-disable @typescript-eslint/no-explicit-any -- mdast built by hand */
const callout = (head: string): any => {
  const tree: any = { type: "root", children: [{ type: "blockquote", children: [{ type: "paragraph", children: [{ type: "text", value: `${head}\nBody text.` }] }] }] };
  transformCallouts(tree);
  return tree.children[0];
};

describe("callouts against ofm.ts", () => {
  it("the same type aliases, and the same style for each", () => {
    for (const [alias, kind] of Object.entries(calloutMapping)) expect(calloutKind(alias), alias).toBe(kind);
    for (const alias of Object.keys(calloutMapping)) expect(calloutKind(alias.toUpperCase())).toBe(canonicalizeCallout(alias));
  });

  const HEADS = ["[!note]", "[!TIP]", "[!warning]+", "[!faq]-", "[!tip|wide]", "[!info|no-icon]-", "[!my-custom]", "[!quote|left wide]+"];
  for (const head of HEADS) {
    it(`${head}: type, metadata and fold as ofm.ts reads them`, () => {
      const q = calloutRegex.exec(head)!;
      const l = CALLOUT_HEAD.exec(head);
      expect(l, "Lumen reads it as a callout").not.toBeNull();
      expect({ type: l![1], meta: l![2] ?? null, fold: l![3] }).toEqual({ type: q[1], meta: q[2] ?? null, fold: q[3] });
      const node = callout(`${head} Title`);
      expect(node.data.hProperties["data-callout"]).toBe(q[1].toLowerCase());
      expect(node.data.hProperties["data-callout-metadata"] ?? null).toBe(q[2] ?? null);
      expect(node.data.hName).toBe(q[3] ? "details" : "div");
    });
  }

  it("DIVERGENT: an unknown type keeps its name (data-callout) but takes the note style, as Obsidian draws it; ofm.ts styles it by its own name", () => {
    expect(canonicalizeCallout("my-custom")).toBe("my-custom");
    expect(calloutKind("my-custom")).toBe("note");
    expect(callout("[!my-custom] T").data.hProperties["data-callout"]).toBe("my-custom");
  });
});

describe("plain wikilinks against ofm.ts", () => {
  const CASES = ["[[Note]]", "[[Note#Heading]]", "[[Note|alias]]", "[[Note#Heading|alias]]", "[[folder/Note]]", "[[פתק בעברית#כותרת]]", "[[Note#^block-id]]", "[[Note ]]", "[[ Note#Heading ]]"];
  for (const link of CASES) {
    it(`${link}: the same note and heading`, () => {
      const m = wikilinkRegex.exec(link)!;
      expect(m[0]).toBe(link);
      const [, rawFp, rawHeader] = m;
      const want = { note: (rawFp ?? "").trim(), heading: rawHeader ? rawHeader.replace(/^#+/, "").trim() : null };
      const inner = link.slice(2, -2).split("|")[0];
      const got = splitWikiTarget(inner);
      expect({ note: got.note.trim(), heading: got.heading?.trim() ?? null }).toEqual(want);
    });
  }
});

describe("block references against ofm.ts", () => {
  const SAME = ["A paragraph ^abc123", "Item ^my-block", "^solo", "Text ^ABC-9"];
  for (const line of SAME) {
    it(`"${line}": the same id`, () => {
      expect(BLOCK_MARK.exec(line)?.[2] ?? null).toBe(blockReferenceRegex.exec(line)?.[1] ?? null);
    });
  }
  it("DIVERGENT: Obsidian's ids are letters, digits and dashes after a space; ofm.ts also takes an underscore and no space", () => {
    // obsidian.md/help/links#Link to a block in a note: "Block identifiers can only consist of Latin letters, numbers, and dashes."
    expect(blockReferenceRegex.exec("Text ^my_block")?.[1]).toBe("my_block");
    expect(BLOCK_MARK.exec("Text ^my_block")).toBeNull();
    expect(blockReferenceRegex.exec("x^abc")?.[1]).toBe("abc");
    expect(BLOCK_MARK.exec("x^abc")).toBeNull();
  });
});
