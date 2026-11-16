/**
 * W11.Q8 (research R5.9): CommonMark 0.31.2 conformance as a published
 * number (eval/results/md-conformance.json, scripts/md-conformance.mjs), and
 * property tests over the spec's 652 examples.
 *
 * Runs now, on the real packages at the lockfile's versions:
 *   - the parser (micromark) gives the spec's HTML for all 652 examples;
 *   - Markdown → AST → Markdown, with the app's handlers
 *     (src/editor/markdownSerialize.mjs), keeps the HTML for all but 5, each
 *     with its reason (serializer bugs in mdast-util-to-markdown 2.1.2):
 *     647/652, over the 99% target. Nested emphasis (461, 463) and an
 *     indented HTML block after a list are fixed and pinned below;
 *   - the committed results file is what a run gives now.
 *
 * Property tests (fast-check, installed with W10.M2) are skipped until the
 * package is there, and say so:
 *   - round trip and idempotence of random concatenations of spec examples;
 *   - E2EE: decrypt(encrypt(x)) = x, and a flipped byte is rejected;
 *   - Yjs: two replicas converge whatever the order of the updates.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { micromark } from "micromark";
import { fromMarkdown } from "mdast-util-from-markdown";
import { toMarkdown } from "mdast-util-to-markdown";
import { roundTripSafe } from "../editor/markdownSerialize.mjs";
import { parseSpec } from "./helpers/mdSpec";
import { OUT, ROUND_TRIP_EXCEPTIONS, SPEC, TARGET, mdCards, parseSpecText, rowScores, score } from "../../scripts/md-conformance.mjs";
// @ts-expect-error plain JavaScript
import { validateCard } from "../../scripts/lib/evalCard.mjs";

const text = readFileSync(SPEC, "utf8");
const examples = parseSpecText(text);
const versions = (n: string) => JSON.parse(readFileSync(`node_modules/${n}/package.json`, "utf8")).version as string;
const P = { micromark, fromMarkdown, toMarkdown: (tree: never) => toMarkdown(tree, roundTripSafe()), versions: { micromark: versions("micromark"), "mdast-util-from-markdown": versions("mdast-util-from-markdown"), "mdast-util-to-markdown": versions("mdast-util-to-markdown") } };
const OPTS = { allowDangerousHtml: true, allowDangerousProtocol: true };
const html = (md: string) => micromark(md, OPTS);
/** Block-level HTML with the whitespace between blocks dropped (a link definition leaves an empty line, nothing else). */
const blocks = (h: string) => h.replace(/>\s+</g, "><").trim();
/** Examples 20 and 603: an autolink with a backslash in it. */
const AUTOLINK_BACKSLASH = /<[a-z][a-z0-9+.-]{1,31}:[^\s<>]*\\/i;
/** Saving through the AST the way the app does (remark-stringify with roundTripSafe). */
const roundTrip = (md: string) => toMarkdown(fromMarkdown(md), roundTripSafe());
/** The serializer without the app's handlers, to show each fix is needed. */
const plainRoundTrip = (md: string) => toMarkdown(fromMarkdown(md));

/** The parts of fast-check and Yjs these properties use (both are optional here). */
type Fn = (...args: unknown[]) => unknown;
type FastCheck = Record<"assert" | "property" | "asyncProperty" | "array" | "constantFrom" | "oneof" | "string" | "nat" | "boolean" | "tuple", Fn>;
interface YText {
  insert(at: number, s: string): void;
  length: number;
  toString(): string;
}
interface YDoc {
  getText(name: string): YText;
}
interface Yjs {
  Doc: new () => YDoc;
  encodeStateVector(d: YDoc): Uint8Array;
  encodeStateAsUpdate(d: YDoc, sv?: Uint8Array): Uint8Array;
  applyUpdate(d: YDoc, u: Uint8Array): void;
}

/** A module that loads and works (an offline runner may hand back a stand-in that throws when used). */
function usable<T>(m: T, probe: (m: T) => unknown): T | null {
  try {
    probe(m);
    return m;
  } catch {
    return null;
  }
}

/** fast-check, when installed (W10.M2); otherwise the reason the properties are skipped. */
const fc = await import("fast-check" as string).then(
  (m: { default?: FastCheck } & FastCheck) => usable((m.default ?? m) as FastCheck, (f) => f.nat()),
  () => null,
);
const NO_FC = fc ? null : "fast-check is not installed yet (W10.M2 adds it as a dev dependency)";
const Y = await import("yjs" as string).then(
  (m: Yjs) => usable(m, (y) => new y.Doc().getText("t")),
  () => null,
);

describe("CommonMark 0.31.2 conformance (W11.Q8)", () => {
  it("reads the 652 examples of the vendored spec, the same as the conformance suite does", () => {
    expect(examples).toHaveLength(652);
    const theirs = parseSpec(text);
    expect(theirs).toHaveLength(652);
    expect(examples.map((e: { markdown: string }) => e.markdown)).toEqual(theirs.map((e) => e.markdown));
  });

  it("the parser gives the spec's HTML for every example, byte for byte", () => {
    const [parser] = score(examples, P);
    expect(parser.exceptions).toEqual([]);
    expect(parser.passed).toBe(652);
    expect(parser.rate).toBeGreaterThanOrEqual(TARGET);
  });

  it("Markdown → AST → Markdown keeps the meaning of all but the 5 listed examples, each with its reason: ≥ 99%", () => {
    const [, rt] = score(examples, P);
    expect(rt.exceptions.map((e: { example: number }) => e.example)).toEqual(Object.keys(ROUND_TRIP_EXCEPTIONS).map(Number));
    expect(rt.exceptions.map((e: { example: number }) => e.example)).toEqual([20, 39, 148, 187, 603]);
    for (const e of rt.exceptions) expect(e.reason).not.toBe("not explained yet");
    expect(rt.passed).toBe(647);
    expect(rt.rate).toBeGreaterThanOrEqual(TARGET);
  });

  it("examples 461 and 463: nested emphasis is saved as nested emphasis, not as strong", () => {
    for (const n of [461, 463]) {
      const md = examples[n - 1].markdown;
      expect(html(roundTrip(md)), `example ${n}`).toBe(html(md));
      expect(html(roundTrip(md))).toBe("<p><em><em>foo</em></em></p>\n");
      // Without the app's handler it reads as strong (the bug).
      expect(html(plainRoundTrip(md))).toBe("<p><strong>foo</strong></p>\n");
    }
    expect(roundTrip("*_foo_*\n")).toBe("*_foo_*\n");
    expect(roundTrip("_*foo*_\n")).toBe("*_foo_*\n");
    // Nested emphasis that does not touch the outer marker keeps it, and strong is untouched.
    expect(roundTrip("*a *b* c*\n")).toBe("*a *b* c*\n");
    expect(roundTrip("**foo**\n")).toBe("**foo**\n");
    expect(html(roundTrip("_a *_b_* c_\n"))).toBe(html("_a *_b_* c_\n"));
  });

  it("regression (seeded concatenation property): an indented HTML block after a list stays out of the list", () => {
    // Found by a seeded run of the concatenation property: a nested list example followed by an indented <div> example.
    const md = "10) foo\n   - bar\n\n\n  <div>\n";
    expect(blocks(html(md))).toBe('<ol start="10"><li>foo</li></ol><ul><li>bar</li></ul><div>');
    expect(roundTrip(md)).toBe("10. foo\n\n* bar\n\n<div>\n");
    expect(blocks(html(roundTrip(md)))).toBe(blocks(html(md)));
    // Without the app's handler the <div> joins the list (the bug).
    expect(blocks(html(plainRoundTrip(md)))).toBe('<ol start="10"><li>foo</li></ol><ul><li><p>bar</p><div></li></ul>');
    // An indented HTML block anywhere else keeps its indentation byte for byte.
    expect(roundTrip("  <div>\n  *hi*\n")).toBe("  <div>\n  *hi*\n");
    expect(roundTrip("para\n\n   <!-- c -->\n")).toBe("para\n\n   <!-- c -->\n");
  });

  it("the concatenation property, seeded (no fast-check needed): 2,000 random notes of spec examples keep their HTML", () => {
    const clean = examples.filter((e: { example: number }) => !(e.example in ROUND_TRIP_EXCEPTIONS)).map((e: { markdown: string }) => e.markdown);
    let seed = 20261115;
    const rnd = (n: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % n;
    };
    const bad: string[] = [];
    let checked = 0;
    for (let run = 0; run < 2000; run++) {
      const parts = Array.from({ length: 1 + rnd(6) }, () => clean[rnd(clean.length)]);
      const md = parts.join("\n\n");
      // Only notes whose parts stay separate blocks (an unclosed fence or a definition can swallow or change the next part).
      if (blocks(html(md)) !== blocks(parts.map(html).join(""))) continue;
      checked++;
      if (blocks(html(roundTrip(md))) !== blocks(html(md))) bad.push(md);
    }
    expect(checked).toBeGreaterThan(500);
    expect(bad.slice(0, 3)).toEqual([]);
  });

  it("the committed eval/results/md-conformance.json is what a run gives now, origin real", () => {
    const committed = JSON.parse(readFileSync(OUT, "utf8"));
    expect(committed.origin).toBe("real");
    expect(committed.versions).toEqual(P.versions);
    const fresh = score(examples, P);
    expect(committed.rows.filter((r: { kind: string }) => r.kind !== "app")).toEqual(fresh);
  });

  it("the committed results carry their eval card (W11.I18): round-trip dev, parser public, built from the rows", () => {
    const committed = JSON.parse(readFileSync(OUT, "utf8"));
    const fresh = score(examples, P);
    expect(validateCard(committed.card)).toEqual([]);
    expect(committed.card).toEqual(mdCards(fresh, P.versions).card);
    expect(committed.cards).toEqual(mdCards(fresh, P.versions).cards);
    expect(committed.card.tag).toBe("dev");
    expect(committed.cards.parser.tag).toBe("public");
    expect(validateCard(committed.cards.parser)).toEqual([]);
    const rt = fresh.find((r: { kind: string }) => r.kind === "round-trip");
    if (!rt) throw new Error("score() gave no round-trip row");
    expect(committed.card.n).toBe(rt.total);
    expect(committed.card.metrics.html_kept.value).toBeCloseTo(rt.passed / rt.total, 6);
    // rowScores refuses a row whose exceptions do not account for its failures.
    expect(() => rowScores({ ...rt, exceptions: rt.exceptions.slice(1) })).toThrow(/exceptions listed/);
  });
});

// skip-reason: fast-check is not installed until W10.M2 adds it as a dev dependency; the reason is printed in the title | task: W11.Q8 | until: 2027-05-16
describe.skipIf(NO_FC !== null)(`property tests${NO_FC ? ` — skipped: ${NO_FC}` : ""}`, () => {
  const clean = examples.filter((e: { example: number }) => !(e.example in ROUND_TRIP_EXCEPTIONS)).map((e: { markdown: string }) => e.markdown);

  it("any sequence of spec examples, as blocks of one note, keeps its HTML through the AST", () => {
    fc!.assert(
      fc!.property(fc!.array(fc!.constantFrom(...clean), { minLength: 1, maxLength: 6 }), (parts: string[]) => {
        const md = parts.join("\n\n");
        // Only notes whose parts stay separate blocks (an unclosed fence or a definition can swallow or change the next part).
        if (blocks(html(md)) !== blocks(parts.map(html).join(""))) return true;
        return blocks(html(roundTrip(md))) === blocks(html(md));
      }),
      { numRuns: 300 },
    );
  });

  it("saving through the AST twice gives what saving once gave (idempotence), for spec examples and random text", () => {
    fc!.assert(
      // A backslash inside an autolink is escaped again on every save (examples 20 and 603): known, left out.
      fc!.property(fc!.oneof(fc!.constantFrom(...clean), fc!.string({ maxLength: 80 })), (md: string) => AUTOLINK_BACKSLASH.test(md) || roundTrip(roundTrip(md)) === roundTrip(md)),
      { numRuns: 500 },
    );
  });

  it("E2EE: decrypt(encrypt(x)) = x for any text, and a flipped byte is rejected", async () => {
    const { decryptText, encryptText } = await import("../storage/encryption");
    await fc!.assert(
      fc!.asyncProperty(fc!.string({ maxLength: 200 }), fc!.nat(), async (plain: string, at: number) => {
        const sealed = await encryptText(plain, "correct horse battery staple");
        if ((await decryptText(sealed, "correct horse battery staple")) !== plain) return false;
        const bytes = Uint8Array.from(atob(sealed), (c) => c.charCodeAt(0));
        bytes[at % bytes.length] ^= 0x01;
        const tampered = btoa(String.fromCharCode(...bytes));
        return decryptText(tampered, "correct horse battery staple").then(() => false, () => true);
      }),
      { numRuns: 40 },
    );
  });

  // skip-reason: the convergence property needs yjs installed; the reason is printed in the title | task: W11.Q8 | until: 2027-05-16
  it.skipIf(!Y)(`Yjs: two replicas converge whatever order their updates arrive in${Y ? "" : " — skipped: yjs is not installed here"}`, () => {
    const Yjs = Y!;
    fc!.assert(
      fc!.property(fc!.array(fc!.tuple(fc!.boolean(), fc!.nat(40), fc!.string({ minLength: 1, maxLength: 4 })), { minLength: 1, maxLength: 20 }), fc!.boolean(), (ops: Array<[boolean, number, string]>, reverse: boolean) => {
        const a = new Yjs.Doc();
        const b = new Yjs.Doc();
        const updates: Uint8Array[] = [];
        for (const [onA, pos, s] of ops) {
          const d = onA ? a : b;
          const t = d.getText("t");
          const before = Yjs.encodeStateVector(d);
          t.insert(Math.min(pos, t.length), s);
          updates.push(Yjs.encodeStateAsUpdate(d, before));
        }
        const c = new Yjs.Doc();
        const e = new Yjs.Doc();
        for (const u of updates) Yjs.applyUpdate(c, u);
        for (const u of reverse ? [...updates].reverse() : updates) Yjs.applyUpdate(e, u);
        return c.getText("t").toString() === e.getText("t").toString();
      }),
      { numRuns: 200 },
    );
  });
});
