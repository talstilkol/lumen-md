/**
 * Pure logic of the licence gate (scripts/licenses.mjs): SPDX
 * classification, the production dependency walk over package-lock.json,
 * the model registry check, the eval-dataset check and the allowlist.
 * Everything that touches the disk is passed in, so the rules are tested
 * with fixtures (src/__tests__/licenses.test.ts).
 *
 * Levels, from best to worst: ok < notice < warn < fail. Any `fail`
 * makes the gate exit 1.
 */

export const LEVELS = ["ok", "notice", "warn", "fail"];
const RANK = { ok: 0, notice: 1, warn: 2, fail: 3 };
export const worst = (a, b) => (RANK[a] >= RANK[b] ? a : b);
export const best = (a, b) => (RANK[a] <= RANK[b] ? a : b);

// ── SPDX licences ──────────────────────────────────────────────────────

/** Permissive (or file-level copyleft that is fine to ship unmodified). */
const OK_IDS = new Set(
  [
    "MIT", "MIT-0", "ISC", "0BSD", "BSD-2-Clause", "BSD-3-Clause", "BSD-3-Clause-Clear", "Apache-2.0", "Apache-1.1",
    "Unlicense", "CC0-1.0", "CC-BY-3.0", "CC-BY-4.0", "BlueOak-1.0.0", "Zlib", "Python-2.0", "PSF-2.0", "OFL-1.1",
    // SPDX BSL-1.0 is the *Boost* Software License (permissive), not the Business Source License (BUSL-1.1).
    "BSL-1.0",
    "WTFPL", "MPL-1.1", "MPL-2.0", "EPL-1.0", "EPL-2.0", "CDDL-1.0", "CDDL-1.1", "Artistic-2.0", "X11", "W3C", "Ruby",
    "Unicode-DFS-2016", "Unicode-3.0", "AFL-2.1", "AFL-3.0", "Public Domain",
  ].map((s) => s.toLowerCase()),
);

/** Exceptions that turn a GPL into something an app may link against. */
const LINKING_EXCEPTIONS = /^(Classpath-exception-2\.0|GCC-exception-\d|LLVM-exception|Autoconf-exception|Bison-exception|Font-exception-2\.0|Universal-FOSS-exception)/i;

/** Common non-SPDX spellings seen in package.json files. */
const ALIASES = {
  "apache 2.0": "Apache-2.0",
  "apache-2": "Apache-2.0",
  "apache license 2.0": "Apache-2.0",
  "apache license, version 2.0": "Apache-2.0",
  "apache2": "Apache-2.0",
  "mit license": "MIT",
  "the mit license": "MIT",
  "bsd-3": "BSD-3-Clause",
  "new bsd": "BSD-3-Clause",
  "public domain": "Public Domain",
};

/** One licence id (with an optional WITH exception) → level + reason. */
export function classifyId(rawId, exception) {
  const id = ALIASES[rawId.toLowerCase()] ?? rawId;
  const lower = id.toLowerCase();
  if (/commons[\s-]*clause/i.test(id) || /commons[\s-]*clause/i.test(exception ?? "")) return { level: "fail", reason: "Commons Clause (no selling)" };
  if (/^lgpl/i.test(id)) return { level: "warn", reason: "weak copyleft (LGPL): must stay a separate, replaceable library" };
  if (/^a?gpl/i.test(id)) {
    if (exception && LINKING_EXCEPTIONS.test(exception)) return { level: "warn", reason: `GPL with a linking exception (${exception})` };
    return { level: "fail", reason: /^agpl/i.test(id) ? "strong network copyleft (AGPL)" : "strong copyleft (GPL)" };
  }
  if (/^sspl/i.test(id)) return { level: "fail", reason: "SSPL (not open source; service copyleft)" };
  if (/^busl/i.test(id) || /^bsl$/i.test(id) || /^bsl-1\.1$/i.test(id) || /business source/i.test(id)) return { level: "fail", reason: "Business Source License (no production use)" };
  if (/^elastic/i.test(id) || /^elv2$/i.test(id)) return { level: "fail", reason: "Elastic License (no managed service; not open source)" };
  if (/^cc-by-nc/i.test(id)) return { level: "fail", reason: "Creative Commons NonCommercial" };
  if (/^polyform-(noncommercial|strict)/i.test(id)) return { level: "fail", reason: "PolyForm non-commercial licence" };
  if (/^(cpal|eupl|osl|cc-by-sa|cc-by-nd|polyform)/i.test(id)) return { level: "warn", reason: "copyleft / restricted licence: needs a decision" };
  if (OK_IDS.has(lower)) return { level: "ok", reason: "" };
  return { level: "warn", reason: `unrecognised licence id "${id}"` };
}

/** Tokens of an SPDX expression: ids, parentheses, AND / OR / WITH. */
export function tokenize(expr) {
  return expr
    .replace(/[()]/g, (p) => ` ${p} `)
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => (/^(and|or|with)$/i.test(t) ? t.toUpperCase() : t));
}

/** SPDX expression → tree. WITH binds tightest, then AND, then OR. Throws on malformed input. */
export function parseSpdx(expr) {
  const tokens = tokenize(expr);
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  function primary() {
    const t = next();
    if (t === undefined) throw new Error("unexpected end");
    if (t === "(") {
      const node = or();
      if (next() !== ")") throw new Error("missing )");
      return node;
    }
    if (t === ")" || t === "AND" || t === "OR" || t === "WITH") throw new Error(`unexpected ${t}`);
    const node = { type: "id", id: t.replace(/\+$/, "-or-later") };
    if (peek() === "WITH") {
      next();
      const ex = next();
      if (!ex || ex === "(" || ex === ")") throw new Error("missing exception");
      node.exception = ex;
    }
    return node;
  }
  function and() {
    let left = primary();
    while (peek() === "AND") {
      next();
      left = { type: "and", left, right: primary() };
    }
    return left;
  }
  function or() {
    let left = and();
    while (peek() === "OR") {
      next();
      left = { type: "or", left, right: and() };
    }
    return left;
  }
  const tree = or();
  if (i !== tokens.length) throw new Error(`unexpected ${tokens[i]}`);
  return tree;
}

function evalTree(node) {
  if (node.type === "id") {
    const r = classifyId(node.id, node.exception);
    return { ...r, chosen: node.exception ? `${node.id} WITH ${node.exception}` : node.id };
  }
  const l = evalTree(node.left);
  const r = evalTree(node.right);
  if (node.type === "or") return RANK[l.level] <= RANK[r.level] ? l : r; // the licensee picks the better option
  const level = worst(l.level, r.level); // AND: both apply
  return { level, reason: [l.reason, r.reason].filter(Boolean).join("; "), chosen: `${l.chosen} AND ${r.chosen}` };
}

/**
 * A package.json `license` (SPDX string), or the legacy `licenses` array /
 * `{ type }` object, → { level, reason, license }.
 */
export function classifyLicense(raw) {
  if (Array.isArray(raw)) {
    // Legacy `licenses: [{ type }, …]` lists alternatives: the best one applies.
    const parts = raw.map((x) => (typeof x === "string" ? x : x?.type)).filter(Boolean);
    if (!parts.length) return classifyLicense(undefined);
    const results = parts.map((p) => classifyLicense(p));
    const pick = results.reduce((a, b) => (RANK[b.level] < RANK[a.level] ? b : a));
    return { ...pick, license: parts.join(" OR ") };
  }
  if (raw && typeof raw === "object") return classifyLicense(raw.type);
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return { level: "fail", reason: "no licence declared", license: "(missing)" };
  if (/^unlicensed$/i.test(text)) return { level: "fail", reason: "UNLICENSED (proprietary, no grant)", license: text };
  if (/^see licen[cs]e in/i.test(text)) return { level: "warn", reason: "custom licence file: read it and decide", license: text };
  if (/commons[\s-]*clause/i.test(text)) return { level: "fail", reason: "Commons Clause (no selling)", license: text };
  try {
    const r = evalTree(parseSpdx(text));
    const reason = r.chosen !== text && /\bOR\b/.test(text) && r.level === "ok" ? `dual-licensed, using ${r.chosen}` : r.reason;
    return { level: r.level, reason, license: text };
  } catch {
    const r = classifyId(text);
    return { level: r.level, reason: r.reason, license: text };
  }
}

/** The licence a LICENSE file's first lines name, when it is an obvious one. */
export function sniffLicenseText(text) {
  const head = (text ?? "").slice(0, 600);
  if (/\bMIT License\b|Permission is hereby granted, free of charge/i.test(head)) return "MIT";
  if (/ISC License|Permission to use, copy, modify, and\/or distribute/i.test(head)) return "ISC";
  if (/Apache License,?\s+Version 2\.0/i.test(head)) return "Apache-2.0";
  if (/GNU AFFERO GENERAL PUBLIC LICENSE/i.test(head)) return "AGPL-3.0";
  if (/GNU LESSER GENERAL PUBLIC LICENSE/i.test(head)) return "LGPL-3.0";
  if (/GNU GENERAL PUBLIC LICENSE/i.test(head)) return "GPL-3.0";
  if (/Redistribution and use in source and binary forms/i.test(head)) return "BSD-3-Clause";
  return null;
}

// ── npm: the production dependency tree from package-lock.json ─────────

/**
 * Packages whose declared licence hides copyleft (or that are banned for
 * another reason). Present in production dependencies → that level.
 */
export const HIDDEN_COPYLEFT = [
  { name: "phonemizer", level: "fail", reason: "bundles eSpeak NG (GPL-3.0)" },
  { name: "@mintplex-labs/piper-tts-web", level: "fail", reason: "Piper with the eSpeak NG phonemizer (GPL-3.0)" },
  { name: "@diffusionstudio/vits-web", level: "fail", reason: "VITS/Piper with the eSpeak NG phonemizer (GPL-3.0)" },
  { name: "dictionary-he", level: "fail", reason: "Hspell word list (AGPL-3.0)" },
  { name: "hyperformula", level: "fail", reason: "GPL-3.0 unless a commercial licence key is bought" },
  { name: "expr-eval", level: "fail", reason: "CVE-2025-12735 (code injection), unmaintained" },
  { name: "@hebcal/core", level: "fail", reason: "GPL licence" },
  { name: "@hebcal/hdate", level: "fail", reason: "GPL licence" },
  { name: "citeproc", level: "warn", reason: "CPAL-1.0 / AGPL dual licence: needs a decision" },
  {
    name: "webr",
    level: "fail",
    reason: "declares 'SEE LICENSE IN'; its LICENSE.md says the webR binaries (R, libgfortran) are distributed under GPL-3.0, and scripts/copy-webr.mjs ships them in public/webr/",
  },
];

const nameFromPath = (p) => p.slice(p.lastIndexOf("node_modules/") + "node_modules/".length);

/** Node's lookup: `name` as seen from the package at `from` ("" = the root). */
export function resolveDep(packages, from, name) {
  let base = from;
  for (;;) {
    const cand = `${base ? base + "/" : ""}node_modules/${name}`;
    if (packages[cand]) return cand;
    if (!base) return null;
    const i = base.lastIndexOf("/node_modules/");
    base = i < 0 ? "" : base.slice(0, i);
  }
}

function runtimeDeps(entry) {
  const peersOptional = entry.peerDependenciesMeta ?? {};
  const peers = Object.keys(entry.peerDependencies ?? {}).filter((n) => !peersOptional[n]?.optional);
  return [
    ...Object.keys(entry.dependencies ?? {}).map((n) => ({ name: n, optional: false })),
    ...Object.keys(entry.optionalDependencies ?? {}).map((n) => ({ name: n, optional: true })),
    ...peers.map((n) => ({ name: n, optional: true })),
  ];
}

/**
 * Every package reachable from the root's dependencies / optionalDependencies
 * (never devDependencies) in a lockfile v2/v3 → [{ path, name, version,
 * license, via, optional }], breadth-first, so `via` is the direct dependency
 * on the shortest path. `unresolved` lists required deps the lock lacks.
 */
export function walkProduction(lock) {
  const packages = lock?.packages;
  if (!packages || !packages[""]) throw new Error("package-lock.json has no `packages` map (lockfileVersion 2+ needed)");
  const seen = new Map();
  const unresolved = [];
  const queue = [];
  for (const d of runtimeDeps(packages[""])) queue.push({ from: "", name: d.name, optional: d.optional, via: d.name });
  while (queue.length) {
    const { from, name, optional, via } = queue.shift();
    let path = resolveDep(packages, from, name);
    if (!path) {
      if (!optional) unresolved.push(`${name} (from ${from || "root"})`);
      continue;
    }
    if (seen.has(path)) continue;
    let entry = packages[path];
    let depsFrom = path;
    if (entry.link && entry.resolved && packages[entry.resolved]) {
      depsFrom = entry.resolved;
      entry = packages[entry.resolved];
    }
    seen.set(path, {
      path,
      name: entry.name ?? nameFromPath(path),
      version: entry.version ?? "",
      license: entry.license,
      via,
      optional: Boolean(entry.optional || optional),
    });
    for (const d of runtimeDeps(entry)) queue.push({ from: depsFrom, name: d.name, optional: d.optional, via });
  }
  return { packages: [...seen.values()], unresolved };
}

const nameMatches = (pattern, name) => (pattern.endsWith("*") ? name.startsWith(pattern.slice(0, -1)) : pattern === name);

/**
 * Classify every production package. `readPackage(path)` may return the
 * installed package.json (for a licence the lock does not carry) and
 * `readLicenseFile(path)` the text of its LICENSE file; both are optional.
 */
export function checkNpm(lock, { readPackage, readLicenseFile, hidden = HIDDEN_COPYLEFT } = {}) {
  const { packages, unresolved } = walkProduction(lock);
  const byKey = new Map();
  for (const p of packages) {
    let raw = p.license;
    let source = "lock";
    if (raw === undefined || raw === null || raw === "") {
      const pkg = readPackage?.(p.path);
      if (pkg && (pkg.license || pkg.licenses)) {
        raw = pkg.license ?? pkg.licenses;
        source = "package.json";
      } else {
        const sniffed = sniffLicenseText(readLicenseFile?.(p.path));
        if (sniffed) {
          raw = sniffed;
          source = "LICENSE file";
        }
      }
    }
    const c = classifyLicense(raw);
    let { level, reason } = c;
    const h = hidden.find((x) => nameMatches(x.name, p.name));
    if (h) {
      level = worst(level, h.level);
      reason = [reason, `known hidden copyleft / banned: ${h.reason}`].filter(Boolean).join("; ");
    }
    if (source !== "lock" && level === "ok") reason = `licence read from ${source}`;
    const key = `${p.name}@${p.version}`;
    const prev = byKey.get(key);
    if (prev) {
      prev.paths.push(p.path);
      continue;
    }
    byKey.set(key, { area: "npm", name: p.name, version: p.version, license: c.license, level, reason, via: p.via, optional: p.optional, paths: [p.path] });
  }
  const findings = [...byKey.values()];
  for (const u of unresolved) findings.push({ area: "npm", name: u, version: "", license: "", level: "warn", reason: "required dependency missing from package-lock.json", via: "", optional: false, paths: [] });
  return findings;
}

// ── Models: models/registry.json ───────────────────────────────────────

export const MODEL_KINDS = ["llm", "asr", "tts", "embedding", "reranker", "ocr", "nikud", "mt", "vision", "other"];
export const MODEL_CLASSES = ["allowed", "conditional", "forbidden", "unknown"];
export const MODEL_RUNS = ["browser", "ollama", "desktop"];
const COMMERCIAL_FOR = { allowed: ["yes"], conditional: ["conditional"], forbidden: ["no"], unknown: ["yes", "conditional", "no", "unknown"] };
const REQUIRED = ["id", "kind", "source", "license", "class", "commercial", "attribution", "size", "runs", "notes"];

/** Problems with one registry entry (empty when it is well-formed). */
export function validateEntry(e) {
  const problems = [];
  for (const f of REQUIRED) if (typeof e?.[f] !== "string") problems.push(`missing ${f}`);
  if (problems.length) return problems;
  if (!MODEL_KINDS.includes(e.kind)) problems.push(`kind "${e.kind}" is not one of ${MODEL_KINDS.join("|")}`);
  if (!MODEL_CLASSES.includes(e.class)) problems.push(`class "${e.class}" is not one of ${MODEL_CLASSES.join("|")}`);
  if (!MODEL_RUNS.includes(e.runs)) problems.push(`runs "${e.runs}" is not one of ${MODEL_RUNS.join("|")}`);
  if (MODEL_CLASSES.includes(e.class) && !COMMERCIAL_FOR[e.class].includes(e.commercial)) problems.push(`commercial "${e.commercial}" contradicts class "${e.class}"`);
  if (!/^https:\/\//.test(e.source)) problems.push("source must be an https URL");
  if (!e.license.trim()) problems.push("empty license");
  if ((e.class === "allowed" || e.class === "conditional") && !e.attribution.trim()) problems.push("allowed/conditional models need attribution text");
  if (e.match !== undefined && !(Array.isArray(e.match) && e.match.every((m) => typeof m === "string" && m.length >= 3))) problems.push("match must be an array of strings (3+ chars)");
  return problems;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A model token inside source text: not glued to more letters/digits on either side. */
export const tokenRegex = (token) => new RegExp(`(?<![A-Za-z0-9])${escapeRe(token)}(?![A-Za-z0-9])`, "i");

/** Where any of the entry's tokens (its id and `match`) occurs → [{ file, line }]. */
export function findReferences(entry, sources) {
  const res = [entry.id, ...(entry.match ?? [])].map(tokenRegex);
  const refs = [];
  for (const { file, text } of sources) {
    const lines = text.split("\n");
    lines.forEach((l, i) => {
      if (res.some((r) => r.test(l))) refs.push({ file, line: i + 1 });
    });
  }
  return refs;
}

/**
 * Model ids declared in the app's catalogs. A catalog id that no registry
 * entry covers warns, so a new model cannot slip in unclassified.
 */
export const CATALOG_PATTERNS = [
  { file: "src/ai/modelManager.ts", re: /\bbase:\s*"([^"]+)"/g },
  { file: "src/ai/modelCatalog.ts", re: /\{\s*name:\s*"([^"]+)"/g },
  { file: "src/ai/transformersEngine.ts", re: /"([A-Za-z][\w-]*\/[\w.-]+)"/g },
  { file: "src/agents/executors/webllm.ts", re: /"([A-Za-z0-9.-]+?)-q4f(?:16|32)_1-MLC"/g },
  { file: "src/agents/executors/ollama.ts", re: /RECOMMENDED_[A-Z_]*MODEL\s*=\s*"([^"]+)"/g },
  { file: "src/agents/doctor.ts", re: /RECOMMENDED_[A-Z_]*MODEL\s*=\s*"([^"]+)"/g },
];

export function discoverCatalogIds(sources, patterns = CATALOG_PATTERNS) {
  const found = [];
  for (const p of patterns) {
    const src = sources.find((s) => s.file === p.file);
    if (!src) continue;
    for (const m of src.text.matchAll(p.re)) found.push({ id: m[1], file: p.file });
  }
  return found;
}

/** Check the registry against the app's source files → findings, one per entry (plus problems). */
export function checkModels(registry, sources) {
  const findings = [];
  const entries = Array.isArray(registry?.models) ? registry.models : null;
  if (!entries) return [{ area: "model", name: "models/registry.json", license: "", level: "fail", reason: "no `models` array", refs: [] }];
  const ids = new Set();
  for (const e of entries) {
    const problems = validateEntry(e);
    if (e?.id && ids.has(e.id)) problems.push("duplicate id");
    if (e?.id) ids.add(e.id);
    if (problems.length) {
      findings.push({ area: "model", name: e?.id ?? "(no id)", license: e?.license ?? "", class: e?.class, level: "fail", reason: `registry entry invalid: ${problems.join("; ")}`, refs: [] });
      continue;
    }
    const refs = findReferences(e, sources);
    let level = "ok";
    let reason = refs.length ? "" : "not referenced by app code";
    if (e.class === "forbidden") {
      if (refs.length) {
        level = "fail";
        reason = "forbidden model referenced by app code";
      }
    } else if (e.class === "unknown") {
      level = "warn";
      reason = `licence not established${refs.length ? "" : " (not referenced by app code)"}`;
    } else if (e.class === "conditional" && refs.length) {
      level = "notice";
      reason = "needs its licence notice in the UI; must not be a default";
    }
    if (e.verified === false && e.class !== "forbidden" && refs.length) {
      level = worst(level, "notice");
      reason = [reason, "classified from the model card, not from verified research"].filter(Boolean).join("; ");
    }
    findings.push({ area: "model", name: e.id, license: e.license, class: e.class, kind: e.kind, runs: e.runs, level, reason, refs });
  }
  const valid = entries.filter((e) => validateEntry(e).length === 0);
  for (const { id, file } of discoverCatalogIds(sources)) {
    const covered = valid.some((e) => [e.id, ...(e.match ?? [])].some((t) => tokenRegex(t).test(id)));
    if (!covered) findings.push({ area: "model", name: id, license: "", class: "unknown", level: "warn", reason: `in an app catalog (${file}) but not in models/registry.json`, refs: [{ file, line: 0 }] });
  }
  return findings;
}

// ── Datasets: eval/golden/<set>/ ───────────────────────────────────────

/**
 * Each eval/golden/<set>/ folder must say where its data comes from
 * (SOURCES.md) and under which licence (LICENSE, LICENSE.md or LICENSE.txt).
 * `dirs` = [{ name, files: [...] }].
 */
export function checkDatasets(dirs) {
  return dirs.map(({ name, files }) => {
    const missing = [];
    if (!files.includes("SOURCES.md")) missing.push("SOURCES.md");
    if (!files.some((f) => /^LICEN[CS]E(\.md|\.txt)?$/.test(f))) missing.push("LICENSE");
    return { area: "dataset", name: `eval/golden/${name}`, license: "", level: missing.length ? "fail" : "ok", reason: missing.length ? `missing ${missing.join(" and ")}` : "" };
  });
}

// ── Allowlist: licenses.allow.json ─────────────────────────────────────

/**
 * Documented exceptions. Each { area, name (trailing * = prefix), level
 * (the most it may report: warn | notice | ok; default warn), reason,
 * until? (YYYY-MM-DD) }. A matching finding is capped at that level and
 * carries the reason. Problems with the allowlist itself are findings too.
 */
export function applyAllowlist(findings, allow, today = new Date().toISOString().slice(0, 10)) {
  const extra = [];
  const exceptions = Array.isArray(allow?.exceptions) ? allow.exceptions : [];
  for (const ex of exceptions) {
    const label = `${ex?.area ?? "?"}:${ex?.name ?? "?"}`;
    if (!ex || !["npm", "model", "dataset"].includes(ex.area) || typeof ex.name !== "string" || !ex.name) {
      extra.push({ area: "allowlist", name: label, license: "", level: "fail", reason: "exception needs area (npm|model|dataset) and name" });
      continue;
    }
    if (typeof ex.reason !== "string" || ex.reason.trim().length < 10) {
      extra.push({ area: "allowlist", name: label, license: "", level: "fail", reason: "exception without a documented reason" });
      continue;
    }
    const cap = ex.level ?? "warn";
    if (!["warn", "notice", "ok"].includes(cap)) {
      extra.push({ area: "allowlist", name: label, license: "", level: "fail", reason: `level "${cap}" must be warn, notice or ok` });
      continue;
    }
    if (ex.until && ex.until < today) {
      extra.push({ area: "allowlist", name: label, license: "", level: "warn", reason: `exception expired on ${ex.until}; not applied` });
      continue;
    }
    const hits = findings.filter((f) => f.area === ex.area && nameMatches(ex.name, f.name));
    if (!hits.length) {
      extra.push({ area: "allowlist", name: label, license: "", level: "warn", reason: "exception matches nothing: remove it" });
      continue;
    }
    for (const f of hits) {
      f.allowed = ex.reason + (ex.decision ? ` (decision ${ex.decision})` : "");
      f.level = best(f.level, cap);
    }
  }
  return [...findings, ...extra];
}

export function summarize(findings) {
  const counts = { fail: 0, warn: 0, notice: 0, ok: 0 };
  for (const f of findings) counts[f.level]++;
  return counts;
}

/** Plain-text table (no colours) of the rows given. */
export function formatTable(rows, columns) {
  const widths = columns.map((c) => Math.max(c.label.length, ...rows.map((r) => String(r[c.key] ?? "").length)));
  const cap = (s, w) => (s.length > w ? s.slice(0, w - 1) + "…" : s);
  const maxW = columns.map((c, i) => Math.min(widths[i], c.max ?? 80));
  const line = (vals) => vals.map((v, i) => cap(String(v ?? ""), maxW[i]).padEnd(maxW[i])).join("  ").trimEnd();
  return [line(columns.map((c) => c.label)), line(maxW.map((w) => "-".repeat(w))), ...rows.map((r) => line(columns.map((c) => r[c.key])))].join("\n");
}
