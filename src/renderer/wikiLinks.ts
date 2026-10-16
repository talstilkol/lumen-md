/**
 * Wiki-link navigation in the preview. `[[Target]]` renders as an in-page
 * anchor (`#target`) — right for headings in the same note — but when the
 * note has no such heading the reader means another note: open the
 * workspace file whose name (or path) matches the target.
 */

/** Workspace path for a wiki target, matching file name or path, case-insensitively. */
export function resolveWikiTarget(target: string, paths: readonly string[]): string | null {
  const want = target.trim().toLowerCase().replace(/\.(md|markdown)$/, "");
  if (!want) return null;
  const strip = (p: string) => p.toLowerCase().replace(/\.(md|markdown)$/, "");
  return (
    paths.find((p) => strip(p) === want) ??
    paths.find((p) => strip(p.split("/").pop() ?? p) === want) ??
    null
  );
}

/**
 * Click handler for the preview root. Returns true when it took over the
 * click (opened a note); same-note heading anchors keep their default.
 */
export function handleWikiLinkClick(
  e: { target: EventTarget | null; preventDefault(): void },
  root: HTMLElement,
  listPaths: () => Promise<string[]>,
  open: (path: string) => void,
): boolean {
  const el = (e.target as Element | null)?.closest?.("a.wiki-link[data-wiki-target]");
  if (!el) return false;
  const href = el.getAttribute("href") ?? "";
  const id = href.startsWith("#") ? decodeURIComponent(href.slice(1)) : "";
  // A heading with that id in this note: keep the in-page jump.
  if (id && Array.from(root.querySelectorAll("[id]")).some((n) => n.id === id)) return false;
  e.preventDefault();
  const target = el.getAttribute("data-wiki-target") ?? "";
  void listPaths()
    .then((paths) => {
      const path = resolveWikiTarget(target, paths);
      if (path) open(path);
    })
    .catch(() => {
      /* no workspace (OPFS unavailable) — nothing to open */
    });
  return true;
}
