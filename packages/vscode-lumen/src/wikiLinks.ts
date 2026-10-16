/**
 * Wiki-link helpers shared by the webview script and the extension. No
 * imports, so the webview bundle doesn't pull in the render pipeline.
 */
/** `Note#Heading` → note and heading (null when there is no `#`). */
export function splitWikiTarget(target: string): { note: string; heading: string | null } {
  const hash = target.indexOf("#");
  if (hash === -1) return { note: target.trim(), heading: null };
  const heading = target.slice(hash + 1).trim();
  return { note: target.slice(0, hash).trim(), heading: heading || null };
}

/**
 * The workspace-relative Markdown path a wiki note name points to: an exact
 * path match first, then a file-name match, case-insensitively, with or
 * without the extension. Same rules as the Lumen app.
 */
export function resolveWikiNote(note: string, paths: readonly string[]): string | null {
  const strip = (p: string) => p.toLowerCase().replace(/\.(md|markdown)$/, "");
  const want = strip(note.trim());
  if (!want) return null;
  return (
    paths.find((p) => strip(p) === want) ??
    paths.find((p) => strip(p.split("/").pop() ?? p) === want) ??
    null
  );
}

/**
 * What a click on a preview link should do in the webview: `null` to let
 * the browser handle it (an in-page heading that exists), or the message to
 * send to the extension. A `[[wiki link]]` renders as `#slug`; when this
 * document has no such heading it names another note, so it goes to the
 * extension as `openWikiLink`.
 */
export function previewClickMessage(
  a: Element,
  hasId: (id: string) => boolean,
): { type: "openLink"; href: string } | { type: "openWikiLink"; target: string } | null {
  const href = a.getAttribute("href") ?? "";
  if (!href.startsWith("#")) return { type: "openLink", href };
  let id = href.slice(1);
  try {
    id = decodeURIComponent(id);
  } catch {
    /* keep raw */
  }
  const target = a.getAttribute("data-wiki-target");
  if (target && a.classList.contains("wiki-link") && !hasId(id)) {
    return splitWikiTarget(target).note ? { type: "openWikiLink", target } : null;
  }
  return null; // in-page anchor: let the browser scroll
}
