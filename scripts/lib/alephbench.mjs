/**
 * Plan W11.I11 — AlephBench adapters (research R2.4): the Hebrew LLM
 * benchmark of HebArabNlpProject/AlephBench (eval/public/llm-alephbench.json)
 * and the tasks of the Hebrew chat leaderboard (huggingface.co/blog/leaderboard-hebrew).
 *
 * One adapter per subset turns an example into a prompt and an answer into
 * a score in [0, 1]:
 *   choice   classification and multiple choice: the first label the answer
 *            names (Hebrew or English label, or the option's letter) → 1/0
 *   qa       extractive QA: token F1 (Hebrew one-letter prefixes dropped), best reference
 *   number   arithmetic word problems: the last number in the answer equals the gold one
 *   overlap  translation and summarisation: character 3-gram F (a chrF-like score)
 *   nikud    nikud: the share of letters whose points match the gold pointing
 *
 * The overall number is computed as the public leaderboard does it: the
 * unweighted mean of the per-subset scores (macro), not a mean over all
 * examples, so a large subset cannot outweigh a small one. The card carries
 * `macro` (what scripts/lib/modelSelect.mjs reads), `nikud` and one metric
 * per subset.
 *
 *
 * The data is not committed (licence: per subset, no redistribution). The
 * runner (src/agents/eval/alephbench.eval.ts) reads normalised JSONL, one
 * line per example; an example names its subset, and a subset this file
 * does not know is an error, never silently dropped. Turning the Hub files
 * into that JSONL is the Mac's step (W11.M4), after `npm run eval:public --
 * fetch llm-alephbench --pin`: each subset's own field names are read there.
 *
 * Plain JavaScript (like evalCard.mjs and modelSelect.mjs): an eval harness,
 * not part of the app.
 *
 * @typedef {"choice" | "qa" | "number" | "overlap" | "nikud"} AlephKind
 * @typedef {{ id: string, subset: string, input: string, context?: string, choices?: string[], answer: string | number | string[] }} AlephExample
 *   input: the question, sentence or text; context: a passage (QA) or a premise (NLI);
 *   choices: the options of a multiple-choice item; answer: a label, a choice index, a number, or reference texts
 * @typedef {{ id: string, kind: AlephKind, instruction: string, labels?: Array<{ id: string, names: string[] }> }} AlephSubset
 * @typedef {{ id: string, answer(prompt: string, e: AlephExample): Promise<string> }} AlephEngine
 * @typedef {{ id: string, subset: string, score: number, answer: string, error?: string }} AlephRow
 */
const NLI = [
  { id: "entailment", names: ["היסק", "נובע", "entailment"] },
  { id: "neutral", names: ["ניטרלי", "נייטרלי", "neutral"] },
  { id: "contradiction", names: ["סתירה", "contradiction"] },
];
const SENTIMENT = [
  { id: "positive", names: ["חיובי", "positive"] },
  { id: "negative", names: ["שלילי", "negative"] },
  { id: "neutral", names: ["ניטרלי", "נייטרלי", "neutral"] },
];
/** The 11 subsets. Their ids are the normalised subset names the fetch step writes. */
export const SUBSETS = [
  {
    id: "hebnli",
    kind: "choice",
    labels: NLI,
    instruction: "קבע את היחס בין המשפטים: היסק, ניטרלי או סתירה.",
  },
  {
    id: "hebrew_qa",
    kind: "qa",
    instruction: "ענה על השאלה במילים מתוך הקטע בלבד.",
  },
  {
    id: "hebrew_sentiment",
    kind: "choice",
    labels: SENTIMENT,
    instruction: "מה הסנטימנט של הטקסט: חיובי, שלילי או ניטרלי?",
  },
  {
    id: "winograd",
    kind: "choice",
    instruction: "בחר את האפשרות שאליה מתייחס הכינוי במשפט. ענה באות האפשרות.",
  },
  {
    id: "winogrande",
    kind: "choice",
    instruction: "בחר את האפשרות שמשלימה את המשפט נכון. ענה באות האפשרות.",
  },
  {
    id: "mmlu_heb",
    kind: "choice",
    instruction: "ענה על שאלת הרב-ברירה. ענה באות האפשרות בלבד.",
  },
  {
    id: "gsm8k_heb",
    kind: "number",
    instruction: "פתור את הבעיה. כתוב בסוף את התשובה המספרית בלבד.",
  },
  {
    id: "israeli_trivia",
    kind: "qa",
    instruction: "ענה על שאלת הטריוויה בקצרה.",
  },
  { id: "ted_heb", kind: "overlap", instruction: "תרגם את המשפט לאנגלית." },
  {
    id: "summarization",
    kind: "overlap",
    instruction: "סכם את הטקסט בשני משפטים לכל היותר.",
  },
  {
    id: "nikud",
    kind: "nikud",
    instruction: "נקד את הטקסט בניקוד מלא. החזר את הטקסט המנוקד בלבד.",
  },
];
const BY_ID = new Map(SUBSETS.map((s) => [s.id, s]));
const LETTERS = ["א", "ב", "ג", "ד", "ה", "ו"];
const LATIN = ["A", "B", "C", "D", "E", "F"];
export function subsetOf(id) {
  const s = BY_ID.get(id);
  if (!s)
    throw new Error(
      `AlephBench: unknown subset "${id}" (known: ${SUBSETS.map((x) => x.id).join(", ")})`,
    );
  return s;
}
/** The prompt for one example: the subset's instruction, the context, the input, the options. */
export function promptOf(e) {
  const s = subsetOf(e.subset);
  const parts = [s.instruction];
  if (e.context) parts.push(e.context);
  parts.push(e.input);
  if (e.choices?.length)
    parts.push(e.choices.map((c, i) => `${LETTERS[i]}. ${c}`).join("\n"));
  return parts.join("\n\n");
}
// ── scoring ───────────────────────────────────────────────────────────────
const POINTS = /[֑-ׇ]/g;
const strip = (s) => s.replace(POINTS, "");
const norm = (s) =>
  strip(s)
    .toLowerCase()
    .replace(/[‎‏"'״׳.,:;!?()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const HE_PREFIX = /^[והבלמשכ]{1,2}(?=[א-ת]{2})/;
const words = (s) =>
  norm(s)
    .split(" ")
    .filter(Boolean)
    .map((w) => w.replace(HE_PREFIX, ""));
/** Token F1 (SQuAD style, Hebrew one-letter prefixes dropped). */
export function tokenF1(pred, ref) {
  const p = words(pred);
  const r = words(ref);
  if (!p.length || !r.length) return p.length === r.length ? 1 : 0;
  const counts = new Map();
  for (const w of r) counts.set(w, (counts.get(w) ?? 0) + 1);
  let common = 0;
  for (const w of p) {
    const c = counts.get(w) ?? 0;
    if (c) {
      common++;
      counts.set(w, c - 1);
    }
  }
  if (!common) return 0;
  const precision = common / p.length;
  const recall = common / r.length;
  return (2 * precision * recall) / (precision + recall);
}
/** Character 3-gram F-score (β = 2, chrF's weighting of recall), spaces dropped. */
export function charF(pred, ref, n = 3) {
  const grams = (s) => {
    const t = norm(s).replace(/ /g, "");
    const m = new Map();
    for (let i = 0; i + n <= t.length; i++)
      m.set(t.slice(i, i + n), (m.get(t.slice(i, i + n)) ?? 0) + 1);
    return m;
  };
  const p = grams(pred);
  const r = grams(ref);
  const total = (m) => [...m.values()].reduce((a, b) => a + b, 0);
  const tp = total(p);
  const tr = total(r);
  if (!tp || !tr) return tp === tr ? 1 : 0;
  let common = 0;
  for (const [g, c] of p) common += Math.min(c, r.get(g) ?? 0);
  if (!common) return 0;
  const precision = common / tp;
  const recall = common / tr;
  const b2 = 4;
  return ((1 + b2) * precision * recall) / (b2 * precision + recall);
}
/** The last number in a text (commas between thousands allowed, Hebrew or Latin digits only). */
export function lastNumber(s) {
  const m = String(s)
    .replace(/(\d),(\d{3})/g, "$1$2")
    .match(/-?\d+(?:\.\d+)?/g);
  return m ? Number(m[m.length - 1]) : null;
}
/** Per letter of the gold text: does the prediction's letter carry the same points? */
export function nikudAccuracy(pred, gold) {
  const units = (s) => {
    const out = [];
    for (const ch of s.normalize("NFC")) {
      if (/[ְ-ׇ]/.test(ch) && out.length) out[out.length - 1].points += ch;
      else if (/[א-ת]/.test(ch)) out.push({ letter: ch, points: "" });
    }
    return out.map((u) => ({ ...u, points: [...u.points].sort().join("") }));
  };
  const g = units(gold);
  const p = units(pred);
  if (!g.length) return p.length ? 0 : 1;
  // The letters must be the gold's letters, in order; a changed text scores what still lines up.
  let ok = 0;
  for (let i = 0; i < g.length; i++)
    if (p[i] && p[i].letter === g[i].letter && p[i].points === g[i].points)
      ok++;
  return ok / g.length;
}
/** Which option or label does an answer name? Index, or null. */
export function pickedChoice(answer, e, s) {
  const a = norm(answer);
  if (e.choices?.length) {
    const lead = /^(?:ה?תשובה|answer)?\s*:?\s*([א-ו]|[a-f])(?:[.)\s]|$)/i.exec(
      a,
    );
    if (lead) {
      const i =
        LETTERS.indexOf(lead[1]) >= 0
          ? LETTERS.indexOf(lead[1])
          : LATIN.indexOf(lead[1].toUpperCase());
      if (i >= 0 && i < e.choices.length) return i;
    }
    const hit = e.choices
      .map((c, i) => ({ i, at: a.indexOf(norm(c)) }))
      .filter((x) => norm(e.choices[x.i]) && x.at >= 0)
      .sort((x, y) => x.at - y.at);
    return hit.length ? hit[0].i : null;
  }
  const labels = s.labels ?? [];
  let best = null;
  labels.forEach((l, i) => {
    for (const n of l.names) {
      const at = a.indexOf(norm(n));
      if (at >= 0 && (!best || at < best.at)) best = { i, at };
    }
  });
  return best ? best.i : null;
}
/** The score of one answer, in [0, 1]. */
export function scoreAnswer(e, answer) {
  const s = subsetOf(e.subset);
  const refs = Array.isArray(e.answer)
    ? e.answer.map(String)
    : [String(e.answer)];
  switch (s.kind) {
    case "choice": {
      const got = pickedChoice(answer, e, s);
      if (got === null) return 0;
      if (e.choices?.length) return got === Number(e.answer) ? 1 : 0;
      return s.labels[got].id === String(e.answer) ? 1 : 0;
    }
    case "qa":
      return Math.max(...refs.map((r) => tokenF1(answer, r)));
    case "number": {
      const got = lastNumber(answer);
      return got !== null && Math.abs(got - Number(e.answer)) < 1e-6 ? 1 : 0;
    }
    case "overlap":
      return Math.max(...refs.map((r) => charF(answer, r)));
    case "nikud":
      return nikudAccuracy(answer, refs[0]);
  }
}
/** Run every example; an engine error scores 0 and is kept on the row. */
export async function runAleph(examples, engine, onRow) {
  const rows = [];
  for (const e of examples) {
    subsetOf(e.subset);
    let row;
    try {
      const answer = await engine.answer(promptOf(e), e);
      row = {
        id: e.id,
        subset: e.subset,
        score: scoreAnswer(e, answer),
        answer,
      };
    } catch (err) {
      row = {
        id: e.id,
        subset: e.subset,
        score: 0,
        answer: "",
        error: String(err?.message ?? err),
      };
    }
    rows.push(row);
    onRow?.(row);
  }
  return rows;
}
/** Scores per subset, in SUBSETS order (subsets with no rows left out). */
export function scoresBySubset(rows) {
  const out = {};
  for (const s of SUBSETS) {
    const xs = rows.filter((r) => r.subset === s.id).map((r) => r.score);
    if (xs.length) out[s.id] = xs;
  }
  return out;
}
/** The leaderboard's average: the unweighted mean of the per-subset means. */
export function macroAverage(by) {
  const means = Object.values(by)
    .filter((xs) => xs.length)
    .map((xs) => xs.reduce((a, b) => a + b, 0) / xs.length);
  if (!means.length) throw new Error("AlephBench: no subset was scored");
  return means.reduce((a, b) => a + b, 0) / means.length;
}
/**
 * The card's scores: `macro` as one score per subset (so its bootstrap is
 * over subsets, and its value is the macro average), `nikud`, and one metric
 * per subset.
 */
export function cardScores(rows) {
  const by = scoresBySubset(rows);
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const out = { macro: Object.values(by).map(mean) };
  if (by.nikud) out.nikud = by.nikud;
  for (const [id, xs] of Object.entries(by)) out[`subset_${id}`] = xs;
  return out;
}
/** Parse the fetch step's JSONL; every line must be a known subset with an answer. */
export function parseAlephJsonl(text) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l, i) => {
      const e = JSON.parse(l);
      if (
        !e ||
        typeof e.input !== "string" ||
        e.answer === undefined ||
        typeof e.subset !== "string"
      )
        throw new Error(
          `AlephBench JSONL line ${i + 1}: needs subset, input and answer`,
        );
      subsetOf(e.subset);
      return { ...e, id: e.id ?? `${e.subset}-${i}` };
    });
}
