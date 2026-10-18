/**
 * C1 — build-time prerender of the first screen a new visitor sees: the
 * opening of the welcome document, as real text in index.html. It is
 * painted before any JavaScript runs, so the largest paint on a phone no
 * longer waits for React + the markdown pipeline. Returning visitors get
 * the neutral skeleton instead (public/boot.js marks them before paint).
 *
 * Deliberately tiny: headings, paragraphs and quotes from the intro
 * section only, with inline bold / italic / code / links.
 */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function inline(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}

/** Markdown of the welcome doc → HTML of its intro (up to the first `---` rule). */
export function prerenderIntro(md: string): string {
  const body = md.replace(/^---\n[\s\S]*?\n---\n/, "");
  const intro = body.split(/\n---\n/)[0];
  const out: string[] = [];
  for (const block of intro.split(/\n{2,}/)) {
    const b = block.trim();
    if (!b) continue;
    const h = /^(#{1,3})\s+(.*)$/.exec(b);
    if (h) out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
    else if (b.startsWith(">")) out.push(`<blockquote><p>${inline(b.replace(/^>\s?/gm, "").replace(/\n/g, " "))}</p></blockquote>`);
    else out.push(`<p>${inline(b.replace(/\n/g, " "))}</p>`);
  }
  return out.join("");
}
