import { existsSync } from "node:fs";
import { delimiter as pathDelimiter, join as pathJoin } from "node:path";
/**
 * The steps `npm run ci:local` runs (plan 0.14), as data, so the choice of
 * steps is testable without running any of them.
 *
 * The list mirrors docs/archive/workflows/ci.yml's `check` job plus the e2e job on
 * Chromium. A step whose tool is not in this checkout (an older branch with no
 * licence gate, say) is reported as "not here" instead of failing.
 */

/** @typedef {{ id: string, title: string, cmd: string[], needs?: string[], data?: string[], slow?: boolean, skipReason?: string, coverageMin?: number }} Step */

/** Whether `bin` is an executable on PATH (no shell, no `which`). */
export function onPath(bin, env = {}) {
  return String(env.PATH ?? "")
    .split(pathDelimiter)
    .some((d) => d && existsSync(pathJoin(d, bin)));
}

/** The scanners ci:local runs when their binary is on PATH (W10.D14). */
export const SECURITY_STEPS = [
  { id: "gitleaks", tool: "gitleaks", bin: "gitleaks", title: "gitleaks (secrets)" },
  { id: "semgrep", tool: "semgrep", bin: "semgrep", title: "semgrep (OSS rules)" },
  { id: "cargo-audit", tool: "cargo-audit", bin: "cargo-audit", title: "cargo audit (with audit-lock)" },
];

/**
 * The base pr:check compares with in ci:local (W10.D4): `explicit` (--base),
 * else the current train — the highest origin/verify/train-N among `remoteRefs`
 * (as `git for-each-ref --format=%(refname:short)` prints them) — else
 * origin/main. Never @{upstream}: that is the branch's own remote copy.
 */
export function prCheckBase(explicit, remoteRefs = []) {
  if (explicit) return explicit;
  let best = null;
  for (const ref of remoteRefs) {
    const m = /^origin\/verify\/train(?:-(\d+))?$/.exec(String(ref).trim());
    const n = m ? Number(m[1] ?? 1) : null;
    if (n != null && (best == null || n > best.n)) best = { n, ref: m[0] };
  }
  return best?.ref ?? "origin/main";
}

/** CI's coverage gate (docs/archive/workflows/ci.yml "Coverage gate (lines >= 65%)"). */
export const COVERAGE_MIN = 65;

/**
 * Paths that are app code for build / budget / e2e: sources, specs, scripts,
 * public/ (the runner pages and their prebuilt scripts among them), every
 * root HTML file (each is a Vite entry: index.html…) and the build configs.
 */
export const isAppCode = (f) => /^(src|e2e|scripts|public)\/|^[^/]+\.html$|^(vite\.config|tsconfig|package|playwright\.config|postcss\.config|tailwind\.config)/.test(f);

const isCodeFile = (f) => /\.(m?[jt]sx?)$/.test(f);

/**
 * OCR inputs (plan 7.5): the OCR code, its traineddata, the golden OCR set
 * and the measuring script. A diff that touches one gets the CER step.
 */
export const isOcrInput = (f) => /^(src\/ai\/ocr[^/]*\.ts|public\/tesseract\/|eval\/golden\/ocr-he\/|scripts\/ocr\/)/.test(f);

/**
 * Public-benchmark inputs (plan W11.H5): manifests, committed results, the
 * registry the staleness rule reads, and the harness. A diff that touches
 * one gets the public-eval gate.
 */
export const isPublicEvalInput = (f) => /^(eval\/public\/|eval\/results\/|models\/registry\.json$|src\/eval\/public\/|scripts\/eval-public)/.test(f);

/** Bidi conformance inputs (plan W11.H1): the direction rule, its strong table, the runner and its manifest. */
export const isBidiConformanceInput = (f) => /^(src\/lib\/bidi(Direction|Strong\.generated)\.ts$|src\/eval\/public\/adapters\/bidi\.ts$|eval\/public\/unicode-bidi\.json$|scripts\/eval-public\.mjs$)/.test(f);

/** Where `npm run eval:public -- fetch unicode-bidi` puts the UCD test file (git-ignored). */
export const BIDI_TEST_DATA = "eval/public/.data/unicode-bidi/BidiCharacterTest.txt";

/** A module path without its extension or a trailing /index: how imports name it. */
export const moduleStem = (p) => p.replace(/\.(m?[jt]sx?)$/, "").replace(/\/index$/, "");

/** Normalise a/b/../c → a/c (POSIX, relative to the repository root). */
function normalise(p) {
  const out = [];
  for (const part of p.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

/**
 * Every module a dynamic `import("./…")` names in these sources, as stems.
 * `vitest related` follows static imports only, so a changed module reached
 * this way (the app's lazy panels, and the tests that load them the same way)
 * would find no related test and pass as "no tests" (W1.32, Codex on #210).
 * @param {{ path: string, text: string }[]} sources repository-relative POSIX paths
 */
export function dynamicImportTargets(sources) {
  const out = new Set();
  for (const { path, text } of sources) {
    const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    for (const m of text.matchAll(/\bimport\(\s*(?:\/\*[^*]*\*\/\s*)?["'](\.{1,2}\/[^"']+)["']\s*\)/g)) out.add(moduleStem(normalise(`${dir}/${m[1]}`)));
  }
  return out;
}

const has = (pkg, name) => Boolean(pkg?.scripts?.[name]);

/**
 * @param {{ pkg: any, exists: (path: string) => boolean, changed: string[] | null, flags: { skip?: string[], only?: string[], coverage?: boolean, base?: string, body?: string }, dynamicTargets?: Set<string> }} input
 *   `flags.base` / `flags.body`: what pr:check compares against (default origin/main) and the PR body file, if any.
 *   `changed` is the list of changed files for `--changed` (deleted ones included), or null for a full run.
 *   `dynamicTargets`: module stems some source loads with a dynamic import (dynamicImportTargets).
 * @returns {Step[]}
 */
export function planSteps({ pkg, exists, changed, flags, dynamicTargets, hasBin = () => false }) {
  const skip = new Set(flags.skip ?? []);
  const only = flags.only?.length ? new Set(flags.only) : null;
  // A deleted file is a change too: what referenced it may break at build time or at run time.
  const codeChanged = changed === null || changed.some(isAppCode);
  // Unit-test inputs: e2e/ is Playwright's (no vitest test imports a spec).
  const changedCode = (changed ?? []).filter((f) => isCodeFile(f) && !/^e2e\//.test(f));
  // `vitest related` cannot trace a file that is gone, nor a JSON / HTML / CSS
  // input (locales, public/_headers…) that tests read from disk: either means the full suite.
  const deletedCode = changedCode.filter((f) => !exists(f));
  const lazyCode = changedCode.filter((f) => dynamicTargets?.has(moduleStem(f)));
  const otherInputs = (changed ?? []).filter((f) => !isCodeFile(f) && isAppCode(f) && !/^e2e\//.test(f));
  const coverage = flags.coverage && changed === null;
  /** @type {Step[]} */
  const steps = [
    { id: "typecheck", title: "TypeScript", cmd: ["npx", "tsc", "--noEmit", "-p", "."] },
    has(pkg, "hygiene") ? { id: "hygiene", title: "Code hygiene", cmd: ["npm", "run", "-s", "hygiene"] } : { id: "hygiene", title: "Code hygiene", cmd: [], skipReason: "not here" },
    has(pkg, "lint") ? { id: "lint", title: "ESLint", cmd: ["npm", "run", "-s", "lint"] } : { id: "lint", title: "ESLint", cmd: [], skipReason: "not here (plan 0.4)" },
    // Plan 0.16 (W10.E24): unused files everywhere; knip's unused exports and dependencies where knip is installed.
    has(pkg, "unused") ? { id: "unused", title: "Unused files (plan 0.16)", cmd: ["npm", "run", "-s", "unused"] } : { id: "unused", title: "Unused files (plan 0.16)", cmd: [], skipReason: "not here" },
    exists("node_modules/knip/package.json")
      ? { id: "knip", title: "knip: unused exports and dependencies (baseline only goes down)", cmd: ["node", "scripts/knip-gate.mjs"], needs: ["scripts/knip-gate.mjs"] }
      : { id: "knip", title: "knip: unused exports and dependencies", cmd: [], skipReason: "knip is not installed (owner: W10.E24)" },
    { id: "i18n", title: "i18n keys + drift", cmd: ["node", "scripts/extract-i18n-keys.mjs", "--check"], needs: ["scripts/extract-i18n-keys.mjs"] },
    has(pkg, "licenses") ? { id: "licenses", title: "Licence gate", cmd: ["npm", "run", "-s", "licenses"] } : { id: "licenses", title: "Licence gate", cmd: [], skipReason: "not here (plan 0.10)" },
    exists("scripts/headers.mjs") ? { id: "headers", title: "Security headers", cmd: ["node", "scripts/headers.mjs", "--check"] } : { id: "headers", title: "Security headers", cmd: [], skipReason: "not here (plan 0.17)" },
    // Review 12, M3: the plan's ratchet files (audit ledger, WIP decisions, merged-while-frozen), held against the PR's base.
    has(pkg, "plan:ratchet") ? { id: "plan-ratchet", title: "Plan ratchets (only one way)", cmd: ["npm", "run", "-s", "plan:ratchet", ...(flags.base ? ["--", "--base", flags.base] : [])] } : { id: "plan-ratchet", title: "Plan ratchets", cmd: [], skipReason: "not here (review 12, M3)" },
    // pr:check, the PR gate (plan 0.19), on every run (W10.D4). Vercel builds only
    // main and verify/* (100 builds a day on the free plan, and the builds are the
    // Mac's now), so a PR gets it here and in Buildkite's pr-check job, not from a
    // preview. No bundle size here: that needs two builds (--no-size).
    has(pkg, "pr:check")
      ? { id: "pr-check", title: "pr:check (the PR gate)", cmd: ["node", "scripts/pr-check.mjs", "--base", flags.base ?? "origin/main", "--no-size", ...(flags.body ? ["--body", flags.body] : [])] }
      : { id: "pr-check", title: "pr:check (the PR gate)", cmd: [], skipReason: "not here (plan 0.19)" },
    // W10.D14: the scanners Buildkite runs on every PR, here when the binary is installed
    // (scripts/security-scan.mjs; npm audit needs the registry, so it stays Buildkite's).
    ...SECURITY_STEPS.map((t) => ({ id: t.id, title: t.title, cmd: ["node", "scripts/security-scan.mjs", t.tool], needs: ["scripts/security-scan.mjs"], needsBin: t.bin })),
    changed === null
      ? coverage
        ? { id: "test", title: `Vitest + coverage gate (lines >= ${COVERAGE_MIN}%)`, cmd: ["npx", "vitest", "run", "--coverage"], slow: true, coverageMin: COVERAGE_MIN }
        : { id: "test", title: "Vitest", cmd: ["npx", "vitest", "run"], slow: true }
      : deletedCode.length
        ? { id: "test", title: `Vitest (full: ${deletedCode.length} code file(s) deleted)`, cmd: ["npx", "vitest", "run"], slow: true }
        : lazyCode.length
          ? { id: "test", title: `Vitest (full: ${lazyCode[0]} is loaded by a dynamic import, which vitest related does not follow)`, cmd: ["npx", "vitest", "run"], slow: true }
          : otherInputs.length
          ? { id: "test", title: `Vitest (full: non-code inputs changed, e.g. ${otherInputs[0]})`, cmd: ["npx", "vitest", "run"], slow: true }
          : // --passWithNoTests: a changed file that no unit test covers is not a failure.
            { id: "test", title: "Vitest (related to the diff)", cmd: ["npx", "vitest", "related", "--run", "--passWithNoTests", ...changedCode], slow: true, empty: changedCode.length === 0 },
    { id: "build", title: "Build", cmd: ["npm", "run", "-s", "build"], slow: true },
    // Measures this run's build (see buildState), never a dist/ left from earlier.
    has(pkg, "budget") ? { id: "budget", title: "Bundle budget", cmd: ["npm", "run", "-s", "budget"] } : { id: "budget", title: "Bundle budget", cmd: [], skipReason: "not here" },
    // Plan 7.5 "runs on every PR": the CER gates (clean ≤ 5 %, degraded ≤ 12 %) on the ocr-he dev split,
    // with the app's own tesseract.js models and post-processing; it was CI's `ocr-cer` job.
    { id: "ocr", title: "OCR CER (Hebrew, English; dev split)", cmd: ["node", "scripts/ocr/cer-node.mjs"], needs: ["scripts/ocr/cer-node.mjs"], slow: true },
    // W11.H5: manifests valid, no stale result, no dataset file in the repo or dist (never GitHub Actions).
    has(pkg, "eval:public")
      ? { id: "public-eval", title: "Public benchmarks gate (manifests, stale results, no dataset files)", cmd: ["npm", "run", "-s", "eval:public", "--", "check"] }
      : { id: "public-eval", title: "Public benchmarks gate", cmd: [], skipReason: "not here (plan W11.H5)" },
    // W11.H1: Unicode's BidiCharacterTest against Lumen's direction rule, when the data is downloaded.
    has(pkg, "eval:public")
      ? { id: "bidi-conformance", title: "Unicode bidi conformance (BidiCharacterTest ≥ 99.9 %)", cmd: ["npm", "run", "-s", "eval:public", "--", "run", "unicode-bidi"], data: [BIDI_TEST_DATA], slow: true }
      : { id: "bidi-conformance", title: "Unicode bidi conformance", cmd: [], skipReason: "not here (plan W11.H1)" },
    { id: "e2e", title: "e2e (Chromium, production build)", cmd: ["e2e"], slow: true },
  ];
  for (const s of steps) {
    if (s.skipReason) continue;
    if (only && !only.has(s.id)) s.skipReason = "not selected";
    else if (skip.has(s.id)) s.skipReason = "skipped (--skip)";
    else if (s.needs?.some((p) => !exists(p))) s.skipReason = "not here";
    else if (s.needsBin && !hasBin(s.needsBin)) s.skipReason = `${s.needsBin} is not installed`;
    else if (s.data?.some((p) => !exists(p))) s.skipReason = `data not downloaded (${s.data.find((p) => !exists(p))}): npm run eval:public -- fetch unicode-bidi`;
    else if (changed !== null && s.id === "test" && s.empty) s.skipReason = "no unit-test inputs in the diff";
    else if (changed !== null && (s.id === "build" || s.id === "budget" || s.id === "e2e") && !codeChanged) s.skipReason = "diff touches no app code";
    else if (changed !== null && s.id === "ocr" && !changed.some(isOcrInput)) s.skipReason = "diff touches no OCR input";
    else if (changed !== null && s.id === "public-eval" && !changed.some(isPublicEvalInput)) s.skipReason = "diff touches no public-benchmark input";
    else if (changed !== null && s.id === "bidi-conformance" && !changed.some(isBidiConformanceInput)) s.skipReason = "diff touches no bidi-conformance input";
  }
  return steps;
}

/**
 * CI's coverage gate on coverage/coverage-summary.json (json-summary
 * reporter): lines % must be at least `min`. A missing or unreadable
 * summary fails, as it would in CI.
 */
export function coverageGate(summaryText, min = COVERAGE_MIN) {
  let pct;
  try {
    pct = JSON.parse(summaryText ?? "").total?.lines?.pct;
  } catch {
    pct = undefined;
  }
  if (typeof pct !== "number") return { ok: false, pct: null, message: "no coverage/coverage-summary.json with total.lines.pct (json-summary reporter)" };
  return pct >= min ? { ok: true, pct, message: `Coverage lines: ${pct}%` } : { ok: false, pct, message: `Lines coverage ${pct}% < ${min}% gate` };
}

/**
 * The pre-push hook to write. An existing hook that is not ours is never
 * replaced silently: refused, or with `force` backed up first.
 * @returns {{ action: "write" | "refuse" | "backup", content: string }}
 */
export const HOOK_MARK = "installed by `npm run ci:local -- --install-hook`";
/**
 * The pre-push hook. Before ci:local it:
 *   - notes what this push sends, for the lane-state reference-transaction
 *     hook to record once origin has it (W8.10; a no-op with no lane state set);
 *   - fails on lockfile drift (W8.9): the installed tree against
 *     package-lock.json, or package.json against it when there is no node_modules.
 */
export const HOOK_BODY = [
  'refs=$(cat)',
  'printf \'%s\\n\' "$refs" | node scripts/lane-state.mjs pending "$1" || true',
  'if [ -d node_modules ]; then node scripts/lockfile-drift.mjs || exit 1; else node scripts/lockfile-drift.mjs --lock-only || exit 1; fi',
  "exec npm run -s ci:local -- --changed --skip e2e --bail",
];

export function hookPlan(existing, { force = false } = {}) {
  const content = `#!/bin/sh\n# ${HOOK_MARK} (plan 0.14); skip once with \`git push --no-verify\`\n${HOOK_BODY.join("\n")}\n`;
  if (existing == null || existing.includes(HOOK_MARK)) return { action: "write", content };
  return { action: force ? "backup" : "refuse", content };
}

/**
 * The build that budget and e2e use: "fresh" when the Build step passed in
 * this run, "failed" when it failed (nothing to measure or serve), "none"
 * when it did not run (--only budget, --skip build…): then they build first,
 * since a dist/ left from earlier may not be this checkout.
 */
export function buildState(results) {
  const b = results.find((r) => r.id === "build" && r.status !== "skip");
  return !b ? "none" : b.status === "pass" ? "fresh" : "failed";
}

/** Step ids, for --only / --skip. */
export const STEP_IDS = ["typecheck", "hygiene", "lint", "unused", "knip", "i18n", "licenses", "headers", "plan-ratchet", "pr-check", "gitleaks", "semgrep", "cargo-audit", "test", "build", "budget", "ocr", "public-eval", "bidi-conformance", "e2e"];
const BOOL_FLAGS = ["--help", "--h", "-h", "--changed", "--coverage", "--bail", "--install-hook", "--force"];
const VALUE_FLAGS = ["--base", "--body", "--skip", "--only"];

/** Problems with the command line: a typo must not turn into a green run without the requested checks. */
export function argErrors(argv) {
  const errors = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (VALUE_FLAGS.includes(a)) {
      const v = argv[i + 1];
      if (!v || v.startsWith("-")) {
        errors.push(`${a} needs a value`);
        continue;
      }
      i++;
      if (a === "--base" || a === "--body") continue;
      for (const id of v.split(",").map((x) => x.trim()).filter(Boolean)) if (!STEP_IDS.includes(id)) errors.push(`${a}: unknown step "${id}" (steps: ${STEP_IDS.join(", ")})`);
    } else if (!BOOL_FLAGS.includes(a)) errors.push(`unknown argument "${a}"`);
  }
  return errors;
}

/** e2e specs for a run: every spec for a full run; with --changed, changed specs plus the smoke test. */
export function e2eSpecs(changed, allSpecs) {
  if (changed === null) return [];
  // A changed (or deleted) helper under e2e/ can break any spec that imports it: the whole suite.
  if (changed.some((f) => /^e2e\//.test(f) && !/\.spec\.ts$/.test(f))) return [];
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

/**
 * The uncommitted files from `git status --porcelain -z` (not trimmed: the
 * first entry's leading space is part of its status), leaving out .ci-local/.
 * A rename or copy names its new path (the old one follows it and is skipped).
 * @param {string} out
 */
export function porcelainFiles(out) {
  const parts = String(out ?? "").split("\0");
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (e.length < 4) continue;
    files.push(e.slice(3));
    if (/^[RC]/.test(e)) i++;
  }
  return files.filter((f) => !f.startsWith(".ci-local/"));
}
