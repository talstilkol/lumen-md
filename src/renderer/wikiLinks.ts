/**
 * Wiki-link navigation in the preview. `[[Target]]` renders as an in-page
 * anchor (`#target`) — right for headings in the same note — but when the
 * note has no such heading the reader means another note: open the
 * workspace file whose name (or path) matches the target.
 */

/**
 * Split `Note#Heading` into the note and the heading fragment. A target
 * without `#` has no fragment; `#Heading` alone has an empty note.
 */
export function splitWikiTarget(target: string): { note: string; heading: string | null } {
  const hash = target.indexOf("#");
  if (hash === -1) return { note: target.trim(), heading: null };
  const heading = target.slice(hash + 1).trim();
  return { note: target.slice(0, hash).trim(), heading: heading || null };
}

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
  open: (path: string, heading?: string) => void,
): boolean {
  const el = (e.target as Element | null)?.closest?.("a.wiki-link[data-wiki-target]");
  if (!el) return false;
  const href = el.getAttribute("href") ?? "";
  const id = href.startsWith("#") ? decodeURIComponent(href.slice(1)) : "";
  // A heading with that id in this note: keep the in-page jump.
  if (id && Array.from(root.querySelectorAll("[id]")).some((n) => n.id === id)) return false;
  // `[[Note#Heading]]` names the note before the `#`; the heading is
  // carried through so the opened note can scroll to it. `[[#Heading]]`
  // is same-note only — nothing to open.
  const { note, heading } = splitWikiTarget(el.getAttribute("data-wiki-target") ?? "");
  if (!note) return false;
  e.preventDefault();
  void listPaths()
    .then((paths) => {
      const path = resolveWikiTarget(note, paths);
      if (!path) return;
      if (heading) open(path, heading);
      else open(path);
    })
    .catch(() => {
      /* no workspace (OPFS unavailable) — nothing to open */
    });
  return true;
}

/**
 * Scroll the preview to the heading with id `headingId` once it appears —
 * the note that was just opened renders asynchronously. Polls briefly and
 * gives up quietly (the heading may not exist in that note).
 */
export function scrollToHeadingWhenRendered(
  headingId: string,
  { intervalMs = 100, timeoutMs = 3000, doc = document } = {},
): void {
  const started = Date.now();
  const tick = () => {
    const el = Array.from(doc.querySelectorAll("[data-preview-root] [id]")).find((n) => n.id === headingId);
    if (el) {
      el.scrollIntoView({ block: "start" });
      return;
    }
    if (Date.now() - started < timeoutMs) setTimeout(tick, intervalMs);
  };
  // First look after a beat, so the previous note's DOM is gone.
  setTimeout(tick, intervalMs);
}
