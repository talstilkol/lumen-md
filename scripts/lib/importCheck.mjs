/**
 * Plan W10.A14: a broken import fails the offline train fast. Every relative
 * (`./`, `../`) and `@/` import in the scanned sources must name a file that
 * exists, with the extensions TypeScript and Vite resolve. Package imports
 * are not checked here (the full typecheck and the build do that); this is
 * the seconds-long first gate, so a typo'd or deleted module is red before
 * the minutes-long ones start.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";

export const SOURCE_EXT = /\.(m?[jt]sx?|cjs|cts|mts)$/;
const RESOLVE_EXT = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".json", ".d.ts"];

/** The TypeScript script kind for a file name (JSX only where the extension allows it). */
function scriptKind(fileName) {
  if (/\.tsx$/.test(fileName)) return ts.ScriptKind.TSX;
  if (/\.jsx$/.test(fileName)) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/.test(fileName)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/** A string literal or a template literal without substitutions (through `as string`, parentheses): its text; else null. */
function literal(n) {
  while (n && (ts.isAsExpression(n) || ts.isParenthesizedExpression(n) || ts.isSatisfiesExpression(n) || ts.isTypeAssertionExpression(n))) n = n.expression;
  return n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : null;
}

/**
 * The module specifiers a source names: static imports and re-exports, side-effect
 * imports, `import x = require()`, `import()` and `require()` with a literal,
 * `import("…")` types, and `/// <reference path>`. Read from the syntax tree
 * (review 9, L3: the pre-processor took an import written inside a template
 * literal for a real one), so an import in a string, a template, a comment or a
 * regex (a test fixture, a doc example) is not taken for one.
 * @param {string} text
 * @param {string} [fileName]  picks the parser (.tsx/.jsx parse JSX)
 * @returns {string[]}
 */
export function specifiers(text, fileName = "module.ts") {
  const sf = ts.createSourceFile(fileName, String(text), ts.ScriptTarget.Latest, false, scriptKind(fileName));
  const out = [];
  const visit = (n) => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier) {
      const s = literal(n.moduleSpecifier);
      if (s !== null) out.push(s);
    } else if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference)) {
      const s = literal(n.moduleReference.expression);
      if (s !== null) out.push(s);
    } else if (ts.isCallExpression(n) && n.arguments.length >= 1) {
      const isImport = n.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(n.expression) && n.expression.text === "require" && n.arguments.length === 1;
      const s = isImport || isRequire ? literal(n.arguments[0]) : null;
      if (s !== null) out.push(s);
    } else if (ts.isImportTypeNode(n) && ts.isLiteralTypeNode(n.argument)) {
      const s = literal(n.argument.literal);
      if (s !== null) out.push(s);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  for (const r of sf.referencedFiles) out.push(r.fileName);
  return out;
}

/** Whether a specifier is one this check resolves (relative, or the `@/` alias for src/). */
export const isLocal = (spec) => spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("@/");

/**
 * Whether `spec`, imported from `from`, names an existing file.
 * Vite's query suffixes (`?raw`, `?worker&url`) are dropped; a `.js` specifier
 * may name its `.ts`/`.tsx` source, as TypeScript's bundler resolution allows.
 * @param {string} spec
 * @param {string} from  absolute path of the importing file
 * @param {string} root  the checkout (for `@/`)
 * @param {(p: string) => boolean} [exists]
 */
export function resolves(spec, from, root, exists = isFile) {
  const bare = spec.replace(/[?#].*$/, "");
  const base = bare.startsWith("@/") ? join(root, "src", bare.slice(2)) : resolve(dirname(from), bare);
  const candidates = [base, ...RESOLVE_EXT.map((e) => base + e), ...RESOLVE_EXT.map((e) => join(base, `index${e}`))];
  const js = /\.(m|c)?jsx?$/.exec(base);
  if (js) {
    const stem = base.slice(0, -js[0].length);
    candidates.push(...[".ts", ".tsx", ".mts", ".cts", ".d.ts"].map((e) => stem + e));
  }
  return candidates.some(exists);
}

function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Source files under `dirs` (relative to root), skipping node_modules, dot dirs and vendored libraries. */
export function sourceFiles(root, dirs) {
  const out = [];
  const walk = (d) => {
    let entries = [];
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        if (e.name !== "node_modules" && !e.name.startsWith(".") && e.name !== "dist") walk(p);
      } else if (SOURCE_EXT.test(e.name)) out.push(p);
    }
  };
  for (const d of dirs) if (existsSync(join(root, d))) walk(join(root, d));
  return out.sort();
}

/**
 * Every local import that names no file.
 * @param {string} root
 * @param {string[]} [dirs]
 * @returns {{ files: number, broken: { file: string, spec: string }[] }}
 */
export function brokenImports(root, dirs = ["src", "security", "scripts"]) {
  const files = sourceFiles(root, dirs);
  const broken = [];
  for (const f of files) {
    for (const spec of specifiers(readFileSync(f, "utf8"), f)) {
      if (!isLocal(spec) || /[${]/.test(spec)) continue;
      if (!resolves(spec, f, root)) broken.push({ file: relative(root, f), spec });
    }
  }
  return { files: files.length, broken };
}
