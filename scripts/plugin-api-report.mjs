#!/usr/bin/env node
/**
 * The plugin API report (plan W13.L1), in the manner of api-extractor: reads
 * the public types of src/plugins/api/lumen-plugin.d.ts with the TypeScript
 * compiler and writes plugin-api/api-report.md (for people) and
 * plugin-api/api-report.json (for this check), one entry per interface
 * member, type-alias union member and theme variable.
 *
 * Every released API version keeps a snapshot, plugin-api/releases/<v>.json.
 * The rules, checked on every pair of consecutive snapshots:
 *   - an addition needs at least a minor bump;
 *   - a removal or a changed signature needs a major bump;
 *   - a removed member must have been `@deprecated` in at least two released
 *     minor versions first (Obsidian's way: Array#contains in 1.15.1);
 *   - a snapshot, once committed, never changes: change the API, bump the
 *     version (src/plugins/api/version.ts).
 *
 *   node scripts/plugin-api-report.mjs          write the report and the current version's snapshot (refused when the bump is wrong)
 *   node scripts/plugin-api-report.mjs --check  exit 1 when the report is stale, the bump is wrong or the deprecation window is short
 *   --root <dir>                                another tree (the tests)
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export const DTS = "src/plugins/api/lumen-plugin.d.ts";
export const VERSION_TS = "src/plugins/api/version.ts";
export const OUT_DIR = "plugin-api";

const norm = (s) => s.replace(/\s+/g, " ").replace(/\s*;\s*$/, "").trim();

/** The JSDoc tags of a node: since, deprecated { since, removeIn, use }. */
function tagsOf(node) {
  const out = {};
  for (const tag of ts.getJSDocTags(node)) {
    const name = tag.tagName.text;
    const text = typeof tag.comment === "string" ? tag.comment : ts.getTextOfJSDocComment(tag.comment) ?? "";
    if (name === "since") out.since = text.trim();
    if (name === "deprecated") {
      const [since, removeIn, use] = text.trim().split(/\s+/);
      out.deprecated = { since: since ?? "", removeIn: removeIn ?? "", use: use ?? "" };
    }
  }
  return out;
}

/** The report entries of a .d.ts text, sorted by key. Throws on a member without @since. */
export function buildEntries(dtsText, fileName = DTS) {
  const sf = ts.createSourceFile(fileName, dtsText, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const entries = [];
  const errors = [];
  const add = (key, kind, signature, node, inherit = {}) => {
    const t = { ...inherit, ...tagsOf(node) };
    entries.push({ key, kind, signature: norm(signature), since: t.since ?? null, ...(t.deprecated ? { deprecated: t.deprecated } : {}) });
  };
  for (const st of sf.statements) {
    if (ts.isInterfaceDeclaration(st)) {
      const name = st.name.text;
      add(`${name}`, "interface", `interface ${name}`, st);
      for (const m of st.members) {
        const mname = m.name && (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name)) ? m.name.text : m.getText(sf);
        add(`${name}.${mname}`, ts.isMethodSignature(m) ? "method" : "property", m.getText(sf).replace(/\/\*\*[\s\S]*?\*\//g, ""), m);
      }
    } else if (ts.isTypeAliasDeclaration(st)) {
      const name = st.name.text;
      const t = tagsOf(st);
      if (ts.isUnionTypeNode(st.type)) {
        add(`${name}`, "type", `type ${name}`, st);
        for (const u of st.type.types) {
          const text = norm(u.getText(sf));
          add(`${name} | ${text}`, "union-member", text, st, t);
        }
      } else add(`${name}`, "type", `type ${name} = ${st.type.getText(sf)}`, st);
    } else if (ts.isModuleDeclaration(st) || ts.isExportDeclaration(st)) {
      // `declare global { const lumen }`: the entry point.
      add(`global ${st.name?.getText(sf) ?? "export"}`, "global", st.getText(sf).replace(/\/\*\*[\s\S]*?\*\//g, ""), st);
    }
  }
  // A member without @since inherits its declaration's; a declaration without one is 1.0.0, the first public API.
  // (A new member that forgets its tag is caught by checkReleases: it is new in a later release but says 1.0.0.)
  const declSince = new Map();
  for (const e of entries) if (e.kind === "interface" || e.kind === "type") declSince.set(e.key, e.since ?? "1.0.0");
  for (const e of entries) {
    if (e.since) continue;
    if (e.kind === "global") e.since = "1.0.0";
    else e.since = declSince.get(e.key.split(/[.]| \| /)[0]) ?? "1.0.0";
  }
  for (const e of entries) if (!/^\d+\.\d+\.\d+$/.test(e.since)) errors.push(`${e.key}: @since ${JSON.stringify(e.since)} is not a version`);
  if (errors.length) throw new Error(`plugin API: ${errors.join("; ")}`);
  if (!entries.some((e) => e.kind === "method")) throw new Error("plugin API: no methods found — wrong file?");
  return entries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

export function readApiVersion(versionTs) {
  const m = /export const PLUGIN_API_VERSION = "(\d+\.\d+\.\d+)"/.exec(versionTs);
  if (!m) throw new Error(`${VERSION_TS}: PLUGIN_API_VERSION not found`);
  return m[1];
}

const sv = (v) => v.split(".").map(Number);
export function cmp(a, b) {
  const pa = sv(a);
  const pb = sv(b);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  return 0;
}

/** What changed between two snapshots' entries. */
export function diffEntries(prev, next) {
  const p = new Map(prev.map((e) => [e.key, e]));
  const n = new Map(next.map((e) => [e.key, e]));
  const added = [...n.keys()].filter((k) => !p.has(k));
  const removed = [...p.keys()].filter((k) => !n.has(k));
  const changed = [...n.keys()].filter((k) => p.has(k) && p.get(k).signature !== n.get(k).signature);
  const deprecated = [...n.keys()].filter((k) => n.get(k).deprecated && !p.get(k)?.deprecated);
  return { added, removed, changed, deprecated };
}

/** The bump a diff needs: "major", "minor" or "patch". */
export function requiredBump(d) {
  if (d.removed.length || d.changed.length) return "major";
  if (d.added.length || d.deprecated.length) return "minor";
  return "patch";
}

function bumpOf(a, b) {
  const [A, B] = [sv(a), sv(b)];
  if (B[0] > A[0]) return "major";
  if (B[0] === A[0] && B[1] > A[1]) return "minor";
  if (B[0] === A[0] && B[1] === A[1] && B[2] > A[2]) return "patch";
  return "none";
}
const RANK = { none: -1, patch: 0, minor: 1, major: 2 };

/**
 * Check a chain of release snapshots (sorted or not): each step's bump, the deprecation window of every removal,
 * and that `since` and `deprecated.since` name real releases. Returns the problems (empty = fine).
 */
export function checkReleases(releases) {
  const list = [...releases].sort((a, b) => cmp(a.apiVersion, b.apiVersion));
  const problems = [];
  const versions = list.map((r) => r.apiVersion);
  for (let i = 0; i < list.length; i++) {
    const cur = list[i];
    for (const e of cur.entries) {
      if (e.since && cmp(e.since, cur.apiVersion) > 0) problems.push(`${cur.apiVersion}: ${e.key} says @since ${e.since}, newer than its release`);
      if (e.deprecated) {
        const d = e.deprecated;
        if (!/^\d+\.\d+\.\d+$/.test(d.since) || !/^\d+\.\d+\.\d+$/.test(d.removeIn) || !d.use) problems.push(`${cur.apiVersion}: ${e.key}: @deprecated needs "<since> <removeIn> <replacement>"`);
        else if (sv(d.removeIn)[0] <= sv(d.since)[0]) problems.push(`${cur.apiVersion}: ${e.key}: removal ${d.removeIn} must be a later major than ${d.since}`);
      }
    }
    if (i === 0) continue;
    const prev = list[i - 1];
    const d = diffEntries(prev.entries, cur.entries);
    const need = requiredBump(d);
    const got = bumpOf(prev.apiVersion, cur.apiVersion);
    if (RANK[got] < RANK[need]) {
      const what = [...d.removed.map((k) => `removed ${k}`), ...d.changed.map((k) => `changed ${k}`), ...d.added.map((k) => `added ${k}`), ...d.deprecated.map((k) => `deprecated ${k}`)].slice(0, 8).join(", ");
      problems.push(`${prev.apiVersion} → ${cur.apiVersion}: needs a ${need} bump (${what}), got ${got}`);
    }
    for (const k of d.added) {
      const e = cur.entries.find((x) => x.key === k);
      if (e.since !== cur.apiVersion && e.kind !== "global" && e.kind !== "union-member") problems.push(`${cur.apiVersion}: ${k} is new here but says @since ${e.since}`);
    }
    for (const k of d.removed) {
      // Two minor versions of warning: the member was deprecated in at least two releases of distinct minors.
      const minors = new Set(list.slice(0, i).filter((r) => r.entries.some((e) => e.key === k && e.deprecated)).map((r) => sv(r.apiVersion).slice(0, 2).join(".")));
      if (minors.size < 2) problems.push(`${cur.apiVersion}: ${k} removed after ${minors.size} deprecated minor version(s); deprecate it for two minor versions first`);
    }
    for (const k of cur.entries.map((e) => e.key)) {
      const a = prev.entries.find((e) => e.key === k);
      const b = cur.entries.find((e) => e.key === k);
      if (a && a.since !== b.since) problems.push(`${cur.apiVersion}: ${k} changed @since ${a.since} → ${b.since}`);
    }
  }
  if (new Set(versions).size !== versions.length) problems.push("two snapshots have the same version");
  return problems;
}

export function renderMarkdown(apiVersion, entries) {
  const lines = [
    "<!-- Generated by scripts/plugin-api-report.mjs from src/plugins/api/lumen-plugin.d.ts. Do not edit; run the script. -->",
    "",
    `# Lumen plugin API report — ${apiVersion}`,
    "",
    "The public surface plugins and themes may rely on. A change here needs the matching `PLUGIN_API_VERSION` bump",
    "(an addition: minor; a removal or a changed signature: major, after two minor versions of `@deprecated`).",
    "",
  ];
  const deprecated = entries.filter((e) => e.deprecated);
  if (deprecated.length) {
    lines.push("## Deprecated", "", "| Member | Deprecated in | Removed in | Use instead |", "| --- | --- | --- | --- |");
    for (const e of deprecated) lines.push(`| \`${e.key}\` | ${e.deprecated.since} | ${e.deprecated.removeIn} | \`${e.deprecated.use}\` |`);
    lines.push("");
  }
  const groups = new Map();
  for (const e of entries) {
    const g = e.kind === "global" ? "(global)" : e.key.split(/[.| ]/)[0];
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(e);
  }
  for (const [g, list] of groups) {
    lines.push(`## ${g}`, "", "| Member | Since | Signature |", "| --- | --- | --- |");
    for (const e of list) {
      const sig = e.signature.replace(/\|/g, "\\|");
      lines.push(`| \`${e.key.replace(/\|/g, "\\|")}\`${e.deprecated ? " (deprecated)" : ""} | ${e.since ?? "—"} | \`${sig}\` |`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

const json = (o) => JSON.stringify(o, null, 2) + "\n";

export function loadReleases(root) {
  const dir = join(root, OUT_DIR, "releases");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^\d+\.\d+\.\d+\.json$/.test(f))
    .map((f) => {
      const r = JSON.parse(readFileSync(join(dir, f), "utf8"));
      if (r.apiVersion !== f.replace(/\.json$/, "")) throw new Error(`${OUT_DIR}/releases/${f}: names ${r.apiVersion}`);
      return r;
    });
}

/** Run the check (or the update) on a tree. Returns { ok, problems, wrote }. */
export function run(root, { check }) {
  const problems = [];
  const apiVersion = readApiVersion(readFileSync(join(root, VERSION_TS), "utf8"));
  const entries = buildEntries(readFileSync(join(root, DTS), "utf8"));
  const current = { apiVersion, entries };
  const releases = loadReleases(root);
  const same = releases.find((r) => r.apiVersion === apiVersion);
  if (same && json(same) !== json(current)) problems.push(`the API changed but PLUGIN_API_VERSION is still ${apiVersion}, which is released (${OUT_DIR}/releases/${apiVersion}.json): bump it in ${VERSION_TS}`);
  const newer = releases.filter((r) => cmp(r.apiVersion, apiVersion) > 0);
  if (newer.length) problems.push(`snapshots newer than PLUGIN_API_VERSION ${apiVersion}: ${newer.map((r) => r.apiVersion).join(", ")}`);
  const chain = [...releases.filter((r) => r.apiVersion !== apiVersion), current];
  problems.push(...checkReleases(chain));
  const md = renderMarkdown(apiVersion, entries);
  const out = join(root, OUT_DIR);
  if (check) {
    if (!same) problems.push(`no snapshot for ${apiVersion}: run node scripts/plugin-api-report.mjs`);
    const reportJson = join(out, "api-report.json");
    const reportMd = join(out, "api-report.md");
    if (!existsSync(reportJson) || readFileSync(reportJson, "utf8") !== json(current)) problems.push(`${OUT_DIR}/api-report.json is out of date: run node scripts/plugin-api-report.mjs`);
    if (!existsSync(reportMd) || readFileSync(reportMd, "utf8") !== md) problems.push(`${OUT_DIR}/api-report.md is out of date: run node scripts/plugin-api-report.mjs`);
    return { ok: problems.length === 0, problems, wrote: [], apiVersion, entries };
  }
  if (problems.length) return { ok: false, problems, wrote: [], apiVersion, entries };
  mkdirSync(join(out, "releases"), { recursive: true });
  writeFileSync(join(out, "api-report.json"), json(current));
  writeFileSync(join(out, "api-report.md"), md);
  writeFileSync(join(out, "releases", `${apiVersion}.json`), json(current));
  return { ok: true, problems, wrote: ["api-report.json", "api-report.md", `releases/${apiVersion}.json`], apiVersion, entries };
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const ri = args.indexOf("--root");
  const root = ri >= 0 ? resolve(args[ri + 1]) : resolve(dirname(fileURLToPath(import.meta.url)), "..");
  let r;
  try {
    r = run(root, { check });
  } catch (e) {
    console.error(`plugin-api-report: ${e.message}`);
    process.exit(1);
  }
  if (!r.ok) {
    for (const p of r.problems) console.error(`plugin-api-report: ${p}`);
    process.exit(1);
  }
  const dep = r.entries.filter((e) => e.deprecated).length;
  console.log(`plugin-api-report: ${check ? "ok" : "wrote " + r.wrote.join(", ")} — API ${r.apiVersion}, ${r.entries.length} entries, ${dep} deprecated`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
