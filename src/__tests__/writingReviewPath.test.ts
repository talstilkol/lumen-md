/**
 * INT7 — one writing-suggestion contract and one review path for every
 * writing agent (W13.W1 with W13.W6–W15).
 *
 *  - Every rule-based checker of L5 (W6–W10) and L6 (W11–W15) emits a
 *    `CheckerFinding`, and every finding it gives on its own test sets is a
 *    valid W1 suggestion for its text once `fromFinding` makes it one
 *    (range, original, kind, confidence, the AI flag).
 *  - The finding kind is kept as W1's `ruleId`; the W1 kind is its group.
 *  - The review path (agents/writingReview.ts) stages only valid W1
 *    suggestions: one that does not fit its text is dropped, never staged.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { fromFinding, findingKind, SUGGESTION_KINDS, SuggestionError, validateSuggestion, type CheckerFinding } from "../agents/writing/suggestion";
import { stageFinding, stageWritingSuggestions, toRangeProposal } from "../agents/writingReview";
import { clearStagedChanges, listStagedChanges } from "../agents/staging";
import { detectRepetition } from "../agents/writing/repetition";
import { detectLoanwords } from "../agents/writing/loanwords";
import { critiqueStructure } from "../agents/writing/structure/structureCritic";
import { checkArgument } from "../agents/writing/argument/argumentChecker";
import { runVaultConsistency } from "../agents/writing/consistency/vaultConsistency";
import { structureSet } from "./fixtures/writing/structureSet";
import { argumentSet } from "./fixtures/writing/argumentSet";
import { buildVault } from "./fixtures/writing/consistencyVault";

const labels = { title: "T", count: (n: number) => `${n}`, none: "none", why: "Why", sources: "Sources", staged: (n: number) => `${n} staged`, kind: (k: string) => k };

/** Every finding as a W1 suggestion; the ones that do not convert, with why. */
function convert(text: string, list: readonly CheckerFinding[]) {
  const bad: string[] = [];
  for (const f of list) {
    try {
      const s = fromFinding(text, f);
      expect(validateSuggestion(s, text)).toEqual([]);
      expect(s.ruleId).toBe(f.kind);
      expect(SUGGESTION_KINDS).toContain(s.kind);
    } catch (e) {
      bad.push(`${f.agentId}/${f.kind}: ${(e as Error).message}`);
    }
  }
  return bad;
}

describe("every L5 / L6 checker speaks W1 (INT7)", () => {
  it("repetition, clichés and doubled words (W13.W11), Hebrew and English", () => {
    const texts = ["זה היה של של חבר. הבית היה גדול, והבית היה ישן, והבית היה קר. בסופו של דבר הכול טוב.", "the the end. The house was big and the house was old and the house was cold. At the end of the day it is fine."];
    let n = 0;
    for (const [i, text] of texts.entries()) {
      const found = detectRepetition(text, { lang: i ? "en" : "he" });
      n += found.length;
      expect(convert(text, found)).toEqual([]);
    }
    expect(n).toBeGreaterThan(2);
  });

  it("loanwords (W13.W15)", () => {
    const text = "שלחתי אימייל עם פידבק על הפרויקט.";
    const found = detectLoanwords(text, { register: "academic" });
    expect(found.length).toBeGreaterThan(0);
    expect(convert(text, found)).toEqual([]);
  });

  it("the structure critic's whole set (W13.W7)", async () => {
    let n = 0;
    for (const d of structureSet()) {
      const found = await critiqueStructure(d.text);
      n += found.length;
      expect(convert(d.text, found), d.id).toEqual([]);
    }
    expect(n).toBeGreaterThan(10);
  });

  it("the argument checker's whole set (W13.W8)", () => {
    let n = 0;
    for (const d of argumentSet()) {
      const found = checkArgument({ text: d.text });
      n += found.length;
      expect(convert(d.text, found), d.id).toEqual([]);
    }
    expect(n).toBeGreaterThan(10);
  });

  it("the vault consistency checker (W13.W6): each finding against its own note", async () => {
    const { notes, entities } = buildVault();
    const texts = new Map(notes.map((x) => [x.path, x.content]));
    const found = await runVaultConsistency({ notes, entities });
    expect(found.length).toBeGreaterThan(3);
    for (const f of found) expect(convert(texts.get(f.path ?? "") ?? "", [f])).toEqual([]);
  });
});

describe("the mapping onto W1 (INT7)", () => {
  const f = (kind: string, agentId = "x"): CheckerFinding => ({ range: { from: 0, to: 3 }, kind, message: "m", rationale: "r", confidence: 0.5, replacement: null, agentId, model: "rules" });
  it("finding kinds become W1 kinds and stay as ruleId", () => {
    expect(findingKind(f("fact-conflict"))).toBe("consistency");
    expect(findingKind(f("heading-skip"))).toBe("structure");
    expect(findingKind(f("straw-man"))).toBe("logic");
    expect(findingKind(f("grammar:Agreement", "harperGrammar"))).toBe("grammar");
    expect(findingKind(f("cliche"))).toBe("wordChoice");
    expect(findingKind(f("doubled"))).toBe("redundancy");
    expect(findingKind(f("something-new", "argumentChecker"))).toBe("logic");
    expect(findingKind(f("something-new", "nobody"))).toBeUndefined();
    const s = fromFinding("abcdef", { ...f("term-variant"), path: "n.md", links: ["a.md#^x"] });
    expect(s).toMatchObject({ kind: "consistency", ruleId: "term-variant", original: "abc", aiAuthored: false, path: "n.md", links: ["a.md#^x"] });
    expect(() => fromFinding("abcdef", f("something-new", "nobody"))).toThrow(SuggestionError);
    expect(() => fromFinding("ab", f("cliche"))).toThrow(/range/);
  });
});

describe("one review path: only valid W1 suggestions are staged (INT7)", () => {
  beforeEach(() => clearStagedChanges());
  const text = "We met Dana and Dana left.";
  const fix = (from: number, to: number, replacement: string | null, kind = "name-variant", agentId = "consistency"): CheckerFinding => ({ range: { from, to }, kind, message: "m", rationale: "because", confidence: 0.8, replacement, agentId, model: "rules", path: "n.md" });

  it("a fix is staged with its original; one equal to the text, off the text or of no known kind is dropped", () => {
    const r = stageWritingSuggestions({
      suggestions: [fix(7, 11, "Dina"), fix(7, 11, "Dana"), fix(20, 99, "x"), fix(0, 2, "Us", "nonsense-kind", "nobody"), fix(16, 20, null, "fact-conflict")],
      texts: new Map([["n.md", text]]),
      agentId: "consistency",
      tool: "writing.consistency",
      labels,
      today: "2026-11-17",
    });
    expect(r.staged).toHaveLength(1);
    expect(r.staged[0]).toMatchObject({ kind: "range", before: "Dana", after: "Dina", path: "n.md" });
    expect(r.dropped).toBe(3);
    expect(r.report?.kind === "file" && r.report.after).toMatch(/## 1\. fact-conflict: m/);
    expect(listStagedChanges()).toHaveLength(2);
  });

  it("the dialogs' path: stageFinding and toRangeProposal go through the same check", () => {
    expect(stageFinding(fix(7, 11, "Dina"), text, "n.md", { tool: "writing.repetition" })).toMatchObject({ kind: "range", before: "Dana", after: "Dina" });
    expect(stageFinding(fix(7, 11, "Dana"), text, "n.md", { tool: "writing.repetition" })).toBeNull();
    expect(stageFinding(fix(7, 11, null), text, "n.md", { tool: "writing.repetition" })).toBeNull();
    expect(toRangeProposal(fix(7, 11, "Dina"), text, "n.md")).toMatchObject({ kind: "range", before: "Dana", after: "Dina" });
    expect(toRangeProposal(fix(30, 40, "Dina"), text, "n.md")).toBeNull();
    expect(listStagedChanges()).toHaveLength(1);
  });
});
