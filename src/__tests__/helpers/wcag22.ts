/**
 * Checks for the WCAG 2.2 criteria axe mostly can't see (plan W13.Y3, W13.Y5),
 * shared by the unit tests (src/__tests__/labelInName.test.ts,
 * wcag22New.test.ts) and the browser runs (e2e/a11y.spec.ts):
 *
 *   2.5.3 Label in Name        the accessible name of a control contains its visible text
 *   2.5.8 Target Size (Min.)   a target is 24 × 24 CSS px, or spaced so 24 px circles don't touch
 *   2.4.11 Focus Not Obscured  the focused control is not entirely hidden by sticky or fixed content
 *
 * Pure DOM: no app imports, so a Playwright page can inject it too.
 */

/** What a speech-input user says matches when the name contains it: case, spacing, niqqud and decoration don't count. */
export function normalizeLabel(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-֑ͯ-ׇ]/g, "")
    .replace(/[‎‏⁦-⁩‪-‮]/g, "")
    .replace(/[…●•·:：,.!?()[\]{}"'“”„«»‹›→←↑↓⌘⇧⌥⌃+\-–—/\\|*#]/g, " ")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Whether `name` satisfies 2.5.3 for `visible`: the visible text, as words,
 * appears in the name (WCAG's best practice: at the start; required: inside).
 * Visible text that is only symbols, digits or one letter is an icon, not a label.
 */
export function labelInName(visible: string, name: string): boolean {
  const v = normalizeLabel(visible);
  if (!v || v.length < 2 || !/\p{L}{2}/u.test(v)) return true;
  return ` ${normalizeLabel(name)} `.includes(` ${v} `);
}

const INTERACTIVE = 'button, a[href], input[type="button"], input[type="submit"], [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"], [role="switch"], [role="checkbox"], [role="radio"], summary';

/** The text a sighted user reads on `el` (aria-hidden parts left out). */
export function visibleText(el: Element): string {
  let out = "";
  const walk = (n: Node) => {
    if (n.nodeType === 3) out += n.textContent ?? "";
    else if (n.nodeType === 1) {
      const e = n as Element;
      if (e.getAttribute("aria-hidden") === "true" || (e as HTMLElement).hidden) return;
      if (e.tagName === "INPUT" && (e as HTMLInputElement).type !== "button" && (e as HTMLInputElement).type !== "submit") return;
      for (const c of e.childNodes) walk(c);
    }
  };
  walk(el);
  if (el.tagName === "INPUT") out = (el as HTMLInputElement).value;
  return out.replace(/\s+/g, " ").trim();
}

/** The name `aria-labelledby` or `aria-label` gives (null: the name comes from the content, which 2.5.3 meets by construction). */
export function authoredName(el: Element): string | null {
  const ids = el.getAttribute("aria-labelledby");
  if (ids) {
    const doc = el.ownerDocument;
    return ids
      .split(/\s+/)
      .map((id) => doc.getElementById(id)?.textContent ?? "")
      .join(" ")
      .trim();
  }
  const label = el.getAttribute("aria-label");
  return label === null ? null : label;
}

export interface LabelViolation {
  element: Element;
  visible: string;
  name: string;
}

export function labelInNameViolations(root: ParentNode): LabelViolation[] {
  const out: LabelViolation[] = [];
  for (const el of root.querySelectorAll(INTERACTIVE)) {
    const name = authoredName(el);
    if (name === null) continue;
    const visible = visibleText(el);
    if (!labelInName(visible, name)) out.push({ element: el, visible, name });
  }
  return out;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const TARGET_MIN = 24;

/**
 * 2.5.8 over boxes: each box under 24 × 24 passes only if a 24 px-diameter
 * circle centred on it intersects no other target and no other undersized
 * target's circle (the spacing exception). Returns the failing indexes.
 */
export function undersizedTargets(boxes: readonly Box[]): number[] {
  const small = boxes.map((b) => b.width < TARGET_MIN || b.height < TARGET_MIN);
  const centre = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  const r = TARGET_MIN / 2;
  const circleHitsBox = (c: { x: number; y: number }, b: Box) => {
    const dx = Math.max(b.x - c.x, 0, c.x - (b.x + b.width));
    const dy = Math.max(b.y - c.y, 0, c.y - (b.y + b.height));
    return dx * dx + dy * dy < r * r;
  };
  const fail: number[] = [];
  boxes.forEach((b, i) => {
    if (!small[i]) return;
    const c = centre(b);
    const clash = boxes.some((o, j) => {
      if (j === i) return false;
      if (circleHitsBox(c, o)) return true;
      if (small[j]) {
        const d = centre(o);
        return Math.hypot(c.x - d.x, c.y - d.y) < 2 * r;
      }
      return false;
    });
    if (clash) fail.push(i);
  });
  return fail;
}

/** Interactive targets of `root` that fail 2.5.8 (layout needed: a browser). Links inside running text are exempt (WCAG's inline exception). */
export function targetSizeViolations(root: ParentNode): Element[] {
  const els = [...root.querySelectorAll(`${INTERACTIVE}, input:not([type="hidden"]), select, textarea`)].filter((el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    if (el.tagName === "A" && el.closest("p, li, td, blockquote, .prose-lumen, .cm-content")) return false;
    // A control whose size the user agent sets (a native checkbox inside its label) counts with the label.
    return getComputedStyle(el).visibility !== "hidden";
  });
  const boxes = els.map((el) => {
    const r = (el.closest("label") ?? el).getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  return undersizedTargets(boxes).map((i) => els[i]);
}

/**
 * 2.4.11: true when the focused element is entirely covered by content
 * that is position: fixed or sticky (a toolbar, a toast) — every sampled
 * point of it hits something else.
 */
export function focusObscured(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  const doc = el.ownerDocument;
  const pts = [
    [r.left + r.width / 2, r.top + r.height / 2],
    [r.left + 2, r.top + 2],
    [r.right - 2, r.top + 2],
    [r.left + 2, r.bottom - 2],
    [r.right - 2, r.bottom - 2],
  ];
  return pts.every(([x, y]) => {
    const top = doc.elementFromPoint(x, y);
    if (!top || el.contains(top) || top.contains(el)) return false;
    for (let n: Element | null = top; n; n = n.parentElement) {
      const pos = getComputedStyle(n).position;
      if (pos === "fixed" || pos === "sticky") return true;
    }
    return false;
  });
}
