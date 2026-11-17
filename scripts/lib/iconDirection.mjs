/**
 * Icon direction check (plan W13.H3).
 *
 * Every icon the interface imports from lucide-react is classified in
 * src/ui/icons/direction.json as `directional` (it shows a reading
 * direction: back/forward, undo/redo, a side panel, bullets — it mirrors in
 * RTL) or `fixed` (physical or symmetric: media controls, clocks, check marks,
 * code — it never mirrors). Blind mirroring of every icon is the common bug;
 * this check makes the choice explicit and keeps it so:
 *
 *   - an imported icon that is in neither list fails;
 *   - `<Undo2 …/>` (a directional icon in JSX) must carry the `icon-dir`
 *     class, which mirrors under RTL (src/index.css), or a
 *     `data-icon-fixed="<reason>"` attribute where that use means a physical
 *     side;
 *   - a fixed icon must not carry `icon-dir`;
 *   - a directional icon passed around as a value (a command's icon, a
 *     `rtl ? ChevronRight : ChevronLeft` swap) must go through `dirIcon(…)`
 *     (src/ui/icons/direction.ts), so whoever renders it adds the class;
 *   - no icon is flipped by hand (`scaleX(-1)` on an icon element): that
 *     double-flips once the class is there.
 */
import ts from "typescript";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

export const DIRECTION_JSON = "src/ui/icons/direction.json";

export function readDirection(root) {
  const j = JSON.parse(readFileSync(join(root, DIRECTION_JSON), "utf8"));
  return { directional: new Set(Object.keys(j.directional ?? {})), fixed: new Set(Object.keys(j.fixed ?? {})), raw: j };
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!/^(__tests__|__mocks__|node_modules)$/.test(name)) walk(full, out);
    } else if (/\.tsx?$/.test(name) && !/\.(test|spec|stories)\.tsx?$|\.d\.ts$/.test(name)) out.push(full);
  }
  return out;
}

/** Does this class expression contain the token `icon-dir`? */
function hasIconDir(expr, sf) {
  if (!expr) return false;
  return /(^|[\s"'`])icon-dir([\s"'`]|$)/.test(expr.getText(sf)) || /iconDirClass\(|ICON_DIR\b/.test(expr.getText(sf));
}

function attr(el, name) {
  return el.attributes.properties.find((p) => ts.isJsxAttribute(p) && p.name.getText() === name);
}

/**
 * Scan one source file. `dir` is the classification.
 * @returns {{ imports: string[], problems: {line: number, rule: string, text: string}[] }}
 */
export function scanIconFile(fileName, text, dir) {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const local = new Map(); // local name → lucide name
  const imports = [];
  const problems = [];
  const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || st.moduleSpecifier.text !== "lucide-react") continue;
    const nb = st.importClause?.namedBindings;
    if (!nb || !ts.isNamedImports(nb) || st.importClause.isTypeOnly) continue;
    for (const e of nb.elements) {
      if (e.isTypeOnly) continue;
      const name = (e.propertyName ?? e.name).text;
      if (name === "LucideIcon" || name === "LucideProps" || name === "createLucideIcon") continue;
      local.set(e.name.text, name);
      imports.push(name);
      if (!dir.directional.has(name) && !dir.fixed.has(name)) problems.push({ line: lineOf(e), rule: "unclassified", text: `${name} is in neither list of ${DIRECTION_JSON}` });
    }
  }
  if (!local.size) return { imports, problems };
  const visit = (node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(sf);
      const name = local.get(tag);
      if (name) {
        const cls = attr(node, "className");
        const on = cls && hasIconDir(cls.initializer, sf);
        const fixedAttr = attr(node, "data-icon-fixed");
        const style = attr(node, "style");
        if (style && /scaleX\(\s*-1\s*\)|scale\(\s*-1/.test(style.getText(sf))) problems.push({ line: lineOf(node), rule: "manual-flip", text: `<${tag}> is flipped by hand; use the icon-dir class` });
        if (dir.directional.has(name) && !on && !fixedAttr) problems.push({ line: lineOf(node), rule: "missing-icon-dir", text: `<${tag}> is directional: add className="icon-dir" (or data-icon-fixed="<reason>")` });
        if (dir.fixed.has(name) && on) problems.push({ line: lineOf(node), rule: "fixed-mirrored", text: `<${tag}> is fixed and must not mirror` });
      }
    } else if (ts.isIdentifier(node) && local.has(node.text)) {
      const name = local.get(node.text);
      const p = node.parent;
      const inImport = !!p && (ts.isImportSpecifier(p) || ts.isImportClause(p));
      const isTag = !!p && (ts.isJsxOpeningElement(p) || ts.isJsxSelfClosingElement(p) || ts.isJsxClosingElement(p)) && p.tagName === node;
      const isKey = !!p && ts.isPropertyAssignment(p) && p.name === node;
      const isShorthand = !!p && ts.isShorthandPropertyAssignment(p);
      const isPropAccess = !!p && ts.isPropertyAccessExpression(p) && p.name === node;
      if (!inImport && !isTag && !isKey && !isPropAccess && dir.directional.has(name)) {
        const call = isShorthand ? null : p;
        const wrapped = !!call && ts.isCallExpression(call) && call.expression.getText(sf) === "dirIcon";
        if (!wrapped) problems.push({ line: lineOf(node), rule: "unwrapped-value", text: `${node.text} is directional and used as a value: wrap it, dirIcon(${node.text})` });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { imports, problems };
}

/** Scan src/: `{ files, imports: Map<name, files[]>, problems: {file, line, rule, text}[] }`. */
export function scanIcons(root) {
  const dir = readDirection(root);
  const src = join(root, "src");
  const files = existsSync(src) ? walk(src) : [];
  const imports = new Map();
  const problems = [];
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    if (!text.includes("lucide-react")) continue;
    const rel = relative(root, f).split("\\").join("/");
    const r = scanIconFile(rel, text, dir);
    for (const n of r.imports) imports.set(n, [...(imports.get(n) ?? []), rel]);
    for (const p of r.problems) problems.push({ file: rel, ...p });
  }
  const stale = [...dir.directional, ...dir.fixed].filter((n) => !imports.has(n));
  const both = [...dir.directional].filter((n) => dir.fixed.has(n));
  return { files: files.length, imports, problems, stale, both, dir };
}
