/**
 * Scoring for the agent eval (MASTER_PLAN v2, E1). Every check is
 * deterministic, so a run against a real local model gives a number that
 * can be compared between models, prompts and releases.
 */

export type Check =
  /** At least `min` (0–1) of the letters are Hebrew. */
  | { type: "hebrew"; min: number }
  /** At most `max` (0–1) of the letters are Hebrew (a translation out of Hebrew). */
  | { type: "maxHebrew"; max: number }
  /** Every listed string appears (case-insensitive). */
  | { type: "contains"; all: string[] }
  /** At least one of the listed strings appears (case-insensitive). */
  | { type: "containsAny"; any: string[] }
  | { type: "notContains"; none: string[] }
  | { type: "maxChars"; max: number }
  /** A JSON path into the structured output has at least `min` items. */
  | { type: "minItems"; path: string; min: number }
  /** A regular expression (source + flags) matches the text form. */
  | { type: "matches"; source: string; flags?: string };

export interface CheckResult {
  check: Check;
  ok: boolean;
  detail: string;
}

/** The text an output is judged on: strings as is, structures as JSON. */
export function textOf(output: unknown): string {
  return typeof output === "string" ? output : JSON.stringify(output ?? "");
}

/** Share of letters that are Hebrew (0 when there are no letters). */
export function hebrewRatio(text: string): number {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (!letters.length) return 0;
  const hebrew = letters.filter((c) => /\p{Script=Hebrew}/u.test(c)).length;
  return hebrew / letters.length;
}

function at(value: unknown, path: string): unknown {
  let cur: unknown = value;
  for (const part of path.split(".").filter(Boolean)) {
    if (cur && typeof cur === "object") cur = (cur as Record<string, unknown>)[part];
    else return undefined;
  }
  return cur;
}

export function runCheck(check: Check, output: unknown): CheckResult {
  const text = textOf(output);
  const lower = text.toLowerCase();
  switch (check.type) {
    case "hebrew": {
      // Structured answers: judge the values, not the English keys.
      const values = typeof output === "string" ? text : JSON.stringify(output).replace(/"[A-Za-z_]+":/g, "");
      const r = hebrewRatio(values);
      return { check, ok: r >= check.min, detail: `${Math.round(r * 100)}% Hebrew letters` };
    }
    case "maxHebrew": {
      const r = hebrewRatio(text);
      return { check, ok: r <= check.max, detail: `${Math.round(r * 100)}% Hebrew letters` };
    }
    case "contains": {
      const missing = check.all.filter((s) => !lower.includes(s.toLowerCase()));
      return { check, ok: missing.length === 0, detail: missing.length ? `missing: ${missing.join(", ")}` : "all present" };
    }
    case "containsAny": {
      const hit = check.any.find((s) => lower.includes(s.toLowerCase()));
      return { check, ok: !!hit, detail: hit ? `found: ${hit}` : `none of: ${check.any.join(", ")}` };
    }
    case "notContains": {
      const hit = check.none.filter((s) => lower.includes(s.toLowerCase()));
      return { check, ok: hit.length === 0, detail: hit.length ? `unexpected: ${hit.join(", ")}` : "clean" };
    }
    case "maxChars":
      return { check, ok: text.length <= check.max, detail: `${text.length} chars` };
    case "minItems": {
      const v = at(output, check.path);
      const n = Array.isArray(v) ? v.length : 0;
      return { check, ok: n >= check.min, detail: `${n} item(s) at ${check.path}` };
    }
    case "matches": {
      const ok = new RegExp(check.source, check.flags ?? "").test(text);
      return { check, ok, detail: ok ? "matches" : `no match for /${check.source}/` };
    }
  }
}

export interface CaseResult {
  id: string;
  agent: string;
  status: "ok" | "failed" | "skipped";
  executor: string | null;
  model: string | null;
  attempts: number;
  ms: number;
  checks: CheckResult[];
  error?: string;
}

/** A case passes when the run succeeded and every check holds. */
export function passed(r: CaseResult): boolean {
  return r.status === "ok" && r.checks.every((c) => c.ok);
}

export function scoreCases(output: unknown, checks: Check[]): CheckResult[] {
  return checks.map((c) => runCheck(c, output));
}

/** Markdown report: one summary line and a table, in the order run. */
export function formatEvalReport(results: CaseResult[], meta: { model: string; url: string; date: string }): string {
  const ran = results.filter((r) => r.status !== "skipped");
  const ok = ran.filter(passed).length;
  const ms = ran.reduce((a, r) => a + r.ms, 0);
  const lines = [
    `# Agent eval — ${meta.model}`,
    "",
    `${meta.date} · ${meta.url} · **${ok}/${ran.length} passed** · ${(ms / 1000).toFixed(1)} s total`,
    "",
    "| Case | Agent | Result | Attempts | Time | Notes |",
    "|---|---|---|---|---|---|",
  ];
  for (const r of results) {
    const res = r.status === "skipped" ? "skipped" : passed(r) ? "pass" : "FAIL";
    const notes = r.error ?? r.checks.filter((c) => !c.ok).map((c) => `${c.check.type}: ${c.detail}`).join("; ");
    lines.push(`| ${r.id} | ${r.agent} | ${res} | ${r.attempts} | ${(r.ms / 1000).toFixed(1)} s | ${(notes || "—").replace(/\|/g, "\\|")} |`);
  }
  return lines.join("\n") + "\n";
}
