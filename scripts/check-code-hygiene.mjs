#!/usr/bin/env node
/**
 * Code-hygiene gate for production sources.
 *
 * Fails (exit 1) when any production file under `src/` contains:
 *   - an `as any` cast
 *   - a `console.log(...)` call
 *
 * Production = `src/**\/*.{ts,tsx}` excluding `__tests__/` directories,
 * `*.test.*` / `*.spec.*` files and `*.d.ts` declarations.
 *
 * The check walks the TypeScript AST (not a regex), so occurrences inside
 * string literals, template literals (e.g. worker source strings or editor
 * snippets) and comments are ignored.
 *
 * Intentional exceptions: put `// hygiene-allow: <justification>` on the
 * offending line or the line directly above it. A justification is required.
 *
 * CSS (plan 9.3): in `src/**\/*.css`, rules for the preview (`.prose-lumen`)
 * and the editor (`.cm-*`) must use logical properties — `margin-inline-start`,
 * `padding-inline-end`, `border-inline-start`, `inset-inline-start`,
 * `text-align: start` — so Hebrew and Arabic notes lay out mirrored. A
 * physical one (`margin-left`, `right:`, `text-align: left`, `float: right`…)
 * fails unless a `/* hygiene-allow: <justification> *\/` comment sits on its
 * line or the line above.
 *
 * Usage: node scripts/check-code-hygiene.mjs   (or `npm run hygiene`)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import postcss from "postcss";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "src");
const ALLOW_RE = /\/\/\s*hygiene-allow:\s*\S+/;

function isProductionFile(path) {
  if (!/\.(ts|tsx)$/.test(path)) return false;
  if (/\.d\.ts$/.test(path)) return false;
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(path)) return false;
  if (/(^|[\\/])__tests__([\\/]|$)/.test(path)) return false;
  return true;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      walk(full, out);
    } else if (isProductionFile(full)) {
      out.push(full);
    }
  }
  return out;
}

/** Returns a list of `{ line, rule, text }` violations for one source text. */
export function findViolations(fileName, text) {
  const sf = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const lines = text.split(/\r?\n/);
  const out = [];
  const report = (node, rule) => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    const here = lines[line] ?? "";
    const above = line > 0 ? lines[line - 1] : "";
    if (ALLOW_RE.test(here) || ALLOW_RE.test(above)) return;
    out.push({ line: line + 1, rule, text: here.trim() });
  };
  const visit = (node) => {
    if (ts.isAsExpression(node) && node.type.kind === ts.SyntaxKind.AnyKeyword) {
      report(node, "as-any");
    } else if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "console" &&
      node.expression.name.text === "log"
    ) {
      report(node, "console-log");
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** Physical properties and the logical one to use instead (plan 9.3). */
const PHYSICAL_PROPS = [
  [/^(margin|padding|scroll-margin|scroll-padding)-(left|right)$/, (m) => `${m[1]}-inline-${m[2] === "left" ? "start" : "end"}`],
  [/^border-(left|right)(-(width|style|color))?$/, (m) => `border-inline-${m[1] === "left" ? "start" : "end"}${m[2] ?? ""}`],
  [/^border-(top|bottom)-(left|right)-radius$/, (m) => `border-${m[1] === "top" ? "start" : "end"}-${m[2] === "left" ? "start" : "end"}-radius`],
  [/^(left|right)$/, (m) => `inset-inline-${m[1] === "left" ? "start" : "end"}`],
];
const PHYSICAL_VALUES = { "text-align": /^(left|right)$/i, float: /^(left|right)$/i, clear: /^(left|right)$/i };
const LOGICAL_SCOPE = /\.prose-lumen|\.cm-/;

/** Split a CSS value on top-level whitespace (not inside `calc(...)`, `var(...)`). */
function cssWords(value) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of String(value).trim()) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (cur) out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

const BOX_SHORTHANDS = /^(margin|padding|inset|scroll-margin|scroll-padding|border-width|border-style|border-color)$/;

/**
 * A shorthand that sets left and right (or the left and right corners)
 * differently does not mirror in RTL: `margin: 0 1rem 0 2rem`,
 * `border-radius: 0 0.5rem 0.5rem 0`. Symmetric ones (`margin: 0 auto`) are fine.
 */
function physicalShorthand(prop, value) {
  if (BOX_SHORTHANDS.test(prop)) {
    const v = cssWords(value);
    if (v.length === 4 && v[1] !== v[3]) {
      const base = prop.startsWith("border-") ? `border-inline-start-${prop.slice(7)} / border-inline-end-${prop.slice(7)}` : `${prop}-block + ${prop}-inline-start / ${prop}-inline-end`;
      return base;
    }
    return null;
  }
  if (prop === "border-radius") {
    for (const part of String(value).split("/")) {
      const v = cssWords(part);
      // corners in order: top-left, top-right, bottom-right, bottom-left
      const [tl, tr, br, bl] = v.length === 1 ? [v[0], v[0], v[0], v[0]] : v.length === 2 ? [v[0], v[1], v[0], v[1]] : v.length === 3 ? [v[0], v[1], v[2], v[1]] : v;
      if (tl !== tr || br !== bl) return "border-start-start-radius / border-start-end-radius / border-end-end-radius / border-end-start-radius";
    }
  }
  return null;
}
const CSS_ALLOW_RE = /hygiene-allow:\s*[^\s*/]/; // a justification, not just the comment's closing */

/** Physical properties in `.prose-lumen` / `.cm-*` rules of one stylesheet: `{ line, rule, text }`. */
export function findCssViolations(fileName, text) {
  const root = postcss.parse(text, { from: fileName });
  const lines = text.split(/\r?\n/);
  const out = [];
  root.walkDecls((d) => {
    const rule = d.parent;
    if (!rule || rule.type !== "rule" || !LOGICAL_SCOPE.test(rule.selector)) return;
    let use = null;
    for (const [re, fix] of PHYSICAL_PROPS) {
      const m = re.exec(d.prop);
      if (m) use = fix(m);
    }
    if (!use) use = physicalShorthand(d.prop, d.value);
    const valRe = PHYSICAL_VALUES[d.prop];
    if (!use && valRe && valRe.test(String(d.value).trim())) use = `${d.prop}: ${/left/i.test(d.value) ? "start" : "end"}` + (d.prop === "text-align" ? "" : " (inline-start / inline-end)");
    if (!use) return;
    const line = d.source?.start?.line ?? 1;
    const here = lines[line - 1] ?? "";
    const above = line > 1 ? lines[line - 2] : "";
    if (CSS_ALLOW_RE.test(here) || CSS_ALLOW_RE.test(above)) return;
    out.push({ line, rule: "physical-css", text: `${rule.selector.replace(/\s+/g, " ")} { ${d.prop}: ${d.value} } → ${use}` });
  });
  return out;
}

function walkCss(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      walkCss(full, out);
    } else if (name.endsWith(".css")) out.push(full);
  }
  return out;
}

function main() {
  const files = walk(srcDir);
  let total = 0;
  for (const file of files) {
    const violations = findViolations(file, readFileSync(file, "utf8"));
    for (const v of violations) {
      total++;
      console.error(`${relative(root, file)}:${v.line}  [${v.rule}]  ${v.text}`);
    }
  }
  const sheets = walkCss(srcDir);
  let cssTotal = 0;
  for (const file of sheets) {
    for (const v of findCssViolations(file, readFileSync(file, "utf8"))) {
      cssTotal++;
      console.error(`${relative(root, file)}:${v.line}  [${v.rule}]  ${v.text}`);
    }
  }
  if (total > 0 || cssTotal > 0) {
    if (total > 0)
      console.error(
        `\n✖ code hygiene: ${total} violation(s). Replace \`as any\` with a real type and ` +
          "`console.log` with `log` from src/lib/logger, or add `// hygiene-allow: <reason>`.",
      );
    if (cssTotal > 0)
      console.error(
        `\n✖ code hygiene: ${cssTotal} physical CSS propert${cssTotal === 1 ? "y" : "ies"} in preview/editor rules. ` +
          "Use the logical property shown, or add `/* hygiene-allow: <reason> */`.",
      );
    process.exit(1);
  }
  console.error(
    `✓ code hygiene: ${files.length} production files clean (no \`as any\`, no console.log); ` +
      `${sheets.length} stylesheets use logical properties in .prose-lumen / .cm-* rules.`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
