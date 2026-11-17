/**
 * W13.W7 — the structure critic: heading tree, opening and closing,
 * paragraph length and topic sentences, as comments only.
 *
 * Acceptance: precision ≥ 0.8 on the labelled set (120 documents, Hebrew and
 * English, fixtures/writing/structureSet.ts) and on a small set of
 * hand-written notes below that the rules were not tuned on; 0 automatic
 * rewrites (every suggestion's replacement is null). The committed card
 * (eval/cards/writing/structureCritic.json) must equal this run.
 */
import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { structureSet, type Labelled } from "./fixtures/writing/structureSet";
import { critiqueStructure, outlineOf, structureRules, topicRule, type TopicJudge } from "../agents/writing/structure/structureCritic";
import { LOCAL_EXECUTORS, runtimeTopicJudge, topicSentenceAgent } from "../agents/writing/structure/topicSentenceAgent";
import type { WritingSuggestion } from "../agents/writing/suggestionShape";
// @ts-expect-error — a plain .mjs helper without types
import { bootstrapCi, validateCard } from "../../scripts/lib/evalCard.mjs";

const lineOf = (text: string, off: number) => text.slice(0, off).split("\n").length - 1;

async function evaluate(set: Labelled[]) {
  const perPrediction: number[] = [];
  const perExpected: number[] = [];
  const all: WritingSuggestion[] = [];
  for (const d of set) {
    const s = await critiqueStructure(d.text);
    all.push(...s);
    const got = s.map((x) => ({ kind: x.kind, line: lineOf(d.text, x.range.from) }));
    for (const g of got) perPrediction.push(d.expected.some((e) => e.kind === g.kind && e.line === g.line) ? 1 : 0);
    for (const e of d.expected) perExpected.push(got.some((g) => g.kind === e.kind && g.line === e.line) ? 1 : 0);
  }
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 1);
  return { perPrediction, perExpected, precision: mean(perPrediction), recall: mean(perExpected), all };
}

/** Hand-written notes, not generated, not tuned on: what a user writes. */
const UNSEEN: Labelled[] = [
  {
    id: "u-he-1",
    lang: "he",
    text: "# תכנית לחופשה\n\nהשנה נוסעים לגליל לשבוע, עם הילדים.\n\n## לינה\n\nצימר בראש פינה, שלושה חדרים.\n\n#### מחיר\n\n1,200 ש״ח ללילה.\n\n## אוכל\n\n## טיולים\n\n- נחל עמוד\n- הר מירון\n",
    expected: [
      { kind: "heading-skip", line: 8 },
      { kind: "lone-subheading", line: 4 },
      { kind: "empty-section", line: 12 },
    ],
  },
  {
    id: "u-he-2",
    lang: "he",
    text: "---\ntitle: פרוטוקול\n---\n\n## משתתפים\n\nדנה, יוסי ורותם.\n\n## החלטות\n\n- לדחות את ההשקה בשבוע.\n- לבדוק שוב את התקציב.\n\n## משימות\n\n- [ ] דנה: לעדכן את הלקוח\n",
    expected: [],
  },
  {
    id: "u-he-3",
    lang: "he",
    text: "# מדריך\n\n## התקנה\n\n### במק\n\nמורידים את הקובץ ופותחים.\n\n### בחלונות\n\nמריצים את המתקין.\n\n## התקנה\n\nאפשר גם מהחנות.\n",
    expected: [
      { kind: "no-intro", line: 2 },
      { kind: "duplicate-heading", line: 12 },
    ],
  },
  {
    id: "u-en-1",
    lang: "en",
    text: "# Trip notes\n\nA week in Galilee with the kids.\n\n## Where to stay\n\nA cabin in Rosh Pina.\n\n### Price\n\n1,200 a night.\n\n## Food\n\nWe cook most evenings.\n\n## Food\n\nMarkets on Friday.\n",
    expected: [
      { kind: "lone-subheading", line: 4 },
      { kind: "duplicate-heading", line: 16 },
    ],
  },
  {
    id: "u-en-2",
    lang: "en",
    text: "# API\n\n```\n# not a heading\n#### nor this\n```\n\n## Auth\n\nTokens last one hour.\n\n## Errors\n\nEvery error has a code.\n",
    expected: [],
  },
  {
    id: "u-en-3",
    lang: "en",
    text: "## Setup\n\nInstall it.\n\n#### Linux\n\nUse the package.\n\n#### macOS\n\nUse the dmg.\n",
    expected: [{ kind: "heading-skip", line: 4 }],
  },
];

describe("the outline", () => {
  it("reads headings and paragraphs, not code, front matter, lists or quotes", () => {
    const o = outlineOf("---\ntitle: x\n---\n# A\n\ntext one\nstill one\n\n```\n# no\n```\n\n- item\n\n> quote\n\n## B\n\ntwo ^id1\n");
    expect(o.headings.map((h) => [h.level, h.title])).toEqual([
      [1, "A"],
      [2, "B"],
    ]);
    expect(o.paragraphs.map((p) => p.text)).toEqual(["text one\nstill one", "two"]);
  });
  it("an empty note, a note without headings: nothing to say", async () => {
    expect(await critiqueStructure("")).toEqual([]);
    expect(await critiqueStructure("שורה אחת בלי כותרות.")).toEqual([]);
  });
});

describe("W13.W7 precision on the labelled set", () => {
  const set = structureSet();
  it("120 documents, half Hebrew", () => {
    expect(set.length).toBe(120);
    expect(set.filter((d) => d.lang === "he").length).toBe(60);
  });

  it("precision ≥ 0.8 (and recall reported) on the set and on unseen notes", async () => {
    const r = await evaluate(set);
    expect(r.precision).toBeGreaterThanOrEqual(0.8);
    expect(r.recall).toBeGreaterThanOrEqual(0.8);
    const u = await evaluate(UNSEEN);
    expect(u.precision).toBeGreaterThanOrEqual(0.8);
  });

  it("0 automatic rewrites: every suggestion is a comment with a reason", async () => {
    const r = await evaluate([...set, ...UNSEEN]);
    expect(r.all.length).toBeGreaterThan(100);
    for (const s of r.all) {
      expect(s.replacement).toBeNull();
      expect(s.rationale.length).toBeGreaterThan(30);
      expect(s.agentId).toBe("structureCritic");
    }
  });

  it("messages are in the note's language", async () => {
    const he = await critiqueStructure(UNSEEN[0].text);
    expect(he.every((s) => /[א-ת]/.test(s.message))).toBe(true);
    const en = await critiqueStructure(UNSEEN[3].text);
    expect(en.every((s) => !/[א-ת]/.test(s.message))).toBe(true);
  });

  it("the eval card matches this run", async () => {
    const r = await evaluate(set);
    const card = {
      schema: 1,
      tag: "dev",
      agent: "structureCritic",
      model: { name: "rules (no model; the topic-sentence model is optional)", digest: "n/a (no model weights)" },
      seed: 7,
      temperature: 0,
      dataset: { name: "eval/writing/structureCritic/synthetic", version: "1", license: "MIT (written for lumen-md; synthetic)", origin: "synthetic" },
      n: set.length,
      metrics: { precision: bootstrapCi(r.perPrediction, { seed: 7 }), recall: bootstrapCi(r.perExpected, { seed: 7 }) },
    };
    for (const m of Object.values(card.metrics) as Array<Record<string, unknown>>) delete m.resamples;
    const report = { card, predictions: r.perPrediction.length, labels: r.perExpected.length };
    const file = resolve(__dirname, "../../eval/cards/writing/structureCritic.json");
    if (process.env.LUMEN_WRITE_CARDS) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `${JSON.stringify(report, null, 1)}\n`);
    }
    expect(validateCard(card)).toEqual([]);
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(JSON.parse(JSON.stringify(report)));
  });
});

describe("rules, one by one", () => {
  const he = (s: string) => structureRules(s).map((x) => x.kind);
  it("a note may start at H2 (title in front matter) without a skip", () => {
    expect(he("## א\n\nטקסט.\n\n### ב\n\nטקסט.\n\n### ג\n\nטקסט.\n")).toEqual([]);
  });
  it("back matter with one subsection is fine", () => {
    expect(he("# כותרת\n\nפתיחה.\n\n## גוף\n\nטקסט.\n\n## מקורות\n\n### ספרים\n\n- א\n")).toEqual([]);
  });
  it("a 201-word paragraph is long, a 200-word one is not", () => {
    const w = (n: number) => Array.from({ length: n }, (_, i) => `מילה${i}`).join(" ") + ".";
    expect(he(`# א\n\n${w(201)}\n`)).toContain("long-paragraph");
    expect(he(`# א\n\n${w(200)}\n`)).not.toContain("long-paragraph");
  });
  it("the topic rule: a connective, a question, or a first sentence about something else", () => {
    expect(topicRule("בנוסף, הם הביאו כלים. עוד משפט. ועוד אחד. ועוד.", "he")).toMatch(/בנוסף/);
    expect(topicRule("However, it rained. More. More. More.", "en")).toMatch(/However/);
    expect(topicRule("What happens then? A. B. C.", "en")).toMatch(/question/);
    expect(topicRule("The water cycle moves water. Water evaporates. Water falls. Water returns.", "en")).toBeNull();
  });
});

describe("the small model (topic sentence) goes through the runtime", () => {
  const para = "The water cycle is the process that keeps water moving between the sea, the air and the land. Heat from the sun makes water evaporate from oceans and lakes. The vapour rises, cools in the upper air and forms the tiny droplets that make clouds. When the droplets grow heavy, they fall back as rain or snow. Rivers carry the water back to the sea, and it begins again.";
  const doc = `# Notes\n\n${para}\n`;

  it("the model's 'no' flags a paragraph the rule would pass; its 'yes' silences the rule", async () => {
    const no: TopicJudge = async () => false;
    const s = await critiqueStructure(doc, { judge: no, judgeModel: "gemma-4-e2b" });
    expect(s.map((x) => [x.kind, x.model])).toEqual([["topic-sentence", "gemma-4-e2b"]]);
    const bad = `# Notes\n\nHowever, ${para}\n`;
    expect((await critiqueStructure(bad)).map((x) => x.kind)).toEqual(["topic-sentence"]);
    expect(await critiqueStructure(bad, { judge: async () => true })).toEqual([]);
    expect((await critiqueStructure(bad, { judge: async () => null })).map((x) => x.model)).toEqual(["rules"]);
  });

  it("passes the AbortSignal and stops when it aborts", async () => {
    const ac = new AbortController();
    let seen: AbortSignal | undefined;
    const judge: TopicJudge = async (_p, o) => {
      seen = o.signal;
      ac.abort();
      return true;
    };
    await expect(critiqueStructure(doc, { judge, signal: ac.signal })).rejects.toThrow(/abort/i);
    expect(seen).toBe(ac.signal);
  });

  it("the agent: local executors only, no tools, temperature 0; a failed run is no answer", async () => {
    expect(topicSentenceAgent.executorPreference).toEqual(LOCAL_EXECUTORS);
    expect(LOCAL_EXECUTORS).not.toContain("chat");
    expect(topicSentenceAgent.tools).toEqual([]);
    expect(topicSentenceAgent.temperature).toBe(0);
    const calls: unknown[] = [];
    const ok = runtimeTopicJudge(async (_d, input, opts) => {
      calls.push([input, opts.signal]);
      return { status: "ok", output: { hasTopicSentence: false } } as never;
    });
    const ac = new AbortController();
    expect(await ok("x", { lang: "en", signal: ac.signal })).toBe(false);
    expect(calls[0]).toEqual([{ text: "x", extra: { lang: "en" } }, ac.signal]);
    const failed = runtimeTopicJudge(async () => ({ status: "failed", output: null }) as never);
    expect(await failed("x", { lang: "he" })).toBeNull();
  });
});
