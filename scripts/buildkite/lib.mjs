/**
 * Real CI without GitHub Actions (plan W7.21): Buildkite Free schedules the
 * jobs, our own agents run them (the second host of W6.5 in Docker, Tal's Mac
 * natively for WebKit), and Buildkite's GitHub app posts one commit status per
 * gate. Pure functions; the CLIs next to this file do the I/O.
 *
 * The gates are not re-typed here. docs/archive/workflows/ci.yml stays the one
 * list of what a PR must pass: buildPipeline() copies each gate's `run:`
 * text out of it, and gateCoverage() fails when a ci.yml step is neither in
 * the pipeline nor named in NOT_GATES with a reason. A new or renamed gate in
 * ci.yml therefore breaks `npm run ci:pipeline -- --check` until the pipeline
 * carries it.
 */

import { E2E_SHARDS, SHARD_MINUTES } from "../lib/e2eShards.mjs";
import { createHash } from "node:crypto";
import { POLICY_SKIP_KEY } from "./receiptReport.mjs";


export const REPO = "talstilkol/lumen-md";
/** Agent queues: the Linux host runs every job in Playwright's image; the Mac runs WebKit on macOS itself. */
export const QUEUES = ["linux", "mac"];
export const VITEST_SHARDS = 4;
/** The test files vite.config.ts includes (the drift test reads vite.config.ts and compares). */
export const VITEST_INCLUDE = ["src/__tests__/**/*.test.{ts,tsx}", "packages/vscode-lumen/test/**/*.test.ts"];
/** Context of the build-level commit status; each job adds `<prefix>: <key>`. */
export const STATUS_PREFIX = "lumen/buildkite";
/** Buildkite reads these anywhere in a commit message or PR title and skips the build (buildkite.com/docs/pipelines/skipping). */
export const SKIP_MARKERS = ["[ci skip]", "[skip ci]", "[ci-skip]", "[skip-ci]"];

/**
 * One Buildkite job per ci.yml job (or per matrix value). `steps` are the
 * ci.yml step names (or `run: <first line>` for an unnamed step) whose `run:`
 * text the job executes, in order. `env` replaces a ci.yml env value that is
 * a GitHub expression (`${{ … }}`), which has no meaning here.
 * `keepGoing`: run every step and fail at the end (independent checks);
 * otherwise the job stops at the first failure, as a GitHub job does.
 */
export const JOBS = [
  {
    key: "static",
    label: ":white_check_mark: static gates",
    job: "check",
    keepGoing: true,
    steps: [
      "Typecheck",
      "Code hygiene (no `as any` / console.log in production src)",
      "Security headers match security/policy.json",
      "Docs sync (docs name only commands and scripts that exist; no hand-typed counts in README)",
      "Plan matches plan/plan.json",
      "No hard-coded UI strings (plan 9.1)",
      "Definition of done for every ✅ task",
      "Unused files (no new src/ file that nothing imports — plan 0.16)",
      "Docs complete (every sidebar page in en + he; 13.1.1 areas covered; links resolve)",
      "i18n drift gate",
    ],
    timeout: 20,
  },
  { key: "lint", label: ":eslint: lint", job: "lint", steps: ["ESLint"], timeout: 20 },
  { key: "licenses", label: ":scroll: licence gate", job: "licenses", steps: ["Licence gate"], install: "npm ci --ignore-scripts", timeout: 10 },
  {
    key: "build",
    label: ":package: build + budget",
    job: "check",
    steps: ["Build", "No collab secrets in the bundle", "No VITE_* secrets in the bundle", "No e2e test surface in the production build (plan W1.31)", "Bundle-size budget"],
    artifacts: ["bundle-sizes.json"],
    timeout: 25,
  },
  ...["chromium", "firefox", "webkit"].map((browser) => ({
    key: `e2e-${browser}`,
    label: `:playwright: e2e ${browser}${browser === "webkit" ? " (Mac)" : ""}`,
    job: "e2e",
    matrix: { browser },
    steps: ["Run E2E (${{ matrix.browser }})"],
    env: browser === "firefox" ? { LIBGL_ALWAYS_SOFTWARE: "1", GALLIUM_DRIVER: "llvmpipe", PW_FIREFOX_HEADED: "1" } : { LIBGL_ALWAYS_SOFTWARE: "", GALLIUM_DRIVER: "", PW_FIREFOX_HEADED: "" },
    // Real WebKit on macOS every run (W7.21 acceptance; complements W6.6): the Mac's queue, never skipped.
    queue: browser === "webkit" ? "mac" : "linux",
    browsers: [browser],
    artifacts: ["playwright-report/**/*"],
    timeout: 40,
  })),
  {
    key: "e2e-prod",
    label: ":playwright: e2e on the production build",
    job: "e2e-prod",
    steps: ["Build production bundle", "Serve dist with http-server", "Run E2E against prod bundle"],
    browsers: ["chromium"],
    timeout: 35,
  },
  {
    key: "e2e-headers",
    label: ":lock: e2e under deploy headers (nginx)",
    job: "e2e-headers",
    matrix: { conf: "deploy" },
    steps: ["Build production bundle", "Serve dist with ${{ matrix.conf }}/nginx.conf", "Headers on the routes 0.20 covers", "Run E2E under the headers"],
    browsers: ["chromium", "webkit"],
    timeout: 40,
  },
  {
    key: "local-ai",
    label: ":robot_face: local agents (fake Ollama)",
    job: "local-ai",
    steps: ["Start the fake Ollama server", "Every agent once, over real HTTP", "Model manager — Ollama pull with progress, over real HTTP"],
    timeout: 20,
  },
  {
    key: "ocr-cer",
    label: ":eye: OCR CER (Hebrew, English)",
    job: "ocr-cer",
    steps: ["Build production bundle", "Serve dist", "Measure CER on ocr-he (dev split)"],
    browsers: ["chromium"],
    artifacts: ["reports/ocr-cer.json"],
    timeout: 30,
  },
  {
    // Plan 10.3 (W10.E23): the baselines are approved on the Mac
    // (`npm run visual:approve -- visual`), so they are compared there.
    // No baseline, or one from another Chromium, fails; so does a diff.
    key: "visual",
    label: ":camera_with_flash: visual regression (Mac)",
    job: "visual",
    steps: ["Baselines exist for this platform and Chromium", "Visual regression (plan 10.3)"],
    queue: "mac",
    browsers: ["chromium"],
    artifacts: ["visual-results/**/*"],
    timeout: 30,
  },
  {
    key: "lighthouse",
    label: ":lighthouse: Lighthouse CI",
    job: "lighthouse",
    steps: ["run: npm run build", "Lighthouse CI"],
    env: { LHCI_GITHUB_APP_TOKEN: "" },
    browsers: ["chromium"],
    // The reports stay with the build (upload.target "filesystem"): nothing goes to public storage.
    artifacts: ["reports/lh/**/*"],
    // Every PR and every push (W10.E10): no condition.
    timeout: 35,
  },
];

/**
 * Buildkite-only jobs (W10.D4, W10.D14): gates that have no ci.yml step, so
 * their scripts live here. Each step is `{ name, run }`; the job runs on every
 * build (no `if`), and posts its own commit status like every other gate.
 *   pr-check   `npm run pr:check` on the PR itself (W10.D4): every PR gets it
 *              without anyone running it. A build that isn't for a PR passes.
 *   security   the scanners that replace GitHub's (W10.D14, plan 2.8):
 *              gitleaks, npm audit, cargo audit (with audit-lock) and semgrep
 *              with OSS rules in place of CodeQL. A missing binary fails here.
 *   security-nightly  the scheduled build only (research R3.7): OSV,
 *              cargo deny, OpenSSF Scorecard and a CycloneDX SBOM.
 *   percy      the 30 screens × 4 variants as Percy snapshots (plan W7.25,
 *              W10.E55), rendered by Percy in Chrome, Firefox and Safari.
 *              PERCY_TOKEN comes from the agent's secret store; without it
 *              percy-run.mjs exits non-zero, so the step never passes silently.
 *              Main pushes and PRs labelled `percy` only (the free plan's
 *              screenshot allowance does not cover every PR build); other
 *              builds pass the step with a message, never skip it.
 */
export const NATIVE_JOBS = [
  {
    key: "pr-check",
    label: ":mag: pr:check",
    timeout: 20,
    keepGoing: false,
    steps: [
      {
        name: "pr:check on the pull request",
        run: [
          'if [ "${BUILDKITE_PULL_REQUEST:-false}" = "false" ]; then echo "pr:check: not a pull-request build; it runs on every PR build"; exit 0; fi',
          'base="${BUILDKITE_PULL_REQUEST_BASE_BRANCH:-main}"',
          'git fetch --no-tags origin "+refs/heads/$base:refs/remotes/origin/$base"',
          "mkdir -p ci-out",
          `gh api "repos/${REPO}/pulls/$BUILDKITE_PULL_REQUEST" --jq .body > ci-out/pr-body.md`,
          'npm run -s pr:check -- --base "origin/$base" --pr "$BUILDKITE_PULL_REQUEST" --body ci-out/pr-body.md --no-size --out ci-out/pr-check.md',
        ].join("\n"),
      },
    ],
    artifacts: ["ci-out/pr-check.md"],
    // W10.E25 (plan 0.19): the report as one PR comment, edited on every build, pass or fail.
    always: ["node scripts/buildkite/pr-comment.mjs ci-out/pr-check.md"],
  },
  {
    key: "security",
    label: ":shield: security scanners",
    timeout: 25,
    keepGoing: true,
    steps: [
      { name: "gitleaks (secrets in the history)", run: "node scripts/security-scan.mjs gitleaks" },
      { name: "npm audit (high and critical)", run: "node scripts/security-scan.mjs npm-audit" },
      { name: "cargo audit (with audit-lock)", run: "node scripts/security-scan.mjs cargo-audit" },
      { name: "semgrep (OSS rules, in place of CodeQL)", run: "node scripts/security-scan.mjs semgrep" },
    ],
    artifacts: ["reports/security/*.json"],
  },
  {
    key: "security-nightly",
    label: ":crescent_moon: supply chain (nightly)",
    timeout: 40,
    keepGoing: true,
    if: 'build.source == "schedule"',
    steps: [
      { name: "osv-scanner (every lockfile)", run: "node scripts/security-scan.mjs osv" },
      { name: "cargo deny (advisories, bans)", run: "node scripts/security-scan.mjs cargo-deny" },
      { name: "OpenSSF Scorecard", run: "node scripts/security-scan.mjs scorecard" },
      { name: "CycloneDX SBOM", run: "node scripts/security-scan.mjs sbom" },
    ],
    artifacts: ["reports/security/*.json"],
  },  {
    key: "percy",
    label: ":camera_with_flash: Percy (30 screens, Chrome / Firefox / Safari)",
    timeout: 40,
    keepGoing: false,
    browsers: ["chromium"],
    // No step-level `if`: the receipt waits for percy, and it would count a skipped step as failed
    // (see gateKeys). When Percy was not asked for, the step exits 0 and leaves a policy-skip marker
    // (POLICY_SKIP_KEY), so the receipt records "skipped-by-policy", not a pass (review Z6-L2).
    steps: [
      {
        name: "Percy snapshots of the 30 screens",
        run: [
          `case ",\${BUILDKITE_PULL_REQUEST_LABELS:-}," in *,percy,*) ;; *) if [ "\${BUILDKITE_BRANCH:-}" != "main" ]; then echo "percy: runs on main and on PRs labelled percy"; buildkite-agent meta-data set "${POLICY_SKIP_KEY("percy")}" "not run: runs on main and on PRs labelled percy"; exit 0; fi ;; esac`,
          "npm run -s visual:percy",
        ].join("\n"),
      },
    ],
  },
];

/**
 * Plan 7.2 / W10.E33: the real-model runs, as native Buildkite steps — not
 * derived from .github/workflows (no Actions). Every model and image is
 * pinned by digest in models/ci-models.json (scripts/lib/realModelPins.mjs);
 * a pin that is not a real digest fails the step. The Ollama store is
 * cached per model digest under the agent's cache.
 *   real-model-pr        qwen3:0.6b, every agent once — on a build whose change touches src/agents/
 *   real-model-nightly   qwen3:1.7b (multi-step) and the real LanguageTool and SearXNG — scheduled builds
 *   real-model-hebrew    DictaLM 3.0 1.7B on short Hebrew prompts — scheduled builds
 */
export const REAL_MODEL_STEPS = [
  { key: "real-model-pr", label: ":robot_face: real tiny model (qwen3:0.6b)", model: "qwen3:0.6b", ifChanged: "src/agents/**", timeout: 30 },
  { key: "real-model-nightly", label: ":crescent_moon: real model, multi-step (qwen3:1.7b) + LanguageTool, SearXNG", model: "qwen3:1.7b", services: true, if: 'build.source == "schedule"', timeout: 45 },
  { key: "real-model-hebrew", label: ":crescent_moon: Hebrew smoke (DictaLM 3.0 1.7B)", model: "hf.co/dicta-il/DictaLM-3.0-1.7B-Thinking-GGUF", hebrew: true, if: 'build.source == "schedule"', timeout: 45 },
];

/** The command of one real-model step: pinned containers on a job network, then the run through run.sh. */
export function realModelCommand(step) {
  const m = shq(step.model);
  const images = ["ollama/ollama", ...(step.services ? ["erikvl87/languagetool", "searxng/searxng"] : [])];
  const before = [
    "set -euo pipefail",
    "pins() { node scripts/real-model-pins.mjs \"$@\"; }",
    `pins check --model ${m}${images.map((i) => ` --image ${i}`).join("")}`,
    'NET="lumen-rm-${BUILDKITE_JOB_ID:-local}"',
    `STORE="$(pins cache-dir ${m} "\${LUMEN_CI_CACHE:-$HOME/.cache/lumen-ci}")"`,
    'mkdir -p "$STORE"',
    'docker network create "$NET" > /dev/null',
    'trap \'docker rm -f "$NET-ollama" "$NET-lt" "$NET-sx" > /dev/null 2>&1 || true; docker network rm "$NET" > /dev/null 2>&1 || true\' EXIT',
    'docker run -d --rm --name "$NET-ollama" --network "$NET" --network-alias ollama -v "$STORE:/root/.ollama" "$(pins image ollama/ollama)" > /dev/null',
    ...(step.services
      ? [
          'docker run -d --rm --name "$NET-lt" --network "$NET" --network-alias languagetool -e Java_Xms=512m -e Java_Xmx=1g "$(pins image erikvl87/languagetool)" > /dev/null',
          'docker run -d --rm --name "$NET-sx" --network "$NET" --network-alias searxng -v "$PWD/docker/searxng/settings.yml:/etc/searxng/settings.yml:ro" "$(pins image searxng/searxng)" > /dev/null',
        ]
      : []),
    'export LUMEN_CI_DOCKER_NET="$NET"',
  ];
  const run = step.hebrew ? `npm run -s ci:real-model -- --hebrew-smoke --model ${m} --digest "$(node scripts/real-model-pins.mjs digest ${m})"` : `npm run -s ci:real-model -- --model ${m} --digest "$(node scripts/real-model-pins.mjs digest ${m})"`;
  const gates = [`gate ${shq(step.hebrew ? "Hebrew smoke test, at the pinned digest" : "Every agent against the real model, at the pinned digest")} LUMEN_REAL_MODEL_REQUIRED=1 LUMEN_REAL_OLLAMA_URL=http://ollama:11434 <<'LUMEN_STEP'\n${run}\nLUMEN_STEP`];
  if (step.services)
    gates.push(
      "gate 'LanguageTool and SearXNG for real' LUMEN_REAL_LANGUAGETOOL_URL=http://languagetool:8010/v2/check LUMEN_REAL_SEARXNG_URL=http://searxng:8080 <<'LUMEN_STEP'\nfor i in $(seq 1 60); do curl -sf http://languagetool:8010/v2/languages > /dev/null && break; sleep 2; done\nnpx vitest run --config vitest.eval.config.ts --reporter dot src/agents/eval/services.eval.ts\nLUMEN_STEP",
    );
  gates.push("gates_done");
  return command({ key: step.key }, gates.join("\n"), { before });
}

/**
 * Plan W8.8 / W10.E58: native Buildkite steps that run only on the
 * pipeline's scheduled build (Buildkite → Pipeline settings → Schedules,
 * docs contributing/nightly). Not derived from .github/workflows.
 *   fuzz-redaction   the redaction fuzz with the night's seed (UTC date), 20,000 cases;
 *                    a leak fails the step, and the minimised case is kept as an
 *                    artifact (tests/fuzz/redaction/regressions.json) for a PR
 */
export const SCHEDULED_STEPS = [
  {
    key: "fuzz-redaction",
    label: ":crescent_moon: redaction fuzz (nightly seed, 20,000 cases)",
    gates: ["gate 'Redaction fuzz with the night seed' <<'LUMEN_STEP'\nnpm run -s fuzz:redaction\nLUMEN_STEP"],
    artifacts: ["reports/nightly/fuzz-redaction.json", "tests/fuzz/redaction/regressions.json"],
    timeout: 45,
  },
];
export const SCHEDULE_IF = 'build.source == "schedule"';

/**
 * ci.yml steps that the pipeline does not run as a gate, each with the reason.
 * Keys are `<job> › <step>`; a whole job is `<job> › *`.
 */
export const NOT_GATES = {
  "* › Install": "setup: scripts/buildkite/run.sh runs `npm ci` in every job",
  "* › run: npm ci || npm install": "setup: run.sh runs `npm ci`",
  "* › run: npm ci": "setup: run.sh runs `npm ci`",
  "licenses › Install (no scripts)": "setup: the licences job's install is `npm ci --ignore-scripts` (JOBS.licenses.install)",
  "e2e › Install Playwright browser (${{ matrix.browser }})": "setup: Playwright's image has the browsers; on the Mac run.sh installs the job's browser",
  "e2e › Software GL for headless WebGL (firefox)": "setup: Mesa and xvfb are in scripts/factory/Dockerfile.factory",
  "e2e-prod › Install Playwright browsers (chromium only — saves ~6 min)": "setup: in the image",
  "visual › Install Playwright browser (chromium)": "setup: on the Mac run.sh installs the job's browser (LUMEN_CI_BROWSERS)",
  "e2e-headers › Install Playwright browsers (chromium, webkit)": "setup: in the image",
  "ocr-cer › Install Playwright Chromium": "setup: in the image",
  "check › Test": "covered by the `vitest` shards: the merged run is the whole suite, with coverage on (a superset of `npm run test`)",
  "check › Coverage gate (lines >= 65%)": "covered by `vitest-merge`, which runs this step's gate text on the merged coverage",
  "check › Record bundle sizes (main)": "main-only cache of sizes for the PR comment; no pass or fail",
  "check › Bundle-size change": "a report (the size table for the PR comment), not a gate; the budget step is the gate",
  "bundle-comment › *": "posts a PR comment; no pass or fail of the PR's code",
  "lighthouse › Mobile startup profile and Lighthouse mobile TBT (plan 8.1)": "informational (continue-on-error in ci.yml): it never fails the job",
  "lighthouse › Lighthouse CI assertions → PR comment": "posts a PR comment (continue-on-error)",
  "e2e-headers › nginx error log": "diagnostics on failure only",
  "ocr-cer › Annotate the numbers": "prints the numbers as annotations and exits 0 either way; the gate is the spec itself",
  "signal-health › *": "checks the deployed signaling server on main pushes, not the PR's code",
};

/**
 * ci.yml steps whose text the pipeline replaces, each with the reason. `ciSha256` pins the
 * exact ci.yml text the override was reviewed against: when ci.yml changes that step, the
 * generator stops until the override is looked at again. An override must be equal to the
 * ci.yml step or stricter, never looser.
 */
export const OVERRIDES = {
  "check › i18n drift gate": {
    ciSha256: "10c8b2c59801326979a5a30cb7d02782cb785dcd6d0cf4157e86d06652ef7123",
    run: "node scripts/i18n-split.mjs --check\nnode scripts/extract-i18n-keys.mjs --check\nnode scripts/i18n-drift.mjs",
    reason:
      "ci.yml counts English from src/i18n/locales/en/ only, so the English of the lazy domains (src/i18n/lazy/*.json, out of the startup bundle by design) shows up as drift: en 2270 vs he 2493 on chore/verify-factory with no string missing. scripts/i18n-drift.mjs counts locales/en plus the lazy English, keeps the same 10-key limit for he and applies it to every locale, and fails on any key without English. The two --check lines are ci.yml's, unchanged. Equal or stricter.",
  },
};

/** ci.yml's steps with a `run:` as { job, name, id: "<job> › <name>", run, env, if }. */
export function ciSteps(ci) {
  const out = [];
  for (const [job, j] of Object.entries(ci?.jobs ?? {}))
    for (const s of j.steps ?? []) {
      if (typeof s.run !== "string") continue; // `uses:` steps are GitHub actions (checkout, cache, upload)
      const name = s.name ?? `run: ${s.run.trim().split("\n")[0]}`;
      out.push({ job, name, id: `${job} › ${name}`, run: s.run, env: s.env ?? {}, if: s.if ?? null, matrix: j.strategy?.matrix ?? null });
    }
  return out;
}

const notGateReason = (step) => NOT_GATES[step.id] ?? NOT_GATES[`* › ${step.name}`] ?? NOT_GATES[`${step.job} › *`] ?? null;

/**
 * Every ci.yml run step is either run by a pipeline job or listed in NOT_GATES.
 * Also catches a JOBS entry that names a ci.yml step that no longer exists, a
 * matrix value ci.yml no longer has, and a NOT_GATES key that matches nothing.
 * → { ok, problems, mapped: [{ id, key }], excluded: [{ id, reason }] }
 */
export function gateCoverage(ci, jobs = JOBS) {
  const steps = ciSteps(ci);
  const problems = [];
  const mapped = [];
  const excluded = [];
  const used = new Set();
  for (const j of jobs) {
    if (!ci?.jobs?.[j.job]) problems.push(`${j.key}: ci.yml has no job "${j.job}"`);
    for (const [k, v] of Object.entries(j.matrix ?? {})) {
      const values = ci?.jobs?.[j.job]?.strategy?.matrix?.[k];
      if (!Array.isArray(values) || !values.includes(v)) problems.push(`${j.key}: ci.yml's ${j.job} matrix has no ${k}=${v}`);
    }
    for (const name of j.steps) if (!steps.some((s) => s.job === j.job && s.name === name)) problems.push(`${j.key}: ci.yml's ${j.job} job has no step "${name}"`);
  }
  for (const s of steps) {
    const runBy = jobs.filter((j) => j.job === s.job && j.steps.includes(s.name)).map((j) => j.key);
    if (runBy.length) {
      mapped.push({ id: s.id, key: runBy.join(", ") });
      continue;
    }
    const reason = notGateReason(s);
    if (reason) {
      excluded.push({ id: s.id, reason });
      for (const k of [s.id, `* › ${s.name}`, `${s.job} › *`]) if (NOT_GATES[k]) used.add(k);
    } else problems.push(`ci.yml step "${s.id}" is a gate the Buildkite pipeline does not run (add it to a JOBS entry, or to NOT_GATES with the reason)`);
  }
  // Matrix values: every browser of the e2e matrix needs its own job.
  for (const s of steps)
    for (const [k, values] of Object.entries(s.matrix ?? {})) {
      if (!Array.isArray(values) || !jobs.some((j) => j.job === s.job && j.steps.includes(s.name))) continue;
      for (const v of values) if (!jobs.some((j) => j.job === s.job && j.steps.includes(s.name) && j.matrix?.[k] === v)) problems.push(`ci.yml ${s.job} matrix ${k}=${v} has no pipeline job`);
    }
  for (const k of Object.keys(NOT_GATES)) if (!used.has(k)) problems.push(`NOT_GATES "${k}" matches no ci.yml step (remove it)`);
  return { ok: problems.length === 0, problems, mapped, excluded };
}

/** `${{ matrix.x }}` → its value; any other GitHub expression is an error (it has no meaning on Buildkite). */
export function substitute(text, matrix = {}, where = "") {
  const out = String(text).replace(/\$\{\{\s*matrix\.([A-Za-z_][\w-]*)\s*\}\}/g, (m, k) => (k in matrix ? String(matrix[k]) : m));
  if (out.includes("${{")) throw new Error(`${where}: a GitHub expression is left (${out.slice(out.indexOf("${{"), out.indexOf("${{") + 60)}…): give the job an env override or a matrix value`);
  return out;
}

/** A heredoc delimiter that the text does not contain. */
function delimiter(text, base) {
  let d = base;
  for (let i = 2; text.split("\n").some((l) => l.trim() === d); i++) d = `${base}_${i}`;
  return d;
}

/** Shell-quote one word for bash. */
export const shq = (s) => (/^[\w@%+=:,./-]+$/.test(String(s)) ? String(s) : `'${String(s).replace(/'/g, "'\\''")}'`);

/**
 * The script a job runs: each ci.yml step as `gate "<name>" [ENV=…] <<'EOF' … EOF`,
 * fed to scripts/buildkite/run.sh, which defines `gate` and `gates_done`.
 */
export function jobScript(job, ci) {
  const steps = ciSteps(ci);
  const parts = [];
  for (const name of job.steps) {
    if (typeof name === "object") {
      // A Buildkite-only step (NATIVE_JOBS): its script is here, not in ci.yml.
      const d = delimiter(name.run, "LUMEN_STEP");
      parts.push(`gate ${shq(name.name)} <<'${d}'\n${name.run.replace(/\s+$/, "")}\n${d}`);
      continue;
    }
    const s = steps.find((x) => x.job === job.job && x.name === name);
    if (!s) throw new Error(`${job.key}: ci.yml's ${job.job} job has no step "${name}"`);
    const env = { ...s.env };
    for (const [k, v] of Object.entries(env)) if (String(v).includes("${{") && !(job.env && k in job.env)) throw new Error(`${job.key}: env ${k} of "${name}" is a GitHub expression; add JOBS.${job.key}.env.${k}`);
    for (const [k, v] of Object.entries(job.env ?? {})) if (k in env) env[k] = v;
    const o = OVERRIDES[s.id];
    if (o && createHash("sha256").update(s.run).digest("hex") !== o.ciSha256) throw new Error(`${s.id}: ci.yml changed this step since its override was reviewed; update OVERRIDES in scripts/buildkite/lib.mjs (and its ciSha256)`);
    const run = substitute(o ? o.run : s.run, job.matrix, `${job.key} › ${name}`).replace(/\s+$/, "");
    const d = delimiter(run, "LUMEN_STEP");
    const title = substitute(name, job.matrix, job.key);
    parts.push(`gate ${shq(title)}${Object.entries(env).map(([k, v]) => ` ${k}=${shq(substitute(v, job.matrix, job.key))}`).join("")} <<'${d}'\n${run}\n${d}`);
  }
  parts.push("gates_done");
  return parts.join("\n");
}

/** Buildkite interpolates `$VAR` when a pipeline is uploaded; `$$` keeps a literal `$` for the shell. */
export const escapeDollars = (s) => String(s).replace(/\$/g, "$$$$");

/** The command of a job: run.sh reads the job's script from a quoted heredoc (nothing in it is expanded early). */
/**
 * `always`: host commands that run after the job's script whether it passed
 * or failed (Buildkite's shell is `bash -e`), before the job exits with the
 * script's own code, so they can never turn a red job green.
 */
function command(job, script, { before = [], after = [], always = [] } = {}) {
  const d = delimiter(script, "LUMEN_JOB");
  const envs = [`LUMEN_CI_JOB=${job.key}`, job.install ? `LUMEN_CI_INSTALL=${shq(job.install)}` : null, job.browsers ? `LUMEN_CI_BROWSERS=${job.browsers.join(",")}` : null, job.keepGoing ? "LUMEN_CI_KEEP_GOING=1" : null].filter(Boolean);
  const run = `${envs.join(" ")} bash scripts/buildkite/run.sh <<'${d}'${always.length ? " || lumen_code=$?" : ""}\n${script}\n${d}`;
  const keep = always.length ? ["lumen_code=0", run, ...always.map((c) => `${c} || true`), 'exit "$lumen_code"'] : [run];
  return escapeDollars([...before, ...keep, ...after].join("\n"));
}

const status = (key) => [{ github_commit_status: { context: `${STATUS_PREFIX}: ${key}` } }];
/** Only a lost agent (exit -1) or a cancelled spot machine is retried; a failing test never is (no e2e retries: plan 0.5). */
const RETRY = { automatic: [{ exit_status: -1, limit: 2 }, { exit_status: 255, limit: 1 }] };

/**
 * The pipeline object (.buildkite/pipeline.yml is its YAML). The vitest gate
 * is sharded: `vitest-plan` splits the files by their last run time,
 * `vitest` runs the shards in parallel with blob reports, `vitest-merge`
 * merges them, checks that every planned file ran, and applies ci.yml's
 * coverage gate. `receipt` seals what every gate did (W4.36 format).
 */
export function buildPipeline(ci, { jobs = JOBS, shards = VITEST_SHARDS, native = NATIVE_JOBS, e2eShards = E2E_SHARDS } = {}) {
  const cov = ciSteps(ci).find((s) => s.id === "check › Coverage gate (lines >= 65%)");
  if (!cov) throw new Error('ci.yml has no step "check › Coverage gate (lines >= 65%)"');
  const covLines = cov.run.split("\n");
  if (covLines[0].trim() !== "npm run test:coverage") throw new Error("the coverage gate no longer starts with `npm run test:coverage`: update buildPipeline()");
  const covGate = covLines.slice(1).join("\n").replace(/\s+$/, "");
  const steps = [];
  const at = (queue) => ({ queue });
  const vitestPlan = {
    label: ":scissors: vitest: plan the shards",
    key: "vitest-plan",
    command: escapeDollars(`buildkite-agent meta-data set lumen:started-at "$(date -u +%Y-%m-%dT%H:%M:%SZ)"\nnode scripts/buildkite/vitest-shards.mjs plan --shards ${shards} --timings "\${LUMEN_CI_CACHE:-.}/vitest-timings.json" --out ci-out/vitest-shards.json`),
    agents: at("linux"),
    artifact_paths: ["ci-out/vitest-shards.json"],
    timeout_in_minutes: 5,
    retry: RETRY,
  };
  const vitest = {
    label: ":vitest: vitest shard %n",
    key: "vitest",
    depends_on: "vitest-plan",
    parallelism: shards,
    command: command(
      { key: "vitest" },
      [`gate ${shq(`Vitest shard (of ${shards})`)} <<'LUMEN_STEP'`, "node scripts/buildkite/vitest-shards.mjs run --plan ci-out/vitest-shards.json", "LUMEN_STEP", "gates_done"].join("\n"),
      { before: ["buildkite-agent artifact download ci-out/vitest-shards.json ."] },
    ),
    agents: at("linux"),
    artifact_paths: [".vitest/blob/*.json"],
    timeout_in_minutes: 45,
    notify: status("vitest"),
    retry: RETRY,
  };
  const merge = {
    label: ":vitest: vitest: merge + coverage gate",
    key: "vitest-merge",
    depends_on: "vitest",
    command: command(
      { key: "vitest-merge" },
      [
        "gate 'Merge the shard reports; every planned file ran' <<'LUMEN_STEP'",
        "node scripts/buildkite/vitest-shards.mjs merge --plan ci-out/vitest-shards.json",
        "LUMEN_STEP",
        `gate ${shq(cov.name)} <<'LUMEN_STEP'`,
        covGate,
        "LUMEN_STEP",
        "gates_done",
      ].join("\n"),
      {
        before: ["buildkite-agent artifact download ci-out/vitest-shards.json .", "buildkite-agent artifact download '.vitest/blob/*.json' ."],
        // The next plan balances by these times (kept on the host, so no extra service).
        after: ['if [ -n "${LUMEN_CI_CACHE:-}" ] && [ -f ci-out/vitest-timings.json ]; then cp ci-out/vitest-timings.json "$LUMEN_CI_CACHE/vitest-timings.json"; fi'],
      },
    ),
    agents: at("linux"),
    artifact_paths: ["ci-out/vitest-summary.json", "ci-out/vitest-timings.json", "coverage/coverage-summary.json"],
    timeout_in_minutes: 20,
    notify: status("vitest-merge"),
    retry: RETRY,
  };
  steps.push(vitestPlan, vitest, merge);
  for (const n of SCHEDULED_STEPS) {
    steps.push({
      label: n.label,
      key: n.key,
      command: command({ key: n.key }, [...n.gates, "gates_done"].join("\n")),
      agents: at("linux"),
      timeout_in_minutes: n.timeout,
      notify: status(n.key),
      retry: RETRY,
      artifact_paths: n.artifacts,
      if: SCHEDULE_IF,
    });
  }
  for (const j of [...jobs, ...native]) {
    const s = {
      label: j.label,
      key: j.key,
      command: command(j, jobScript(j, ci), { always: j.always ?? [] }),
      agents: at(j.queue ?? "linux"),
      timeout_in_minutes: j.timeout,
      notify: status(j.key),
      retry: RETRY,
    };
    if (j.artifacts) s.artifact_paths = j.artifacts;
    if (j.if) s.if = j.if;
    steps.push(s);
  }
  steps.push(...e2eShardSteps(e2eShards));
  for (const r of REAL_MODEL_STEPS) {
    const s = {
      label: r.label,
      key: r.key,
      command: realModelCommand(r),
      agents: at("linux"),
      timeout_in_minutes: r.timeout,
      notify: status(r.key),
      retry: RETRY,
      artifact_paths: ["eval/results/real-*"],
    };
    if (r.if) s.if = r.if;
    if (r.ifChanged) s.if_changed = r.ifChanged;
    steps.push(s);
  }
  steps.push(deadcodeStep());
  // #747's schedule-only steps (SCHEDULED_STEPS) post no PR status, so the receipt does not wait for
  // them; the real-model steps stay gates of the receipt (#716, W10.E33), scheduled or not.
  const realKeys = new Set(REAL_MODEL_STEPS.map((r) => r.key));
  const gateKeys = steps.filter((s) => s.notify && (s.if !== SCHEDULE_IF || realKeys.has(s.key))).map((s) => s.key);
  steps.push({
    label: ":lock_with_ink_pen: signed receipt",
    key: "receipt",
    depends_on: gateKeys.map((step) => ({ step, allow_failure: true })),
    // allow_failure only lets this step start after a red gate; it never makes a gate green.
    command: escapeDollars(`buildkite-agent artifact download 'ci-out/vitest-summary.json' . || true\nnode scripts/buildkite/receipt.mjs --gates ${gateKeys.join(",")}`),
    agents: at("linux"),
    artifact_paths: ["ci-out/receipt.json"],
    timeout_in_minutes: 10,
    notify: status("receipt"),
    retry: RETRY,
  });
  return {
    env: { LUMEN_CI: "buildkite" },
    notify: [{ github_commit_status: { context: STATUS_PREFIX } }],
    steps,
  };
}

/**
 * The whole chromium suite in shards (plan W4.2, W6.8; W10.E39), on the
 * production build made with VITE_E2E=1, as scripts/e2e-gate.mjs runs it.
 * `e2e-shards`: one job per shard, each inside SHARD_MINUTES, each leaving
 * ci-out/e2e-shard-<k>-of-<n>.json. `e2e-receipt`: merges them into
 * reports/e2e-<sha>.json, sealed with the host key (LUMEN_NIGHTLY_KEY, as the
 * receipt), and fails unless every shard passed. scripts/promote-main.mjs
 * moves main only with that report for the same hash.
 */
export function e2eShardSteps(n = E2E_SHARDS) {
  const shards = {
    label: `:playwright: e2e chromium, shard %n of ${n}`,
    key: "e2e-shards",
    parallelism: n,
    command: command(
      { key: "e2e-shards", browsers: ["chromium"] },
      [
        "gate 'Build the production bundle with the e2e surface (VITE_E2E=1)' VITE_E2E=1 <<'LUMEN_STEP'",
        "npm run build",
        "LUMEN_STEP",
        `gate ${shq(`E2E shard (the whole chromium project, under ${SHARD_MINUTES} min)`)} <<'LUMEN_STEP'`,
        "node scripts/e2e-gate.mjs --full",
        "LUMEN_STEP",
        "gates_done",
      ].join("\n"),
    ),
    agents: { queue: "linux" },
    artifact_paths: ["ci-out/e2e-shard-*.json"],
    timeout_in_minutes: 35,
    notify: status("e2e-shards"),
    retry: RETRY,
  };
  const receipt = {
    label: ":lock_with_ink_pen: e2e report for this hash",
    key: "e2e-receipt",
    depends_on: [{ step: "e2e-shards", allow_failure: true }],
    // allow_failure lets the report record a red shard; the merge exits 1 unless all n passed.
    command: escapeDollars(`buildkite-agent artifact download 'ci-out/e2e-shard-*.json' . || true\nnode scripts/e2e-gate.mjs merge --total ${n} --dir ci-out`),
    agents: { queue: "linux" },
    artifact_paths: ["reports/e2e-*.json"],
    timeout_in_minutes: 5,
    notify: status("e2e-receipt"),
    retry: RETRY,
  };
  return [shards, receipt];
}

/**
 * Plan 0.16 (W10.E24): knip's unused exports, types and dependencies
 * against scripts/knip-baseline.json, which only goes down. Unused files
 * are ci.yml's "Unused files" step, in `static`.
 */
export function deadcodeStep() {
  return {
    label: ":wastebasket: knip: unused exports and dependencies",
    key: "deadcode",
    command: command({ key: "deadcode" }, ["gate 'knip: no new unused export or dependency (plan 0.16)' <<'LUMEN_STEP'", "node scripts/knip-gate.mjs", "LUMEN_STEP", "gates_done"].join("\n")),
    agents: { queue: "linux" },
    timeout_in_minutes: 15,
    notify: status("deadcode"),
    retry: RETRY,
  };
}

/** Keys of the jobs whose outcome the receipt records (every job with a commit status). */
/**
 * The keys the receipt waits for and seals: every step with a commit status
 * but the receipt and the scheduled-only steps (a PR build skips those, and
 * the receipt would count a skipped step as failed; the scheduled build's
 * fuzz result is its own commit status and artifact).
 */
export const gateKeys = (pipeline) => pipeline.steps.filter((s) => s.notify && s.key !== "receipt" && (s.if !== SCHEDULE_IF || REAL_MODEL_STEPS.some((r) => r.key === s.key))).map((s) => s.key);

// ── YAML ─────────────────────────────────────────────────────────────────

const plainKey = (k) => /^[A-Za-z_][\w-]*$/.test(k);
/** A scalar: a block literal for multi-line text, JSON quoting otherwise (a JSON string is a YAML double-quoted scalar). */
function scalar(v, indent) {
  if (typeof v === "string" && v.includes("\n") && !/^\s/.test(v) && !/[^\S\n]$/m.test(v)) {
    const chomp = v.endsWith("\n") ? "" : "-";
    const body = v.replace(/\n$/, "").split("\n").map((l) => (l ? `${indent}${l}` : "")).join("\n");
    return `|${chomp}\n${body}`;
  }
  return JSON.stringify(v);
}

/** The pipeline as YAML: the subset Buildkite needs (maps, lists, strings, numbers, booleans). */
export function toYaml(value, indent = "") {
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    return value
      .map((item) => {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const inner = toYaml(item, `${indent}  `);
          return `${indent}- ${inner.slice(indent.length + 2)}`;
        }
        return `${indent}- ${scalar(item, `${indent}  `)}`;
      })
      .join("\n");
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined);
    if (!keys.length) return `${indent}{}`;
    return keys
      .map((k) => {
        const v = value[k];
        const key = plainKey(k) ? k : JSON.stringify(k);
        if (v && typeof v === "object") return Array.isArray(v) && !v.length ? `${indent}${key}: []` : `${indent}${key}:\n${toYaml(v, `${indent}  `)}`;
        return `${indent}${key}: ${scalar(v, `${indent}  `)}`;
      })
      .join("\n");
  }
  return scalar(value, indent);
}

export const PIPELINE_HEADER = [
  "# GENERATED from docs/archive/workflows/ci.yml by scripts/buildkite/pipeline.mjs (plan W7.21). Do not edit by hand:",
  "#   npm run ci:pipeline -- --write     regenerate after a change to ci.yml or scripts/buildkite/lib.mjs",
  "#   npm run ci:pipeline -- --check     fails when this file is stale or a ci.yml gate is missing",
  "# Buildkite's pipeline settings upload it with `buildkite-agent pipeline upload` (docs: self-hosting/buildkite).",
  "",
].join("\n");

export const pipelineYaml = (ci, opts) => `${PIPELINE_HEADER}${toYaml(buildPipeline(ci, opts))}\n`;

/**
 * Rules the pipeline itself must keep (on top of gateCoverage):
 * no soft_fail anywhere (it would turn a red gate green), no retry on a
 * test failure, every gate posts its own commit status, WebKit and the
 * visual gate run on the Mac's queue without a condition, and every job has
 * a timeout.
 */
export function pipelineRules(p) {
  const problems = [];
  for (const s of p.steps ?? []) {
    const k = s.key ?? s.label;
    if ("soft_fail" in s) problems.push(`${k}: soft_fail would let a failing gate pass`);
    if (!s.timeout_in_minutes) problems.push(`${k}: no timeout_in_minutes`);
    for (const r of s.retry?.automatic ?? []) if (![-1, 255].includes(r.exit_status)) problems.push(`${k}: automatic retry on exit ${r.exit_status ?? "any"} (a retry turns a flake into a pass; plan 0.5)`);
    if (s.retry?.automatic === true) problems.push(`${k}: automatic retry on any exit`);
    if (!QUEUES.includes(s.agents?.queue)) problems.push(`${k}: agents.queue must be one of ${QUEUES.join(", ")}`);
    if (k !== "vitest-plan" && !s.notify?.some((n) => n.github_commit_status?.context === `${STATUS_PREFIX}: ${k}`)) problems.push(`${k}: no commit status "${STATUS_PREFIX}: ${k}"`);
  }
  const webkit = (p.steps ?? []).find((s) => s.key === "e2e-webkit");
  if (!webkit) problems.push("no e2e-webkit job");
  else {
    if (webkit.agents?.queue !== "mac") problems.push("e2e-webkit must run on the Mac's queue (real WebKit on macOS)");
    if (webkit.if || webkit.skip) problems.push("e2e-webkit must run on every build (no if/skip)");
  }
  // W10.E25: the pr:check report is posted on the PR after pr:check, whatever its result.
  const prCheck = (p.steps ?? []).find((x) => x.key === "pr-check");
  if (prCheck && !/pr-comment\.mjs ci-out\/pr-check\.md \|\| true\nexit "\$\$lumen_code"/.test(prCheck.command ?? "")) problems.push("pr-check does not post its report on the PR after pr:check, pass or fail (scripts/buildkite/pr-comment.mjs)");
  // W10.D4 / W10.D14: pr:check and the scanners run on every build, PRs included.
  for (const key of ["pr-check", "security"]) {
    const s = (p.steps ?? []).find((x) => x.key === key);
    if (!s) problems.push(`no ${key} job`);
    else if (s.if || s.skip || s.branches) problems.push(`${key} must run on every build (no if/skip/branches)`);
  }
  const shards = (p.steps ?? []).find((s) => s.key === "e2e-shards");
  if (!shards) problems.push("no e2e-shards job (the whole chromium suite, sharded: plan W4.2)");
  else if (!(shards.parallelism >= 2)) problems.push("e2e-shards must run in parallel (parallelism ≥ 2)");
  else if (shards.if || shards.skip) problems.push("e2e-shards must run on every build (no if/skip)");
  const e2eReceipt = (p.steps ?? []).find((s) => s.key === "e2e-receipt");
  if (!e2eReceipt) problems.push("no e2e-receipt job (reports/e2e-<sha>.json: plan W4.2)");
  else if (!(e2eReceipt.depends_on ?? []).some((d) => d.step === "e2e-shards")) problems.push("e2e-receipt does not wait for e2e-shards");
  // Plan 10.3 (W10.E23): the visual gate compares on the Mac, where its baselines are approved, on every build.
  const visual = (p.steps ?? []).find((s) => s.key === "visual");
  if (!visual) problems.push("no visual job (plan 10.3: npm run test:visual)");
  else {
    if (visual.agents?.queue !== "mac") problems.push("visual must run on the Mac's queue (its baselines are approved there)");
    if (visual.if || visual.skip) problems.push("visual must run on every build (no if/skip)");
    if (!/visual-stamp\.mjs --check/.test(visual.command ?? "")) problems.push("visual must check its baselines first (scripts/visual-stamp.mjs --check)");
    if (!/npm run test:visual\b/.test(visual.command ?? "")) problems.push("visual must run npm run test:visual");
  }
  const deadcode = (p.steps ?? []).find((s) => s.key === "deadcode");
  if (!deadcode) problems.push("no deadcode job (knip: plan 0.16)");
  else if (deadcode.if || deadcode.skip || !/node scripts\/knip-gate\.mjs/.test(deadcode.command ?? "")) problems.push("deadcode must run scripts/knip-gate.mjs on every build");
  const receipt = (p.steps ?? []).find((s) => s.key === "receipt");
  const deps = new Set((receipt?.depends_on ?? []).map((d) => d.step));
  for (const k of gateKeys(p)) if (!deps.has(k)) problems.push(`receipt does not wait for ${k}`);
  if (!p.notify?.some((n) => n.github_commit_status?.context === STATUS_PREFIX)) problems.push(`no build-level commit status "${STATUS_PREFIX}"`);
  return problems;
}

// ── vitest shards ────────────────────────────────────────────────────────

/**
 * Longest-processing-time first: files sorted by weight, each to the
 * lightest shard so far. Weight = the file's last measured time, else the
 * median of the measured ones (or its size when nothing is measured yet).
 *
 * Vitest treats file arguments as substring filters, so `a.test.ts` also
 * selects `a.test.tsx`: files where one path contains another are packed as
 * one unit into the same shard, or that file would run twice.
 * → { shards: [{ index, files, ms }], spread } where spread = (max − min) / max.
 */
export function planShards(files, n, { timings = {}, sizes = {} } = {}) {
  const uniq = [...new Set(files)].sort();
  const known = uniq.map((f) => timings[f]).filter((x) => typeof x === "number" && x > 0).sort((a, b) => a - b);
  const median = known.length ? known[Math.floor(known.length / 2)] : null;
  const weight = (f) => (typeof timings[f] === "number" && timings[f] > 0 ? timings[f] : median ?? Math.max(1, sizes[f] ?? 1));
  const parent = new Map(uniq.map((f) => [f, f]));
  const find = (f) => (parent.get(f) === f ? f : find(parent.get(f)));
  for (const a of uniq) for (const b of uniq) if (a !== b && b.includes(a)) parent.set(find(b), find(a));
  const units = new Map();
  for (const f of uniq) units.set(find(f), [...(units.get(find(f)) ?? []), f]);
  const unitWeight = (u) => u.reduce((t, f) => t + weight(f), 0);
  const shards = Array.from({ length: n }, (_, index) => ({ index, files: [], ms: 0 }));
  const sorted = [...units.values()].sort((a, b) => unitWeight(b) - unitWeight(a) || a[0].localeCompare(b[0]));
  for (const u of sorted) {
    const s = shards.reduce((a, b) => (b.ms < a.ms ? b : a));
    s.files.push(...u);
    s.ms += unitWeight(u);
  }
  for (const s of shards) s.files.sort();
  return { shards, spread: spread(shards.map((s) => s.ms)), measured: known.length, basis: known.length ? "timings" : "file size" };
}

export const spread = (xs) => {
  const max = Math.max(...xs);
  return max > 0 ? Math.round(((max - Math.min(...xs)) / max) * 1000) / 1000 : 0;
};

/** A glob of VITEST_INCLUDE's shape (`**`, `*`, `{a,b}`) → RegExp. */
export function globRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      re += glob[i + 2] === "/" ? "(?:.*/)?" : ".*";
      i += glob[i + 2] === "/" ? 2 : 1;
    } else if (c === "*") re += "[^/]*";
    else if (c === "{") {
      const end = glob.indexOf("}", i);
      re += `(?:${glob.slice(i + 1, end).split(",").map((x) => x.replace(/[.+^$()|[\]\\]/g, "\\$&")).join("|")})`;
      i = end;
    } else re += c.replace(/[.+^$()|[\]\\?]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/**
 * Vitest's JSON report (jest-shaped) → per-file milliseconds, repository-relative.
 * The merged report keeps each file's start and end time.
 */
export function fileTimings(report, root) {
  const out = {};
  for (const r of report?.testResults ?? []) {
    const file = String(r.name ?? "").replace(root, "").replace(/^\/+/, "");
    const ms = typeof r.endTime === "number" && typeof r.startTime === "number" ? r.endTime - r.startTime : null;
    if (file && ms !== null && ms >= 0) out[file] = ms;
  }
  return out;
}

/** The merged run against the plan: files that were planned but did not run, and files that ran unplanned. */
export function mergeCheck(plan, report, root, mustRun = []) {
  const planned = new Set(plan.shards.flatMap((s) => s.files));
  const ran = new Map();
  const twice = [];
  for (const r of report?.testResults ?? []) {
    const f = String(r.name ?? "").replace(root, "").replace(/^\/+/, "");
    if (ran.has(f)) twice.push(f);
    ran.set(f, (ran.get(f) ?? true) && r.status === "passed");
  }
  const missing = [...planned].filter((f) => !ran.has(f)).sort();
  const unplanned = [...ran.keys()].filter((f) => !planned.has(f)).sort();
  const must = mustRun.map((file) => ({ file, ran: ran.has(file), ok: ran.get(file) === true }));
  const timings = fileTimings(report, root);
  const actual = plan.shards.map((s) => s.files.reduce((n, f) => n + (timings[f] ?? 0), 0));
  const problems = [];
  if (missing.length) problems.push(`${missing.length} planned file(s) did not run: ${missing.slice(0, 10).join(", ")}`);
  if (twice.length) problems.push(`${twice.length} file(s) ran in more than one shard: ${twice.slice(0, 10).join(", ")}`);
  if (unplanned.length) problems.push(`${unplanned.length} file(s) ran without being planned: ${unplanned.slice(0, 10).join(", ")}`);
  for (const m of must) if (!m.ran || !m.ok) problems.push(`${m.file} ${m.ran ? "failed" : "did not run"} (must run: weakness E65)`);
  return {
    ok: problems.length === 0 && (report?.numFailedTests ?? 0) === 0 && report?.success !== false,
    problems,
    files: ran.size,
    tests: report?.numTotalTests ?? 0,
    failed: report?.numFailedTests ?? 0,
    mustRun: must,
    shardMs: actual,
    spread: spread(actual),
    timings,
  };
}

// ── triggering builds ────────────────────────────────────────────────────

/** A build message without Buildkite's skip markers (every commit here carries `[skip ci]` so Actions stays off). */
export function stripSkip(text) {
  let s = String(text ?? "");
  for (const m of SKIP_MARKERS) s = s.replace(new RegExp(m.replace(/[[\]-]/g, "\\$&"), "gi"), "");
  return s.replace(/\s{2,}/g, " ").trim();
}

/**
 * Which open PR heads get a Buildkite build now. Webhook builds would be
 * skipped (every commit subject and PR title here has `[skip ci]`), so the
 * second host polls and creates builds through the REST API instead.
 * Only same-repository heads (a fork's code never runs on our machines),
 * only heads without a build yet, only PRs updated since `since` unless
 * backfilling, newest first, at most `max`.
 */
export function planTriggers(prs, { built = new Set(), since = null, max = 4, backfill = 0, repo = REPO } = {}) {
  const fresh = prs
    .filter((p) => p.state === "open" && p.head?.repo?.full_name === repo && /^[0-9a-f]{40}$/.test(p.head?.sha ?? ""))
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)) || b.number - a.number);
  const todo = [];
  const skipped = [];
  let backfilled = 0;
  for (const p of fresh) {
    if (built.has(p.head.sha)) continue;
    const recent = !since || String(p.updated_at) >= since;
    if (!recent && backfilled >= backfill) {
      skipped.push(p.number);
      continue;
    }
    if (!recent) backfilled++;
    if (todo.length >= max) break;
    todo.push(p);
  }
  return { todo, skipped };
}

/** The REST body for one PR head (buildkite.com/docs/apis/rest-api/builds#create-a-build). */
export function buildRequest(pr) {
  return {
    commit: pr.head.sha,
    branch: pr.head.ref,
    message: `#${pr.number} ${stripSkip(pr.title)}`.slice(0, 200),
    pull_request_id: pr.number,
    pull_request_base_branch: pr.base?.ref,
    pull_request_labels: (pr.labels ?? []).map((l) => l.name),
    env: { LUMEN_CI_PR: String(pr.number) },
    meta_data: { "lumen:pr": String(pr.number) },
  };
}

// ── the receipt ──────────────────────────────────────────────────────────

// The receipt body and the policy-skip marker live in ./receiptReport.mjs (re-exported here).
export { PASSED, POLICY_SKIP_KEY, POLICY_SKIPPABLE, SKIPPED_BY_POLICY, collectOutcomes, receiptReport } from "./receiptReport.mjs";
