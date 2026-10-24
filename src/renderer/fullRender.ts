/**
 * The full render up to the finished HAST (plan 8.1), loaded lazily by
 * pipeline.ts: Markdown → HAST with KaTeX and Shiki in the render worker,
 * and — when the tree was made on the main thread because no worker could
 * run — the main thread's own KaTeX and Shiki passes over it.
 */
import { unified } from "unified";
import type { Root as HastRoot } from "hast";
import { rehypeShiki } from "./shiki";
import { hasMath, hasRawHtml } from "./hastPipeline";

type RehypeKatex = typeof import("./katexPlugin").default;

let katexPromise: Promise<RehypeKatex> | null = null;

function loadKatex(): Promise<RehypeKatex> {
  if (!katexPromise) {
    katexPromise = import("./katexPlugin").then((m) => m.default);
    katexPromise.catch(() => {
      katexPromise = null; // allow a retry after a failed chunk fetch
    });
  }
  return katexPromise;
}

/** Markdown → finished HAST (KaTeX and Shiki applied). */
export async function renderMarkdownHast(markdownText: string, isDark: () => boolean): Promise<HastRoot> {
  const math = hasMath(markdownText);
  const { renderHast } = await import("./renderClient");
  const { hast, finished } = await renderHast(markdownText, { raw: hasRawHtml(markdownText), math, dark: isDark() });
  // The worker already ran KaTeX and Shiki (step 3); a tree made in-thread didn't.
  if (!finished) {
    const rehypeKatex = math ? await loadKatex() : null;
    // The finishing passes run on the tree in place (unified's `run`).
    const finish = rehypeKatex ? unified().use(rehypeKatex).use(rehypeShiki, { isDark }) : unified().use(rehypeShiki, { isDark });
    await finish.run(hast);
  }
  return hast;
}
