/**
 * The user's switches for the rule-based writing checks (W13.W11, W13.W15):
 * lemmas not to flag, own clichés, built-in clichés switched off, loanword
 * terms switched off and the register. A per-device convenience: kept in
 * localStorage (every access guarded), never sent anywhere; the checks
 * work with the defaults when storage is unavailable.
 */
export interface WritingCheckSettings {
  window: number;
  ignoredLemmas: string[];
  userCliches: string[];
  disabledCliches: string[];
  /** W13.W15: "everyday" (default, no loanword suggestions) or "academic". */
  register: "everyday" | "academic";
  disabledTerms: string[];
}

export const WRITING_CHECKS_KEY = "lumen.writingChecks.v1";

export const DEFAULT_WRITING_CHECKS: WritingCheckSettings = { window: 50, ignoredLemmas: [], userCliches: [], disabledCliches: [], register: "everyday", disabledTerms: [] };

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 2000) : []);

export function loadWritingChecks(): WritingCheckSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(WRITING_CHECKS_KEY) ?? "null") as Partial<WritingCheckSettings> | null;
    if (!raw || typeof raw !== "object") return { ...DEFAULT_WRITING_CHECKS };
    const w = Number(raw.window);
    return {
      window: Number.isFinite(w) && w >= 5 && w <= 500 ? Math.round(w) : 50,
      ignoredLemmas: strings(raw.ignoredLemmas),
      userCliches: strings(raw.userCliches),
      disabledCliches: strings(raw.disabledCliches),
      register: raw.register === "academic" ? "academic" : "everyday",
      disabledTerms: strings(raw.disabledTerms),
    };
  } catch {
    // why: storage blocked or corrupt — the defaults still work
    return { ...DEFAULT_WRITING_CHECKS };
  }
}

export function saveWritingChecks(s: WritingCheckSettings): void {
  try {
    localStorage.setItem(WRITING_CHECKS_KEY, JSON.stringify(s));
  } catch {
    // why: storage blocked (private window); the switch lasts for this session only
  }
}
