#!/usr/bin/env node
/**
 * Plan W7.1 acceptance 2, on a machine with Claude Code signed in (the Mac):
 * Claude Code with the `lumen-skills` pack writes a .base file ten times,
 * one task per try, and Lumen's Bases engine opens every one.
 *
 *   node --experimental-transform-types --no-warnings --import ./scripts/lib/ts-register.mjs \
 *     scripts/skills/claude-base-trials.mjs run [--tries 10] [--claude claude] [--out eval/results/skills-base]
 *   node … scripts/skills/claude-base-trials.mjs check <dir>      judge try-*.base files already written
 *
 * Each try runs in a fresh temporary folder holding the synthetic vault
 * (agents/skills/baseTrials.ts TRIAL_VAULT) and the pack under
 * .claude/skills/, with `claude -p` allowed to read and write files there
 * only. The .base it wrote is copied to <out>/<run>/try-N.base and judged
 * (checkBaseTrials). Prints the report as JSON and writes report.json.
 *
 * Exit 0: ≥ 10 tries and every one opened. 1: a try failed. 2: usage.
 * 3: the environment (no Claude Code CLI on PATH), so the result says
 * nothing about the pack.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BASE_TRIAL_PROMPTS, TRIAL_VAULT, checkBaseTrials } from "../../src/agents/skills/baseTrials.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};

function judge(dir) {
  const names = readdirSync(dir).filter((f) => /^try-\d+\.base$/.test(f)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  const tries = names.map((name) => ({ name, text: readFileSync(join(dir, name), "utf8") }));
  // A try that wrote nothing leaves a marker, so it still counts as a try.
  for (const f of readdirSync(dir).filter((x) => /^try-\d+\.missing$/.test(x))) tries.push({ name: f.replace(".missing", ".base"), text: null });
  const report = checkBaseTrials(tries);
  writeFileSync(join(dir, "report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.pass ? 0 : 1);
}

if (cmd === "check") {
  const dir = argv[1];
  if (!dir || !existsSync(dir)) {
    console.error("usage: claude-base-trials.mjs check <dir with try-N.base>");
    process.exit(2);
  }
  judge(dir);
} else if (cmd === "run") {
  const tries = Number(opt("tries", "10"));
  const claude = opt("claude", "claude");
  const v = spawnSync(claude, ["--version"], { encoding: "utf8" });
  if (v.error || v.status !== 0) {
    console.log(JSON.stringify({ task: "W7.1", env: true, error: `Claude Code CLI "${claude}" not found or not runnable: ${v.error?.message ?? v.stderr}` }));
    process.exit(3);
  }
  const run = new Date().toISOString().replace(/[:.]/g, "-");
  const out = resolve(root, opt("out", "eval/results/skills-base"), run);
  mkdirSync(out, { recursive: true });
  const skills = join(root, "packages/lumen-skills/skills");
  for (let i = 0; i < tries; i++) {
    const task = BASE_TRIAL_PROMPTS[i % BASE_TRIAL_PROMPTS.length];
    const file = task.match(/Write (\S+\.base)/)[1];
    const work = mkdtempSync(join(tmpdir(), "lumen-base-try-"));
    try {
      for (const n of TRIAL_VAULT) {
        mkdirSync(dirname(join(work, n.path)), { recursive: true });
        writeFileSync(join(work, n.path), n.text);
      }
      cpSync(skills, join(work, ".claude/skills"), { recursive: true });
      const prompt = `${task} This folder is an Obsidian/Lumen vault. Use the lumen-bases skill. Write the file at the top of this folder, then stop.`;
      const r = spawnSync(claude, ["-p", prompt, "--permission-mode", "acceptEdits", "--allowedTools", "Read,Write,Glob"], { cwd: work, encoding: "utf8", timeout: 300_000 });
      writeFileSync(join(out, `try-${i + 1}.log`), `${prompt}\n\n--- exit ${r.status}\n${r.stdout ?? ""}\n${r.stderr ?? ""}`);
      const wrote = join(work, file);
      if (existsSync(wrote)) cpSync(wrote, join(out, `try-${i + 1}.base`));
      else writeFileSync(join(out, `try-${i + 1}.missing`), `${file} was not written\n`);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }
  judge(out);
} else {
  console.error("usage: claude-base-trials.mjs run [--tries 10] [--claude claude] [--out dir] | check <dir>");
  process.exit(2);
}
