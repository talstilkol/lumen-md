#!/usr/bin/env node
/**
 * Generate a public ROADMAP.md from MASTER_PLAN.md (ε.4).
 *
 * The master plan is too detailed for casual readers; this script
 * extracts the phase summaries + their gates and produces a slim
 * roadmap suitable for github.com / loops.so embedding.
 *
 * Run: node scripts/generate-roadmap.mjs
 * Output: ROADMAP.md (overwritten in repo root)
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const PLAN = await readFile(resolve("MASTER_PLAN.md"), "utf8");

// Match each `## Phase X — name` heading, capture title + body until next ##.
const phases = [];
const phaseRe = /^## Phase ([αβγδεζ]) — (.+?)$/gm;
let m;
const positions = [];
while ((m = phaseRe.exec(PLAN)) !== null) {
  positions.push({ index: m.index, letter: m[1], title: m[2] });
}
for (let i = 0; i < positions.length; i++) {
  const start = positions[i].index;
  const end = i + 1 < positions.length ? positions[i + 1].index : PLAN.length;
  phases.push({
    letter: positions[i].letter,
    title: positions[i].title,
    body: PLAN.slice(start, end),
  });
}

// Extract goal + duration + gate from each phase body.
function extract(body, prefix) {
  const re = new RegExp(`\\*\\*${prefix}\\.?\\*\\*\\s*(.+?)\\n`, "i");
  const m = re.exec(body);
  return m ? m[1].trim() : null;
}

// ── Compose ROADMAP.md ────────────────────────────────────────────────────

let out = `# Lumen Roadmap

> Auto-generated from \`MASTER_PLAN.md\`. Last refresh: ${new Date().toISOString().slice(0, 10)}.
>
> Vote on items in [GitHub Discussions → Roadmap](https://github.com/lumen-md/lumen/discussions/categories/roadmap).

## Where we are today

Lumen is **#1 by weighted scorecard** (7.78) but the lead is fragile (0.39 over Obsidian).
The roadmap below closes the gap to **9.42 / 2.0+ ahead of every competitor**.

## Phases

| Phase | Title | Duration | Status |
|---|---|---|---|
`;

for (const p of phases) {
  const dur = extract(p.body, "Duration") ?? "—";
  out += `| ${p.letter} | ${p.title} | ${dur} | _planning_ |\n`;
}

out += `\n---\n`;

for (const p of phases) {
  out += `\n## Phase ${p.letter} — ${p.title}\n\n`;
  const goal = extract(p.body, "Goal") ?? "_(see master plan)_";
  const gate = extract(p.body, "Gate") ?? "_(see master plan)_";
  out += `**Goal.** ${goal}\n\n`;
  out += `**Gate to advance.** ${gate}\n\n`;

  // Include just the sub-section H3 headers so users can see scope.
  const subRe = /^### ((?:[αβγδεζ])\.\d+\s+—.+?)$/gm;
  const subs = [];
  let s;
  while ((s = subRe.exec(p.body)) !== null) subs.push(s[1]);
  if (subs.length > 0) {
    out += `### Tasks\n\n`;
    for (const sub of subs) out += `- ${sub}\n`;
  }
}

out += `\n---\n\n## Want to influence priorities?\n\n`;
out += `1. 👍 the items you care about in [GitHub Discussions](https://github.com/lumen-md/lumen/discussions/categories/roadmap).\n`;
out += `2. Comment with a use-case — concrete user stories help us scope.\n`;
out += `3. PRs welcome on Phase α + β items (no credentials required); see [CONTRIBUTING.md](CONTRIBUTING.md).\n`;

await writeFile("ROADMAP.md", out);
console.log(`✓ wrote ROADMAP.md (${out.length} bytes, ${phases.length} phases)`);
