/**
 * W13.W6 — the vault consistency checker.
 *
 * Acceptance: on a synthetic vault with 50 planted inconsistencies (and
 * the traps listed in the fixture), recall ≥ 0.8 and precision ≥ 0.8; every
 * suggestion carries two paragraph links. The committed eval card
 * (eval/cards/writing/consistency.json) must equal this run's numbers; set
 * LUMEN_WRITE_CARDS=1 to rewrite it.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildVault, ENTITIES, type Planted } from "./fixtures/writing/consistencyVault";
import { checkVaultConsistency, isGlossaryNote, parseGlossary, runVaultConsistency, type VaultNote } from "../agents/writing/consistency/vaultConsistency";
import { disagree, valuesOf } from "../agents/writing/consistency/values";
import type { WritingSuggestion } from "../agents/writing/suggestionShape";
import { resolveParagraphAnchor } from "../ai/paragraphAnchors";
// @ts-expect-error — a plain .mjs helper without types
import { bootstrapCi, validateCard } from "../../scripts/lib/evalCard.mjs";

const pathOf = (link: string) => link.slice(0, link.lastIndexOf("#"));

function score(sugs: WritingSuggestion[], planted: Planted[]) {
  const hit = new Set<number>();
  const correct = sugs.map((s) => {
    const i = planted.findIndex((p) => {
      if (p.kind === "fact-conflict") {
        if (s.kind !== "fact-conflict") return false;
        const got = [s.path, pathOf(s.links![1])].sort().join("|");
        return got === [...p.paths].sort().join("|");
      }
      return s.kind === p.kind && s.path === p.path && s.range.from < p.to && s.range.to > p.from;
    });
    if (i >= 0) hit.add(i);
    return i >= 0;
  });
  return { correct, found: planted.map((_, i) => hit.has(i)) };
}

describe("values", () => {
  it("reads dates in three forms as one", () => {
    const a = valuesOf("ב-14.5.1948")[0];
    const b = valuesOf("ב-14 במאי 1948")[0];
    const c = valuesOf("on May 14, 1948")[0];
    expect([a.type, b.type, c.type]).toEqual(["date", "date", "date"]);
    expect(new Set([a.value, b.value, c.value]).size).toBe(1);
  });
  it("normalises multipliers and units, keeps bounds out", () => {
    expect(valuesOf("3 מיליון תושבים")[0]).toMatchObject({ value: 3e6, unit: "people" });
    expect(valuesOf("3,000,000 residents")[0]).toMatchObject({ value: 3e6, unit: "people" });
    expect(valuesOf("251 ק״מ")[0].unit).toBe("km");
    expect(valuesOf("יותר מ-500 לקוחות")[0].bound).toBe(true);
    expect(valuesOf("more than 500 customers")[0].bound).toBe(true);
  });
  it("approximations within 10% agree; a year meets a date on its year", () => {
    expect(disagree(valuesOf("כ-950 איש")[0], valuesOf("980 איש")[0])).toBe(false);
    expect(disagree(valuesOf("about 100 people")[0], valuesOf("150 people")[0])).toBe(true);
    expect(disagree(valuesOf("ב-1948")[0], valuesOf("ב-14.5.1948")[0])).toBe(false);
    expect(disagree(valuesOf("ב-1949")[0], valuesOf("ב-14.5.1948")[0])).toBe(true);
  });
  it("versions, times and references are not values", () => {
    expect(valuesOf("v2 at 3:15, see §12")).toEqual([]);
    expect(valuesOf("נולדה ב-20.9.1890.")[0].type).toBe("date");
  });
});

describe("glossary", () => {
  it("reads list and table forms, and finds the glossary note", () => {
    const g = parseGlossary("- דוא״ל: אימייל, מייל\n| מונח | חלופות |\n|---|---|\n| מרשתת | אינטרנט |\n- email = e-mail", "g.md");
    expect(g.map((t) => [t.preferred, t.variants])).toEqual([
      ["דוא״ל", ["אימייל", "מייל"]],
      ["מרשתת", ["אינטרנט"]],
      ["email", ["e-mail"]],
    ]);
    expect(g[0].link).toMatch(/^g\.md#/);
    expect(isGlossaryNote({ path: "x/מילון מונחים.md", content: "" })).toBe(true);
    expect(isGlossaryNote({ path: "a.md", content: "---\nlumen: glossary\n---\n" })).toBe(true);
    expect(isGlossaryNote({ path: "a.md", content: "# a" })).toBe(false);
  });
});

describe("W13.W6 on the synthetic vault (50 planted)", () => {
  const { notes, entities, planted } = buildVault();
  const sugs = checkVaultConsistency({ notes, entities });
  const { correct, found } = score(sugs, planted);
  const precision = correct.filter(Boolean).length / Math.max(1, sugs.length);
  const recall = found.filter(Boolean).length / planted.length;

  it("plants exactly 50", () => {
    expect(planted.length).toBe(50);
  });

  it("recall ≥ 0.8 and precision ≥ 0.8", () => {
    const misses = planted.filter((_, i) => !found[i]);
    const wrong = sugs.filter((_, i) => !correct[i]).map((s) => `${s.kind} ${s.path} ${s.message} ${s.links?.join(" ")}`);
    expect({ recall, misses }).toMatchObject({ recall: expect.any(Number) });
    expect(recall, JSON.stringify(misses, null, 1)).toBeGreaterThanOrEqual(0.8);
    expect(precision, wrong.join("\n")).toBeGreaterThanOrEqual(0.8);
  });

  it("every suggestion has two paragraph links that resolve, and a rationale", () => {
    const byPath = new Map<string, VaultNote>(notes.map((n) => [n.path, n]));
    for (const s of sugs) {
      expect(s.links?.length).toBe(2);
      for (const l of s.links!) {
        if (l.startsWith("entity:")) {
          expect(entities.some((e) => `entity:${e.id}` === l)).toBe(true);
          continue;
        }
        const n = byPath.get(pathOf(l));
        expect(n, l).toBeTruthy();
        expect(resolveParagraphAnchor(n!.content, l.slice(l.lastIndexOf("#") + 1)), l).not.toBeNull();
      }
      expect(s.rationale.length).toBeGreaterThan(20);
      expect(s.agentId).toBe("consistency");
      expect(s.confidence).toBeGreaterThan(0);
    }
  });

  it("facts are comments (no rewrite); names and terms replace the flagged text only", () => {
    for (const s of sugs) {
      if (s.kind === "fact-conflict") expect(s.replacement).toBeNull();
      else expect(typeof s.replacement).toBe("string");
      const n = notes.find((x) => x.path === s.path)!;
      expect(s.range.to).toBeGreaterThan(s.range.from);
      expect(n.content.slice(s.range.from, s.range.to).trim().length).toBeGreaterThan(0);
    }
  });

  it("keeps the Hebrew prefix and article when it proposes a spelling", () => {
    const v = sugs.find((s) => s.kind === "name-variant" && s.path === "variants/v-01.md")!;
    expect(v).toBeTruthy();
    const n = notes.find((x) => x.path === v.path)!;
    const fixed = n.content.slice(0, v.range.from) + v.replacement + n.content.slice(v.range.to);
    expect(fixed).toContain("בירושלים העתיקה");
    const t = sugs.find((s) => s.kind === "term-variant" && s.path === "terms/t-07.md")!;
    expect(n && notes.find((x) => x.path === t.path)!.content.slice(t.range.from - 2, t.range.to)).toBe("ובאינטרנט");
    expect(t.replacement).toBe("מרשתת");
  });

  it("the eval card matches this run", () => {
    const card = {
      schema: 1,
      tag: "dev",
      agent: "consistency",
      model: { name: "rules (no model)", digest: "n/a (no model weights)" },
      seed: 13,
      temperature: 0,
      dataset: { name: "eval/writing/consistency/synthetic-vault", version: "1", license: "MIT (written for lumen-md; synthetic)", origin: "synthetic" },
      n: planted.length,
      metrics: {
        precision: bootstrapCi(correct.map(Number), { seed: 13 }),
        recall: bootstrapCi(found.map(Number), { seed: 13 }),
      },
    };
    for (const m of Object.values(card.metrics) as Array<Record<string, unknown>>) delete m.resamples;
    const file = resolve(__dirname, "../../eval/cards/writing/consistency.json");
    const report = { card, suggestions: sugs.length, planted: planted.length };
    if (process.env.LUMEN_WRITE_CARDS) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `${JSON.stringify(report, null, 1)}\n`);
    }
    expect(validateCard(card)).toEqual([]);
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(JSON.parse(JSON.stringify(report)));
  });
});

describe("robustness", () => {
  it("an empty vault, no entities, no glossary: nothing", () => {
    expect(checkVaultConsistency({ notes: [], entities: [] })).toEqual([]);
    expect(checkVaultConsistency({ notes: [{ path: "a.md", content: "שלום 1948." }], entities: [] })).toEqual([]);
  });

  it("skips fully pointed text and glossed Latin names", () => {
    const notes = [
      { path: "a.md", content: "ירושלים יפה. ירושלים גדולה." },
      { path: "b.md", content: "יְרוּשָׁלַיִם עִיר עַתִּיקָה וְיָפָה מְאֹד." },
      { path: "c.md", content: "ירושלים (Jerusalem) היא בירה." },
    ];
    expect(checkVaultConsistency({ notes, entities: ENTITIES })).toEqual([]);
  });

  it("aborts", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(runVaultConsistency({ notes: buildVault().notes, entities: ENTITIES }, { signal: ac.signal })).rejects.toThrow(/abort/i);
  });

  it("10,000 notes in under 15 s, with one planted conflict found", () => {
    const notes: VaultNote[] = [];
    const towns = ["חיפה", "ירוחם", "תל אביב", "באר שבע", "קריית שמונה"];
    for (let i = 0; i < 10_000; i++) {
      const town = towns[i % towns.length];
      notes.push({ path: `big/n${i}.md`, content: `# פתק ${i}\n\nביקרנו ב${town === "תל אביב" ? "תל אביב" : town} ביום ${(i % 28) + 1}.\n\nהפגישה נקבעה לשעה ${i % 12}:00 ונמשכה זמן רב.\n\nכתבנו ${i % 50} עמודים של סיכומים.` });
    }
    notes.push({ path: "big/x.md", content: "הטכניון נוסד ב-1912." }, { path: "big/y.md", content: "הטכניון נוסד ב-1913." });
    const t0 = performance.now();
    const sugs = checkVaultConsistency({ notes, entities: ENTITIES });
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(15_000);
    expect(sugs.filter((s) => s.kind === "fact-conflict").map((s) => [s.path, pathOf(s.links![1])].sort().join("|"))).toContain("big/x.md|big/y.md");
  });
});

describe("audit r4 A2.10: a hyphen or maqaf against a space is a variant", () => {
  it("Tel Aviv / Tel-Aviv, ישראל ישראלי / ישראל-ישראלי, בן גוריון / בן־גוריון are reported; maqaf against hyphen is one spelling", () => {
    const notes = [
      { path: "q4.md", content: "We visited Tel Aviv and Tel-Aviv again." },
      { path: "q5.md", content: "ישראל ישראלי כתב ספר. ישראל-ישראלי כתב עוד אחד." },
      { path: "q7.md", content: "דוד בן־גוריון ודוד בן גוריון." },
      { path: "q8.md", content: "דוד בן־גוריון ודוד בן-גוריון." },
    ];
    const entities = [
      { id: "t", name: "Tel Aviv", aliases: [] },
      { id: "i", name: "ישראל ישראלי", aliases: [] },
      { id: "b", name: "דוד בן גוריון", aliases: [] },
    ];
    const found = checkVaultConsistency({ notes, entities: entities as never, glossary: [] }).filter((f) => f.kind === "name-variant");
    expect(found.map((f) => (f as { path?: string }).path).sort()).toEqual(["q4.md", "q5.md", "q7.md"]);
  });
});

