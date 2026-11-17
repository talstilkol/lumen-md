/**
 * The app's link rewrite for `lumen move` / `lumen rename` (plan W13.K1).
 *
 * Moving a note must change its links exactly the way moving it in the app
 * does (src/storage/linkRewriteCore.ts: wiki links, embeds, Markdown links,
 * reference definitions, code left alone, Hebrew names kept readable). This
 * package cannot import the app, so the build bundles that file into
 * `dist/links-engine.js` (scripts/bundle-bases.mjs), and tests pass it in.
 */

export interface RewriteOptions {
  folder?: boolean;
  notePrevPath?: string;
  vault?: readonly string[];
}

export interface LinksEngine {
  rewriteLinks(content: string, notePath: string, oldPath: string, newPath: string, opts?: RewriteOptions): string;
  noteKey(s: string): string;
}

let engine: LinksEngine | null = null;

export function setLinksEngine(e: LinksEngine | null): void {
  engine = e;
}

export class LinksUnavailableError extends Error {}

export async function linksEngine(): Promise<LinksEngine> {
  if (engine) return engine;
  const spec = new URL("../links-engine.js", import.meta.url).href;
  try {
    engine = (await import(spec)) as LinksEngine;
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== "ERR_MODULE_NOT_FOUND") throw e;
    throw new LinksUnavailableError("Moving notes needs the link engine, which is not in this build (dist/links-engine.js is missing). Build it with `npm run build` in mcp-server/ after `npm ci` in the repository root.");
  }
  return engine;
}

/** A plain fallback key for reads when the engine is missing: case and niqqud folded. */
export function plainKey(s: string): string {
  return s.normalize("NFD").replace(/[֑-ׇ]/g, "").toLocaleLowerCase().normalize("NFC").trim();
}
