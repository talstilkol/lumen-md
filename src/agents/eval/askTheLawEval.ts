/**
 * Plan W7.5 acceptance 3: "20 golden questions on 5 laws: ≥ 18 answers with
 * the right section that passed verification". The run itself is
 * askTheLaw.eval.ts (a real local model, opt-in); this is the part that does
 * not need a model: the golden set, one question's run (search → answer →
 * critic, the app's own code in sources/knesset), and the score. An answer
 * counts only when the critic verified it AND its quote is the golden law
 * and section.
 */
import { askTheLaw, parseLawNote, renderLawNote, type SavedLaw } from "../../sources/knesset/store";
import { toLaw, rowsOf, type Law } from "../../sources/knesset/odata";
import { answerLawQuestion, type LawChat } from "../../sources/knesset/answer";

export interface LawGolden {
  laws: Record<string, string>;
  questions: Array<{ q: string; law: string; section: string }>;
}

export interface LawRow {
  q: string;
  law: string;
  section: string;
  gotLaw: string | null;
  gotSection: string | null;
  critic: string;
  verified: boolean;
  /** Verified, and the golden law and section. */
  correct: boolean;
}

export interface LawScore {
  task: "W7.5";
  total: number;
  correct: number;
  need: number;
  pass: boolean;
}

/** The golden laws as the app saves them (the notes askTheLaw searches). */
export function savedLaws(golden: LawGolden, odataRows: unknown): SavedLaw[] {
  const laws: Law[] = rowsOf(odataRows).map(toLaw).filter((l): l is Law => l !== null);
  return Object.entries(golden.laws).map(([name, text]) => {
    const law = laws.find((l) => l.name === name);
    if (!law) throw new Error(`golden law not in the OData fixture: ${name}`);
    return parseLawNote(`Sources/Knesset/Laws/${name}.md`, renderLawNote(law, "2026-11-15", text))!;
  });
}

export async function runLawQuestion(g: LawGolden["questions"][number], saved: SavedLaw[], chat: LawChat): Promise<LawRow> {
  const quote = askTheLaw(g.q, saved, 1)[0];
  const base = { q: g.q, law: g.law, section: g.section };
  if (!quote) return { ...base, gotLaw: null, gotSection: null, critic: "no-quote", verified: false, correct: false };
  const r = await answerLawQuestion(g.q, quote, chat);
  const gotLaw = quote.law.law.name;
  const gotSection = quote.section.number;
  const verified = !!r?.verified;
  return { ...base, gotLaw, gotSection, critic: r?.critic ?? "no-answer", verified, correct: verified && gotLaw === g.law && gotSection === g.section };
}

export function scoreLaw(rows: readonly LawRow[], need = 18): LawScore {
  const correct = rows.filter((r) => r.correct).length;
  return { task: "W7.5", total: rows.length, correct, need, pass: rows.length >= 20 && correct >= need };
}
