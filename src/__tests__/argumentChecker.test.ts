/**
 * W13.W8 — the argument and logic checker: claims without support (R12.11
 * selection + the R12.9 support score against vault sources), logical leaps
 * and seven labelled fallacies, linked to the argument map (W12.V4).
 *
 * Acceptance: precision ≥ 0.7 on 150 labelled arguments (fixtures/writing/
 * argumentSet.ts); every suggestion explains why. The committed card
 * (eval/cards/writing/argumentChecker.json) must equal this run; it also
 * carries precision on 24 notes written after the rules were fixed
 * ("unseen", below), never tuned on.
 */
import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { argumentSet, type ArgItem } from "./fixtures/writing/argumentSet";
import { checkArgument, mapFindings } from "../agents/writing/argument/argumentChecker";
import { FALLACIES } from "../agents/writing/argument/fallacies";
// @ts-expect-error — a plain .mjs helper without types
import { bootstrapCi, validateCard } from "../../scripts/lib/evalCard.mjs";

function evaluate(set: ArgItem[]) {
  const pred: number[] = [];
  const rec: number[] = [];
  for (const d of set) {
    const kinds = checkArgument({ text: d.text }).map((s) => s.kind);
    for (const k of kinds) pred.push(k === d.label ? 1 : 0);
    if (d.label !== "none") rec.push(kinds.includes(d.label) ? 1 : 0);
  }
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 1);
  return { pred, rec, precision: mean(pred), recall: mean(rec) };
}

/** Written after the rules were fixed; not tuned on. */
const UNSEEN: ArgItem[] = [
  { id: "u1", lang: "he", label: "hasty-generalization", text: "כל השכנים שלנו הם רעשנים, זה ידוע." },
  { id: "u2", lang: "he", label: "appeal-to-popularity", text: "כולם יודעים שהמבחן הזה לא הוגן." },
  { id: "u3", lang: "he", label: "false-dilemma", text: "או שנעבור דירה השנה או שלא נחסוך לעולם." },
  { id: "u4", lang: "he", label: "slippery-slope", text: "אם נאשר עכשיו חניה אחת לאורחים, אחר כך יבקשו חמש, ובסוף לא יהיה איפה לחנות." },
  { id: "u5", lang: "he", label: "ad-hominem", text: "מה היא כבר יודעת על ספורט, היא עורכת דין." },
  { id: "u6", lang: "he", label: "post-hoc", text: "מאז שהחלפנו ספק אינטרנט הילדים לומדים יותר, אז ברור שזה בזכות הספק." },
  { id: "u7", lang: "he", label: "unsupported-claim", text: "שליש מהנהגים בעיר נוהגים בלי ביטוח." },
  { id: "u8", lang: "he", label: "none", text: "לפי נתוני העירייה, 12% מהרחובות בלי תאורה [@muni2025]." },
  { id: "u9", lang: "he", label: "none", text: "ביום ראשון נצא לטיול בגליל עם הכיתה." },
  { id: "u10", lang: "he", label: "none", text: "אני חושבת שכדאי לנסות את השיטה לחודש." },
  { id: "u11", lang: "he", label: "straw-man", text: "אז אתם בעצם אומרים שאין צורך במורים בכלל." },
  { id: "u12", lang: "he", label: "none", text: "האם מישהו בדק את המספרים לפני הישיבה?" },
  { id: "u13", lang: "en", label: "hasty-generalization", text: "All cyclists are reckless on the road." },
  { id: "u14", lang: "en", label: "appeal-to-popularity", text: "Everybody knows the old bridge is unsafe." },
  { id: "u15", lang: "en", label: "false-dilemma", text: "Either we hire more staff or the service collapses." },
  { id: "u16", lang: "en", label: "slippery-slope", text: "If we skip one inspection, soon we'll skip them all, and eventually something will burn down." },
  { id: "u17", lang: "en", label: "ad-hominem", text: "Don't listen to him about the budget, he's just a kid." },
  { id: "u18", lang: "en", label: "post-hoc", text: "Since we started the newsletter complaints fell, which proves the newsletter fixed things." },
  { id: "u19", lang: "en", label: "unsupported-claim", text: "A third of drivers in the city have no insurance." },
  { id: "u20", lang: "en", label: "none", text: "According to the council, 12% of streets have no lights [@muni2025]." },
  { id: "u21", lang: "en", label: "none", text: "On Sunday the class goes on a trip to the north." },
  { id: "u22", lang: "en", label: "none", text: "I think we should try the method for a month." },
  { id: "u23", lang: "en", label: "straw-man", text: "So you're basically saying we don't need teachers at all." },
  { id: "u24", lang: "en", label: "none", text: "Did anyone check the numbers before the meeting?" },
];

describe("W13.W8 on 150 labelled arguments", () => {
  const set = argumentSet();
  it("150 items, 75 per language, every fallacy six times per language", () => {
    expect(set.length).toBe(150);
    expect(set.filter((d) => d.lang === "he").length).toBe(75);
    for (const f of FALLACIES) for (const lang of ["he", "en"]) expect(set.filter((d) => d.label === f.kind && d.lang === lang).length).toBe(6);
  });

  it("precision ≥ 0.7", () => {
    const r = evaluate(set);
    expect(r.precision).toBeGreaterThanOrEqual(0.7);
    expect(r.recall).toBeGreaterThanOrEqual(0.7);
  });

  it("every suggestion explains why, with what it saw, and is a comment", () => {
    for (const d of set) {
      for (const s of checkArgument({ text: d.text })) {
        expect(s.replacement).toBeNull();
        expect(s.rationale.length).toBeGreaterThan(60);
        if (FALLACIES.some((f) => f.kind === s.kind)) {
          const f = FALLACIES.find((x) => x.kind === s.kind)!;
          expect(s.rationale).toContain(f[d.lang].name);
          expect(s.rationale).toContain(f[d.lang].fix);
        }
        expect(/[א-ת]/.test(s.rationale)).toBe(d.lang === "he");
      }
    }
  });

  it("each fallacy has a Hebrew and an English example its own patterns catch", () => {
    for (const f of FALLACIES) {
      for (const lang of ["he", "en"] as const) {
        const ex = f[lang].example.replace(/^["״“]|["״”]$/g, "");
        expect(checkArgument({ text: ex }).map((s) => s.kind), `${f.kind} ${lang}: ${ex}`).toContain(f.kind);
      }
    }
  });

  it("the eval card matches this run (with the unseen notes' precision)", () => {
    const r = evaluate(set);
    const u = evaluate(UNSEEN);
    const card = {
      schema: 1,
      tag: "dev",
      agent: "argumentChecker",
      model: { name: "rules (no model)", digest: "n/a (no model weights)" },
      seed: 8,
      temperature: 0,
      dataset: { name: "src/__tests__/argumentChecker.test.ts (its synthetic set, built in the test)", version: "1", license: "MIT (written for lumen-md; synthetic)", origin: "synthetic" },
      n: set.length,
      metrics: { precision: bootstrapCi(r.pred, { seed: 8 }), recall: bootstrapCi(r.rec, { seed: 8 }), unseenPrecision: bootstrapCi(u.pred, { seed: 8 }) },
    };
    for (const m of Object.values(card.metrics) as Array<Record<string, unknown>>) delete m.resamples;
    const report = { card, unseen: UNSEEN.length };
    const file = resolve(__dirname, "../../eval/cards/writing/argumentChecker.json");
    if (process.env.LUMEN_WRITE_CARDS) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `${JSON.stringify(report, null, 1)}\n`);
    }
    expect(validateCard(card)).toEqual([]);
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(JSON.parse(JSON.stringify(report)));
  });
});

describe("support", () => {
  it("a citation in the sentence or the next one is support", () => {
    expect(checkArgument({ text: "Prices rose 40% last year [@cbs]." })).toEqual([]);
    expect(checkArgument({ text: "Prices rose 40% last year. See [[CBS report]] for the series." })).toEqual([]);
    expect(checkArgument({ text: "המחירים עלו ב-40% בשנה שעברה (כהן, 2021)." })).toEqual([]);
    expect(checkArgument({ text: "Prices rose 40% last year." }).map((s) => s.kind)).toEqual(["unsupported-claim"]);
  });

  it("a vault source that supports the claim is named", () => {
    const s = checkArgument({ text: "Prices rose 40% in the city last year.", path: "essay.md", sources: [{ path: "sources/cbs.md", text: "In the city, prices rose 40% last year, the bureau said." }] });
    expect(s).toHaveLength(1);
    expect(s[0].rationale).toContain("[[sources/cbs]]");
    // A source that says another number does not support it.
    const t = checkArgument({ text: "Prices rose 40% in the city last year.", sources: [{ path: "s.md", text: "In the city, prices rose 30% last year." }] });
    expect(t[0].rationale).not.toContain("[[");
  });

  it("questions, hedges, quotes and code are not claims", () => {
    expect(checkArgument({ text: "> Everyone knows prices rose 40%.\n\n```\nall users are admins 100%\n```\n" })).toEqual([]);
  });

  it("offsets point at the sentence", () => {
    const text = "# כותרת\n\nפתיחה רגילה. כולם יודעים שהתוכנית תצליח.";
    const [s] = checkArgument({ text });
    expect(text.slice(s.range.from, s.range.to)).toBe("כולם יודעים שהתוכנית תצליח.");
  });

  it("aborts", () => {
    const ac = new AbortController();
    ac.abort();
    expect(() => checkArgument({ text: "Prices rose 40%." }, { signal: ac.signal })).toThrow(/abort/i);
  });
});

describe("the argument map (W12.V4)", () => {
  const mapNotes = [
    { path: "claims/a.md", fm: { type: "claim" } },
    { path: "claims/b.md", fm: { type: "claim" } },
    { path: "sources/s.md", fm: { type: "evidence", supports: "[[claims/b]]" } },
  ];
  it("a claim node no source reaches is flagged on its note", () => {
    expect(checkArgument({ text: "# a\n\nTrams are quiet.", path: "claims/a.md", mapNotes }).map((s) => s.kind)).toEqual(["map-unsupported"]);
    expect(checkArgument({ text: "# b\n\nTrams are quiet.", path: "claims/b.md", mapNotes })).toEqual([]);
  });
  it("mapFindings gives the map its badges per node", () => {
    const f = mapFindings(
      [
        { path: "claims/a.md", text: "# a\n\nEveryone knows trams are quiet." },
        { path: "claims/b.md", text: "# b\n\nTrams are quiet." },
      ],
      mapNotes,
    );
    expect([...f.keys()]).toEqual(["claims/a.md"]);
    expect(f.get("claims/a.md")!.kinds.sort()).toEqual(["appeal-to-popularity", "map-unsupported"]);
  });
});
