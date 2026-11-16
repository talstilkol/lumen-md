/**
 * Plan W13.X2 (with W11.S12): public/.well-known/security.txt, checked
 * against RFC 9116. Pure functions: scripts/security-page.mjs --check and
 * src/__tests__/securityTxt.test.ts call them.
 *
 * What the RFC asks of the file, and what this checks:
 *   §2.2  each line is empty, a comment ("#") or "Field: value"; UTF-8
 *   §2.5.3 Contact     at least once; a URI, and a web URI is https://
 *   §2.5.5 Expires     exactly once; an RFC 3339 date-time in the future
 *                      (and, as §2.5.5 recommends, less than a year away)
 *   §2.5.8 Preferred-Languages  at most once; comma-separated language tags
 *   §2.5.2 Canonical, Policy, Acknowledgments, Encryption, Hiring, CSAF: https URIs
 *   §3    served from /.well-known/security.txt (Canonical names that URL)
 * Lumen's own rule on top: a field the RFC does not define is a problem
 * here (the RFC lets readers ignore one; our file has no reason to carry it).
 */

export const FIELDS = Object.freeze(["Acknowledgments", "Canonical", "Contact", "CSAF", "Encryption", "Expires", "Hiring", "Policy", "Preferred-Languages"]);
const ONCE = new Set(["expires", "preferred-languages"]);
const URI_FIELDS = new Set(["acknowledgments", "canonical", "contact", "csaf", "encryption", "hiring", "policy"]);
const YEAR_MS = 366 * 24 * 3600 * 1000;
// RFC 3339 §5.6 date-time (the "T" and "Z" may be lower case).
const DATE_TIME = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])[Tt]([01]\d|2[0-3]):[0-5]\d:([0-5]\d|60)(\.\d+)?([Zz]|[+-]([01]\d|2[0-3]):[0-5]\d)$/;
// RFC 5646 language tag, loosely: a primary subtag and optional subtags.
const LANG_TAG = /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/;

/** The file's fields, in order: [{ name (as written), key (lower case), value, line }], and the lines that are not fields. */
export function parseSecurityTxt(text) {
  const fields = [];
  const bad = [];
  String(text)
    .split(/\r?\n/)
    .forEach((raw, i) => {
      const line = raw.replace(/\s+$/, "");
      if (line === "" || line.startsWith("#")) return;
      const m = /^([A-Za-z0-9-]+):[ \t]*(.*)$/.exec(line);
      if (!m || !m[2]) bad.push({ line: i + 1, text: line });
      else fields.push({ name: m[1], key: m[1].toLowerCase(), value: m[2].trim(), line: i + 1 });
    });
  return { fields, bad };
}

function uriProblem(f) {
  let u;
  try {
    u = new URL(f.value);
  } catch {
    return `line ${f.line}: ${f.name} is not a URI: ${f.value}`;
  }
  if (f.key === "contact") {
    if (["mailto:", "tel:"].includes(u.protocol)) return null;
    if (u.protocol !== "https:") return `line ${f.line}: a web Contact must be https:// (RFC 9116 §2.5.3): ${f.value}`;
    return null;
  }
  return u.protocol === "https:" ? null : `line ${f.line}: ${f.name} must be an https:// URI (RFC 9116 §2.5): ${f.value}`;
}

/**
 * The problems with a security.txt: [] when it passes.
 *   now        the time it is checked at (ms or Date), for Expires
 *   canonical  the URL it is served at; when given, a Canonical field must name it
 */
export function securityTxtProblems(text, { now = Date.now(), canonical } = {}) {
  const out = [];
  if (/^﻿/.test(String(text))) out.push("starts with a byte-order mark");
  if (!String(text).endsWith("\n")) out.push("does not end with a newline");
  const { fields, bad } = parseSecurityTxt(text);
  for (const b of bad) out.push(`line ${b.line}: not a comment and not "Field: value": ${b.text}`);
  const count = (k) => fields.filter((f) => f.key === k).length;
  const known = new Set(FIELDS.map((f) => f.toLowerCase()));
  for (const f of fields) {
    if (!known.has(f.key)) out.push(`line ${f.line}: ${f.name} is not an RFC 9116 field`);
    if (URI_FIELDS.has(f.key)) {
      const p = uriProblem(f);
      if (p) out.push(p);
    }
  }
  if (count("contact") === 0) out.push("no Contact field (RFC 9116 §2.5.3 requires at least one)");
  for (const k of ONCE) if (count(k) > 1) out.push(`${k === "expires" ? "Expires" : "Preferred-Languages"} appears ${count(k)} times (at most once)`);
  const exp = fields.filter((f) => f.key === "expires");
  if (exp.length === 0) out.push("no Expires field (RFC 9116 §2.5.5 requires one)");
  for (const f of exp) {
    if (!DATE_TIME.test(f.value)) {
      out.push(`line ${f.line}: Expires is not an RFC 3339 date-time: ${f.value}`);
      continue;
    }
    const t = Date.parse(f.value);
    const at = now instanceof Date ? now.getTime() : now;
    if (!(t > at)) out.push(`line ${f.line}: Expires ${f.value} has passed: renew the file`);
    else if (t - at > YEAR_MS) out.push(`line ${f.line}: Expires ${f.value} is more than a year away (RFC 9116 §2.5.5 recommends less)`);
  }
  for (const f of fields.filter((x) => x.key === "preferred-languages")) {
    const tags = f.value.split(",").map((s) => s.trim());
    for (const tag of tags) if (!LANG_TAG.test(tag)) out.push(`line ${f.line}: Preferred-Languages has an invalid language tag: "${tag}"`);
  }
  if (canonical) {
    const c = fields.filter((f) => f.key === "canonical").map((f) => f.value);
    if (!c.includes(canonical)) out.push(`no Canonical field names ${canonical}, where the file is served`);
  }
  return out;
}

/** Field values by name (lower case): "contact" → [uri, …]. */
export function securityTxtValues(text, name) {
  return parseSecurityTxt(text)
    .fields.filter((f) => f.key === name.toLowerCase())
    .map((f) => f.value);
}
