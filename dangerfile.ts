/**
 * The PR gate (plan 0.19), run by the `danger` job of ci.yml on every pull
 * request (`danger ci`) and locally with `npm run danger:local`.
 *
 * It comments once per PR (updating the same comment) with:
 *  - bundle size: size-limit per main chunk (fails over a limit) and the
 *    per-class change against the base when CI made bundle-diff.md;
 *  - code without tests (a warning);
 *  - the `ai-written` label when a commit or the body says an AI agent wrote it;
 *  - production packages whose licence changed (fails on copyleft / NC / none);
 *  - new network calls that the privacy ledger does not cover (fails).
 *
 * The rules themselves are in scripts/lib/prGate.mjs (unit tested).
 */
import { danger, fail, markdown, message, schedule, warn } from "danger";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  AI_LABEL,
  licenceChanges,
  sizeLimitReport,
  unregisteredNetworkCalls,
  untestedChanges,
  writtenByAi,
} from "./scripts/lib/prGate.mjs";

type Added = Record<string, Array<{ line: number; text: string; before: string[] }>>;

async function addedLines(files: string[]): Promise<Added> {
  const out: Added = {};
  for (const file of files) {
    const diff = await danger.git.structuredDiffForFile(file);
    if (!diff) continue;
    for (const chunk of diff.chunks) {
      const recent: string[] = [];
      for (const change of chunk.changes as Array<{ type: string; content: string; ln?: number; ln2?: number }>) {
        const text = change.content.slice(1);
        if (change.type === "add") {
          (out[file] ??= []).push({ line: change.ln ?? 0, text, before: recent.slice(-2) });
          recent.push(text);
        } else if (change.type === "normal") recent.push(text);
      }
    }
  }
  return out;
}

const baseRef = danger.github?.pr?.base?.sha ?? process.env.DANGER_BASE ?? "origin/main";

function readAtBase(path: string): string | null {
  try {
    return execFileSync("git", ["show", `${baseRef}:${path}`], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const changed = [...danger.git.created_files, ...danger.git.modified_files];

  // ── Bundle size ──
  if (existsSync("size-limit.json")) {
    const report = sizeLimitReport(JSON.parse(readFileSync("size-limit.json", "utf8")));
    markdown(`### Bundle size (size-limit, gzip)\n\n${report.markdown}`);
    for (const name of report.over) fail(`Bundle: **${name}** is over its size-limit (\`.size-limit.cjs\`).`);
  } else {
    message("Bundle size: no size-limit.json (run `npm run build && npm run size -- --json > size-limit.json`).");
  }
  if (existsSync("bundle-diff.md")) markdown(readFileSync("bundle-diff.md", "utf8"));

  // ── Code without tests ──
  const untested = untestedChanges(changed);
  if (untested.length) warn(`Production code changed without any test or e2e change: ${untested.map((f) => `\`${f}\``).join(", ")}.`);

  // ── Written by an AI agent ──
  const commits = danger.git.commits.map((c) => c.message);
  if (writtenByAi(danger.github?.pr?.body, commits)) {
    const labels = danger.github?.issue?.labels?.map((l) => l.name) ?? [];
    if (!labels.includes(AI_LABEL)) {
      try {
        await danger.github.api.issues.addLabels({ ...danger.github.thisPR, issue_number: danger.github.thisPR.number, labels: [AI_LABEL] });
        message(`Labelled \`${AI_LABEL}\`: a commit or the description says an AI agent wrote it.`);
      } catch {
        warn(`This PR was written by an AI agent: add the \`${AI_LABEL}\` label.`);
      }
    }
  }

  // ── Licences ──
  if (changed.includes("package-lock.json")) {
    const base = readAtBase("package-lock.json");
    const rows = licenceChanges(base ? JSON.parse(base) : {}, JSON.parse(readFileSync("package-lock.json", "utf8")));
    if (rows.length) {
      markdown(
        ["### Production packages added or changed", "", "| | package | version | licence | was |", "|---|---|---|---|---|", ...rows.map((r) => `| ${r.level === "fail" ? "❌" : r.level === "warn" ? "⚠️" : "✅"} | ${r.name} | ${r.version} | ${r.license} | ${r.previous ?? "new"} |`)].join("\n"),
      );
      for (const r of rows.filter((x) => x.level === "fail")) fail(`Licence: **${r.name}@${r.version}** is \`${r.license}\` — not allowed in the shipped app (plan 0.10).`);
      for (const r of rows.filter((x) => x.level === "warn")) warn(`Licence: **${r.name}@${r.version}** is \`${r.license}\` — check it.`);
    }
  }

  // ── Network calls and the privacy ledger ──
  const ledger = existsSync("src/ai/privacyLedger.ts") ? readFileSync("src/ai/privacyLedger.ts", "utf8") : "";
  for (const v of unregisteredNetworkCalls(await addedLines(changed), ledger)) {
    fail(`Network call not in the privacy ledger — ${v.why}: \`${v.text.slice(0, 120)}\``, v.file, v.line);
  }
}

// Danger waits for the scheduled promise before it posts.
schedule(main());
