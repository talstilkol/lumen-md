/**
 * The pseudo-locale scan (plan W13.I1), run inside the page by
 * e2e/i18n-pseudo.spec.ts. Under en-XA / ar-XB every UI string is accented,
 * 40 % longer and inside ⟦ ⟧ (scripts/lib/i18n-pseudo.mjs). So, in a surface:
 *
 *   hard-coded  visible text (or an aria-label / title / placeholder) with
 *               Latin words that no ⟦ ⟧ string covers: it never went through t()
 *   truncated   a ⟦ string whose box clips it (overflow hidden / ellipsis and
 *               scrollWidth > clientWidth, or the same vertically)
 *
 * Self-contained (no imports, no closures) so Playwright can pass it to
 * page.evaluate; e2e/__tests__ is not needed — scripts/pseudo-scan-check.mjs
 * runs it in real Chromium on planted cases.
 */
export interface PseudoFinding {
  kind: "hard-coded" | "truncated";
  text: string;
  where: string;
}

export function pseudoScan(scopeSelector: string | null, ignoreSelectors: string[]): PseudoFinding[] {
  const OPEN = "⟦";
  const CLOSE = "⟧";
  // Words that are the same in every language: product, format and key names.
  const SAME = /^(?:Lumen|Markdown|Mermaid|LaTeX|KaTeX|PDF|HTML|CSV|JSON|YAML|URL|API|AI|GPU|WebGPU|Ollama|GitHub|Git|Zotero|Obsidian|Notion|Excalidraw|tldraw|Ctrl|Cmd|Alt|Shift|Esc|Tab|Enter|OK|RTL|LTR|MCP|ACP|OPFS|WebDAV|S3|iOS|Android|macOS|Windows|Linux|Chrome|Firefox|Safari|Edge|v?\d[\w.-]*)$/;
  const root: Element = (scopeSelector && document.querySelector(scopeSelector)) || document.body;
  const ignored = (el: Element | null) => !!el && ignoreSelectors.some((s) => el.closest(s));
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none" && !el.closest('[aria-hidden="true"]');
  };
  const latinWords = (s: string) => (s.match(/[A-Za-z][A-Za-z'’-]+/g) ?? []).filter((w) => !SAME.test(w));
  const where = (el: Element) => {
    const parts: string[] = [];
    for (let e: Element | null = el; e && parts.length < 4 && e !== document.body; e = e.parentElement) {
      parts.unshift(`${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ""}${e.classList.length ? `.${[...e.classList].slice(0, 2).join(".")}` : ""}`);
    }
    return parts.join(" > ");
  };
  /** True when text at `el` lies inside a ⟦ … ⟧ of some ancestor's text (rich strings split one string over elements). */
  const covered = (el: Element, text: string) => {
    for (let e: Element | null = el, i = 0; e && i < 6; e = e.parentElement, i++) {
      const all = e.textContent ?? "";
      const at = all.indexOf(text);
      if (at < 0) continue;
      const open = all.lastIndexOf(OPEN, at);
      const close = all.indexOf(CLOSE, at + text.length - 1);
      if (open >= 0 && close >= 0 && all.lastIndexOf(CLOSE, at) < open) return true;
    }
    return false;
  };
  const out: PseudoFinding[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    const text = (n.textContent ?? "").trim();
    if (!el || !text || ignored(el) || !visible(el)) continue;
    if (el.closest("script, style, code, pre, kbd, .cm-content, [contenteditable='true'], [data-user-content]")) continue;
    if (!latinWords(text).length) continue;
    if (text.includes(OPEN) || text.includes(CLOSE) || covered(el, text)) continue;
    out.push({ kind: "hard-coded", text: text.slice(0, 80), where: where(el) });
  }
  for (const el of root.querySelectorAll("[aria-label], [title], [placeholder]")) {
    if (ignored(el) || !visible(el)) continue;
    for (const attr of ["aria-label", "title", "placeholder"]) {
      const v = el.getAttribute(attr)?.trim();
      if (!v || !latinWords(v).length || v.includes(OPEN)) continue;
      out.push({ kind: "hard-coded", text: `${attr}="${v.slice(0, 70)}"`, where: where(el) });
    }
  }
  // A label is cut off when the box around its own text clips it: the text's element or one of
  // its two nearest ancestors (a button's span, the button, its toolbar slot).
  const seen = new Set<Element>();
  const clipped = (el: Element) => {
    const cs = getComputedStyle(el);
    if (["auto", "scroll"].includes(cs.overflowX) || ["auto", "scroll"].includes(cs.overflowY)) return false;
    const clipsX = cs.overflowX !== "visible" || cs.textOverflow === "ellipsis";
    const clipsY = cs.overflowY === "hidden" || cs.overflowY === "clip" || (cs.webkitLineClamp ?? "none") !== "none";
    return (clipsX && el.scrollWidth > el.clientWidth + 1) || (clipsY && el.scrollHeight > el.clientHeight + 1);
  };
  const texts = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = texts.nextNode(); n; n = texts.nextNode()) {
    if (!/[⟦⟧]/.test(n.textContent ?? "")) continue;
    let el = n.parentElement;
    for (let i = 0; el && i < 3; el = el.parentElement, i++) {
      if (seen.has(el) || ignored(el) || !visible(el)) continue;
      seen.add(el);
      if (clipped(el)) {
        out.push({ kind: "truncated", text: (el.textContent ?? "").trim().slice(0, 80), where: where(el) });
        break;
      }
    }
  }
  return out;
}
