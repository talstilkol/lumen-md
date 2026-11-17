/**
 * Follow-up wave FC2: the harnesses that were owed —
 *   4.6   scripts/golden/evals/unlinked.mjs   (the dev split scored for real here)
 *   4.15  scripts/golden/evals/clipper.mjs    (its scoring; the extraction runs on the Mac)
 *   6.6   scripts/caption/rating-sheet.mjs    (sheet and scorer)
 *   6.15  scripts/golden/evals/data-analysis.model.mjs (the model mode's writeCode)
 *   W5.5  scripts/pdf-paste/real-corpus.mjs   (real-PDF loader and scorer)
 *   W5.13 scripts/student/lecture-timing.mjs  (the 90-minute timing harness)
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findUnlinkedMentions } from "../lib/unlinkedMentions";
import { suggestPdfHebrewFix } from "../paste/pdfHebrew";
import * as lectureCore from "../student/lectureCore";
import { analystAgent } from "../agents/defs/analyst";
// @ts-expect-error — plain .mjs harnesses without types
import { scoreWith as scoreUnlinked } from "../../scripts/golden/evals/unlinked.mjs";
// @ts-expect-error — plain .mjs
import { norm, scoreWith as scoreClipper } from "../../scripts/golden/evals/clipper.mjs";
// @ts-expect-error — plain .mjs
import { makeSheet, parseCsv, scoreSheet, toCsv, toHtml } from "../../scripts/caption/rating-sheet.mjs";
// @ts-expect-error — plain .mjs
import { ollamaWriteCode } from "../../scripts/golden/evals/data-analysis.model.mjs";
// @ts-expect-error — plain .mjs
import { pageLines, reviewRows, scoreCorpus, selectLines } from "../../scripts/pdf-paste/real-corpus.mjs";
// @ts-expect-error — plain .mjs
import { guardedFetch, parseWhisperJson, timeLecture, verdict } from "../../scripts/student/lecture-timing.mjs";

const golden = (set: string, file: string) => JSON.parse(readFileSync(join(process.cwd(), "eval/golden", set, "dev", file), "utf8")).items;

describe("4.6 unlinked mentions on the dev split", () => {
  it("scores the app's finder: every labelled mention found, none extra", async () => {
    const items = golden("unlinked", "notes.json");
    const r = await scoreUnlinked((t: string, titles: string[], own: string) => findUnlinkedMentions(t, titles, own), items);
    // eslint-disable-next-line no-console
    console.log("UNLINKED dev", JSON.stringify(r));
    expect(r.mentions).toBeGreaterThan(0);
    expect(r).toMatchObject({ precision: 1, recall: 1, f1: 1, "notes.exact": 1 });
    // The scorer is not blind: a finder that misses one note's mentions loses recall.
    const miss = await scoreUnlinked(async (t: string, titles: string[], own: string) => (t === items[0].text ? [] : findUnlinkedMentions(t, titles, own)), items);
    expect(miss.recall).toBeLessThan(1);
  });
});

describe("4.15 clipper scoring", () => {
  const items = golden("clipper", "pages.json").map((it: { file: string }) => ({ ...it, file: join(process.cwd(), "eval/golden/clipper/dev", it.file) }));

  it("a perfect clip scores 1 everywhere; the whole page (noise kept) is caught", async () => {
    const perfect = async (_html: string, url: string) => {
      const it = items.find((x: { id: string }) => url.endsWith(x.id));
      const e = it.expected;
      return { title: e.title, author: e.author ?? "", markdown: [`# ${e.title}`, ...(e.headings ?? []).map((h: string) => `## ${h}`), ...e.paragraphs].join("\n\n") };
    };
    const p = await scoreClipper(perfect, items);
    expect(p).toMatchObject({ title: 1, paragraphs: 1, order: 1, include: 1, "noise.pages": 0, pages: items.length });
    const whole = async (html: string) => ({ title: "", author: "", markdown: html.replace(/<[^>]+>/g, " ") });
    const w = await scoreClipper(whole, items);
    expect(w.title).toBe(0);
    expect(w["noise.pages"]).toBeGreaterThan(0);
    expect(norm("**Hello** — “world”")).toBe('hello - "world"');
  });
});

describe("6.6 caption rating sheet", () => {
  const items = [
    { id: "a", image: "/x/a.jpg", refs_he: ["כלב"] },
    { id: "b", image: "/x/b.jpg", refs_he: ["חתול"] },
  ];
  const captions = { "florence2@webgpu": { a: "כלב רץ", b: "חתול, ישן" }, "smolvlm@webgpu": { a: "a dog", b: 'cat "sleeping"' } };

  it("blinds the engines, keeps an image's rows together, and round-trips through CSV", () => {
    const { rows, key } = makeSheet(items, captions);
    expect(Object.values(key).sort()).toEqual(Object.keys(captions).sort());
    expect(rows).toHaveLength(4);
    expect(rows.every((r: { engine: string }) => /^[AB]$/.test(r.engine))).toBe(true);
    expect(rows[0].item).toBe(rows[1].item);
    const back = parseCsv(toCsv(rows));
    expect(back[0]).toEqual(["row", "item", "image", "engine", "caption", "reference_he", "rating", "notes"]);
    expect(back.slice(1).map((r: string[]) => r[4]).sort()).toEqual(['a dog', 'cat "sleeping"', "חתול, ישן", "כלב רץ"].sort());
    expect(toHtml(rows)).toContain('<img src="/x/');
  });

  it("scores per engine: mean, share rated 4 or more, and names bad ratings by row", () => {
    const { rows, key } = makeSheet(items, captions);
    const letterOf = Object.fromEntries(Object.entries(key).map(([l, e]) => [e, l]));
    for (const r of rows) r.rating = r.engine === letterOf["florence2@webgpu"] ? "5" : r.item === "a" ? "2" : "4";
    const s = scoreSheet(toCsv(rows), key);
    expect(s.engines["florence2@webgpu"]).toMatchObject({ rated: 2, mean: 5, shareAtLeast4: 1, pass: false, complete: true });
    expect(s.engines["smolvlm@webgpu"]).toMatchObject({ rated: 2, mean: 3, shareAtLeast4: 0.5 });
    expect(s.errors).toEqual([]);
    rows[0].rating = "6";
    expect(scoreSheet(toCsv(rows), key).errors).toEqual([expect.stringMatching(/^row 1: rating "6"/)]);
  });
});

describe("6.15 data-analysis model mode", () => {
  it("asks a loopback Ollama with the agent's prompt, temperature 0 and seed 42, and repairs a broken program once", async () => {
    expect(() => ollamaWriteCode({ url: "http://10.0.0.2:11434", model: "m", def: analystAgent })).toThrow(/local models only/);
    expect(() => ollamaWriteCode({ def: analystAgent })).toThrow(/ANALYST_MODEL/);
    const bodies: Array<Record<string, unknown>> = [];
    const answers = ["print(1)", '```python\nimport csv, io, json\nrows = list(csv.DictReader(io.StringIO(inputs["csv"])))\nprint(json.dumps({"answer": len(rows)}))\n```'];
    const fetchImpl = async (_u: string, init: { body: string; signal: AbortSignal }) => {
      bodies.push(JSON.parse(init.body));
      expect(init.signal).toBeInstanceOf(AbortSignal);
      return new Response(JSON.stringify({ message: { content: answers[bodies.length - 1] } }));
    };
    const write = ollamaWriteCode({ model: "qwen2.5-coder:7b", def: analystAgent, fetchImpl });
    const code = await write("How many rows?", "a,b\n1,2\n3,4", new AbortController().signal);
    expect(code).toContain('inputs["csv"]');
    expect(code).not.toContain("```");
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toMatchObject({ model: "qwen2.5-coder:7b", stream: false, think: false, options: { temperature: 0, seed: 42 } });
    expect((bodies[0]!.messages as Array<{ content: string }>)[1]!.content).toContain("How many rows?");
    expect(JSON.stringify(bodies[1]!.messages)).toContain("not usable");
    const never = ollamaWriteCode({ model: "m", def: analystAgent, fetchImpl: async () => new Response(JSON.stringify({ message: { content: "print(1)" } })) });
    await expect(never("q", "a\n1")).rejects.toThrow(/broke the contract 2 times/);
  });
});

describe("W5.5 real-PDF corpus", () => {
  it("turns pdf.js items into visual and logical lines, Hebrew lines ordered by x", () => {
    const items = [
      { str: "שלום", dir: "rtl", transform: [1, 0, 0, 1, 200, 700], hasEOL: false },
      { str: " עולם", dir: "rtl", transform: [1, 0, 0, 1, 120, 700], hasEOL: true },
      { str: "Hello world", dir: "ltr", transform: [1, 0, 0, 1, 50, 680], hasEOL: true },
    ];
    expect(pageLines(items)).toEqual([
      { visual: "םלוע םולש", logical: "שלום עולם" },
      { visual: "Hello world", logical: "Hello world" },
    ]);
    // A gap wider than 0.15 em between two runs is a space; touching runs join.
    const runs = [
      { str: "ב-", dir: "rtl", transform: [10, 0, 0, 10, 300, 500], width: 12, hasEOL: false },
      { str: "Word", dir: "ltr", transform: [10, 0, 0, 10, 270, 500], width: 30, hasEOL: false },
      { str: "פותחים", dir: "rtl", transform: [10, 0, 0, 10, 200, 500], width: 60, hasEOL: true },
    ];
    expect(pageLines(runs)[0]!.logical).toBe("ב-Word פותחים");
  });

  it("selects Hebrew lines over the files, ids only — no file names", () => {
    const perFile = [
      { sha: "f1", lines: [{ visual: "x", logical: "אבגדהוזחטיכלמנ", page: 1 }, { visual: "y", logical: "short", page: 1 }] },
      { sha: "f2", lines: [{ visual: "z", logical: "פסק הדין ניתן היום בירושלים", page: 2 }] },
    ];
    const s = selectLines(perFile, 10);
    expect(s.map((x: { source: { file: string } }) => x.source.file).sort()).toEqual(["f1", "f2"]);
    expect(s[0].id).toBe("real-001");
  });

  it("scores the app's fix: reversed lines come back logical, controls get no offer", () => {
    const corpus = JSON.parse(readFileSync(join(process.cwd(), "src/__tests__/fixtures/pdf-paste/corpus.json"), "utf8")).items as Array<{ id: string; logical: string; visual: string }>;
    const r = scoreCorpus(corpus, suggestPdfHebrewFix);
    // eslint-disable-next-line no-console
    console.log("PDF-PASTE synthetic through the real-corpus scorer", JSON.stringify({ ...r, misses: r.misses.length }));
    expect(r.reversed).toBeGreaterThan(90);
    expect(r.controlsChanged).toBe(0);
    expect(r.fixedShare).toBeGreaterThanOrEqual(0.95);
    const broken = scoreCorpus(corpus, () => null);
    expect(broken).toMatchObject({ fixed: 0, pass: false });
    // A person's reference replaces the geometric guess, line by line.
    const it = { id: "x", visual: "םולש", logical: "wrong guess" };
    expect(scoreCorpus([it], suggestPdfHebrewFix).fixed).toBe(0);
    expect(scoreCorpus([it], suggestPdfHebrewFix, new Map([["x", "שלום"]]))).toMatchObject({ reference: "person-checked", fixed: 1 });
    expect(reviewRows([it], suggestPdfHebrewFix)[0]).toEqual({ id: "x", visual: "םולש", fixed: suggestPdfHebrewFix("םולש")?.fixed ?? "םולש", guess: "wrong guess", correct: "wrong guess" });
  });
});

describe("W5.13 lecture timing", () => {
  it("parses whisper.cpp -oj, times each stage, links every card, and fails a request off the machine", async () => {
    const segs = parseWhisperJson({ transcription: [{ offsets: { from: 0, to: 4000 }, text: " היום נלמד על חוק שימור האנרגיה. זה חשוב." }, { offsets: { from: 4000, to: 9000 }, text: " האנרגיה הכוללת במערכת סגורה נשמרת תמיד." }] });
    expect(segs[1]).toEqual({ start: 4, end: 9, text: "האנרגיה הכוללת במערכת סגורה נשמרת תמיד." });
    let clock = 0;
    const r = await timeLecture({ core: lectureCore, now: () => (clock += 1000), decode: async () => "in.wav", transcribe: async () => segs, summarize: async () => [] }, { markers: [6] });
    expect(r.stages).toEqual({ decode: 1000, transcribe: 1000, sentences: 1000, summary: 1000, cards: 1000 });
    expect(r.summary.kind).toBe("extractive");
    expect(r.cards).toBeGreaterThan(0);
    expect(r.cardsLinked).toBe(r.cards);
    const net = guardedFetch(async () => new Response("{}"));
    await net.fetch("http://127.0.0.1:11434/api/chat");
    await expect(net.fetch("https://huggingface.co/x")).rejects.toThrow(/refused/);
    expect(verdict(r, net.log)).toMatchObject({ network: { local: 1, remote: 1 }, pass: false });
    expect(verdict(r, { local: 1, remote: [] }).pass).toBe(true);
    expect(verdict({ ...r, totalMs: 21 * 60_000 }, { local: 0, remote: [] }).pass).toBe(false);
  });
});
