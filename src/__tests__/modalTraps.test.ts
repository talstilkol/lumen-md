/**
 * Plan 10.1 / W10.E8 — the modal gate: no hand-built modal dialog anywhere.
 *
 * Every modal dialog of the app is <Modal> (src/ui/Modal.tsx): a native
 * <dialog> opened with showModal(), so the page behind is inert, with the
 * focus trap, Escape and focus back to the opener. The audit found 39 of
 * 65 `aria-modal` dialogs without a trap; now `aria-modal` may appear only
 * in Modal.tsx. The same rule is the `lumen/modal-only` ESLint rule
 * (eslint-rules/modal-only.js). The e2e side, e2e/a11y-dialogs.spec.ts,
 * opens every dialog in the browser.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
// @ts-expect-error — plain .mjs module without type declarations
import { MODAL_FILE, ariaModalLines, modalProblems, usesModal } from "../../scripts/lib/modalGate.mjs";
// @ts-expect-error — plain .mjs module without type declarations
import { DIALOGS } from "../../e2e/dialogs.registry.mjs";

const ROOT = resolve(__dirname, "../..");

function sources(dir: string, out: { path: string; text: string }[] = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== "__tests__" && name !== "node_modules") sources(p, out);
    } else if (/\.(tsx?|jsx?)$/.test(name)) out.push({ path: relative(ROOT, p).replace(/\\/g, "/"), text: readFileSync(p, "utf8") });
  }
  return out;
}

const files = sources(join(ROOT, "src"));

describe("the modal gate", () => {
  it("is red on a hand-built modal dialog (the check this gate runs)", () => {
    const bad = [
      { path: "src/ui/Bad.tsx", text: 'export const Bad = () => <div role="dialog" aria-modal="true" aria-label="x"><button /></div>;' },
      { path: "src/ui/Bare.tsx", text: "export const Bare = () => <div className='cmd-palette-backdrop' role=\"dialog\" aria-modal>x</div>;" },
      { path: "src/ui/Spread.tsx", text: 'const a = { "aria-modal": "true" } as const;\nexport const S = () => <div {...a} />;' },
      { path: "src/ui/Dom.ts", text: 'el.setAttribute("aria-modal", "true");' },
    ];
    expect(modalProblems(bad).map((p: { file: string; line: number }) => `${p.file}:${p.line}`)).toEqual(["src/ui/Bad.tsx:1", "src/ui/Bare.tsx:1", "src/ui/Spread.tsx:1", "src/ui/Dom.ts:1"]);
    // …and green on what is not one: the primitive itself, a selector that reads the attribute, a comment.
    expect(modalProblems([{ path: MODAL_FILE, text: '<dialog aria-modal="true" />' }])).toEqual([]);
    expect(ariaModalLines("t.closest('[aria-modal=\"true\"]');\n// aria-modal=\"true\" in prose")).toEqual([]);
  });

  it("0 aria-modal in src/ outside src/ui/Modal.tsx", () => {
    expect(modalProblems(files)).toEqual([]);
  });

  it("every dialog renders <Modal> (98: 86, then wave g3's 12, INT7)", () => {
    const modalFiles = files.filter((f) => f.path !== MODAL_FILE && usesModal(f.text));
    const count = modalFiles.reduce((n, f) => n + (f.text.match(/<Modal\b/g)?.length ?? 0), 0);
    expect(count).toBe(98);
    // The e2e registry names every one of them, with how to open it.
    const registered = new Set((DIALOGS as Array<{ file: string }>).map((d) => d.file));
    for (const f of modalFiles) expect(registered.has(f.path), f.path).toBe(true);
  });

  it("the ESLint rule is on for the app's sources", () => {
    const config = readFileSync(join(ROOT, "eslint.config.js"), "utf8");
    expect(config).toContain('import modalOnly from "./eslint-rules/modal-only.js"');
    expect(config).toMatch(/"lumen\/modal-only": "error"/);
  });
});
