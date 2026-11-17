/**
 * Plan W13.W12 — titles, abstract and TL;DR where every sentence is
 * anchored in a paragraph of the note: the R12.9 gate deletes the rest.
 * The model is scripted here (adversarial drafts: true sentences, invented
 * facts, a changed number, a flipped polarity); the real-model run is
 * W13.W17 on the Mac, and the annotator preference is W13.W18.
 */
import { describe, expect, it, vi } from "vitest";
import { abstractMarkdown, abstractWriterAgent, anchorSentences, checkTitles, isAcademic, numberedNote, parseDraft, writeAbstract, type AbstractDraft } from "../agents/writing/abstractWriter";
import { noteParagraphs } from "../ai/paragraphAnchors";
// @ts-expect-error — plain .mjs module without type declarations (#1304)
import { bootstrapCi, validateCard } from "../../scripts/lib/evalCard.mjs";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const NOTE_EN = `# Night trains in Europe

Night trains returned to Europe after 2020. Austria's ÖBB runs the largest network, with routes from Vienna to Paris, Brussels and Rome. ^obb

Demand grew fast. In 2023 the Nightjet carried 1.5 million passengers, about 20 percent more than in 2022.

Tickets are not cheap. A couchette from Vienna to Paris costs around 120 euros, more than many flights.

The main problems are old rolling stock and track fees. New Nightjet trains entered service in 2023 to replace the oldest cars.

Several operators plan new routes. European Sleeper started a Brussels to Berlin line in 2023 and wants to reach Prague.`;

const NOTE_HE = `---
type: מאמר
---
# מבוא

המחקר בדק את השפעת השינה על הזיכרון אצל סטודנטים. ^intro

# שיטה

השתתפו 120 סטודנטים, שחולקו לשתי קבוצות לפי שעות השינה.

# ממצאים

סטודנטים שישנו שמונה שעות זכרו 30 אחוז יותר מילים. ההבדל לא נמצא אצל סטודנטים מבוגרים.`;

const draftEn: AbstractDraft = {
  titles: ["Night trains", "The return of night trains in Europe", "Night trains returned to Europe after 2020, led by Austria's ÖBB Nightjet network", "Why I love sleeping on trains"],
  tldr: "Night trains returned to Europe after 2020.",
  abstract: [
    "Night trains returned to Europe after 2020.",
    "Austria's ÖBB runs the largest network, with routes from Vienna to Paris, Brussels and Rome.",
    "In 2023 the Nightjet carried 1.5 million passengers.",
    "In 2023 the Nightjet carried 3 million passengers.", // a changed number
    "Tickets are cheap.", // flipped polarity
    "Night trains are the future of travel in Asia.", // invented
    "New Nightjet trains entered service in 2023 to replace the oldest cars.",
    "European Sleeper started a Brussels to Berlin line in 2023.",
  ].join(" "),
};

describe("W13.W12 every sentence anchored", () => {
  it("100% of the kept sentences carry a paragraph anchor; invented, renumbered and flipped sentences are deleted", async () => {
    const model = vi.fn(async () => draftEn);
    const r = await writeAbstract(NOTE_EN, { path: "trains.md", lang: "en", model });
    expect(r.engine).toBe("model");
    const all = [...r.abstract, ...(r.tldr ? [r.tldr] : [])];
    expect(all.length).toBeGreaterThan(0);
    for (const s of all) expect(s.anchor, s.text).toMatch(/^(\^[A-Za-z0-9-]+|p-[0-9a-f]{8})$/);
    const paras = noteParagraphs(NOTE_EN);
    for (const s of all) expect(paras.some((p) => p.anchor === s.anchor)).toBe(true);
    expect(r.deleted).toEqual(expect.arrayContaining(["In 2023 the Nightjet carried 3 million passengers.", "Tickets are cheap.", "Night trains are the future of travel in Asia."]));
    expect(r.abstract.map((s) => s.text)).not.toContain("Tickets are cheap.");
    // A real block id is used when the paragraph has one.
    expect(r.abstract.find((s) => s.text.startsWith("Austria"))?.anchor).toBe("^obb");
  });

  it("titles: three, short to long, from the note's own words; an off-topic one is dropped", async () => {
    const r = await writeAbstract(NOTE_EN, { path: "t.md", lang: "en", model: async () => draftEn });
    expect(r.titles).toHaveLength(3);
    const lens = r.titles.map((t) => t.split(/\s+/).length);
    expect(lens[0]).toBeLessThan(lens[1]);
    expect(lens[1]).toBeLessThan(lens[2]);
    expect(r.droppedTitles).toContain("Why I love sleeping on trains");
    expect(checkTitles(["Bananas of Peru", "Night trains"], NOTE_EN).kept).toEqual(["Night trains"]);
  });

  it("an academic note gets a structured abstract (background, method, findings), anchored too", async () => {
    expect(isAcademic(NOTE_HE)).toBe(true);
    expect(isAcademic(NOTE_EN)).toBe(false);
    const model = vi.fn(async (input: { extra: { academic: boolean } }) => {
      expect(input.extra.academic).toBe(true);
      return {
        titles: ["שינה וזיכרון", "השפעת השינה על הזיכרון אצל סטודנטים", "המחקר בדק את השפעת השינה על הזיכרון אצל 120 סטודנטים בשתי קבוצות"],
        tldr: "סטודנטים שישנו שמונה שעות זכרו 30 אחוז יותר מילים.",
        background: "המחקר בדק את השפעת השינה על הזיכרון אצל סטודנטים.",
        method: "השתתפו 120 סטודנטים, שחולקו לשתי קבוצות לפי שעות השינה.",
        findings: "סטודנטים שישנו שמונה שעות זכרו 30 אחוז יותר מילים. ההבדל נמצא גם אצל סטודנטים מבוגרים.",
      } as AbstractDraft;
    });
    const r = await writeAbstract(NOTE_HE, { path: "sleep.md", lang: "he", model: model as never });
    expect(r.academic).toBe(true);
    expect(r.parts?.background).toHaveLength(1);
    expect(r.parts?.method).toHaveLength(1);
    expect(r.parts?.findings.map((s) => s.text)).toEqual(["סטודנטים שישנו שמונה שעות זכרו 30 אחוז יותר מילים."]);
    // "נמצא גם" against "לא נמצא": polarity mismatch, deleted.
    expect(r.deleted).toContain("ההבדל נמצא גם אצל סטודנטים מבוגרים.");
    expect(r.parts?.background[0].anchor).toBe("^intro");
    const md = abstractMarkdown(r, "he");
    expect(md).toContain("> [!abstract] תקציר");
    expect(md).toContain("[[#^intro|¶");
    expect(md).toContain("**שיטה.**");
  });

  it("without a model: the extractive baseline, still anchored, no titles", async () => {
    const r = await writeAbstract(NOTE_EN, { path: "t.md", lang: "en" });
    expect(r.engine).toBe("extractive");
    expect(r.titles).toEqual([]);
    expect(r.abstract.length).toBeGreaterThan(0);
    for (const s of r.abstract) expect(s.anchor).toBeTruthy();
  });

  it("the prompt is the numbered note; the agent has no tools and only local executors; abort is honoured", async () => {
    expect(numberedNote(NOTE_EN).split("\n")[1]).toMatch(/^\[2\] Night trains returned/);
    expect(abstractWriterAgent.tools).toBeUndefined();
    expect(abstractWriterAgent.executorPreference).toEqual(["ollama", "webllm"]);
    const ac = new AbortController();
    ac.abort();
    const model = vi.fn(async () => draftEn);
    await expect(writeAbstract(NOTE_EN, { path: "t.md", lang: "en", model, signal: ac.signal })).rejects.toThrow();
    expect(model).not.toHaveBeenCalled();
  });

  it("the model's JSON is read leniently; the shape validator asks for 3 titles and the length", () => {
    const d = parseDraft('Sure! {"titles":["a","b","c"],"tldr":"x","abstract":["one.","two."]} thanks');
    expect(d.abstract).toBe("one. two.");
    expect(() => parseDraft("no json")).toThrow();
    const v = abstractWriterAgent.validators![0];
    const input = { text: "", extra: { language: "English", academic: false, minWords: 150, maxWords: 250 } } as never;
    expect((v.check({ titles: ["a"], tldr: "x", abstract: "y" }, input) as { ok: boolean }).ok).toBe(false);
    expect((v.check({ titles: ["a", "b", "c"], tldr: "x", abstract: "word ".repeat(200) }, input) as { ok: boolean }).ok).toBe(true);
    expect((v.check({ titles: ["a", "b", "c"], tldr: "x", abstract: "word ".repeat(40) }, input) as { ok: boolean }).ok).toBe(false);
  });

  it("anchorSentences: empty input, and stray [n] markers from the model are ignored", () => {
    expect(anchorSentences("", NOTE_EN, "t.md")).toEqual({ kept: [], deleted: [] });
    const a = anchorSentences("Demand grew fast. [3]", NOTE_EN, "t.md");
    expect(a.kept.map((s) => s.paragraph)).toEqual([3]);
  });
});

/**
 * The dev card (eval/cards/writing/abstractWriter.json): the gate's behaviour
 * on the scripted drafts above — supported sentences kept, adversarial ones
 * (changed number, flipped polarity, invented fact) deleted, and every kept
 * sentence anchored. Recomputed here; LUMEN_WRITE_CARD=1 rewrites the file.
 * It measures the gate, not a model: tag "dev", model "none".
 */
describe("W13.W12 eval card", () => {
  const CARD = join(__dirname, "../../eval/cards/writing/abstractWriter.json");
  const SUPPORTED = [
    ["en", NOTE_EN, "Night trains returned to Europe after 2020."],
    ["en", NOTE_EN, "Austria's ÖBB runs the largest network, with routes from Vienna to Paris, Brussels and Rome."],
    ["en", NOTE_EN, "In 2023 the Nightjet carried 1.5 million passengers."],
    ["en", NOTE_EN, "New Nightjet trains entered service in 2023 to replace the oldest cars."],
    ["en", NOTE_EN, "European Sleeper started a Brussels to Berlin line in 2023."],
    ["en", NOTE_EN, "A couchette from Vienna to Paris costs around 120 euros."],
    ["he", NOTE_HE, "המחקר בדק את השפעת השינה על הזיכרון אצל סטודנטים."],
    ["he", NOTE_HE, "השתתפו 120 סטודנטים, שחולקו לשתי קבוצות לפי שעות השינה."],
    ["he", NOTE_HE, "סטודנטים שישנו שמונה שעות זכרו 30 אחוז יותר מילים."],
    ["he", NOTE_HE, "ההבדל לא נמצא אצל סטודנטים מבוגרים."],
  ] as const;
  const ADVERSARIAL = [
    ["en", NOTE_EN, "In 2023 the Nightjet carried 3 million passengers."],
    ["en", NOTE_EN, "Tickets are cheap."],
    ["en", NOTE_EN, "Night trains are the future of travel in Asia."],
    ["en", NOTE_EN, "A couchette from Vienna to Paris costs around 60 euros."],
    ["he", NOTE_HE, "ההבדל נמצא גם אצל סטודנטים מבוגרים."],
    ["he", NOTE_HE, "השתתפו 200 סטודנטים."],
    ["he", NOTE_HE, "המחקר מוכיח שקפה משפר את הזיכרון."],
  ] as const;

  function measure() {
    const kept = SUPPORTED.map(([, note, s]) => anchorSentences(s, note, "n.md").kept.length === 1 ? 1 : 0);
    const deleted = ADVERSARIAL.map(([, note, s]) => anchorSentences(s, note, "n.md").kept.length === 0 ? 1 : 0);
    const anchored = [...SUPPORTED, ...ADVERSARIAL].flatMap(([, note, s]) => anchorSentences(s, note, "n.md").kept.map((k) => (/^(\^|p-)/.test(k.anchor) ? 1 : 0)));
    return { kept, deleted, anchored };
  }

  it("the committed card matches a fresh run and is complete", () => {
    const m = measure();
    const card = {
      plan: "W13.W12",
      agent: "abstractWriter",
      card: {
        schema: 1,
        tag: "dev",
        model: { name: "none: the R12.9 gate is deterministic; the drafts are scripted", digest: "n/a (no model weights)" },
        seed: 12,
        temperature: 0,
        dataset: { name: "src/__tests__/abstractWriter.test.ts (scripted drafts)", version: "1", license: "MIT (written for lumen-md)", origin: "synthetic" },
        n: m.kept.length + m.deleted.length,
        metrics: {
          supportedKept: bootstrapCi(m.kept, { seed: 12 }),
          adversarialDeleted: bootstrapCi(m.deleted, { seed: 12 }),
          keptAnchored: bootstrapCi(m.anchored, { seed: 12 }),
        },
      },
      owed: "annotator preference vs the extractive baseline (W13.W18); real-model run (W13.W17, Mac)",
    };
    for (const k of Object.keys(card.card.metrics)) delete (card.card.metrics as Record<string, { resamples?: number }>)[k].resamples;
    expect(validateCard(card.card)).toEqual([]);
    expect(card.card.metrics.keptAnchored.value).toBe(1);
    expect(card.card.metrics.adversarialDeleted.value).toBe(1);
    const text = JSON.stringify(card, null, 2) + "\n";
    if (process.env.LUMEN_WRITE_CARD === "1") {
      mkdirSync(dirname(CARD), { recursive: true });
      writeFileSync(CARD, text);
    }
    expect(existsSync(CARD) ? readFileSync(CARD, "utf8") : "").toBe(text);
  });
});

describe("W13.W12 eval:card --agent", () => {
  it("checks only the named agent's reports, and fails when it has none", async () => {
    // @ts-expect-error — plain .mjs module without type declarations (#1304)
    const { main } = await import("../../scripts/eval-card.mjs");
    const out: string[] = [];
    const log = (s: string) => out.push(s);
    expect(main(["--agent", "abstractWriter"], { log, err: log })).toBe(0);
    expect(out.join("\n")).toContain("abstractWriter.json (dev)");
    expect(main(["--agent", "noSuchAgent"], { log, err: log })).toBe(1);
    expect(main(["--agent"], { log, err: log })).toBe(2);
  });
});
