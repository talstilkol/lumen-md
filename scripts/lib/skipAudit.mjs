/**
 * Skipped tests must say why, for which task, and until when (plan W4.12).
 *
 * A skipped test is coverage that looks present but checks nothing. Every
 * call that skips or defers a test in src/ (vitest) or e2e/ (Playwright) —
 * `test.skip`, `it.skip`, `describe.skip`, `*.skipIf`, `*.runIf`, `*.fixme`,
 * `*.todo`, also through `test.describe.*` — needs a structured comment on
 * its line or in the comment lines directly above it:
 *
 *   // skip-reason: <why it cannot run> | task: <plan id or #PR> | until: YYYY-MM-DD
 *
 * The date is when the skip is looked at again: a skip past it fails, and
 * so does a date more than MAX_HORIZON_DAYS ahead (no skip is forever).
 * e2e/ may hold at most MAX_E2E_SKIPS such calls: an engine gap shared by
 * many specs goes through one helper (e2e/_opfs.ts `vaultOrSkip`), not a
 * copy in every test.
 *
 * A call to a shared engine-gap helper (an exported function of
 * e2e/_engines.ts that skips, such as `chromiumOnly`) is a skip of its own
 * (R8-L3): each call site needs its own `// skip-reason:` with a task and a
 * date, and e2e/ may hold at most MAX_E2E_HELPER_SKIPS of them, so a new
 * spec cannot skip WebKit and Firefox through the helper unreviewed.
 * A helper is found however it is imported from `./_engines` (R8b-L4): by
 * name, renamed (`{ chromiumOnly as only }`) or through a namespace
 * (`E.chromiumOnly(...)`). A helper or that namespace used other than in a
 * call (`.forEach(chromiumOnlyHere)`, `const f = E.chromiumOnly`, a
 * re-export) fails: such a skip would have no call site of its own to carry
 * its reason. Helpers are exported functions or exported const arrow /
 * function expressions, also exported through `export { ... }`.
 * Review 9, L4: also a default import (`import E from "./_engines"`), a
 * dynamic import bound to a name or destructured (`const E = await
 * import("./_engines")`, `const { chromiumOnly } = await import(...)`), and a
 * call straight off one (`(await import("./_engines")).chromiumOnly(...)`).
 * Any other use of a dynamic import of ./_engines (`.then(...)`, passed on)
 * fails like a reference.
 *
 * The check walks the TypeScript AST, so the words in strings and comments
 * do not count. Used by scripts/check-code-hygiene.mjs and
 * scripts/skip-report.mjs.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

export const MAX_E2E_SKIPS = 15;
/** Calls of the e2e/_engines.ts skip helpers (R8-L3: today's count, 8; a new one is reviewed with this number). */
export const MAX_E2E_HELPER_SKIPS = 8;
/**
 * W10.F11 (audit r3: "true skip points ~21, engine helpers counted
 * separately"): the places in e2e/ where a test can be skipped, counted once
 * each — every skip call outside e2e/_engines.ts plus every call of one of its
 * helpers (a helper's own body skips only through its call sites, so it is
 * not counted again). Today's number; it only goes down. W10.F11's target is
 * E2E_SKIP_POINTS_TARGET.
 */
export const MAX_E2E_SKIP_POINTS = 19;
export const E2E_SKIP_POINTS_TARGET = 15;
/** The file whose exported skipping functions count as skips where they are called. */
export const ENGINE_HELPERS_FILE = "e2e/_engines.ts";
export const MAX_HORIZON_DAYS = 366;

/** Test-API roots and the members that skip or defer a test. */
const ROOTS = new Set(["test", "it", "describe", "suite", "bench"]);
const SKIPPERS = new Set(["skip", "fixme", "todo", "skipIf", "runIf"]);

const ANNOTATION = /\/\/\s*skip-reason:\s*(.*)$/;
// Plan ids: 0.5, W4.12, and since wave 10 a letter before the number (W10.A6, W12.V5); or a PR.
const TASK = /^(?:W?\d+(?:\.\d+)+|W\d+\.[A-Z]\d+|#\d+)$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `test.describe.skip` → { root: "test", member: "skip" }; null for anything else. */
function skipCallee(expr) {
  if (!ts.isPropertyAccessExpression(expr)) return null;
  const member = expr.name.text;
  if (!SKIPPERS.has(member)) return null;
  let e = expr.expression;
  while (ts.isPropertyAccessExpression(e)) e = e.expression;
  if (!ts.isIdentifier(e) || !ROOTS.has(e.text)) return null;
  return { root: e.text, member };
}

/**
 * Parse `<why> | task: <id> | until: <date>`. Returns the fields and a list
 * of problems (empty when the annotation is complete and in date).
 */
export function parseAnnotation(body, today = new Date()) {
  const parts = body.split("|").map((p) => p.trim());
  const why = parts[0] ?? "";
  const field = (name) => parts.slice(1).find((p) => p.toLowerCase().startsWith(`${name}:`))?.slice(name.length + 1).trim() ?? "";
  const task = field("task");
  const until = field("until");
  const problems = [];
  if (why.length < 10) problems.push("the reason is missing or shorter than 10 characters");
  if (!TASK.test(task)) problems.push(`no task (\`task: W4.12\`, \`task: W10.A6\`, \`task: 0.5\` or \`task: #431\`)${task ? `; got "${task}"` : ""}`);
  const m = DATE.exec(until);
  const date = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
  if (!date || date.toISOString().slice(0, 10) !== until) problems.push(`no review date (\`until: YYYY-MM-DD\`)${until ? `; got "${until}"` : ""}`);
  else {
    const day = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    if (date.getTime() < day) problems.push(`the review date ${until} has passed: fix the test, or re-justify it with a new date`);
    else if (date.getTime() - day > MAX_HORIZON_DAYS * 86_400_000) problems.push(`the review date ${until} is more than ${MAX_HORIZON_DAYS} days ahead`);
  }
  return { why, task, until, problems };
}

/** The `// skip-reason:` text for a call starting on `line` (1-based): same line, or the comment lines just above. */
function annotationFor(lines, line) {
  const same = ANNOTATION.exec(lines[line - 1] ?? "");
  if (same) return same[1];
  for (let i = line - 2; i >= 0 && i >= line - 6; i--) {
    const l = lines[i].trim();
    if (!l.startsWith("//")) break;
    const m = ANNOTATION.exec(l);
    if (m) {
      // A reason may continue on the following comment lines.
      const rest = [];
      for (let j = i + 1; j < line - 1; j++) rest.push(lines[j].trim().replace(/^\/\/\s?/, ""));
      return [m[1], ...rest].join(" ").trim();
    }
  }
  return null;
}

/** The module specifier of the engine helpers file, as a spec imports it ("./_engines", "../_engines.ts"). */
const ENGINES_SPEC = /(^|\/)_engines(\.[cm]?[jt]s)?$/;

/**
 * How a file binds the helpers it imports from ./_engines: local name → helper name
 * (`{ chromiumOnly as only }`), the namespace locals (`* as E`), and the re-exports.
 */
function engineBindings(sf, helpers) {
  const named = new Map();
  const spaces = new Set();
  const reexports = [];
  /** Dynamic imports of ./_engines bound to a name or destructured: not references. */
  const bound = new Set();
  const visit = (n) => {
    if (ts.isVariableDeclaration(n) && n.initializer) {
      const call = enginesImportCall(n.initializer);
      if (call) {
        bound.add(call);
        if (ts.isIdentifier(n.name)) spaces.add(n.name.text);
        else if (ts.isObjectBindingPattern(n.name))
          for (const el of n.name.elements) {
            const key = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : ts.isIdentifier(el.name) ? el.name.text : null;
            if (key && helpers.has(key) && ts.isIdentifier(el.name)) named.set(el.name.text, key);
          }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && ENGINES_SPEC.test(st.moduleSpecifier.text)) {
      // A default import holds the module's exports as well (review 9, L4).
      if (st.importClause?.name) spaces.add(st.importClause.name.text);
      const b = st.importClause?.namedBindings;
      if (b && ts.isNamespaceImport(b)) spaces.add(b.name.text);
      else if (b && ts.isNamedImports(b)) for (const el of b.elements) if (helpers.has((el.propertyName ?? el.name).text)) named.set(el.name.text, (el.propertyName ?? el.name).text);
    }
    if (ts.isExportDeclaration(st) && st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier) && ENGINES_SPEC.test(st.moduleSpecifier.text)) {
      const names = st.exportClause && ts.isNamedExports(st.exportClause) ? st.exportClause.elements.map((el) => (el.propertyName ?? el.name).text) : null;
      if (names === null || names.some((n) => helpers.has(n))) reexports.push(st);
    }
  }
  return { named, spaces, reexports, bound };
}

/** `import("./_engines")`, also under `await` and parentheses: the import call, else null. */
function enginesImportCall(e) {
  while (e && (ts.isParenthesizedExpression(e) || ts.isAwaitExpression(e) || ts.isAsExpression(e))) e = e.expression;
  if (!e || !ts.isCallExpression(e) || e.expression.kind !== ts.SyntaxKind.ImportKeyword) return null;
  const a = e.arguments[0];
  return a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) && ENGINES_SPEC.test(a.text) ? e : null;
}

const REFERENCE = "a skip helper used other than in a call (passed, stored or re-exported): call it where the test skips, with its own `// skip-reason:`";

/**
 * Every skip/defer call in one file: { line, call, condition, annotation, problems }.
 * `problems` is empty for a call with a complete, in-date skip-reason. With `helpers`
 * (the e2e/_engines.ts skip helpers), their calls count too, and a helper used but not called fails.
 */
export function findSkips(file, text, today = new Date(), helpers = new Set()) {
  const kind = /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const lines = text.split(/\r?\n/);
  const out = [];
  const { named, spaces, reexports, bound } = helpers.size ? engineBindings(sf, helpers) : { named: new Map(), spaces: new Set(), reexports: [], bound: new Set() };
  /** Dynamic imports of ./_engines used in a way this check understands. */
  const understood = new Set(bound);
  /** The helper a callee names: `chromiumOnly`, a renamed import, `E.chromiumOnly`, or `(await import("./_engines")).chromiumOnly`. */
  const helperOf = (e) => {
    if (ts.isIdentifier(e)) return named.get(e.text) ?? (helpers.has(e.text) ? e.text : null);
    if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && spaces.has(e.expression.text) && helpers.has(e.name.text)) return e.name.text;
    if (ts.isPropertyAccessExpression(e) && helpers.has(e.name.text)) {
      const call = enginesImportCall(e.expression);
      if (call) {
        understood.add(call);
        return e.name.text;
      }
    }
    return null;
  };
  const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const reference = (node, what) => out.push({ line: lineOf(node), call: `${what} (not a call)`, condition: "", annotation: null, problems: [REFERENCE], helper: true, reference: true });
  for (const st of reexports) reference(st, st.getText(sf).replace(/\s+/g, " "));
  const callees = new Set();
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || callees.has(node)) return;
    if (helpers.size && ts.isCallExpression(node) && enginesImportCall(node) === node && !understood.has(node)) {
      // (await import("./_engines")).other is not a helper; anything else (.then, passed on) is not understood.
      const awaited = node.parent && ts.isAwaitExpression(node.parent) ? node.parent : null;
      const via = awaited?.parent && ts.isParenthesizedExpression(awaited.parent) ? awaited.parent.parent : null;
      if (!(via && ts.isPropertyAccessExpression(via) && !helpers.has(via.name.text))) reference(node, node.getText(sf));
      return;
    }
    if (ts.isCallExpression(node)) {
      const h = helperOf(node.expression);
      const c = skipCallee(node.expression) ?? (h ? { root: node.expression.getText(sf), member: "", helper: true } : null);
      if (h) callees.add(node.expression);
      if (c) {
        const line = lineOf(node);
        const annotation = annotationFor(lines, line);
        const problems = annotation === null ? ["no `// skip-reason: <why> | task: <id> | until: YYYY-MM-DD` comment"] : parseAnnotation(annotation, today).problems;
        const first = node.arguments[0];
        const condition = first && !ts.isStringLiteralLike(first) && !ts.isNoSubstitutionTemplateLiteral(first) ? first.getText(sf).replace(/\s+/g, " ") : "";
        out.push({ line, call: c.helper ? c.root : `${c.root}${node.expression.getText(sf).slice(c.root.length)}`, condition, annotation, problems, ...(c.helper ? { helper: true } : {}) });
      }
    } else {
      // A helper (or the namespace that holds them) that is not called: passed, stored, spread, re-exported.
      if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && spaces.has(node.expression.text)) {
        if (helpers.has(node.name.text)) reference(node, node.getText(sf));
        return; // E.<other export> is not a helper
      }
      if (ts.isIdentifier(node) && !isDeclarationName(node)) {
        if (spaces.has(node.text)) reference(node, node.text);
        else if (named.has(node.text)) reference(node, node.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** An identifier that names something (a declaration, a property key, a member after a dot), not a use of a binding. */
function isDeclarationName(id) {
  const p = id.parent;
  if (!p) return false;
  if (ts.isPropertyAccessExpression(p) && p.name === id) return true;
  if ((ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p) || ts.isPropertySignature(p)) && p.name === id) return true;
  if ((ts.isVariableDeclaration(p) || ts.isFunctionDeclaration(p) || ts.isParameter(p) || ts.isBindingElement(p) || ts.isClassDeclaration(p) || ts.isTypeAliasDeclaration(p) || ts.isInterfaceDeclaration(p)) && p.name === id) return true;
  if (ts.isQualifiedName(p) || ts.isTypeReferenceNode(p) || ts.isTypeQueryNode(p)) return true;
  if (ts.isLabeledStatement(p) || ts.isBreakOrContinueStatement(p)) return true;
  return false;
}

/**
 * The exported functions of a helper file that contain a skip call (`chromiumOnly`, `chromiumOnlyHere`, …):
 * `export function f`, `export const f = () => …` / `function () …`, and local ones exported by `export { f }`.
 */
export function skipHelpers(text, file = ENGINE_HELPERS_FILE) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const exported = (st) => st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  const skips = (node) => findSkips(file, node.getText(sf)).length > 0;
  const local = new Map();
  const names = new Set();
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name) {
      local.set(st.name.text, skips(st));
      if (exported(st) && skips(st)) names.add(st.name.text);
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !d.initializer) continue;
        const fn = ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer);
        const s = fn && skips(d.initializer);
        local.set(d.name.text, s);
        if (exported(st) && s) names.add(d.name.text);
      }
    }
  }
  for (const st of sf.statements) {
    if (!ts.isExportDeclaration(st) || st.moduleSpecifier || !st.exportClause || !ts.isNamedExports(st.exportClause)) continue;
    for (const el of st.exportClause.elements) if (local.get((el.propertyName ?? el.name).text)) names.add(el.name.text);
  }
  return names;
}

/** All .ts/.tsx files below `dir` (tests included), without node_modules. */
export function testSourceFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) testSourceFiles(full, out);
    else if (/\.[cm]?tsx?$/.test(name) && !name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

/**
 * The audit of a repo: every skip in src/ and e2e/, the violations, and the
 * e2e count against MAX_E2E_SKIPS.
 */
export function auditSkips(root, { today = new Date() } = {}) {
  const sites = [];
  let helpers = new Set();
  try {
    helpers = skipHelpers(readFileSync(join(root, ENGINE_HELPERS_FILE), "utf8"));
  } catch {
    // why: no e2e/_engines.ts in this checkout: no helper to count
  }
  for (const area of ["src", "e2e"]) {
    let files = [];
    try {
      files = testSourceFiles(join(root, area));
    } catch {
      continue; // no such directory in this checkout
    }
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      const rel = relative(root, file).split("\\").join("/");
      const own = area === "e2e" && rel !== ENGINE_HELPERS_FILE ? helpers : new Set();
      if (!/\b(skip|fixme|todo|skipIf|runIf)\b/.test(text) && !(own.size && (text.includes("_engines") || [...own].some((h) => text.includes(h))))) continue;
      for (const s of findSkips(file, text, today, own)) sites.push({ area, file: rel, ...s });
    }
  }
  const violations = sites.filter((s) => s.problems.length).map((s) => ({ file: s.file, line: s.line, rule: "skip-reason", text: `${s.call}: ${s.problems.join("; ")}` }));
  const e2eCount = sites.filter((s) => s.area === "e2e" && !s.helper).length;
  const e2eHelperCount = sites.filter((s) => s.area === "e2e" && s.helper).length;
  const e2eSkipPoints = sites.filter((s) => s.area === "e2e" && (s.helper || s.file !== ENGINE_HELPERS_FILE)).length;
  if (e2eCount > MAX_E2E_SKIPS)
    violations.push({ file: "e2e/", line: 0, rule: "skip-count", text: `${e2eCount} skip calls in e2e/, at most ${MAX_E2E_SKIPS}: fix a test or share one helper for an engine gap` });
  if (e2eHelperCount > MAX_E2E_HELPER_SKIPS)
    violations.push({ file: "e2e/", line: 0, rule: "skip-count", text: `${e2eHelperCount} calls of the ${ENGINE_HELPERS_FILE} skip helpers, at most ${MAX_E2E_HELPER_SKIPS}: each one skips engines, so a new one is reviewed` });
  if (e2eSkipPoints > MAX_E2E_SKIP_POINTS)
    violations.push({ file: "e2e/", line: 0, rule: "skip-count", text: `${e2eSkipPoints} skip points in e2e/ (skip calls outside ${ENGINE_HELPERS_FILE} plus calls of its helpers), at most ${MAX_E2E_SKIP_POINTS} (W10.F11; target ${E2E_SKIP_POINTS_TARGET})` });
  return { sites, violations, e2eCount, e2eHelperCount, e2eSkipPoints };
}
