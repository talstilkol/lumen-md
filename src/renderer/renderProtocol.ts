/**
 * Messages between the preview and the render worker (plan 8.1), and the
 * handler the worker runs — kept apart from the worker's entry file so
 * tests can run the same handler in-thread, reply and all.
 */
import type { Root as HastRoot } from "hast";
import { unified } from "unified";
import { renderToHast, type HastOptions } from "./hastPipeline";
import { rehypeShikiWith } from "./shiki";
import { workerHighlighter } from "./shikiWorker";

export interface RenderRequest extends HastOptions {
  id: number;
  text: string;
  /** The source has `$`: run KaTeX (step 3). */
  math: boolean;
  /** The theme in force when the request was made: Shiki's default colour. */
  dark: boolean;
}

type RehypeKatex = typeof import("./katexPlugin").default;
let katexPromise: Promise<RehypeKatex> | null = null;
function loadKatex(): Promise<RehypeKatex> {
  if (!katexPromise) {
    katexPromise = import("./katexPlugin").then((m) => m.default);
    katexPromise.catch(() => {
      katexPromise = null;
    });
  }
  return katexPromise;
}

/** KaTeX and Shiki over the tree, in place (step 3: both off the main thread). */
export async function finishHast(hast: HastRoot, req: Pick<RenderRequest, "math" | "dark">): Promise<void> {
  const shiki = () => rehypeShikiWith(workerHighlighter, { isDark: () => req.dark });
  const finish = req.math ? unified().use(await loadKatex()).use(shiki) : unified().use(shiki);
  await finish.run(hast);
}

export type RenderResponse = { id: number; hast: HastRoot; error?: undefined } | { id: number; hast?: undefined; error: string };

/** One request → one reply; a failure is a reply too, never a thrown error. */
export async function handleRenderRequest(req: RenderRequest): Promise<RenderResponse> {
  try {
    const hast = await renderToHast(req.text, { raw: req.raw });
    await finishHast(hast, req);
    return { id: req.id, hast };
  } catch (e) {
    return { id: req.id, error: e instanceof Error ? e.message : String(e) };
  }
}
