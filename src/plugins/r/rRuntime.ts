/**
 * Shared webR (R compiled to WebAssembly) instance for ```live-r blocks.
 * Booted on the first Run and reused by every R block on the page; the
 * runtime is self-hosted under /webr/ (scripts/copy-webr.mjs), so it needs
 * no CDN and works offline. webR runs R in its own worker; the PostMessage
 * channel is used because the app is not cross-origin isolated
 * (no SharedArrayBuffer).
 */
import type { WebR as WebRType } from "webr";

export interface ROutputLine {
  kind: "out" | "err" | "warn" | "msg";
  text: string;
}

export interface RRunResult {
  lines: ROutputLine[];
  images: ImageBitmap[];
}

let instance: Promise<WebRType> | null = null;

/** Where the runtime is served (respects a non-root Vite base path). */
export function webrBaseUrl(base: string = import.meta.env?.BASE_URL ?? "/"): string {
  return `${base.replace(/\/?$/, "/")}webr/`;
}

/** Boot (once) and return the shared webR instance. */
export function getWebR(): Promise<WebRType> {
  if (!instance) {
    instance = (async () => {
      const { WebR, ChannelType } = await import("webr");
      const webR = new WebR({
        baseUrl: webrBaseUrl(),
        channelType: ChannelType.PostMessage,
        interactive: false,
      });
      await webR.init();
      return webR;
    })();
    instance.catch(() => {
      instance = null; // let a later Run retry
    });
  }
  return instance;
}

/** Tear the shared runtime down (after a timeout); the next Run boots a fresh one. */
export async function resetWebR(): Promise<void> {
  const cur = instance;
  instance = null;
  try {
    (await cur)?.close();
  } catch {
    /* already gone */
  }
}

/** Map webR's captured output entries to display lines. */
export function toLines(output: ReadonlyArray<{ type: string; data: unknown }>): ROutputLine[] {
  const lines: ROutputLine[] = [];
  for (const o of output) {
    const text =
      typeof o.data === "string"
        ? o.data
        : o.data && typeof (o.data as { message?: unknown }).message === "string"
          ? (o.data as { message: string }).message
          : String(o.data);
    const kind: ROutputLine["kind"] =
      o.type === "stdout" ? "out" : o.type === "warning" ? "warn" : o.type === "message" ? "msg" : "err";
    lines.push({ kind, text });
  }
  return lines;
}

/**
 * Collect plot pages from webR's output queue: each `canvasNewPage` starts a
 * page, and the latest `canvasImage` after it is that page's final state.
 */
export function plotPages(msgs: ReadonlyArray<{ type: string; data?: unknown }>): ImageBitmap[] {
  const pages: Array<ImageBitmap | null> = [];
  for (const m of msgs) {
    if (m.type !== "canvas") continue;
    const data = m.data as { event?: string; image?: ImageBitmap } | undefined;
    if (data?.event === "canvasNewPage") pages.push(null);
    else if (data?.event === "canvasImage" && data.image) {
      if (pages.length === 0) pages.push(null);
      pages[pages.length - 1] = data.image;
    }
  }
  return pages.filter((p): p is ImageBitmap => p !== null);
}

/** Run R code, capturing printed output, messages, warnings and plots. */
export async function runR(code: string, plot = { width: 504, height: 360 }): Promise<RRunResult> {
  const webR = await getWebR();
  await webR.flush(); // drop anything left over from an earlier run
  // webR's built-in graphics capture fails over the PostMessage channel, so
  // open its canvas device ourselves and read the frames from the queue.
  await webR.evalRVoid(`webr::canvas(width = ${Math.round(plot.width)}, height = ${Math.round(plot.height)})`);
  const shelter = await new webR.Shelter();
  try {
    const res = await shelter.captureR(code, {
      withAutoprint: true,
      captureStreams: true,
      captureConditions: true,
      captureGraphics: false,
      throwJsException: false,
    });
    await webR.evalRVoid("while (grDevices::dev.cur() > 1) grDevices::dev.off()");
    const images = plotPages(await webR.flush());
    return { lines: toLines(res.output), images };
  } finally {
    await shelter.purge();
  }
}
