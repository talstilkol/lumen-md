/**
 * Tiny markdown linter — runs in the browser, fast enough to call on
 * every doc change. Catches the four most-common Lumen mistakes:
 *
 *   1. Trailing whitespace on a line
 *   2. Mixed-indent inside a list (tabs + spaces)
 *   3. Wiki-link target that doesn't resolve to any workspace note
 *   4. Heading skip (e.g. h1 → h3 with no h2 between them)
 *
 * Each finding has a `line` (1-based) and a short `message`. The host
 * (Outline panel / status bar / editor gutter) decides how to surface
 * them. The lint engine is intentionally non-fatal — it never throws,
 * never opens a dialog, never changes text. Pure analysis.
 */

export type LintSeverity = "info" | "warning" | "error";

export interface LintFinding {
  line: number;
  column?: number;
  severity: LintSeverity;
  /** Stable rule id (e.g. `MD009`, `LUMEN001`). */
  rule: string;
  message: string;
}

export interface LintOptions {
  /** Workspace note titles (basenames without extension). When provided, the
   *  linter checks every wiki-link target against this set. */
  workspaceTitles?: ReadonlySet<string>;
}

export function lintMarkdown(source: string, opts: LintOptions = {}): LintFinding[] {
  const out: LintFinding[] = [];
  const lines = source.split(/\r?\n/);
  // Track whether we're inside a code fence — the rules below mostly skip
  // fenced content because everything in there is supposed to be literal.
  let inFence = false;
  let lastHeadingLevel = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;

    if (/^```/.test(line.trim())) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    // Rule MD009 — trailing whitespace (excludes intentional 2-space line
    // breaks at end of paragraph; flag 1 trailing space, ≥3 trailing spaces).
    const ws = /([ \t]+)$/.exec(line);
    if (ws) {
      const trailLen = ws[1].length;
      if (trailLen === 1 || trailLen >= 3) {
        out.push({
          line: lineNo,
          column: line.length - trailLen + 1,
          severity: "info",
          rule: "MD009",
          message: `Trailing whitespace (${trailLen} char${trailLen === 1 ? "" : "s"}).`,
        });
      }
    }

    // Rule MD019 — mixed-indent. We grab the leading-whitespace run and
    // only flag when it contains BOTH spaces and tabs. Pure-tab and
    // pure-space indentations are perfectly legal markdown.
    const leadingWs = /^[ \t]+/.exec(line);
    if (leadingWs && leadingWs[0].includes(" ") && leadingWs[0].includes("\t")) {
      out.push({
        line: lineNo,
        severity: "warning",
        rule: "MD019",
        message: "Mixed tabs and spaces in indentation. Pick one.",
      });
    }

    // Rule LUMEN001 — wiki-link target must resolve.
    if (opts.workspaceTitles && opts.workspaceTitles.size > 0) {
      const re = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line)) !== null) {
        const target = m[1].trim();
        if (!target) continue;
        if (!opts.workspaceTitles.has(target)) {
          out.push({
            line: lineNo,
            column: m.index + 1,
            severity: "warning",
            rule: "LUMEN001",
            message: `Wiki-link target "${target}" doesn't match any note in the workspace.`,
          });
        }
      }
    }

    // Rule MD001 — heading levels should only increase by one. Going from
    // h1 → h3 (skipping h2) is hostile to outlines + screen readers.
    const headingMatch = /^(#{1,6})\s/.exec(line);
    if (headingMatch) {
      const level = headingMatch[1].length;
      if (lastHeadingLevel > 0 && level > lastHeadingLevel + 1) {
        out.push({
          line: lineNo,
          severity: "warning",
          rule: "MD001",
          message: `Heading level jumps from h${lastHeadingLevel} to h${level}. Insert an intermediate heading.`,
        });
      }
      lastHeadingLevel = level;
    }
  }

  return out;
}
