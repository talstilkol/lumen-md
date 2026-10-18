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
 * It also fails when an e2e file (`e2e/**\/*.ts`) calls `waitForTimeout`:
 * a fixed sleep is either too short on a slow runner (a flake) or longer
 * than needed everywhere. Wait for the condition instead (plan 0.5).
 *
 * The check walks the TypeScript AST (not a regex), so occurrences inside
 * string literals, template literals (e.g. worker source strings or editor
 * snippets) and comments are ignored.
 *
 * Intentional exceptions: put `// hygiene-allow: <justification>` on the
 * offending line or the line directly above it. A justification is required.
 *
 * Usage: node scripts/check-code-hygiene.mjs   (or `npm run hygiene`)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "src");
const e2eDir = join(root, "e2e");
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

/**
 * Returns a list of `{ line, rule, text }` violations for one source text.
 * `{ e2e: true }` checks an e2e file: fixed sleeps only.
 */
export function findViolations(fileName, text, { e2e = false } = {}) {
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
    if (e2e) {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "waitForTimeout"
      ) {
        report(node, "e2e-sleep");
      }
    } else if (ts.isAsExpression(node) && node.type.kind === ts.SyntaxKind.AnyKeyword) {
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

function walkE2e(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkE2e(full, out);
    else if (/\.[cm]?tsx?$/.test(name)) out.push(full);
  }
  return out;
}

function main() {
  const files = walk(srcDir);
  const e2eFiles = walkE2e(e2eDir);
  let total = 0;
  const check = (file, opts) => {
    for (const v of findViolations(file, readFileSync(file, "utf8"), opts)) {
      total++;
      console.error(`${relative(root, file)}:${v.line}  [${v.rule}]  ${v.text}`);
    }
  };
  for (const file of files) check(file);
  for (const file of e2eFiles) check(file, { e2e: true });
  if (total > 0) {
    console.error(
      `\n✖ code hygiene: ${total} violation(s). Replace \`as any\` with a real type, ` +
        "`console.log` with `log` from src/lib/logger and an e2e `waitForTimeout` with a wait " +
        "for the condition, or add `// hygiene-allow: <reason>`.",
    );
    process.exit(1);
  }
  console.error(
    `✓ code hygiene: ${files.length} production files clean (no \`as any\`, no console.log); ` +
      `${e2eFiles.length} e2e files without waitForTimeout.`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
