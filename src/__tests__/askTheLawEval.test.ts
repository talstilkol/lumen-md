/**
 * Plan W7.5 acceptance 3 — the model-free half of the golden run
 * (agents/eval/askTheLawEval.ts): the 20 questions reach the right section
 * through the app's search, and the score counts an answer only when the
 * critic verified it and its section is the golden one. The "model" here is
 * a stand-in that repeats the section and says SUPPORTED, or contradicts
 * it; the real run is askTheLaw.eval.ts on the Mac.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runLawQuestion, savedLaws, scoreLaw, type LawGolden, type LawRow } from "../agents/eval/askTheLawEval";
import type { LawChat } from "../sources/knesset/answer";

const FIX = join(__dirname, "fixtures/knesset");
const golden = JSON.parse(readFileSync(join(FIX, "askTheLaw.json"), "utf8")) as LawGolden;
const saved = savedLaws(golden, JSON.parse(readFileSync(join(FIX, "laws.v4.json"), "utf8")));

/** Answers with the section's own first words (no new numbers), and the critic says `verdict`. */
const standIn = (verdict: string): LawChat => async (messages) => {
  if (messages[0].role === "system" && /SUPPORTED/.test(messages[0].content)) return verdict;
  const m = messages[1].content.match(/Section [^\s]+\s+([^\n]+)/);
  return (m?.[1] ?? "").replace(/\d+/g, "").split(/\s+/).slice(0, 8).join(" ");
};

describe("W7.5 ask-the-law golden run", () => {
  it("has 20 questions on 5 laws", () => {
    expect(golden.questions).toHaveLength(20);
    expect(Object.keys(golden.laws)).toHaveLength(5);
  });

  it("a critic that supports every faithful answer: ≥ 18/20 correct, so the search finds the golden sections", async () => {
    const rows: LawRow[] = [];
    for (const g of golden.questions) rows.push(await runLawQuestion(g, saved, standIn("SUPPORTED")));
    const s = scoreLaw(rows);
    expect(rows.filter((r) => r.gotSection === r.section && r.gotLaw === r.law).length).toBeGreaterThanOrEqual(18);
    expect(s).toMatchObject({ task: "W7.5", total: 20, pass: true });
  });

  it("a critic that contradicts: 0 correct, not a pass", async () => {
    const rows: LawRow[] = [];
    for (const g of golden.questions) rows.push(await runLawQuestion(g, saved, standIn("CONTRADICTED")));
    expect(scoreLaw(rows)).toMatchObject({ correct: 0, pass: false });
  });

  it("verified but the wrong section does not count; fewer than 20 rows is not a pass", () => {
    const row = (correct: boolean): LawRow => ({ q: "q", law: "L", section: "1", gotLaw: "L", gotSection: correct ? "1" : "2", critic: "supported", verified: true, correct });
    expect(scoreLaw([...Array(18)].map(() => row(true)).concat([row(false), row(false)]))).toMatchObject({ correct: 18, pass: true });
    expect(scoreLaw([...Array(17)].map(() => row(true)).concat([row(false), row(false), row(false)]))).toMatchObject({ correct: 17, pass: false });
    expect(scoreLaw([...Array(19)].map(() => row(true)))).toMatchObject({ total: 19, pass: false });
  });
});
