/**
 * The steps `npm run ci:local` runs (plan 0.14), as data, so the choice of
 * steps is testable without running any of them.
 *
 * The list mirrors .github/workflows/ci.yml's `check` job plus the e2e job on
 * Chromium. A step whose tool is not in this checkout (an older branch with no
 * licence gate, say) is reported as "not here" instead of failing.
 */

/** @typedef {{ id: string, title: string, cmd: string[], needs?: string[], slow?: boolean, skipReason?: string }} Step */

const has = (pkg, name) => Boolean(pkg?.scripts?.[name]);

/**
 * @param {{ pkg: any, exists: (path: string) => boolean, changed: string[] | null, flags: { skip?: string[], only?: string[], coverage?: boolean } }} input
 *   `changed` is the list of changed files for `--changed`, or null for a full run.
 * @returns {Step[]}
 */
export function planSteps({ pkg, exists, changed, flags }) {
  const skip = new Set(flags.skip ?? []);
  const only = flags.only?.length ? new Set(flags.only) : null;
  const touches = (re) => changed === null || changed.some((f) => re.test(f));
  const codeChanged = touches(/^(src|e2e|scripts|public|index\.html|vite\.config|tsconfig|package)/);
  /** @type {Step[]} */
  const steps = [
    { id: "typecheck", title: "TypeScript", cmd: ["npx", "tsc", "--noEmit", "-p", "."] },
    has(pkg, "hygiene") ? { id: "hygiene", title: "Code hygiene", cmd: ["npm", "run", "-s", "hygiene"] } : { id: "hygiene", title: "Code hygiene", cmd: [], skipReason: "not here" },
    has(pkg, "lint") ? { id: "lint", title: "ESLint", cmd: ["npm", "run", "-s", "lint"] } : { id: "lint", title: "ESLint", cmd: [], skipReason: "not here (plan 0.4)" },
    { id: "i18n", title: "i18n keys + drift", cmd: ["node", "scripts/extract-i18n-keys.mjs", "--check"], needs: ["scripts/extract-i18n-keys.mjs"] },
    has(pkg, "licenses") ? { id: "licenses", title: "Licence gate", cmd: ["npm", "run", "-s", "licenses"] } : { id: "licenses", title: "Licence gate", cmd: [], skipReason: "not here (plan 0.10)" },
    exists("scripts/headers.mjs") ? { id: "headers", title: "Security headers", cmd: ["node", "scripts/headers.mjs", "--check"] } : { id: "headers", title: "Security headers", cmd: [], skipReason: "not here (plan 0.17)" },
    changed === null
      ? { id: "test", title: "Vitest", cmd: flags.coverage ? ["npx", "vitest", "run", "--coverage"] : ["npx", "vitest", "run"], slow: true }
      : { id: "test", title: "Vitest (related to the diff)", cmd: ["npx", "vitest", "related", "--run", ...changed.filter((f) => /\.(m?[jt]sx?)$/.test(f))], slow: true },
    { id: "build", title: "Build", cmd: ["npm", "run", "-s", "build"], slow: true },
    has(pkg, "budget") ? { id: "budget", title: "Bundle budget", cmd: ["npm", "run", "-s", "budget"], needs: ["dist"] } : { id: "budget", title: "Bundle budget", cmd: [], skipReason: "not here" },
    { id: "e2e", title: "e2e (Chromium, production build)", cmd: ["e2e"], slow: true },
  ];
  for (const s of steps) {
    if (s.skipReason) continue;
    if (only && !only.has(s.id)) s.skipReason = "not selected";
    else if (skip.has(s.id)) s.skipReason = "skipped (--skip)";
    else if (s.needs?.some((p) => !exists(p))) s.skipReason = "not here";
    else if (changed !== null && s.id === "test" && s.cmd.length === 4) s.skipReason = "no code files in the diff";
    else if (changed !== null && (s.id === "build" || s.id === "budget" || s.id === "e2e") && !codeChanged) s.skipReason = "diff touches no app code";
  }
  return steps;
}

/** e2e specs for a run: every spec for a full run; with --changed, changed specs plus the smoke test. */
export function e2eSpecs(changed, allSpecs) {
  if (changed === null) return [];
  const touched = changed.filter((f) => /^e2e\/.*\.spec\.ts$/.test(f) && allSpecs.includes(f));
  return [...new Set(["e2e/smoke.spec.ts", ...touched])].filter((f) => allSpecs.includes(f));
}

/** en vs he key counts must stay within 10 of each other (the CI drift gate). */
export function i18nDrift(enCount, heCount, limit = 10) {
  const diff = Math.abs(enCount - heCount);
  return { diff, ok: diff <= limit };
}

/** A fixed-width summary table. */
export function summary(results) {
  const w = Math.max(...results.map((r) => r.title.length), 10);
  const lines = results.map((r) => {
    const mark = r.status === "pass" ? "✓" : r.status === "fail" ? "✗" : "–";
    const time = r.ms != null ? `${(r.ms / 1000).toFixed(1)}s` : "";
    return `${mark} ${r.title.padEnd(w)}  ${(r.status === "skip" ? r.reason : time).padEnd(10)}`;
  });
  return lines.join("\n");
}
