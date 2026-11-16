#!/usr/bin/env node
/**
 * Wave g6, lane L4: the Mac steps of 41 plan tasks as one command each, with
 * a machine-checkable result (plan/mac-pack/L4.json lists them).
 *
 *   node scripts/mac-pack/L4.mjs all                 every check; ONE Playwright run for all their e2e specs
 *   node scripts/mac-pack/L4.mjs W1.3 W1.6           those checks (their specs in one run, then their commands)
 *   node scripts/mac-pack/L4.mjs all --e2e-only      only the shared e2e run and its per-task verdicts
 *   node scripts/mac-pack/L4.mjs all --no-e2e        only the commands
 *   node scripts/mac-pack/L4.mjs all --from <report.json>   judge an existing Playwright JSON report, run nothing
 *   node scripts/mac-pack/L4.mjs all --dry           print what would run, run nothing
 *   node scripts/mac-pack/L4.mjs --emit-pack         rewrite plan/mac-pack/L4.json from the table below
 *
 * Writes reports/mac-pack/L4/<id>.json per task:
 *   { id, ok, e2e: [{ file, grep, passed, failed, flaky, skipped, skippedOnChromium, ok }], cmds: [{ name, exit, ok }], owed: [...] }
 * and reports/mac-pack/L4/summary.json { lane: "L4", ok, failed: [ids], passed: [ids], at }.
 * Exit 0 when every selected task is ok. `owed` lists what only a person or
 * a device can do (a screen reader, a phone); it never makes a task ok.
 *
 * An e2e group is ok when no test failed or was flaky, at least `min` tests
 * passed (default 1), every project ran it, and nothing was skipped on Chromium: a
 * skip there means the check did not run (on Firefox/WebKit the specs' own
 * engine-gap skips are allowed, they say why). Only Node built-ins.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, "reports/mac-pack/L4");
const ALL3 = ["chromium", "firefox", "webkit"];
const CHROMIUM = ["chromium"];

/** e2e(file, grep?, projects?, min?) — one group of tests a task needs green. */
const e2e = (file, grep = null, projects = ALL3, min = null) => ({ file, grep, projects, min });
/** cmd(name, run, opts) — a shell command whose exit code 0 is the pass. */
const cmd = (name, run, opts = {}) => ({ name, run, ...opts });

/** The table. `needs`: what the Mac must have; `minutes`: the expected wall time of this task alone. */
export const CHECKS = [
  { id: "W1.3", title: "Obsidian syntax: callout/highlight RTL in both editors, Temml lazy", e2e: [e2e("e2e/obsidian-syntax.spec.ts"), e2e("e2e/math-in-hebrew.spec.ts")], cmds: [cmd("Temml is a dependency, not only a lockfile entry", `node -e "process.exit(require('./package.json').dependencies?.temml ? 0 : 1)"`), cmd("golden notes render and round-trip", "npx vitest run src/__tests__/obsidianGolden.test.tsx src/__tests__/syntaxBoundaries.test.ts"), cmd("size-limit: Temml not in the startup bundle", "npm run build && node scripts/bundle-budget.mjs")], owed: ["the 40 golden notes are not Obsidian exports: W10.O9 corpus"], needs: ["npm ci", "browsers"], minutes: 12 },
  { id: "W1.4", title: "Paste fidelity from Word / Docs / web", e2e: [e2e("e2e/paste-fidelity.spec.ts"), e2e("e2e/paste-html.spec.ts")], cmds: [cmd("30 captures: ≥ 95 % structure, 0 stray marks, 0 inline style", "npx vitest run src/__tests__/pasteFidelity.test.ts")], owed: ["real clipboard captures from Word, Google Docs and Gmail (W10.O9) replace the synthetic 30"], needs: ["npm ci", "browsers"], minutes: 8 },
  { id: "W1.5", title: "Atomic writes: 1,000 SIGKILLs, vault check", cmds: [cmd("1,000 kills mid-save: 0 damaged, 0 missing, 0 leftovers", "node scripts/vault-crash-test.mjs --kills 1000 --json", { json: ["damaged", "==", 0] }), cmd("vault check finds 12/12 planted faults, 10k notes < 5 s", "npx vitest run src/__tests__/vaultIntegrity.test.ts src/__tests__/blind/blindIntegrity.test.ts")], needs: ["npm ci"], minutes: 25 },
  { id: "W1.6", title: "Backup to a second drive and restore drill", e2e: [e2e("e2e/backup-drill.spec.ts")], cmds: [cmd("backup units (WebDAV target, age zip, failure shown)", "npx vitest run src/__tests__/backup.test.ts src/__tests__/backupWebdav.test.tsx src/__tests__/autoBackupFlush.test.ts")], needs: ["npm ci", "browsers"], minutes: 8 },
  { id: "W1.8", title: "Sync that explains itself: 10k notes + 1 GB, conflict in panel", e2e: [e2e("e2e/sync-explained.spec.ts")], cmds: [cmd("bench: first sync < 10 min, one change < 3 s", "npx tsx scripts/bench/sync-first.ts --json", { json: ["ok", "==", true] })], owed: ["mobile background sync on a phone (W11.M10)"], needs: ["npm ci", "browsers", "≥ 12 GB free RAM (1 GB on two devices + server)"], minutes: 20 },
  { id: "W1.10", title: "Graph at 10k nodes, local graph, axe", e2e: [e2e("e2e/a11y-hebrew-gate.spec.ts", "knowledge graph")], cmds: [cmd("layout and local-graph budgets", "npx vitest run src/__tests__/graph10k.test.ts src/__tests__/graphTable.test.tsx")], owed: ["≥ 30 fps at 10k/50k on a real GPU (W10.M11): no e2e measures fps yet"], needs: ["npm ci", "browsers"], minutes: 8 },
  { id: "W1.11", title: "Obsidian Bases (.base) compatibility", e2e: [e2e("e2e/obsidian-bases.spec.ts")], cmds: [cmd("formula coverage ≥ 90 %, golden .base files", "npx vitest run src/__tests__/bases")], owed: ["npm run obsidian:compare -- prepare|diff <obsidian-help vault> in Obsidian 1.15.1 (W11.M12): 0 differing views"], needs: ["npm ci", "browsers", "Obsidian 1.15.1 for the owed step"], minutes: 10 },
  { id: "W1.12", title: "Relations, rollups, calendar, timeline", e2e: [e2e("e2e/database-edit.spec.ts"), e2e("e2e/rtl-parity/database-keyboard.spec.ts")], cmds: [cmd("30 rollup goldens", "npx vitest run src/__tests__/basesRelations.test.ts")], owed: ["10,000 rows ≥ 55 fps and the calendar drag round-trip have no e2e yet"], needs: ["npm ci", "browsers"], minutes: 8 },
  { id: "W1.13", title: "Local voice capture to the inbox", e2e: [e2e("e2e/voice-capture.spec.ts", null, CHROMIUM)], owed: ["< 1 s press-to-record and WER of a 60 s note on a real phone (W11.M10)"], needs: ["npm ci", "browsers"], minutes: 4 },
  { id: "W1.14", title: "EPUB reader", e2e: [e2e("e2e/epub-reader.spec.ts")], env: { LUMEN_EPUB_GOLDEN: "data/epub-golden" }, owed: ["10 golden EPUBs in data/epub-golden (W10.M10: 5 from Project Ben-Yehuda)"], needs: ["npm ci", "browsers", "data/epub-golden/*.epub"], minutes: 6 },
  { id: "W1.15", title: "Highlights hub: export note's 20 links", e2e: [e2e("e2e/highlights-hub.spec.ts"), e2e("e2e/highlight-import.spec.ts")], needs: ["npm ci", "browsers"], minutes: 4 },
  { id: "W1.16", title: "Excalidraw: note cards, Hebrew export, 50 cards < 1.5 s", e2e: [e2e("e2e/canvas-note-cards.spec.ts"), e2e("e2e/canvas-excalidraw.spec.ts")], cmds: [cmd("tldraw: 0 references in the build", "npm run build && ! grep -rl tldraw dist/assets")], needs: ["npm ci", "browsers", "visual baselines (W10.M9)"], minutes: 12 },
  { id: "W1.17", title: "ivrit.ai Whisper on the desktop", cmds: [cmd("whisper_core tests (std only)", "rustc --edition 2021 --test src-tauri/src/whisper_core.rs -o /tmp/l4-whisper-core && /tmp/l4-whisper-core"), cmd("lib.rs compiles", "cd src-tauri && cargo check --all-targets"), cmd("FLEURS-he WER ≤ 10 %", "npm run whisper:desktop -- wer --split test=data/fleurs-he/test --model models/ggml-ivrit.bin --out reports/mac-pack/L4/whisper.json")], owed: ["1 h of audio < 10 min on the M1: time the wer run"], needs: ["Rust toolchain", "whisper-cli", "FLEURS-he test split", "the pinned ggml model"], minutes: 60 },
  { id: "W1.19", title: "Real sharing: roles, threads, expiring links", e2e: [e2e("e2e/collab-sharing.spec.ts", null, CHROMIUM), e2e("e2e/collab-e2ee.spec.ts", null, CHROMIUM), e2e("e2e/share-link.spec.ts")], cmds: [cmd("server: viewer can't write, revoked link blocked < 5 s, Hebrew anchor survives 100 edits", "npx vitest run src/__tests__/collabSharing.test.ts src/__tests__/collabE2eeSharing.test.ts src/__tests__/collabE2eeCheckAttacks.test.ts src/__tests__/linkShare.test.ts")], owed: ["two-browser RTL cursor check by eye"], needs: ["npm ci", "browsers"], minutes: 10 },
  { id: "W1.20", title: "Plugin permissions before install, scan of every version", e2e: [e2e("e2e/plugin-install.spec.ts"), e2e("e2e/plugin-ecosystem.spec.ts")], cmds: [cmd("every registry version has a scan result and scorecard", "node scripts/review-plugins.mjs --check")], needs: ["npm ci", "browsers"], minutes: 8 },
  { id: "W1.21", title: "Safe themes and CSS snippets", e2e: [e2e("e2e/settings.spec.ts", "theme")], cmds: [cmd("themes: RTL, contrast scorecards", "node scripts/themes/rtl-check.mjs")], owed: ["axe AA on 5 themes he/en and a < 100 ms switch have no e2e yet"], needs: ["npm ci", "browsers"], minutes: 5 },
  { id: "W1.22", title: "INP and keypress → paint budget", cmds: [cmd("the editor corpus (Moby-Dick, 2 MB Ben-Yehuda)", "npm run perf:editor-corpus"), cmd("INP p75 < 100 ms, keypress → paint p95, gate vs baseline", "npm run perf:inp")], owed: ["the first run makes the baseline: npm run perf:inp:gate -- --update, reviewed by the owner"], needs: ["npm ci", "browsers", "network for the corpus once"], minutes: 20 },
  { id: "W1.23", title: "Screen readers in Hebrew, 400 % reflow", e2e: [e2e("e2e/reflow.spec.ts"), e2e("e2e/sr-announce.spec.ts"), e2e("e2e/aria-hebrew.spec.ts", null, CHROMIUM)], cmds: [cmd("VoiceOver journey (Guidepup)", "npm run test:sr -- --project=voiceover")], owed: ["NVDA (Windows) and TalkBack (Android) journeys by a person, protocol in sr/"], needs: ["npm ci", "browsers", "npx @guidepup/setup", "the Mac's audio and keyboard for ~10 min"], minutes: 25 },
  { id: "W1.24", title: "Store packaging without GitHub Actions", cmds: [cmd("store listings and metadata current", "node scripts/store.mjs check"), cmd("mobile toolchains present", "node scripts/mobile-build.mjs check")], owed: ["brew install --cask / winget / flatpak install of a signed build (needs W10.O5 signed artefacts)"], needs: ["Xcode", "Android SDK"], minutes: 10 },
  { id: "W1.25", title: "Mobile editing at native-app level", e2e: [e2e("e2e/mobile-native.spec.ts", null, CHROMIUM), e2e("e2e/touch.spec.ts", null, CHROMIUM)], owed: ["tap counts vs Obsidian Mobile and launch < 1.5 s on a real Pixel 7 / iPhone 14 (W11.M10)"], needs: ["npm ci", "browsers"], minutes: 6 },
  { id: "W1.26", title: "Import wizard from every source", e2e: [e2e("e2e/import-wizard.spec.ts")], cmds: [cmd("importers: goldens, Notion database → .base, undo by hash", "npx vitest run src/__tests__/importWizard.test.ts src/__tests__/importFormats.test.ts src/__tests__/importDiff.test.ts")], owed: ["npm run import:diff on each real export of W10.O9"], needs: ["npm ci", "browsers"], minutes: 8 },
  { id: "W1.27", title: "Threat model: 1M fuzz per decoder, reproducible build, signed SBOM", cmds: [cmd("1,000,000 inputs per decoder: 0 crashes, 0 hangs > 1 s", "npm run fuzz"), cmd("two builds, same sha256 for every dist file", "npm run repro:two-paths"), cmd("CycloneDX SBOM", "npm run sbom -- --out reports/mac-pack/L4/sbom.cdx.json")], owed: ["a release with SBOM + signature (W10.O5); the OpenSSF badge (W10.O11)"], needs: ["npm ci", "~3 h for the fuzz", "faketime (optional)"], minutes: 200 },
  { id: "W1.34", title: "webR as a user-started download", e2e: [e2e("e2e/live-exec.spec.ts", "live-r")], cmds: [cmd("licence gate passes with no webR exception", "npm run licenses")], needs: ["npm ci", "browsers", "npm run webr:local (Playwright's webServer runs it)"], minutes: 6 },
  { id: "W1.36", title: "Excalidraw core ≤ 700 KB, its own rule removed", cmds: [cmd("build + bundle budget with the exception removed", "npm run build && node scripts/bundle-budget.mjs")], owed: ["find a smaller Excalidraw build, then delete the 'vendor: excalidraw core' rule in scripts/bundle-budgets.json (expires 2027-01-15)"], needs: ["npm ci"], minutes: 10 },
  { id: "W11.S2", title: "Update without trusting the manifest", cmds: [cmd("update_guard + manifest_sig (std only)", "rustc --edition 2021 --test src-tauri/src/update_guard.rs -o /tmp/l4-ug && /tmp/l4-ug && rustc --edition 2021 --test src-tauri/src/manifest_sig.rs -o /tmp/l4-ms && /tmp/l4-ms"), cmd("tauri-plugin-updater ≥ 2.13.3, cargo test", "cd src-tauri && cargo update -p tauri-plugin-updater && cargo test")], needs: ["Rust toolchain", "crates.io"], minutes: 20 },
  { id: "W11.S3", title: "latest.json.sig with minisign, refuse to publish unsigned", cmds: [cmd("release-run refuses without a .sig", "npx vitest run src/__tests__/releaseRun.test.ts src/__tests__/updaterManifestSig.test.ts")], owed: ["a real minisign key: W10.O5"], needs: ["npm ci", "minisign"], minutes: 6 },
  { id: "W11.S5", title: "Supply chain in the nightly: Scorecard, osv, cargo deny, SBOM", cmds: [cmd("nightly receipt with every tool measured", "node scripts/supply/nightly.mjs")], owed: ["Scorecard ≥ 7.0 needs the GitHub settings of W10.O1"], needs: ["scorecard", "osv-scanner", "cargo-deny", "network"], minutes: 15 },
  { id: "W11.S6", title: "Per-device conflict-file mode", e2e: [e2e("e2e/sync-conflict-file.spec.ts")], cmds: [cmd("unit: both versions, history, not synced", "npx vitest run src/__tests__/syncConflictFile.test.ts")], needs: ["npm ci", "browsers"], minutes: 5 },
  { id: "W11.S7", title: "Merge measured on public editing traces", cmds: [cmd("josephg/editing-traces + crdt-benchmarks B4: ≥ 90 % merged, 0 lost", "npm run bench:merge-traces -- --json")], owed: ["replace the 91.8 % figure in the plan with the result"], needs: ["npm ci", "network (GitHub raw)"], minutes: 15 },
  { id: "W11.S9", title: "Recovery kit: 24 words, PDF, 3-word check", e2e: [e2e("e2e/recovery-kit.spec.ts")], needs: ["npm ci", "browsers"], minutes: 10 },
  { id: "W11.S10", title: "Passkey unlock via WebAuthn PRF", e2e: [e2e("e2e/passkey-unlock.spec.ts")], owed: ["a real passkey in Chrome and Safari (W11.M11)"], needs: ["npm ci", "browsers"], minutes: 5 },
  { id: "W11.S17", title: "Trusted Types: 0 default-policy hits", e2e: [e2e("e2e/trusted-types-default.spec.ts", null, CHROMIUM), e2e("e2e/csp-violations.spec.ts")], needs: ["npm ci", "browsers"], minutes: 4 },
  { id: "W11.S19", title: "Telemetry hardening: 0 requests by default, secret fuzz", e2e: [e2e("e2e/monitoring.spec.ts"), e2e("e2e/pii-redaction.spec.ts")], cmds: [cmd("planted secrets: 0 leaks", "node scripts/fuzz/redaction-nightly.mjs --no-save")], needs: ["npm ci", "browsers"], minutes: 10 },
  { id: "W10.F2", title: "Preview gate tiers under 38 min", cmds: [cmd("a timed local Vercel-like build writes reports/vercel-build.json", "node scripts/vercel-build.mjs"), cmd("the gate estimate is inside 38 min", "node scripts/gate-estimate.mjs")], needs: ["npm ci", "browsers"], minutes: 40 },
  { id: "W10.F4", title: "Vault move into a real folder", e2e: [e2e("e2e/vault-folder.spec.ts")], needs: ["npm ci", "browsers"], minutes: 4 },
  { id: "W10.F5", title: "The e2e fixes of #566: the whole suite", cmds: [cmd("the whole e2e suite, three browsers", "npx playwright test --project=chromium --project=firefox --project=webkit")], needs: ["npm ci", "browsers"], minutes: 60 },
  { id: "W10.F10", title: "Plugin e2e of #608 against the real install", e2e: [e2e("e2e/plugins.spec.ts"), e2e("e2e/plugin-dev.spec.ts")], needs: ["npm ci", "browsers"], minutes: 4 },
  { id: "W12.T2", title: "Types in the UI: field form, validation, template", cmds: [cmd("form, RTL אדם note with 5 fields, axe, 100-note rename + one Ctrl+Z", "npx vitest run src/__tests__/typedForm.test.ts src/__tests__/typedFormRtl.test.tsx")], owed: ["the acceptance asks for e2e: no Playwright spec for Object Studio yet"], needs: ["npm ci"], minutes: 3 },
  { id: "W12.T3", title: "Auto Base per type", e2e: [e2e("e2e/rtl-parity/database-keyboard.spec.ts")], cmds: [cmd("1,000 notes of a type < 300 ms on a 10k vault", "npx vitest run src/__tests__/typeBase")], owed: ["'Save as .base' opens in Obsidian 1.15.1 with the same rows (W12.M2)"], needs: ["npm ci", "browsers"], minutes: 6 },
  { id: "W12.T5", title: "Bases vs Obsidian 1.14/1.15: kanban, covers, filter order", e2e: [e2e("e2e/rtl-parity/database-keyboard.spec.ts"), e2e("e2e/bulk-properties.spec.ts", "kanban")], owed: ["mouse drag between kanban columns in RTL has no e2e yet; obsidian-help corpus (W11.P3)"], needs: ["npm ci", "browsers"], minutes: 5 },
  { id: "W12.U1", title: "Edit an embedded block in place", e2e: [e2e("e2e/embed-edit.spec.ts"), e2e("e2e/embeds.spec.ts")], needs: ["npm ci", "browsers"], minutes: 4 },
];

const MAC_PACK = "plan/mac-pack/L4.json";

/** Judge one e2e group against a Playwright JSON report. */
export function judgeGroup(report, group) {
  const tally = { passed: 0, failed: 0, flaky: 0, skipped: 0, skippedOnChromium: 0, seen: new Set() };
  const re = group.grep ? new RegExp(group.grep, "i") : null;
  const walk = (suite, titles) => {
    for (const s of suite.suites ?? []) walk(s, [...titles, s.title]);
    for (const spec of suite.specs ?? []) {
      const file = `e2e/${spec.file ?? suite.file ?? ""}`.replace(/^e2e\/e2e\//, "e2e/");
      if (file !== group.file) continue;
      const full = [...titles, spec.title].join(" › ");
      if (re && !re.test(full)) continue;
      for (const t of spec.tests ?? []) {
        if (!group.projects.includes(t.projectName)) continue;
        tally.seen.add(t.projectName);
        if (t.status === "expected") tally.passed++;
        else if (t.status === "flaky") tally.flaky++;
        else if (t.status === "skipped") {
          tally.skipped++;
          if (t.projectName === "chromium") tally.skippedOnChromium++;
        } else tally.failed++;
      }
    }
  };
  for (const s of report.suites ?? []) walk(s, []);
  const min = group.min ?? 1;
  const ok = tally.failed === 0 && tally.flaky === 0 && tally.skippedOnChromium === 0 && tally.passed >= min && group.projects.every((p) => tally.seen.has(p));
  return { file: group.file, grep: group.grep, projects: group.projects, passed: tally.passed, failed: tally.failed, flaky: tally.flaky, skipped: tally.skipped, skippedOnChromium: tally.skippedOnChromium, min, ok };
}

/** Check a command's JSON stdout field: [field, op, value]. */
export function judgeJson(stdout, [field, op, value]) {
  const line = stdout.trim().split("\n").reverse().find((l) => l.trim().startsWith("{"));
  if (!line) return false;
  let got;
  try {
    got = JSON.parse(line)[field];
  } catch {
    return false;
  }
  return op === "==" ? got === value : op === ">=" ? got >= value : op === "<=" ? got <= value : false;
}

function sh(run, env = {}) {
  const r = spawnSync(run, { cwd: ROOT, shell: true, encoding: "utf8", env: { ...process.env, ...env }, maxBuffer: 1 << 28 });
  process.stdout.write(r.stdout ?? "");
  process.stderr.write(r.stderr ?? "");
  return { exit: r.status ?? 1, stdout: r.stdout ?? "" };
}

function emitPack() {
  const pack = [
    { id: "L4.all", cmd: "node scripts/mac-pack/L4.mjs all", expect: "exit 0 and reports/mac-pack/L4/summary.json .ok == true (.failed lists the task ids that are not)", needs: ["npm ci", "Playwright browsers", "see each task"], minutes: CHECKS.reduce((n, c) => n + c.minutes, 0) },
    { id: "L4.e2e", cmd: "node scripts/mac-pack/L4.mjs all --e2e-only", expect: "exit 0; one Playwright run; every task's reports/mac-pack/L4/<id>.json .e2e[].ok == true (0 failed, 0 flaky, 0 skipped on chromium)", needs: ["npm ci", "Playwright browsers"], minutes: 45 },
    ...CHECKS.map((c) => ({
      id: c.id,
      cmd: `node scripts/mac-pack/L4.mjs ${c.id}`,
      expect: `exit 0 and reports/mac-pack/L4/${c.id}.json .ok == true` + (c.e2e?.length ? `; e2e: ${c.e2e.map((g) => `${g.file}${g.grep ? ` /${g.grep}/` : ""} [${g.projects.join(",")}]`).join("; ")}` : "") + (c.cmds?.length ? `; commands: ${c.cmds.map((x) => x.name).join("; ")}` : "") + (c.owed?.length ? `; still owed after it (.owed): ${c.owed.join("; ")}` : ""),
      needs: c.needs,
      minutes: c.minutes,
    })),
  ];
  mkdirSync(join(ROOT, "plan/mac-pack"), { recursive: true });
  writeFileSync(join(ROOT, MAC_PACK), `${JSON.stringify(pack, null, 2)}\n`);
  writeFileSync(join(ROOT, "plan/mac-pack/L4.md"), packMarkdown(pack, "en"));
  writeFileSync(join(ROOT, "plan/mac-pack/L4.he.md"), packMarkdown(pack, "he"));
  console.log(`${MAC_PACK}: ${pack.length} entries (+ L4.md, L4.he.md)`);
}

/** The plan's (Hebrew) title of each task, for the Hebrew page. */
function planTitles() {
  const out = {};
  try {
    const walk = (o) => {
      if (Array.isArray(o)) return o.forEach(walk);
      if (!o || typeof o !== "object") return;
      if (typeof o.id === "string" && typeof o.title === "string" && !out[o.id]) out[o.id] = o.title;
      Object.values(o).forEach(walk);
    };
    walk(JSON.parse(readFileSync(join(ROOT, "plan/plan.json"), "utf8")));
  } catch {
    /* no plan here: English titles only */
  }
  return out;
}

const esc = (s) => String(s).replace(/\|/g, "\\|");

/** plan/mac-pack/L4.md and L4.he.md: the same entries, generated, never edited by hand. */
export function packMarkdown(pack, lang) {
  const he = lang === "he";
  const titles = he ? planTitles() : {};
  const byId = Object.fromEntries(CHECKS.map((c) => [c.id, c]));
  byId["L4.all"] = { title: "Every L4 task: one e2e run, then each task's commands" };
  byId["L4.e2e"] = { title: "Only the shared e2e run and its per-task verdicts" };
  if (he) Object.assign(titles, { "L4.all": "כל משימות L4: ריצת e2e אחת, ואחריה הפקודות של כל משימה", "L4.e2e": "רק ריצת ה-e2e המשותפת והתוצאה לכל משימה" });
  const head = he
    ? [
        "<div dir=\"rtl\">",
        "",
        "# חבילת Mac — מסלול L4 (גל g6)",
        "",
        "נוצר מ-`scripts/mac-pack/L4.mjs --emit-pack`; לא לערוך ביד. הגרסה האנגלית: [L4.md](L4.md).",
        "",
        "**פקודה אחת לכל המסלול:** `node scripts/mac-pack/L4.mjs all` — יוצא 0 כשכל המשימות תקינות; התוצאה ב-`reports/mac-pack/L4/summary.json` (‏`.ok`, ‏`.failed`, ‏`.owed`). כל ה-e2e של המסלול רצים בריצת Playwright אחת, וכל משימה נשפטת לחוד: 0 נכשלו, 0 flaky, ‏0 דילוגים ב-Chromium ולפחות בדיקה אחת שעברה בכל דפדפן. ‏`owed` הוא מה שרק אדם או מכשיר יכולים לעשות — הוא לא הופך משימה לתקינה.",
        "",
        "| משימה | כותרת | פקודה | זמן (דק׳) |",
        "|---|---|---|---|",
      ]
    : [
        "# Mac pack — lane L4 (wave g6)",
        "",
        "Generated by `scripts/mac-pack/L4.mjs --emit-pack`; do not edit by hand. Hebrew: [L4.he.md](L4.he.md).",
        "",
        "**One command for the lane:** `node scripts/mac-pack/L4.mjs all` — exit 0 when every task is ok; the result is `reports/mac-pack/L4/summary.json` (`.ok`, `.failed`, `.owed`). All the lane's e2e specs run in ONE Playwright run and each task is judged on its own: 0 failed, 0 flaky, 0 skipped on Chromium, at least one passed test in every browser it names. `owed` is what only a person or a device can do; it never makes a task ok.",
        "",
        "| Task | Title | Command | Minutes |",
        "|---|---|---|---|",
      ];
  const rows = pack.map((e) => `| ${e.id} | ${esc(he ? (titles[e.id] ?? byId[e.id]?.title ?? "") : (byId[e.id]?.title ?? ""))} | \`${esc(e.cmd)}\` | ${e.minutes} |`);
  const detail = pack.flatMap((e) => [
    "",
    `## ${e.id}${byId[e.id] ? ` — ${esc(he ? (titles[e.id] ?? byId[e.id].title) : byId[e.id].title)}` : ""}`,
    "",
    `- ${he ? "פקודה" : "Command"}: \`${e.cmd}\``,
    `- ${he ? "צפוי (בדיקה אוטומטית)" : "Expect (machine-checked)"}: ${e.expect}`,
    `- ${he ? "צריך" : "Needs"}: ${e.needs.join(", ")}`,
    ...(byId[e.id]?.cmds?.length ? [`- ${he ? "הפקודות שהמשימה מריצה" : "Commands it runs"}:`, ...byId[e.id].cmds.map((x) => `  - ${x.name}: \`${x.run}\``)] : []),
  ]);
  return [...head, ...rows, ...detail, ...(he ? ["", "</div>"] : []), ""].join("\n");
}

function main(argv) {
  if (argv.includes("--emit-pack")) return emitPack(), 0;
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const fromIdx = argv.indexOf("--from");
  const from = fromIdx >= 0 ? argv[fromIdx + 1] : null;
  const ids = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--from");
  const picked = ids.includes("all") ? CHECKS : CHECKS.filter((c) => ids.includes(c.id));
  const unknown = ids.filter((i) => i !== "all" && !CHECKS.some((c) => c.id === i));
  if (!picked.length || unknown.length) {
    console.error(`usage: node scripts/mac-pack/L4.mjs <all | id…> [--e2e-only | --no-e2e] [--from report.json] [--dry]${unknown.length ? `\nunknown: ${unknown.join(", ")}` : ""}`);
    return 2;
  }
  const dry = flags.has("--dry");
  mkdirSync(OUT, { recursive: true });

  // One Playwright run for every picked task's specs (the projects are the union; each group is judged on its own).
  let report = null;
  const groups = flags.has("--no-e2e") ? [] : picked.flatMap((c) => c.e2e ?? []);
  if (groups.length) {
    const files = [...new Set(groups.map((g) => g.file))].sort();
    const projects = [...new Set(groups.flatMap((g) => g.projects))];
    const env = Object.assign({}, ...picked.map((c) => c.env ?? {}));
    const json = join(OUT, "e2e-report.json");
    const run = `npx playwright test ${files.join(" ")} ${projects.map((p) => `--project=${p}`).join(" ")} --reporter=list,json`;
    if (from) report = JSON.parse(readFileSync(resolve(from), "utf8"));
    else if (dry) console.log(`[dry] PLAYWRIGHT_JSON_OUTPUT_FILE=${json} ${run}`);
    else {
      sh(run, { ...env, PLAYWRIGHT_JSON_OUTPUT_FILE: json, PLAYWRIGHT_JSON_OUTPUT_NAME: json });
      report = existsSync(json) ? JSON.parse(readFileSync(json, "utf8")) : { suites: [] };
    }
  }

  const results = [];
  for (const c of picked) {
    const e2eRes = report ? (c.e2e ?? []).map((g) => judgeGroup(report, g)) : [];
    const cmdRes = [];
    if (!flags.has("--e2e-only") && !from) {
      for (const x of c.cmds ?? []) {
        if (dry) {
          console.log(`[dry] ${c.id}: ${x.run}`);
          continue;
        }
        console.log(`\n── ${c.id}: ${x.name}\n$ ${x.run}`);
        const r = sh(x.run, c.env);
        cmdRes.push({ name: x.name, run: x.run, exit: r.exit, ok: r.exit === 0 && (!x.json || judgeJson(r.stdout, x.json)) });
      }
    }
    const ran = e2eRes.length + cmdRes.length;
    const ok = ran > 0 && e2eRes.every((g) => g.ok) && cmdRes.every((x) => x.ok) && (flags.has("--e2e-only") || !!from || cmdRes.length === (c.cmds ?? []).length);
    const res = { id: c.id, title: c.title, ok: dry ? null : ok, e2e: e2eRes, cmds: cmdRes, owed: c.owed ?? [], at: new Date().toISOString() };
    results.push(res);
    if (!dry) writeFileSync(join(OUT, `${c.id}.json`), `${JSON.stringify(res, null, 2)}\n`);
  }
  if (dry) return 0;
  const summary = { lane: "L4", ok: results.every((r) => r.ok), passed: results.filter((r) => r.ok).map((r) => r.id), failed: results.filter((r) => !r.ok).map((r) => r.id), owed: Object.fromEntries(results.filter((r) => r.owed.length).map((r) => [r.id, r.owed])), at: new Date().toISOString() };
  writeFileSync(join(OUT, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`\nL4: ${summary.passed.length} ok, ${summary.failed.length} not ok${summary.failed.length ? `: ${summary.failed.join(", ")}` : ""} → reports/mac-pack/L4/summary.json`);
  return summary.ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
