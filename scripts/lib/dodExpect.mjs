/**
 * A dod command's expected result (`dodExpect`, plan 0.7 / W10.Z3), checked
 * where a machine can check it (audit r3: dod.mjs went by the exit code alone,
 * so W6.39 showed green while plan:check printed eleven WIP warnings).
 *
 * The clauses read from an expectation. Text in parentheses is a note: its
 * exit codes and counts are not clauses ("(51/51 on 16.11)" is history). But
 * a note never removes a check (review 12, H3): what it says must or must not
 * be printed, "0 failed" and a known phrase are read from the whole text, so
 * "(no wave is over its WIP limit …)" still forbids a wave over its limit.
 *   exit N              leading "exit N": the command's exit code is N
 *   prints `X`          the output has X        (also `prints word` at the end)
 *   prints no `X`       the output does not have X (also "never prints `X`", "no `X`")
 *   A/B                 a count: the output has "A/B" (e.g. "6/6 steps")
 *   0 failed            no "<n> failed" with n > 0 in the output
 *   a known phrase      PHRASES below: "no wave is over its WIP limit", "no problem lines"
 * Everything else ("0 skipped without a reason", "card complete") is prose for
 * the reader, not checked here, and says nothing either way.
 */

/** Prose that has a machine meaning: [phrase, output pattern that must NOT appear, what it means]. */
export const PHRASES = [
  [/\bno wave is over its WIP limit\b/i, /\bWIP — wave \d+ has\b|\bwave pairs? (?:is |are )?over the (?:WIP )?limit\b/, "a wave over its WIP limit"],
  [/\bno problem lines\b/i, /^\s*✗/m, "a problem line"],
];

/**
 * The checkable clauses of an expectation.
 * @param {string | undefined} expect
 * @returns {Array<{ kind: "exit", code: number } | { kind: "prints" | "absent", text: string } | { kind: "count", text: string } | { kind: "zero-failed" } | { kind: "phrase", forbid: RegExp, what: string }>}
 */
export function parseExpect(expect) {
  if (typeof expect !== "string" || !expect.trim()) return [];
  const text = expect.replace(/\([^)]*\)/g, " ");
  const all = expect.replace(/[()]/g, " ");
  const out = [];
  const exit = /^\s*exit (\d+)\b/.exec(text);
  if (exit) out.push({ kind: "exit", code: Number(exit[1]) });
  for (const m of all.matchAll(/\b(prints no|never prints|no|prints)\s+`([^`]+)`/g)) out.push({ kind: m[1] === "prints" ? "prints" : "absent", text: m[2] });
  const bare = /\bprints\s+([^\s`,;—]+)\s*$/.exec(text);
  if (bare && bare[1] !== "no") out.push({ kind: "prints", text: bare[1] });
  for (const m of text.matchAll(/(?<![\d/.])(\d+)\/(\d+)(?![\d/.])/g)) out.push({ kind: "count", text: `${m[1]}/${m[2]}` });
  if (/(?:^|[^\d])0 failed\b/.test(all)) out.push({ kind: "zero-failed" });
  for (const [re, forbid, what] of PHRASES) if (re.test(all)) out.push({ kind: "phrase", forbid, what });
  return out;
}

/**
 * The clauses a run did not meet (empty: met, or nothing checkable).
 * @param {string | undefined} expect
 * @param {{ code: number, out: string }} run
 * @returns {string[]}
 */
export function unmetExpect(expect, { code, out }) {
  const output = String(out ?? "");
  const unmet = [];
  for (const c of parseExpect(expect)) {
    if (c.kind === "exit" && code !== c.code) unmet.push(`exit ${c.code} expected, got ${code}`);
    else if (c.kind === "prints" && !output.includes(c.text)) unmet.push(`does not print "${c.text}"`);
    else if (c.kind === "absent" && output.includes(c.text)) unmet.push(`prints "${c.text}"`);
    else if (c.kind === "count" && !new RegExp(`(?<![\\d/.])${c.text.replace("/", "\\/")}(?![\\d/.])`).test(output)) unmet.push(`no ${c.text} in the output`);
    else if (c.kind === "zero-failed") {
      const bad = [...output.matchAll(/(?:^|[^\d])([1-9]\d*) failed\b/g)].map((m) => m[1]);
      if (bad.length) unmet.push(`${bad[0]} failed`);
    } else if (c.kind === "phrase") {
      const hits = output.split("\n").filter((l) => c.forbid.test(l));
      if (hits.length) unmet.push(`${hits.length} × ${c.what}: ${hits[0].trim().slice(0, 100)}`);
    }
  }
  return unmet;
}

/** The exit code an expectation asks for (0 when it names none). */
export const expectedExit = (expect) => parseExpect(expect).find((c) => c.kind === "exit")?.code ?? 0;
