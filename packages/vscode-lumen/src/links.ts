/**
 * Link handling for the preview webview. A webview's document has an opaque
 * URI, so a relative `href` like `next.md` can't navigate anywhere on its
 * own; the webview script forwards link clicks to the extension, which uses
 * these pure helpers to decide what to do. No `vscode` import — unit-tested
 * in plain Node.
 */

export type LinkAction =
  /** In-page anchor: let the webview scroll. */
  | { kind: "fragment" }
  /** Open in the system browser / mail client. */
  | { kind: "external"; url: string }
  /** A workspace file relative to the previewed document. */
  | { kind: "relative"; path: string; fragment: string }
  /** Anything else (javascript:, data:, file:, command:, …) is ignored. */
  | { kind: "ignore" };

const EXTERNAL = /^(https?:|mailto:)/i;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

export function classifyLink(href: string): LinkAction {
  const h = href.trim();
  if (!h) return { kind: "ignore" };
  if (h.startsWith("#")) return { kind: "fragment" };
  if (EXTERNAL.test(h)) return { kind: "external", url: h };
  if (SCHEME.test(h) || h.startsWith("//")) return { kind: "ignore" };
  const hash = h.indexOf("#");
  const beforeHash = hash < 0 ? h : h.slice(0, hash);
  const fragment = hash < 0 ? "" : h.slice(hash + 1);
  const query = beforeHash.indexOf("?");
  let path = query < 0 ? beforeHash : beforeHash.slice(0, query);
  try {
    path = decodeURI(path);
  } catch {
    /* keep raw */
  }
  if (!path) return { kind: "fragment" };
  return { kind: "relative", path, fragment };
}

/** GitHub-style heading slug (what Lumen's preview uses for heading ids). */
export function slugifyHeading(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/<[^>]*>/g, "")
    .replace(/[*_`~[\]()]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");
}

/**
 * 0-based line of the ATX heading whose slug matches `fragment` (decoded,
 * case-insensitive), or -1. Duplicate headings get GitHub's `-1`, `-2`…
 * suffixes. Fenced code blocks are skipped.
 */
export function findHeadingLine(markdown: string, fragment: string): number {
  let target = fragment;
  try {
    target = decodeURIComponent(fragment);
  } catch {
    /* keep raw */
  }
  target = target.toLowerCase();
  const seen = new Map<string, number>();
  let fence: string | null = null;
  const lines = markdown.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      continue;
    }
    if (fence) continue;
    const h = /^ {0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (!h) continue;
    const base = slugifyHeading(h[1]);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    const slug = n === 0 ? base : `${base}-${n}`;
    if (slug === target) return i;
  }
  return -1;
}
