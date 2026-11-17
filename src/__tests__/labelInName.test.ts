/**
 * Plan W13.Y3 — WCAG 2.5.3 Label in Name, for speech input (Voice Control,
 * Voice Access): a control whose visible text is "Restore" must answer to
 * "click Restore", so its accessible name must contain that text — in
 * English and in Hebrew.
 *
 * Two layers:
 *   1. every JSX element in src/ that sets aria-label and shows text is read
 *      with the TypeScript parser, both strings are resolved from the
 *      English and Hebrew catalogues, and the name must contain the text;
 *   2. the DOM check the browser runs use (src/a11y/wcag22.ts) is tested
 *      on real markup here.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import { labelInName, labelInNameViolations, normalizeLabel } from "../a11y/wcag22";

const SRC = resolve(__dirname, "..");

function merge(dir: string): Record<string, string> {
  return Object.assign({}, ...readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as Record<string, string>));
}
const EN = { ...merge(join(SRC, "i18n/lazy")), ...merge(join(SRC, "i18n/locales/en")) };
const HE = merge(join(SRC, "i18n/locales/he"));

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "__tests__" || e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...sources(p));
    else if (e.name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

type Piece = { key: string } | { text: string } | null;

/** `t("key", …)` → its key; a string literal → its text; anything else → null (unknown at build time). */
function piece(e: ts.Expression): Piece {
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return { text: e.text };
  if (ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === "t" && e.arguments[0] && ts.isStringLiteral(e.arguments[0])) return { key: e.arguments[0].text };
  if (ts.isParenthesizedExpression(e)) return piece(e.expression);
  return null;
}

/** A string in one language from pieces; `{var}` placeholders and unknown parts become "x" on both sides. */
function render(parts: Piece[], cat: Record<string, string>): string | null {
  let s = "";
  for (const p of parts) {
    if (!p) s += " x ";
    else if ("text" in p) s += p.text;
    else {
      const v = cat[p.key] ?? EN[p.key];
      if (v === undefined) return null;
      s += v;
    }
  }
  return s.replace(/\{\{?\w+\}?\}/g, " x ");
}

interface Found {
  where: string;
  name: Piece[];
  visible: Piece[];
}

/** Every element with an aria-label and visible text children we can resolve. */
function scan(file: string): Found[] {
  const src = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: Found[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isJsxElement(n)) {
      const attr = n.openingElement.attributes.properties.find((a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && a.name.getText() === "aria-label");
      if (attr?.initializer) {
        let name: Piece[] | null = null;
        const init = attr.initializer;
        if (ts.isStringLiteral(init)) name = [{ text: init.text }];
        else if (ts.isJsxExpression(init) && init.expression) {
          const e = init.expression;
          if (ts.isTemplateExpression(e)) name = [{ text: e.head.text }, ...e.templateSpans.flatMap((sp) => [piece(sp.expression), { text: sp.literal.text }])];
          else {
            const p = piece(e);
            name = p ? [p] : null;
          }
        }
        // Visible text: JSX text and t()/literal expressions among the direct children; an element child ends the run (icons are elements).
        const visible: Piece[] = [];
        let known = true;
        for (const c of n.children) {
          if (ts.isJsxText(c)) {
            if (c.text.trim()) visible.push({ text: c.text });
          } else if (ts.isJsxExpression(c)) {
            if (!c.expression) continue;
            const p = piece(c.expression);
            if (p) visible.push(p);
            else known = false;
          }
        }
        if (name && known && visible.some((p) => p && ("key" in p || p.text.trim())))
          out.push({ where: `${relative(SRC, file)}:${src.getLineAndCharacterOfPosition(n.getStart()).line + 1}`, name, visible });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
  return out;
}

describe("2.5.3 Label in Name, over the source (English and Hebrew)", () => {
  const found = sources(SRC).flatMap(scan);

  it("finds the controls it checks (not vacuous)", () => {
    expect(found.length).toBeGreaterThan(20);
  });

  for (const lang of ["en", "he"] as const) {
    it(`every control's name contains its visible text — ${lang}`, () => {
      const cat = lang === "en" ? EN : HE;
      const bad: string[] = [];
      for (const f of found) {
        const visible = render(f.visible, cat);
        const name = render(f.name, cat);
        if (visible === null || name === null) continue;
        if (!labelInName(visible, name)) bad.push(`${f.where}: shows “${visible.trim()}”, named “${name.trim()}”`);
      }
      expect(bad).toEqual([]);
    });
  }
});

describe("the DOM check (src/a11y/wcag22.ts)", () => {
  it("normalises like speech input hears: case, spacing, niqqud, decoration", () => {
    expect(normalizeLabel("  Restore…  ")).toBe("restore");
    expect(normalizeLabel("שָׁלוֹם")).toBe("שלום");
    expect(labelInName("Restore", "Restore notes/a.md")).toBe(true);
    expect(labelInName("שחזור", "שִׁחְזוּר הקובץ")).toBe(true);
    expect(labelInName("Delete", "Remove")).toBe(false);
    expect(labelInName("Save", "Save as")).toBe(true);
    // Partial words don't count: "Sav" is not "Save".
    expect(labelInName("Save", "Saved items")).toBe(false);
    // Icons and digits are not labels.
    expect(labelInName("×", "Close")).toBe(true);
    expect(labelInName("12", "Page 3")).toBe(true);
  });

  it("flags a button whose aria-label drops its text, and leaves the right ones alone", () => {
    document.body.innerHTML = `
      <button id="ok1">Restore</button>
      <button id="ok2" aria-label="Restore notes/a.md">Restore</button>
      <button id="ok3" aria-label="Close"><svg aria-hidden="true"></svg></button>
      <button id="bad1" aria-label="Remove">Delete</button>
      <span id="lbl">Undo rename</span><button id="ok4" aria-labelledby="lbl">Undo rename</button>
      <div role="tab" id="bad2" aria-label="Notes">נמחקו (6)</div>
      <button id="ok5" aria-label="Deleted (6) tab"><span aria-hidden="true">●</span> Deleted (6)</button>`;
    expect(labelInNameViolations(document.body).map((v) => v.element.id)).toEqual(["bad1", "bad2"]);
  });
});
