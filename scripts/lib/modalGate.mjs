/**
 * The modal gate (plan 10.1, W10.E8): every modal dialog is the one
 * primitive, src/ui/Modal.tsx (a native <dialog> opened with showModal(),
 * its focus trap, Escape, focus back to the opener). A hand-built
 * `<div aria-modal>` outside it is a dialog that the page behind is not
 * inert for: this finds them. Plain JavaScript, shared by
 * src/__tests__/modalTraps.test.ts and eslint-rules/modal-only.js's tests.
 */

/** The one file allowed to set aria-modal. */
export const MODAL_FILE = "src/ui/Modal.tsx";

/**
 * `aria-modal` set on an element: a JSX attribute (`aria-modal="true"`,
 * `aria-modal={…}`, a bare `aria-modal`), an object key (`{ "aria-modal": … }`
 * spread onto an element) or `setAttribute("aria-modal", …)`. Not a CSS
 * selector that reads it (`[aria-modal="true"]`).
 */
const ARIA_MODAL = /(?<![[\w-])aria-modal(?=\s*=\s*[{"']|\s*[\s/>])|["']aria-modal["']\s*:|setAttribute\(\s*["']aria-modal["']/g;

/** Strip comments and string-free regions that cannot hold JSX attributes (line and block comments). */
function code(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:"'`])\/\/[^\n]*/g, (m, p) => p + " ".repeat(m.length - p.length));
}

/** The 1-based lines of `text` that set aria-modal. */
export function ariaModalLines(text) {
  const src = code(text);
  const out = [];
  for (const m of src.matchAll(ARIA_MODAL)) out.push(src.slice(0, m.index).split("\n").length);
  return out;
}

/** Does `text` render the Modal primitive? */
export const usesModal = (text) => /<Modal\b/.test(text);

/**
 * Problems in a set of files: [{ file, line, why }]. `files` is
 * [{ path, text }] with repo-relative paths.
 */
export function modalProblems(files) {
  const out = [];
  for (const { path, text } of files) {
    if (path === MODAL_FILE || !/\.(tsx|ts|jsx|js)$/.test(path) || /(^|\/)__tests__\//.test(path) || /\.test\.[jt]sx?$/.test(path)) continue;
    for (const line of ariaModalLines(text)) out.push({ file: path, line, why: "aria-modal outside src/ui/Modal.tsx: use <Modal> (a native <dialog>, inert background, focus trap)" });
  }
  return out;
}
