/**
 * Messages between the preview and the render worker (plan 8.1), and the
 * handler the worker runs — kept apart from the worker's entry file so
 * tests can run the same handler in-thread, reply and all.
 */
import type { Root as HastRoot } from "hast";
import { renderToHast, type HastOptions } from "./hastPipeline";

export interface RenderRequest extends HastOptions {
  id: number;
  text: string;
}

export type RenderResponse = { id: number; hast: HastRoot; error?: undefined } | { id: number; hast?: undefined; error: string };

/** One request → one reply; a failure is a reply too, never a thrown error. */
export async function handleRenderRequest(req: RenderRequest): Promise<RenderResponse> {
  try {
    const hast = await renderToHast(req.text, { raw: req.raw });
    return { id: req.id, hast };
  } catch (e) {
    return { id: req.id, error: e instanceof Error ? e.message : String(e) };
  }
}
