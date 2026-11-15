/**
 * Max-lines gate (plan W6.25; W10.E31: no baseline).
 *
 * No production file under src/ may be longer than MAX_LINES (800). There
 * is no baseline and no exception: the six files that were grandfathered in
 * scripts/max-lines-baseline.json were split (W10.E29, W10.E30) and the
 * baseline deleted. `npm run pr:check` fails a diff that brings a baseline
 * file back (RETIRED_BASELINE_PATH).
 *
 * Lines are counted the way ESLint's `max-lines` counts them (blank lines
 * and comments included; a final newline does not open a line), so this is
 * the same number `wc -l` prints for a file that ends with a newline.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export const MAX_LINES = 800;

/** Where the old baseline lived; a file there fails pr:check (W10.E31). */
export const RETIRED_BASELINE_PATH = "scripts/max-lines-baseline.json";

/** Production = src/**\/*.{ts,tsx}, without __tests__/, *.test.* / *.spec.* and *.d.ts (as check-code-hygiene.mjs). */
export function isProductionFile(path) {
  if (!/\.(ts|tsx)$/.test(path)) return false;
  if (/\.d\.ts$/.test(path)) return false;
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(path)) return false;
  if (/(^|[\\/])__tests__([\\/]|$)/.test(path)) return false;
  return true;
}

/** Repo-relative path (forward slashes) → line count, for every production file under `root`/src. */
export function productionLineCounts(root) {
  const out = {};
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name !== "__tests__" && name !== "node_modules") walk(full);
      } else if (isProductionFile(full)) {
        out[relative(root, full).split("\\").join("/")] = countLines(readFileSync(full, "utf8"));
      }
    }
  };
  walk(join(root, "src"));
  return out;
}

/** ESLint's line breaks: CRLF, CR, LF, U+2028 and U+2029. */
const LINE_BREAK = new RegExp(`\\r\\n|[\\r\\n${String.fromCharCode(0x2028, 0x2029)}]`);

/** Lines in `text`, as ESLint `max-lines` counts them. */
export function countLines(text) {
  if (text === "") return 0;
  const lines = text.split(LINE_BREAK);
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines.length;
}

/**
 * Check line counts. `counts`: repo-relative path → current line count, for
 * every production file. Returns `{ tooLong }`: every file over `max`, as
 * `{ file, lines }`, sorted by path.
 */
export function checkMaxLines(counts, max = MAX_LINES) {
  const tooLong = Object.entries(counts)
    .filter(([, lines]) => lines > max)
    .map(([file, lines]) => ({ file, lines }));
  return { tooLong: tooLong.sort((a, b) => a.file.localeCompare(b.file)) };
}

/** One line per problem, for the terminal and the test's failure message. */
export function describeProblems({ tooLong }, max = MAX_LINES) {
  return tooLong.map((t) => `${t.file}: ${t.lines} lines, over ${max} (split it into smaller modules)`);
}
