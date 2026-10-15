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
 * Usage: node scripts/check-code-hygiene.mjs   (or `npm run hygiene`)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

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
  if (total > 0) {
    console.error(
      `\n✖ code hygiene: ${total} violation(s). Replace \`as any\` with a real type and ` +
        "`console.log` with `log` from src/lib/logger, or add `// hygiene-allow: <reason>`.",
    );
    process.exit(1);
  }
  console.error(`✓ code hygiene: ${files.length} production files clean (no \`as any\`, no console.log).`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
