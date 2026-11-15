/**
 * The review every plugin and theme version passes before it is listed
 * (plan W11.S14, research R6.10), with a scorecard per version.
 *
 * On top of the static scan (./scan.ts: eval, Function, dynamic import,
 * obfuscated access, undeclared capabilities and network, signature), it adds:
 *
 *   • closed-source    — the licence is not an open-source SPDX id, or the
 *                        code is shipped minified only (no readable source);
 *   • vulnerable-dependency — a package in the plugin's package-lock.json is
 *                        a known-bad version (security/known-bad.json, the
 *                        same offline list as `npm run audit:lock`);
 *   • permission-added — capabilities this version asks for that the previous
 *                        one did not (a warning: a person approves the change);
 *   • css-remote       — a theme or plugin stylesheet with @import or url()
 *                        to anything but a relative path, a data: URI or an
 *                        origin on the allow-list (no exfiltration by CSS).
 *
 * Policy: a version with any error is not listed; a listed version that
 * fails a later review is delisted within 24 hours (`delistBy`).
 */

import { scanPluginVersion, type ScanFinding, type ScanResult } from "./scan";
import { parseManifest } from "./manifest";

export type ReviewRule = ScanFinding["rule"] | "closed-source" | "vulnerable-dependency" | "permission-added" | "permission-removed" | "css-remote" | "css-syntax" | "rtl-physical-css" | "rtl-contrast";

export interface ReviewFinding {
  rule: ReviewRule;
  severity: "error" | "warning";
  detail: string;
  line?: number;
}

export interface KnownBad {
  name: string;
  range?: string;
  versions?: string[];
  severity: string;
  advisories: string[];
}

export interface ReviewInput {
  manifest: string | unknown;
  main: string;
  ui?: string;
  /** Stylesheets of the version (a theme, or a plugin's CSS), by file name. */
  css?: Record<string, string>;
  /** The readable source, when `main` is a build output. */
  source?: string;
  /** The plugin's package-lock.json, when it has dependencies. */
  lockfile?: string;
  /** The manifest of the version listed before this one. */
  previousManifest?: string | unknown;
  signature?: { signature?: string; signedBy?: string };
  /** Origins a stylesheet may load from (fonts, say), e.g. "https://fonts.gstatic.com". */
  cssAllow?: readonly string[];
  /** security/known-bad.json entries for npm packages, and the range check (scripts/audit-lock.mjs). */
  knownBad?: readonly KnownBad[];
  inRange?: (version: string, range: string) => boolean;
  /** When the review ran (ms); the scorecard's time and the 24-hour delisting deadline. */
  now?: number;
}

export interface Scorecard {
  scorecard: 1;
  id: string;
  version: string;
  passed: boolean;
  score: number;
  grade: "A" | "B" | "C" | "F";
  reviewedAt: string;
  /** A version that fails is removed from the listing by then (24 hours). */
  delistBy: string | null;
  findings: ReviewFinding[];
  permissions: { declared: string[]; added: string[]; removed: string[] };
  scan: Pick<ScanResult, "passed" | "score" | "sha256" | "used">;
  checks: Record<"static" | "license" | "minified" | "dependencies" | "permissions" | "css", "pass" | "fail" | "warn" | "n/a"> & {
    /** A theme's RTL check (W12.S6, src/theme/rtlCheck.ts); absent for plugins. */
    rtl?: "pass" | "warn" | "n/a";
  };
}

/** OSI-approved licences a listed plugin may use (SPDX ids). */
export const OPEN_SOURCE_LICENSES: ReadonlySet<string> = new Set(["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "MPL-2.0", "GPL-2.0-only", "GPL-2.0-or-later", "GPL-3.0-only", "GPL-3.0-or-later", "LGPL-2.1-only", "LGPL-2.1-or-later", "LGPL-3.0-only", "LGPL-3.0-or-later", "AGPL-3.0-only", "AGPL-3.0-or-later", "0BSD", "Unlicense", "Zlib", "EUPL-1.2"]);

/** `MIT OR Apache-2.0` and `(MIT AND Zlib)`: every id must be open source. */
export function isOpenSourceLicense(spdx: string): boolean {
  const ids = spdx.replace(/[()]/g, " ").split(/\s+(?:OR|AND|WITH)\s+|\s+/).filter(Boolean);
  return ids.length > 0 && ids.every((id) => OPEN_SOURCE_LICENSES.has(id) || /-exception(-[0-9.]+)?$/i.test(id));
}

/**
 * Minified only: long lines and next to no whitespace or comments. A build
 * output is fine when its readable source comes with it.
 */
export function looksMinified(code: string): boolean {
  const lines = code.split("\n").filter((l) => l.trim());
  if (!lines.length) return false;
  const long = lines.filter((l) => l.length > 500).length;
  const chars = code.length;
  const spaces = (code.match(/\s/g) ?? []).length;
  return chars > 2000 && (long / lines.length > 0.3 || spaces / chars < 0.08);
}

/** Remote loads in a stylesheet: every @import and url() target that is not relative, data:, or allowed. */
export function cssRemoteLoads(css: string, allow: readonly string[] = []): Array<{ target: string; line: number }> {
  const out: Array<{ target: string; line: number }> = [];
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  const lineAt = (i: number) => noComments.slice(0, i).split("\n").length;
  const check = (raw: string, at: number) => {
    // CSS escapes (\75 rl, \3a) can hide a scheme: decode them first.
    const target = raw.trim().replace(/^['"]|['"]$/g, "").replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/\\(.)/g, "$1").trim();
    if (/^data:/i.test(target)) return;
    const remote = /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//");
    if (!remote) return;
    let origin = "";
    try {
      origin = new URL(target.startsWith("//") ? `https:${target}` : target).origin;
    } catch {
      /* not a URL: refused below */
    }
    if (!allow.includes(origin)) out.push({ target, line: lineAt(at) });
  };
  const unescaped = noComments.replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));
  for (const m of unescaped.matchAll(/url\(\s*((?:"[^"]*"|'[^']*'|[^)]*))\s*\)/gi)) check(m[1], m.index ?? 0);
  for (const m of unescaped.matchAll(/@import\s+(?!url\()("[^"]*"|'[^']*'|[^\s;]+)/gi)) check(m[1], m.index ?? 0);
  // image-set("…") and src() take strings too.
  for (const m of unescaped.matchAll(/(?:image-set|src)\(\s*("[^"]*"|'[^']*')/gi)) check(m[1], m.index ?? 0);
  return out;
}

function lockPackages(lock: string): Array<{ name: string; version: string }> {
  const j = JSON.parse(lock) as { packages?: Record<string, { version?: string }>; dependencies?: Record<string, { version?: string }> };
  const out: Array<{ name: string; version: string }> = [];
  for (const [path, p] of Object.entries(j.packages ?? {})) {
    if (!path || !p.version) continue;
    out.push({ name: path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length), version: p.version });
  }
  for (const [name, p] of Object.entries(j.dependencies ?? {})) if (p.version) out.push({ name, version: p.version });
  return out;
}

const capsOf = (m: unknown): string[] => {
  try {
    return parseManifest(m).capabilities.map((c) => c.id).sort();
  } catch {
    return [];
  }
};

export async function reviewPluginVersion(input: ReviewInput): Promise<Scorecard> {
  const now = input.now ?? Date.now();
  const scan = await scanPluginVersion({ manifest: input.manifest, main: input.main, ...(input.ui !== undefined ? { ui: input.ui } : {}), ...(input.signature ? { signature: input.signature } : {}) });
  const findings: ReviewFinding[] = scan.findings.map((f) => ({ ...f }));
  const checks: Scorecard["checks"] = { static: scan.passed ? "pass" : "fail", license: "n/a", minified: "pass", dependencies: "n/a", permissions: "n/a", css: "n/a" };

  let license = "";
  try {
    license = parseManifest(input.manifest).license;
  } catch {
    /* the scan already reports the manifest */
  }
  if (license) {
    const open = isOpenSourceLicense(license);
    checks.license = open ? "pass" : "fail";
    if (!open) findings.push({ rule: "closed-source", severity: "error", detail: `licence ${JSON.stringify(license)} is not an open-source SPDX id` });
  }
  for (const [file, code] of [["main", input.main], ...(input.ui !== undefined ? [["ui", input.ui]] : [])] as const) {
    if (looksMinified(code) && !input.source) {
      checks.minified = "fail";
      findings.push({ rule: "closed-source", severity: "error", detail: `${file}: minified only, with no readable source` });
    }
  }

  if (input.lockfile !== undefined) {
    checks.dependencies = "pass";
    let pkgs: Array<{ name: string; version: string }> = [];
    try {
      pkgs = lockPackages(input.lockfile);
    } catch {
      checks.dependencies = "fail";
      findings.push({ rule: "vulnerable-dependency", severity: "error", detail: "package-lock.json is not valid JSON" });
    }
    for (const p of pkgs) {
      for (const bad of input.knownBad ?? []) {
        if (bad.name !== p.name) continue;
        const hit = bad.versions?.includes(p.version) || (bad.range && input.inRange?.(p.version, bad.range));
        if (!hit) continue;
        const serious = bad.severity === "critical" || bad.severity === "high";
        if (serious) checks.dependencies = "fail";
        else if (checks.dependencies === "pass") checks.dependencies = "warn";
        findings.push({ rule: "vulnerable-dependency", severity: serious ? "error" : "warning", detail: `${p.name}@${p.version} (${bad.severity}: ${bad.advisories.join(", ")})` });
      }
    }
  }

  const declared = capsOf(input.manifest);
  let added: string[] = [];
  let removed: string[] = [];
  if (input.previousManifest !== undefined) {
    const before = new Set(capsOf(input.previousManifest));
    added = declared.filter((c) => !before.has(c));
    removed = [...before].filter((c) => !declared.includes(c));
    checks.permissions = added.length ? "warn" : "pass";
    for (const c of added) findings.push({ rule: "permission-added", severity: "warning", detail: `${c}: new in this version (a person approves the change before it is listed)` });
    for (const c of removed) findings.push({ rule: "permission-removed", severity: "warning", detail: c });
  }

  if (input.css && Object.keys(input.css).length) {
    checks.css = "pass";
    for (const [file, text] of Object.entries(input.css)) {
      for (const r of cssRemoteLoads(text, input.cssAllow ?? [])) {
        checks.css = "fail";
        findings.push({ rule: "css-remote", severity: "error", detail: `${file}: loads ${r.target}`, line: r.line });
      }
    }
  }

  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;
  const passed = errors === 0;
  const score = passed ? Math.max(0, Math.min(scan.score, 100 - 5 * warnings)) : 0;
  const grade = !passed ? "F" : score >= 90 ? "A" : score >= 75 ? "B" : "C";
  return {
    scorecard: 1,
    id: scan.id,
    version: scan.version,
    passed,
    score,
    grade,
    reviewedAt: new Date(now).toISOString(),
    delistBy: passed ? null : new Date(now + 24 * 3600_000).toISOString(),
    findings,
    permissions: { declared, added, removed },
    scan: { passed: scan.passed, score: scan.score, sha256: scan.sha256, used: scan.used },
    checks,
  };
}
