/**
 * The review every plugin and theme version goes through before it is
 * listed (plan W11.S14, research R6 §1.4: the bar Obsidian set in 2026 is an
 * automated review of every version, a public scorecard and declared
 * permissions). It adds to the static scan of W1.20 (./scan.ts: syntax,
 * eval and Function, dynamic import, obfuscated property access, undeclared
 * capabilities and network origins, size, signature):
 *
 *   - obfuscation: string-array decoders (`_0x…` names), dense hex/unicode
 *     escapes, and a bundle that is minified only (very long lines, no
 *     readable source next to it);
 *   - closed source: a version needs a public source repository (https),
 *     unless it lives in this repository;
 *   - permissions against the previous version: every capability added or
 *     removed is listed, an added one is a finding the reviewer sees;
 *   - CSS (a theme, or a plugin's styles): no `@import`, and no `url()` to
 *     another origin unless that origin is on the allowlist; `data:` fonts
 *     and images are fine;
 *   - the lockfile audit: `npm audit` needs the network, so a version with a
 *     lockfile is marked "audit owed" until the audit ran (never "passed").
 *
 * Ported from #714 (the other W11.S14 implementation, W10 port onto train 6),
 * the checks this design lacked:
 *   - licence: the manifest's `license` must be an open-source SPDX id (or an
 *     expression of them, ./spdx.ts); anything else, or none, is closed source;
 *   - known-bad dependencies, offline: every package in the version's
 *     package-lock.json against security/known-bad.json (the list
 *     `npm run audit:lock` uses); high or critical fails the version, lower is
 *     a warning. `npm audit` is still owed: the list is not an audit;
 *   - minified-only also when the bundle has many long lines or next to no
 *     whitespace, not only one very long line;
 *   - CSS: escapes are decoded first (`u\72l(`, `@\69mport`), and
 *     `image-set("…")` / `src("…")` strings are remote loads too.
 *
 * The result is a scorecard (JSON) per version. A version that fails is not
 * listed, and one listed whose review failed must be taken down within 24
 * hours (`overdueTakedowns`).
 */

import { parseManifest, type CapabilityRequest } from "./manifest";
import { scanPluginVersion, type ScanFinding, type ScanInput, type ScanResult } from "./scan";
import { cssLoads, remoteTarget } from "./cssUrls";
import { isOpenSourceLicense } from "./spdx";

export { OPEN_SOURCE_LICENSES, OPEN_SOURCE_EXCEPTIONS, isOpenSourceLicense } from "./spdx";

export const REVIEWER = "lumen-review/1";
/** A failing version that is still listed after this long is overdue. Never lengthen it. */
export const TAKEDOWN_MS = 24 * 60 * 60 * 1000;
/** Origins a stylesheet may load from (none by default: fonts and images go in as data: or relative files). */
export const CSS_ALLOWED_ORIGINS: readonly string[] = [];

export type ReviewRule = "obfuscated" | "minified-only" | "closed-source" | "new-permission" | "css-import" | "css-remote-url" | "audit-owed" | "vulnerable-dependency" | "rtl-physical-css" | "rtl-contrast";
export const REVIEW_ERRORS: ReadonlySet<ReviewRule> = new Set<ReviewRule>(["obfuscated", "minified-only", "closed-source", "css-import", "css-remote-url"]);

/** One security/known-bad.json entry for npm (`file` ends in package-lock.json). */
export interface KnownBad {
  name: string;
  range?: string;
  versions?: string[];
  severity: string;
  advisories: string[];
}

export interface ReviewFinding {
  rule: ReviewRule | ScanFinding["rule"];
  severity: "error" | "warning";
  detail: string;
  line?: number;
}

export interface ReviewInput extends ScanInput {
  /** A theme's stylesheet, or a plugin's styles. */
  css?: string;
  /** Readable source shipped next to a minified bundle (e.g. src/main.ts), if any. */
  source?: string;
  /** The version lives in this repository (first-party examples): its source is public by definition. */
  inRepo?: boolean;
  /** The manifest of the version before this one, to diff the permissions. */
  previousManifest?: string | unknown;
  /** The version ships a lockfile (package-lock.json / pnpm-lock.yaml). */
  hasLockfile?: boolean;
  /** The text of the version's package-lock.json, checked against `knownBad` (implies hasLockfile). */
  lockfile?: string;
  /** security/known-bad.json's npm entries, and its range check (scripts/audit-lock.mjs `inRange`). */
  knownBad?: readonly KnownBad[];
  inRange?: (version: string, range: string) => boolean;
  /** The time of the review (ms); tests pass it. */
  now?: number;
}

export interface Scorecard {
  kind: "lumen-plugin-scorecard";
  v: 1;
  reviewer: typeof REVIEWER;
  id: string;
  version: string;
  reviewedAt: string;
  passed: boolean;
  /** 0–100, 0 when not passed. */
  score: number;
  grade: ScanResult["grade"];
  sha256: string;
  source: { repository: string | null; inRepo: boolean };
  permissions: { declared: string[]; added: string[]; removed: string[] };
  /** "owed" until `npm audit` ran on the lockfile; "none" without a lockfile. */
  audit: "none" | "owed";
  findings: ReviewFinding[];
  /** How long the review took here (ms). */
  durationMs: number;
}

/** What one review warning costs: what a scan warning costs (10 points). */
export const REVIEW_WARNING_COST = 10;
const gradeOf = (passed: boolean, score: number): Scorecard["grade"] => (!passed ? "F" : score >= 90 ? "A" : score >= 75 ? "B" : "C");

const capIds = (caps: readonly CapabilityRequest[]): string[] => [...new Set(caps.map((c): string => c.id))].sort();

/** Obfuscation the AST scan does not see: string-array decoders and walls of escapes. */
export function obfuscationFindings(code: string, file: string): ReviewFinding[] {
  const out: ReviewFinding[] = [];
  const hexNames = code.match(/\b_0x[0-9a-f]{3,}\b/gi) ?? [];
  if (new Set(hexNames).size >= 3) out.push({ rule: "obfuscated", severity: "error", detail: `${file}: ${new Set(hexNames).size} _0x… names (a string-array decoder)` });
  const escapes = (code.match(/\\x[0-9a-f]{2}|\\u[0-9a-f]{4}/gi) ?? []).length;
  if (escapes >= 40 && escapes / Math.max(1, code.length) > 0.02) out.push({ rule: "obfuscated", severity: "error", detail: `${file}: ${escapes} hex/unicode escapes` });
  if (/\b(?:atob|String\.fromCharCode)\s*\([^)]{0,200}\)\s*\)\s*\(/.test(code)) out.push({ rule: "obfuscated", severity: "error", detail: `${file}: decoded text called as code` });
  return out;
}

/** Lines and whitespace of a text that reads as minified (`floor`: a text this short never does). */
function looksMinified(code: string, floor: number): boolean {
  if (code.length <= floor) return false;
  const lines = code.split("\n");
  const longest = Math.max(...lines.map((l) => l.length));
  if (longest > 1000 || code.length / lines.length > 300) return true;
  const nonEmpty = lines.filter((l) => l.trim());
  const longShare = nonEmpty.filter((l) => l.length > 500).length / Math.max(1, nonEmpty.length);
  const spaces = (code.match(/\s/g) ?? []).length;
  return longShare > 0.3 || spaces / code.length < 0.08;
}

/** A shipped source excuses a minified bundle only when it is at least this long… */
export const MIN_SOURCE_CHARS = 200;
/** …and at least this share of the bundle's length (a stub is not the bundle's source). */
export const MIN_SOURCE_SHARE = 0.1;

/**
 * A bundle no one can read: minified lines and no readable source shipped
 * with it. One very long line or a long average (this design), or, from #714,
 * many long lines (over 30 % longer than 500) or next to no whitespace (< 8 %).
 * Review Z6-L1: the check runs whether or not a source is shipped. A source
 * excuses a minified bundle only when it is readable itself (the same rules,
 * at any length) and plausibly the bundle's: MIN_SOURCE_CHARS and
 * MIN_SOURCE_SHARE of the bundle.
 */
export function minifiedOnly(code: string, source: string | undefined): boolean {
  if (!looksMinified(code, 2000)) return false;
  const src = source?.trim() ?? "";
  const plausible = src.length >= Math.max(MIN_SOURCE_CHARS, code.length * MIN_SOURCE_SHARE);
  return !(plausible && !looksMinified(src, 0));
}

/** CSS escapes (`\75 rl`, `\3a`, `\(`) decoded, so an escaped `url(` or scheme is seen (from #714). */
export function decodeCssEscapes(css: string): string {
  return css.replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, h: string) => {
    const cp = parseInt(h, 16);
    return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "\ufffd";
  }).replace(/\\([^\n0-9a-fA-F])/g, "$1");
}

/** Packages of an npm lockfile (v1 `dependencies`, v2/v3 `packages`). Throws on text that is not JSON. */
export function lockPackages(lock: string): Array<{ name: string; version: string }> {
  const j = JSON.parse(lock) as { packages?: Record<string, { version?: string; name?: string; link?: boolean }>; dependencies?: Record<string, { version?: string }> };
  const out: Array<{ name: string; version: string }> = [];
  for (const [path, p] of Object.entries(j.packages ?? {})) {
    if (!path || p.link || !p.version) continue;
    out.push({ name: p.name ?? path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length), version: p.version });
  }
  for (const [name, p] of Object.entries(j.dependencies ?? {})) if (p.version) out.push({ name, version: p.version });
  return out;
}

/** Known-bad versions in a lockfile: high and critical are errors, the rest warnings. */
export function knownBadFindings(lock: string, knownBad: readonly KnownBad[], inRange?: (version: string, range: string) => boolean): ReviewFinding[] {
  let pkgs: Array<{ name: string; version: string }>;
  try {
    pkgs = lockPackages(lock);
  } catch {
    return [{ rule: "vulnerable-dependency", severity: "error", detail: "package-lock.json is not valid JSON" }];
  }
  const out: ReviewFinding[] = [];
  const seen = new Set<string>();
  for (const p of pkgs) {
    for (const bad of knownBad) {
      if (bad.name !== p.name) continue;
      let hit = !!bad.versions?.includes(p.version);
      if (!hit && bad.range) {
        // why: no range checker given means the range can't be ruled out: a reviewer looks
        hit = inRange ? inRange(p.version, bad.range) : true;
      }
      const key = `${p.name}@${p.version}:${bad.advisories.join(",")}`;
      if (!hit || seen.has(key)) continue;
      seen.add(key);
      const serious = bad.severity === "critical" || bad.severity === "high";
      out.push({ rule: "vulnerable-dependency", severity: serious ? "error" : "warning", detail: `${p.name}@${p.version} (${bad.severity}: ${bad.advisories.join(", ")})` });
    }
  }
  return out;
}

/**
 * `@import` and `url()` to another origin in a stylesheet. Review Z6-M1: read by a CSS tokenizer (./cssUrls.ts), not
 * a pattern: quoted targets may hold `)` and quotes, escapes are decoded where the browser decodes them, and every
 * target is resolved as the URL parser resolves it (tab and newline stripped), against the plugin's own origin.
 */
export function cssFindings(css: string, allowed: readonly string[] = CSS_ALLOWED_ORIGINS): ReviewFinding[] {
  const out: ReviewFinding[] = [];
  for (const load of cssLoads(css)) {
    if (load.kind === "import") {
      out.push({ rule: "css-import", severity: "error", detail: load.target.slice(0, 120) });
      continue;
    }
    if (load.kind === "substitution") {
      // Review Z7-M1: the value a var()/env()/attr() puts into a URL function is not known here, so it is refused.
      out.push({ rule: "css-remote-url", severity: "error", detail: `${load.target}: the loaded value is not reviewable` });
      continue;
    }
    const origin = remoteTarget(load.target, allowed);
    if (origin) out.push({ rule: "css-remote-url", severity: "error", detail: `${origin}: ${JSON.stringify(load.target.slice(0, 120))}` });
  }
  return out;
}

const repositoryOf = (m: unknown): string | null => {
  const r = (m as { repository?: unknown } | null)?.repository;
  const url = typeof r === "string" ? r : typeof (r as { url?: unknown } | null)?.url === "string" ? (r as { url: string }).url : null;
  return url && /^https:\/\/[^\s/]+\/\S+/.test(url) ? url : null;
};

/** Review one version and return its scorecard. */
export async function reviewPluginVersion(input: ReviewInput): Promise<Scorecard> {
  const started = typeof performance !== "undefined" ? performance.now() : Date.now();
  const scan = await scanPluginVersion(input);
  const findings: ReviewFinding[] = [...scan.findings];
  let raw: unknown = input.manifest;
  try {
    raw = typeof input.manifest === "string" ? JSON.parse(input.manifest) : input.manifest;
  } catch {
    // why: the scan already reported the manifest; the repository stays unknown
  }
  for (const [code, file] of [[input.main, "main"], [input.ui, "ui"]] as const) {
    if (code === undefined) continue;
    findings.push(...obfuscationFindings(code, file));
    if (minifiedOnly(code, input.source)) findings.push({ rule: "minified-only", severity: "error", detail: `${file}: minified, with no readable source shipped` });
  }
  const repository = repositoryOf(raw);
  if (!repository && !input.inRepo) findings.push({ rule: "closed-source", severity: "error", detail: "no public source repository (manifest `repository`, https)" });
  // Review Z6-M2: a licence that is missing, not a string, or not an open-source SPDX expression is closed source.
  const license = (raw as { license?: unknown } | null)?.license;
  if (typeof license !== "string" || !license.trim()) findings.push({ rule: "closed-source", severity: "error", detail: "no licence (manifest `license`: an open-source SPDX expression)" });
  else if (!isOpenSourceLicense(license)) findings.push({ rule: "closed-source", severity: "error", detail: `licence ${JSON.stringify(license)} is not an open-source SPDX expression` });
  if (input.lockfile !== undefined && input.knownBad) findings.push(...knownBadFindings(input.lockfile, input.knownBad, input.inRange));
  if (input.css !== undefined) findings.push(...cssFindings(input.css));

  const declared = capIds(scan.capabilities);
  let before: string[] = [];
  if (input.previousManifest !== undefined) {
    try {
      before = capIds(parseManifest(input.previousManifest).capabilities);
    } catch {
      before = []; // why: an unreadable previous manifest: every permission counts as new
    }
  }
  const added = input.previousManifest === undefined ? [] : declared.filter((c) => !before.includes(c));
  const removed = before.filter((c) => !declared.includes(c));
  for (const c of added) findings.push({ rule: "new-permission", severity: "warning", detail: c });
  const hasLockfile = !!input.hasLockfile || input.lockfile !== undefined;
  if (hasLockfile) findings.push({ rule: "audit-owed", severity: "warning", detail: "npm audit on the lockfile has not run (it needs the network)" });

  const errors = findings.filter((f) => f.severity === "error").length;
  const passed = scan.passed && errors === 0;
  // Each warning the review adds costs what a scan warning costs (10 points).
  const reviewWarnings = findings.slice(scan.findings.length).filter((f) => f.severity === "warning").length;
  const score = passed ? Math.max(0, scan.score - REVIEW_WARNING_COST * reviewWarnings) : 0;
  const grade = gradeOf(passed, score);
  const ended = typeof performance !== "undefined" ? performance.now() : Date.now();
  return {
    kind: "lumen-plugin-scorecard",
    v: 1,
    reviewer: REVIEWER,
    id: scan.id,
    version: scan.version,
    reviewedAt: new Date(input.now ?? Date.now()).toISOString(),
    passed,
    score,
    grade,
    sha256: scan.sha256,
    source: { repository, inRepo: !!input.inRepo },
    permissions: { declared, added, removed },
    audit: hasLockfile ? "owed" : "none",
    findings,
    durationMs: Math.round(ended - started),
  };
}

/**
 * More review warnings for a scorecard from a later check (a theme's RTL
 * check, W12.S6): each costs what a review warning costs, the grade follows,
 * and `passed` never changes (a warning is not a delisting).
 */
export function withReviewWarnings<C extends Scorecard>(card: C, extra: readonly ReviewFinding[]): C {
  const warnings = extra.filter((f) => f.severity === "warning");
  if (warnings.length !== extra.length) throw new Error("withReviewWarnings takes warnings only");
  const score = card.passed ? Math.max(0, card.score - REVIEW_WARNING_COST * warnings.length) : 0;
  return { ...card, findings: [...card.findings, ...warnings], score, grade: gradeOf(card.passed, score) };
}

/** Listed versions whose review failed more than 24 hours ago: they must already be down. */
/**
 * W11.S14: the listed versions to take down now — every one whose review
 * on record failed. `review-plugins.mjs --takedown` marks them `delisted`
 * in index.json (the app neither shows nor installs them), and the owner
 * re-signs the index; `--check` keeps failing on one still listed after
 * TAKEDOWN_MS (overdueTakedowns).
 */
export function takedowns(listed: ReadonlyArray<{ id: string; version: string }>, cards: readonly Scorecard[]): Scorecard[] {
  const key = (x: { id: string; version: string }) => `${x.id}@${x.version}`;
  const up = new Set(listed.map(key));
  return cards.filter((c) => !c.passed && up.has(key(c)));
}

export function overdueTakedowns(listed: ReadonlyArray<{ id: string; version: string }>, cards: readonly Scorecard[], now: number): Scorecard[] {
  const key = (x: { id: string; version: string }) => `${x.id}@${x.version}`;
  const up = new Set(listed.map(key));
  return cards.filter((c) => !c.passed && up.has(key(c)) && now - Date.parse(c.reviewedAt) > TAKEDOWN_MS);
}
