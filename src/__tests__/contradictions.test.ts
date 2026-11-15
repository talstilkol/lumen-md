/**
 * R12.10 — "where my notes disagree", on a synthetic vault with five
 * planted contradictions and look-alikes that are not contradictions:
 * ≥ 4 of the 5 found, 0 invented; every quote is exact at its offsets
 * (alignQuote); a clipped page is flagged and gets no weight; the agent
 * only stages a report through the approval queue and writes nothing.
 * No model. Clean reimplementation (design reference only).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { alignQuote, findContradictions, sentences, type Candidate } from "../agents/contradictions";
import { runContradictor } from "../agents/contradictor";
import { clearStagedChanges, listStagedChanges } from "../agents/staging";
import { untrustedSourcesOfNote } from "../agents/provenance";

const NAMES = ["דנה לוי", "יוסי כהן", "רחל אבן", "ועד השכונה"];
const VAULT = new Map<string, string>([
  ["יומן/2024-01-10.md", "---\ndate: 2024-01-10\n---\nדנה לוי נולדה ב-1980 בחיפה.\nבוועד השכונה יש 12 חברים.\nיוסי כהן חתם על החוזה ב-3.4.2021.\n"],
  ["תיק/ועד.md", "דנה לוי נולדה בשנת 1982.\nבוועד השכונה יש 9 חברים.\nהישיבה של ועד השכונה התקיימה ב-4.5.2022.\n"],
  ["תיק/חוזה.md", "יוסי כהן הכחיש שחתם על החוזה.\nדנה לוי החליפה את רחל אבן בתפקיד.\n"],
  ["תיק/פרוטוקול.md", "תיקון: הישיבה של ועד השכונה התקיימה ב-5.5.2022, לא קודם.\nרחל אבן החליפה את דנה לוי בתפקיד.\n"],
  // Look-alikes: compatible dates, other statements, a denial about something else.
  ["תיק/רקע.md", "דנה לוי נולדה ב-2.3.1980 בבוקר.\nיוסי כהן קנה 3 ספרים.\nיוסי כהן בן 40.\nרחל אבן הכחישה שהיא אוהבת קפה.\nדנה לוי ורחל אבן נפגשו בוועד השכונה.\n"],
  // Outside content: a clipped page that disagrees.
  ["ספרייה/כתבה.md", "---\nsource: https://example.org/a\n---\nבוועד השכונה יש 30 חברים.\n"],
]);
// Implied by the first planted pair: 2.3.1980 disagrees with 1982 as well (and agrees with 1980, which is not reported).
const IMPLIED = ["דנה לוי נולדה ב-2.3.1980 בבוקר", "דנה לוי נולדה בשנת 1982"];
const PLANTED: Array<[Candidate["kind"], string, string]> = [
  ["date", "דנה לוי נולדה ב-1980 בחיפה", "דנה לוי נולדה בשנת 1982"],
  ["value", "בוועד השכונה יש 12 חברים", "בוועד השכונה יש 9 חברים"],
  ["denial", "יוסי כהן חתם על החוזה ב-3.4.2021", "יוסי כהן הכחיש שחתם על החוזה"],
  ["correction", "הישיבה של ועד השכונה התקיימה ב-4.5.2022", "תיקון: הישיבה של ועד השכונה התקיימה ב-5.5.2022, לא קודם"],
  ["direction", "דנה לוי החליפה את רחל אבן בתפקיד", "רחל אבן החליפה את דנה לוי בתפקיד"],
];
const pair = (c: Candidate) => [c.a.text, c.b.text].sort().join(" ⟷ ");
const untrusted = (p: string, c: string) => untrustedSourcesOfNote(p, c);

describe("R12.10 contradiction finder (synthetic vault)", () => {
  beforeEach(() => localStorage.clear());

  it("sentences keep exact offsets, and a date's dots do not split one", () => {
    const text = VAULT.get("יומן/2024-01-10.md")!;
    const ss = sentences("n.md", text);
    expect(ss.map((s) => s.text)).toEqual(["דנה לוי נולדה ב-1980 בחיפה", "בוועד השכונה יש 12 חברים", "יוסי כהן חתם על החוזה ב-3.4.2021"]);
    for (const s of ss) expect(text.slice(s.start, s.end)).toBe(s.text);
  });

  it("finds ≥ 4 of the 5 planted contradictions and invents none", () => {
    const found = findContradictions(VAULT, { names: NAMES, untrusted });
    const trusted = found.filter((c) => c.weight === 1);
    const hits = PLANTED.filter(([kind, x, y]) => trusted.some((c) => c.kind === kind && pair(c) === [x, y].sort().join(" ⟷ ")));
    expect(hits.length).toBeGreaterThanOrEqual(4);
    const planted = new Set([...PLANTED.map(([, x, y]) => [x, y].sort().join(" ⟷ ")), [...IMPLIED].sort().join(" ⟷ ")]);
    const invented = trusted.filter((c) => !planted.has(pair(c))).map(pair);
    expect(invented).toEqual([]);
    expect(hits.length).toBe(5);
    expect(trusted.some((c) => pair(c) === ["דנה לוי נולדה ב-1980 בחיפה", "דנה לוי נולדה ב-2.3.1980 בבוקר"].sort().join(" ⟷ "))).toBe(false);
  });

  it("every quote is exact at its offsets", () => {
    for (const c of findContradictions(VAULT, { names: NAMES, untrusted })) {
      expect(alignQuote(VAULT, c.a)).toBe(true);
      expect(alignQuote(VAULT, c.b)).toBe(true);
    }
    expect(alignQuote(VAULT, { note: "תיק/ועד.md", start: 0, end: 5, text: "משהו" })).toBe(false);
  });

  it("a clipped page is flagged and gets no weight; the user's notes come first", () => {
    const found = findContradictions(VAULT, { names: NAMES, untrusted });
    const outside = found.filter((c) => c.a.note.startsWith("ספרייה/") || c.b.note.startsWith("ספרייה/"));
    expect(outside.length).toBeGreaterThan(0);
    for (const c of outside) {
      expect(c.weight).toBe(0);
      expect(c.untrusted[0].why.join()).toMatch(/clipped page/);
    }
    const firstOutside = found.findIndex((c) => c.weight === 0);
    expect(found.slice(firstOutside).every((c) => c.weight === 0)).toBe(true);
  });
});

describe("R12.10 contradictor agent: through the approval queue only", () => {
  beforeEach(() => {
    clearStagedChanges();
    localStorage.clear();
  });
  afterEach(() => clearStagedChanges());

  it("stages one report note and writes nothing", async () => {
    // The names come from the vault's note titles: here, a note per person and the committee.
    const files = new Map([...VAULT, ...NAMES.map((n) => [`אנשים/${n}.md`, `# ${n}\n`] as [string, string])]);
    const writes: string[] = [];
    const vault = {
      listWorkspace: async () => [...files.keys()].map((path) => ({ path })),
      readWorkspaceFile: async (p: string) => files.get(p)!,
      workspaceHasFile: async (p: string) => files.has(p),
      writeWorkspaceFile: async (p: string) => void writes.push(p),
    };
    const before = JSON.stringify([...files]);
    const { candidates, staged } = await runContradictor({ vault, today: "2026-11-15" });
    expect(candidates.length).toBeGreaterThanOrEqual(5);
    expect(staged).toMatchObject({ kind: "file", path: "סתירות/2026-11-15.md", before: null, status: "pending", agentId: "contradictor" });
    expect(listStagedChanges()).toHaveLength(1);
    const report = (staged as { after: string }).after;
    for (const [, x, y] of PLANTED) {
      expect(report).toContain(x);
      expect(report).toContain(y);
    }
    expect(writes).toEqual([]);
    expect(JSON.stringify([...files])).toBe(before);
  });
});
