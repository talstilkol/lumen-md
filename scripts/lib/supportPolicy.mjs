/**
 * W13.T2: the support policy as a check. docs/support-matrix.json names the
 * oldest runtime Lumen supports (the floor) and, for each web API the code
 * might reach for, the first browser versions that have it. A use of an API
 * that some supported runtime lacks must be feature-detected; otherwise the
 * check fails, with the file, the line and the browsers that lack it.
 *
 * What counts as feature detection, per file (simple on purpose; review
 * what it accepts):
 *   - an optional call or member at the use (`x.showPopover?.()`) — the
 *     use pattern does not match it, so it is never flagged;
 *   - `typeof <name>`, `"<name>" in` / `'<name>' in`, `<name> in`,
 *     `if (<obj>.<name>)`, `!<obj>.<name>` or `<obj>.<name> ?` / `&&` /
 *     `=== undefined` somewhere in the same file, for
 *     an identifier of the use;
 * A name inside a '…' or "…" string is not a use.
 *   - `// support-policy: guarded — <why>` on the line or up to 3 lines above
 *     (for a guard this check cannot see, such as a caller that checks first).
 */

const BROWSERS = ["chrome", "edge", "firefox", "safari"];

/** The version a feature needs in a browser (Edge follows Chrome). */
export function needs(feature, browser) {
  return browser === "edge" ? (feature.edge ?? feature.chrome) : feature[browser];
}

/** The supported browsers that lack the feature: [] when every one at the floor has it. */
export function missingAt(feature, floor) {
  return BROWSERS.filter((b) => floor[b] !== undefined).filter((b) => {
    const v = needs(feature, b);
    return v === null || v === undefined || v > floor[b];
  });
}

/** Comments become spaces (lines kept), so a word in a comment is not a use. */
export function stripComments(text) {
  let out = "";
  let i = 0;
  let quote = null;
  while (i < text.length) {
    const c = text[i];
    const n = text[i + 1];
    if (quote) {
      out += c;
      if (c === "\\") {
        out += n ?? "";
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      out += c;
      i++;
      continue;
    }
    if (c === "/" && n === "/") {
      // Keep a support-policy marker; blank out the rest of the comment.
      const end = text.indexOf("\n", i);
      const line = text.slice(i, end < 0 ? text.length : end);
      out += /support-policy: guarded/.test(line) ? line : " ".repeat(line.length);
      i += line.length;
      continue;
    }
    if (c === "/" && n === "*") {
      const end = text.indexOf("*/", i + 2);
      const block = text.slice(i, end < 0 ? text.length : end + 2);
      out += block.replace(/[^\n]/g, " ");
      i += block.length;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** '…' and "…" contents become spaces (for finding uses; detection still reads them). */
export function blankQuotes(code) {
  return code.replace(/(["'])(?:\\.|(?!\1)[^\\\n])*\1/g, (m) => m[0] + " ".repeat(m.length - 2) + m[0]);
}

const IDENT = /[A-Za-z_$][\w$]*/g;
const COMMON = new Set(["new", "navigator", "window", "Array", "Object", "Map", "String", "Promise", "URL", "Intl", "CSS", "for", "await", "of", "body", "stream", "Stream", "storage", "values", "keys", "entries"]);

/** Is a use of `names` feature-detected in this (comment-stripped) file? */
export function detected(code, names) {
  return names.some((nm) => {
    const e = nm.replace(/[$]/g, "\\$");
    return new RegExp(`typeof\\s+(?:[\\w$.]+\\.)?${e}\\b|["'\`]${e}["'\`]\\s+in\\b|\\b${e}\\s+in\\s|!\\s*(?:[\\w$]+\\.)+${e}\\b|\\bif\\s*\\(\\s*(?:[\\w$]+\\.)*${e}\\s*\\)|\\.${e}\\s*(?:\\?(?!\\.)|&&|===?\\s*(?:undefined|null)|!==?\\s*(?:undefined|null))`).test(code);
  });
}

/**
 * Every unguarded use of an API beyond the floor in `files` ([{ path, text }]).
 * → [{ path, line, feature, missing: ["safari", …], snippet }]
 */
export function scan(files, matrix) {
  const risky = matrix.features.map((f) => ({ f, missing: missingAt(f, matrix.floor), re: new RegExp(f.use, "g") })).filter((x) => x.missing.length);
  const out = [];
  for (const { path, text } of files) {
    const code = stripComments(text);
    const uses = blankQuotes(code);
    const lines = code.split("\n");
    for (const { f, missing, re } of risky) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(uses))) {
        const names = [...m[0].matchAll(IDENT)].map((x) => x[0]).filter((x) => !COMMON.has(x));
        const line = code.slice(0, m.index).split("\n").length;
        const near = lines.slice(Math.max(0, line - 4), line).join("\n");
        if (/support-policy: guarded/.test(near) || detected(code, names)) continue;
        out.push({ path, line, feature: f.id, missing, snippet: lines[line - 1].trim().slice(0, 120) });
      }
    }
  }
  return out;
}

/** Problems with the matrix itself (so a typo cannot switch the check off). */
export function matrixProblems(matrix) {
  const p = [];
  for (const b of BROWSERS) if (typeof matrix.floor?.[b] !== "number") p.push(`floor.${b} must be a version number`);
  if (!Array.isArray(matrix.features) || matrix.features.length < 20) p.push("features: the list is missing or too short (at least 20)");
  for (const f of matrix.features ?? []) {
    try {
      new RegExp(f.use);
    } catch (e) {
      p.push(`${f.id}: use is not a regular expression (${e.message})`);
    }
    for (const b of ["chrome", "firefox", "safari"]) if (!(b in f) || (f[b] !== null && typeof f[b] !== "number")) p.push(`${f.id}: ${b} must be a version or null`);
  }
  if (!Array.isArray(matrix.runtimes) || !matrix.runtimes.every((r) => r.en && r.he && r.min && r.minHe)) p.push("runtimes: each needs en, he, min and minHe");
  return p;
}
