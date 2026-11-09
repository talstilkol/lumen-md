/**
 * Eval cases for the app's direct prompts (src/ai/prompts.ts) — the ones
 * that go to whatever provider the user picked, cloud included (K1). Each
 * case is the exact system prompt plus a realistic user message; checks
 * are mechanical (language, format, length), so they run on any model.
 */
import { PROMPTS } from "../../ai/prompts";
import { sameScript } from "../runtime";

export interface PromptCheck {
  name: string;
  test: (out: string, input: string) => boolean;
}

export interface PromptCase {
  id: string;
  prompt: keyof typeof PROMPTS;
  user: string;
  checks: PromptCheck[];
}

const nonEmpty: PromptCheck = { name: "non-empty", test: (o) => o.trim().length > 0 };
const sameLang: PromptCheck = { name: "same language", test: (o, i) => sameScript(i, o).ok };
const noFence: PromptCheck = { name: "no code fence", test: (o) => !/^\s*```/.test(o) };
const maxWords = (n: number): PromptCheck => ({ name: `≤ ${n} words`, test: (o) => o.trim().split(/\s+/).length <= n });

export const PROMPT_CASES: PromptCase[] = [
  {
    id: "rewrite-he",
    prompt: "rewrite",
    user: "Instruction: לנסח בצורה רשמית יותר\n\nText: היי, הפגישה של מחר זזה לשלוש כי הלקוח לא יכול בבוקר, תעדכנו את כולם בבקשה.",
    checks: [nonEmpty, sameLang, noFence],
  },
  {
    id: "rewrite-en",
    prompt: "rewrite",
    user: "Instruction: make it shorter\n\nText: We wanted to let everyone know that the release, which was planned for Monday, has been moved to Tuesday because QA needs one more day.",
    checks: [nonEmpty, noFence, { name: "shorter", test: (o, i) => o.length < i.length }],
  },
  {
    id: "autocomplete-he",
    prompt: "autocomplete",
    user: "בסוף הפגישה הוחלט שהצוות ימשיך לעבוד על",
    checks: [nonEmpty, sameLang, maxWords(12)],
  },
  {
    id: "rag-he",
    prompt: "ragAssistant",
    user: "Context Files:\n---\n📄 [1] פגישות/צוות.md\nההשקה נדחתה ליום שלישי בגלל הבדיקות. התקציב לא השתנה.\n\nQuestion: מתי ההשקה ולמה?",
    checks: [nonEmpty, sameLang, { name: "mentions Tuesday", test: (o) => /שלישי/.test(o) }],
  },
  {
    id: "summarize-he",
    prompt: "summarize",
    user: "אז ככה, דיברתי עם דנה על הפרויקט, היא אומרת שהעיצוב כמעט מוכן ושצריך עוד שבוע לבדיקות. גם ביקשה שנזמין את הספק לפגישה ביום ראשון.",
    checks: [nonEmpty, sameLang, { name: "two bullets", test: (o) => (o.match(/^\s*[-*•]/gm) ?? []).length >= 1 && (o.match(/^\s*[-*•]/gm) ?? []).length <= 3 }],
  },
  {
    id: "actionItems-he",
    prompt: "actionItems",
    user: "סיכום פגישה: יוסי ישלח את המצגת עד יום חמישי. רותם תבדוק את התקציב. צריך לקבוע פגישה עם הספק.",
    checks: [nonEmpty, sameLang, { name: "task list", test: (o) => (o.match(/^\s*- \[ \] /gm) ?? []).length >= 2 }],
  },
  {
    id: "commit-en",
    prompt: "commitMessage",
    user: "M src/editor/Editor.tsx\nA src/ai/ocr.ts\nM package.json",
    checks: [nonEmpty, { name: "one line", test: (o) => o.trim().split("\n").length === 1 }, { name: "conventional", test: (o) => /^(feat|fix|docs|chore|refactor|test|perf|build|ci|style)(\(.+\))?!?:/.test(o.trim()) }],
  },
];
