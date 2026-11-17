/**
 * Logical-CSS scanner (plan W13.H2) — no new dependency: a small CSS lexer and
 * the TypeScript AST that the repo already has.
 *
 * Plan 9.3 (scripts/check-code-hygiene.mjs) only looks at `.prose-lumen` and
 * `.cm-*` rules. This one looks at the whole of src/:
 *   - every rule of every `src/**\/*.css` file (nested rules and @media too);
 *   - inline style objects in TS/TSX: `style={{ marginLeft: 8 }}`, a `style:`
 *     property, a `CSSProperties` object, `el.style.paddingRight = …`,
 *     `Object.assign(el.style, { left: … })`;
 *   - Tailwind utilities in class strings (`ml-2`, `pr-4`, `left-0`,
 *     `text-left`, `border-l`, `rounded-r`…): the logical ones are `ms-*`,
 *     `pe-*`, `start-*`, `text-start`, `border-s`, `rounded-e`.
 *
 * Not reported, because they mirror correctly or are meant to be physical:
 *   - a rule under an explicit direction (`[dir="rtl"]`, `[dir=ltr]`, `:dir(…)`):
 *     there the author chose the side on purpose;
 *   - symmetric pairs in one rule or object (`left: 0; right: 0`,
 *     `margin-left: auto; margin-right: auto`) and centring (`left: 50%`);
 *   - a line with `logical-allow: <reason>` (or 9.3's `hygiene-allow:` / the design
 *     audit's `design-allow:` with a reason)
 *     on it or on the line above. A reason is required.
 */
import ts from "typescript";

/** Physical CSS property → the logical one to use. */
const CSS_PROPS = [
  [/^(margin|padding|scroll-margin|scroll-padding)-(left|right)$/, (m) => `${m[1]}-inline-${m[2] === "left" ? "start" : "end"}`],
  [/^border-(left|right)(-(width|style|color))?$/, (m) => `border-inline-${m[1] === "left" ? "start" : "end"}${m[2] ?? ""}`],
  [/^border-(top|bottom)-(left|right)-radius$/, (m) => `border-${m[1] === "top" ? "start" : "end"}-${m[2] === "left" ? "start" : "end"}-radius`],
  [/^(left|right)$/, (m) => `inset-inline-${m[1] === "left" ? "start" : "end"}`],
];
const CSS_VALUES = { "text-align": /^(left|right)(\s*!important)?$/i, float: /^(left|right)(\s*!important)?$/i, clear: /^(left|right)(\s*!important)?$/i };

const ALLOW_RE = /(logical|hygiene|design)-allow:\s*[^\s*/]/;
const DIR_SCOPE_RE = /\[dir(=|\s*=\s*)["']?(rtl|ltr)["']?\]|:dir\(|\[dir\]/i;

/** camelCase JS style key → CSS property name. */
export const kebab = (k) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** The logical replacement for one declaration, or null when it is fine. */
export function physicalFix(prop, value) {
  const p = prop.trim().toLowerCase();
  for (const [re, fix] of CSS_PROPS) {
    const m = re.exec(p);
    if (m) return fix(m);
  }
  const sh = physicalShorthand(p, value);
  if (sh) return sh;
  const vr = CSS_VALUES[p];
  if (vr && vr.test(String(value).trim())) return `${p}: ${/left/i.test(String(value)) ? (p === "text-align" ? "start" : "inline-start") : p === "text-align" ? "end" : "inline-end"}`;
  return null;
}

/** Split a CSS value on top-level whitespace (not inside `calc(...)`). */
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

/** A four-value shorthand with different left and right (or corners) does not mirror. */
function physicalShorthand(p, value) {
  if (BOX_SHORTHANDS.test(p)) {
    const v = cssWords(value);
    if (v.length === 4 && v[1] !== v[3]) return p.startsWith("border-") ? `border-inline-start-${p.slice(7)} / border-inline-end-${p.slice(7)}` : `${p}-block + ${p}-inline-start / ${p}-inline-end`;
    return null;
  }
  if (p === "border-radius") {
    for (const part of String(value).split("/")) {
      const v = cssWords(part);
      const [tl, tr, br, bl] = v.length === 1 ? [v[0], v[0], v[0], v[0]] : v.length === 2 ? [v[0], v[1], v[0], v[1]] : v.length === 3 ? [v[0], v[1], v[2], v[1]] : v;
      if (tl !== tr || br !== bl) return "border-start-start-radius / border-start-end-radius / border-end-end-radius / border-end-start-radius";
    }
  }
  return null;
}

/**
 * Drop the declarations that mirror anyway: a left/right pair with the same
 * value (`left: 0; right: 0`, `margin-left: auto; margin-right: auto`) and
 * `left: 50%` / `right: 50%` (centring with a translate).
 * @param {{prop: string, value: string}[]} decls
 */
export function symmetricProps(decls) {
  const val = new Map(decls.map((d) => [d.prop.toLowerCase(), String(d.value).trim()]));
  const ok = new Set();
  for (const d of decls) {
    const p = d.prop.toLowerCase();
    const other = p.includes("left") ? p.replace("left", "right") : p.includes("right") ? p.replace("right", "left") : null;
    if (other && val.has(other) && val.get(other) === String(d.value).trim()) ok.add(p);
    if ((p === "left" || p === "right") && /^50%$/.test(String(d.value).trim())) ok.add(p);
  }
  return ok;
}

/* ---------------------------------------------------------------- CSS --- */

/**
 * A tiny CSS lexer: rules with their selector chain and declarations with
 * line numbers. Comments and strings are skipped; nesting is supported.
 * @returns {{ selectors: string[], decls: {prop: string, value: string, line: number}[] }[]}
 */
export function parseCssRules(text) {
  const rules = [];
  const stack = [{ selectors: [], decls: [] }];
  let buf = "";
  let bufLine = 1;
  let line = 1;
  const flushDecl = () => {
    const raw = buf.trim();
    buf = "";
    if (!raw) return;
    const i = raw.indexOf(":");
    if (i <= 0) return;
    const prop = raw.slice(0, i).trim();
    if (!/^-?[a-zA-Z-]+$/.test(prop)) return;
    stack[stack.length - 1].decls.push({ prop, value: raw.slice(i + 1).trim(), line: bufLine });
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\n") line++;
    if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end < 0 ? text.length : end + 2;
      for (let j = i; j < stop; j++) if (text[j] === "\n") line++;
      i = stop - 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== ch) {
        if (text[j] === "\\") j++;
        j++;
      }
      buf += text.slice(i, j + 1);
      i = j;
      continue;
    }
    if (!buf.trim() && !/\s/.test(ch)) bufLine = line;
    if (ch === "{") {
      const parent = stack[stack.length - 1];
      const node = { selectors: [...parent.selectors, buf.trim()], decls: [] };
      buf = "";
      stack.push(node);
      rules.push(node);
    } else if (ch === "}") {
      flushDecl();
      if (stack.length > 1) stack.pop();
    } else if (ch === ";") {
      flushDecl();
    } else buf += ch;
  }
  return rules;
}

/** Physical properties in one stylesheet: `{ line, kind, text, fix }[]`. */
export function scanCss(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  for (const rule of parseCssRules(text)) {
    const sel = rule.selectors.join(" ");
    if (DIR_SCOPE_RE.test(sel)) continue;
    if (rule.selectors.some((s) => /^@(font-face|keyframes|-webkit-keyframes|page|property|counter-style)/.test(s))) continue;
    const sym = symmetricProps(rule.decls);
    for (const d of rule.decls) {
      if (sym.has(d.prop.toLowerCase())) continue;
      const fix = physicalFix(d.prop, d.value);
      if (!fix) continue;
      if (ALLOW_RE.test(lines[d.line - 1] ?? "") || ALLOW_RE.test(lines[d.line - 2] ?? "")) continue;
      out.push({ line: d.line, kind: "css", text: `${sel.replace(/\s+/g, " ").slice(0, 80)} { ${d.prop}: ${d.value} }`, fix });
    }
  }
  return out;
}

/* ----------------------------------------------------------- Tailwind --- */

// `ml-2`, `-mr-px`, `pl-[3px]`, `left-0`, `right-1/2`, `text-left`, `border-l`,
// `border-r-2`, `rounded-l-md`, `rounded-tr`, `float-right`, `scroll-ml-4`,
// with optional variants (`md:`, `hover:`, `rtl:` — `rtl:`/`ltr:` are explicit
// and not reported) and the `!` important prefix.
const TW_PHYSICAL = [
  [/^-?(m|p)(l|r)-/, (m) => `${m[1]}${m[2] === "l" ? "s" : "e"}-*`],
  [/^-?scroll-(m|p)(l|r)-/, (m) => `scroll-${m[1]}${m[2] === "l" ? "s" : "e"}-*`],
  [/^-?(left|right)-/, (m) => `${m[1] === "left" ? "start" : "end"}-*`],
  [/^text-(left|right)$/, (m) => `text-${m[1] === "left" ? "start" : "end"}`],
  [/^float-(left|right)$/, (m) => `float-${m[1] === "left" ? "start" : "end"}`],
  [/^clear-(left|right)$/, (m) => `clear-${m[1] === "left" ? "start" : "end"}`],
  [/^border-(l|r)(-|$)/, (m) => `border-${m[1] === "l" ? "s" : "e"}${m[2] ? "-*" : ""}`],
  [/^rounded-(l|r)(-|$)/, (m) => `rounded-${m[1] === "l" ? "s" : "e"}${m[2] ? "-*" : ""}`],
  [/^rounded-(tl|tr|bl|br)(-|$)/, (m) => `rounded-${{ tl: "ss", tr: "se", bl: "es", br: "ee" }[m[1]]}${m[2] ? "-*" : ""}`],
];

/** Physical Tailwind utilities in one class string: `{ token, fix }[]`. */
export function scanClassString(s) {
  const out = [];
  for (const token of String(s).split(/\s+/)) {
    if (!token) continue;
    const parts = token.split(":");
    const base = parts[parts.length - 1].replace(/^!/, "");
    const variants = parts.slice(0, -1);
    if (variants.some((v) => /^(rtl|ltr)$/.test(v))) continue;
    for (const [re, fix] of TW_PHYSICAL) {
      const m = re.exec(base);
      if (m) {
        out.push({ token, fix: fix(m) });
        break;
      }
    }
  }
  // the symmetric pair `left-0 right-0` mirrors
  const bases = out.map((o) => o.token.split(":").pop().replace(/^!/, ""));
  return out.filter((o, i) => {
    const b = bases[i];
    const twin = b.startsWith("left-") ? `right-${b.slice(5)}` : b.startsWith("right-") ? `left-${b.slice(6)}` : null;
    const pl = /^-?(m|p)(l|r)-/.exec(b);
    const twin2 = pl ? b.replace(/^(-?)(m|p)(l|r)-/, (_, s, mp, lr) => `${s}${mp}${lr === "l" ? "r" : "l"}-`) : null;
    return !((twin && bases.includes(twin)) || (twin2 && bases.includes(twin2)) || b === "left-1/2" || b === "right-1/2");
  });
}

/* ----------------------------------------------------------- TS / TSX --- */

const CLASS_CALLS = /^(cn|clsx|cx|twMerge|classNames|cva|tw)$/;
const CLASS_NAME = /class(Name|es)?$|Class$/;

function propName(n) {
  if (!n) return null;
  if (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  return null;
}

function literalText(n) {
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  if (ts.isTemplateExpression(n)) return [n.head.text, ...n.templateSpans.map((s) => s.literal.text)].join(" ");
  return null;
}

/** Is this object literal a style object? */
function isStyleObject(obj) {
  const p = obj.parent;
  if (!p) return false;
  if (ts.isJsxExpression(p) && p.parent && ts.isJsxAttribute(p.parent) && propName(p.parent.name) === "style") return true;
  if (ts.isPropertyAssignment(p) && /^(style|styles?|css)$/i.test(propName(p.name) ?? "")) return true;
  if (ts.isVariableDeclaration(p) && p.type && /CSSProperties/.test(p.type.getText())) return true;
  if (ts.isAsExpression(p) && /CSSProperties/.test(p.type.getText())) return true;
  if (ts.isSatisfiesExpression?.(p) && /CSSProperties/.test(p.type.getText())) return true;
  if (ts.isCallExpression(p) && p.expression.getText() === "Object.assign" && p.arguments[0] && /\.style$/.test(p.arguments[0].getText())) return true;
  return false;
}

/** Physical properties in one TS/TSX source: `{ line, kind, text, fix }[]`. */
export function scanTs(fileName, text) {
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : fileName.endsWith(".jsx") ? ts.ScriptKind.JSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
  const lines = text.split(/\r?\n/);
  const out = [];
  const push = (node, k, desc, fix) => {
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    if (ALLOW_RE.test(lines[line - 1] ?? "") || ALLOW_RE.test(lines[line - 2] ?? "")) return;
    out.push({ line, kind: k, text: desc, fix });
  };
  const classStrings = (n) => {
    const s = literalText(n);
    if (s != null) {
      for (const f of scanClassString(s)) push(n, "tailwind", f.token, f.fix);
      return;
    }
    if (ts.isConditionalExpression(n)) {
      classStrings(n.whenTrue);
      classStrings(n.whenFalse);
    } else if (ts.isBinaryExpression(n)) {
      classStrings(n.left);
      classStrings(n.right);
    } else if (ts.isParenthesizedExpression(n)) classStrings(n.expression);
    else if (ts.isArrayLiteralExpression(n)) n.elements.forEach(classStrings);
    else if (ts.isTemplateExpression(n)) n.templateSpans.forEach((sp) => classStrings(sp.expression));
    else if (ts.isObjectLiteralExpression(n)) {
      for (const p of n.properties) {
        const k = ts.isPropertyAssignment(p) ? propName(p.name) : null;
        if (k) for (const f of scanClassString(k)) push(p, "tailwind", f.token, f.fix);
        if (ts.isPropertyAssignment(p)) classStrings(p.initializer);
      }
    }
  };
  const visit = (node) => {
    if (ts.isObjectLiteralExpression(node) && isStyleObject(node)) {
      const decls = [];
      for (const p of node.properties) {
        if (!ts.isPropertyAssignment(p)) continue;
        const k = propName(p.name);
        if (!k) continue;
        // only a literal value is judged; `compact ? 8 : undefined` is not a shorthand
        const v = literalText(p.initializer) ?? (ts.isNumericLiteral(p.initializer) ? p.initializer.text : "");
        decls.push({ prop: kebab(k), value: v, shown: p.initializer.getText(sf), node: p, key: k });
      }
      const sym = symmetricProps(decls);
      for (const d of decls) {
        if (sym.has(d.prop)) continue;
        const fix = physicalFix(d.prop, d.value);
        if (fix) push(d.node, "style", `${d.key}: ${d.shown}`, fix);
      }
    }
    // el.style.marginLeft = …
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(node.left) && /\.style$/.test(node.left.expression.getText(sf))) {
      const k = node.left.name.text;
      const v = literalText(node.right) ?? "";
      const fix = physicalFix(kebab(k), v);
      if (fix) push(node, "style", `.style.${k} = ${node.right.getText(sf)}`, fix);
    }
    if (ts.isJsxAttribute(node) && /^(className|class)$/.test(propName(node.name) ?? "") && node.initializer) {
      if (ts.isStringLiteral(node.initializer)) classStrings(node.initializer);
      else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) classStrings(node.initializer.expression);
    }
    if (ts.isCallExpression(node) && CLASS_CALLS.test(node.expression.getText(sf))) node.arguments.forEach(classStrings);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && CLASS_NAME.test(node.name.text) && node.initializer) classStrings(node.initializer);
    if (ts.isPropertyAssignment(node) && CLASS_NAME.test(propName(node.name) ?? "")) classStrings(node.initializer);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** Scan one file by its extension. */
export function scanFile(fileName, text) {
  if (fileName.endsWith(".css")) return scanCss(text);
  if (/\.(tsx?|jsx)$/.test(fileName)) return scanTs(fileName, text);
  return [];
}

/**
 * Compare per-file counts with the baseline (it only goes down).
 * @param {Record<string, number>} counts today's counts (files with 0 left out)
 * @param {Record<string, number>} baseline
 * @returns {{ over: {file: string, now: number, was: number}[], under: {file: string, now: number, was: number}[] }}
 */
export function compareBaseline(counts, baseline) {
  const over = [];
  const under = [];
  for (const [file, now] of Object.entries(counts)) {
    const was = baseline[file] ?? 0;
    if (now > was) over.push({ file, now, was });
    else if (now < was) under.push({ file, now, was });
  }
  for (const [file, was] of Object.entries(baseline)) if (!(file in counts) && was > 0) under.push({ file, now: 0, was });
  return { over, under };
}
