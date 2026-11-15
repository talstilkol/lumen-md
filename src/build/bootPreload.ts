/**
 * The lazy chunks a start loads, listed in index.html for public/boot.js
 * (plan W2.21, W10.E20). Vite preloads the entry's static imports itself;
 * the start then waits on lazy ones in a chain: the bundle runs, asks for
 * the vault's location module and the saved language's strings, renders,
 * and only then asks for the editor. boot.js reads this list in <head> and
 * adds a `<link rel="modulepreload">` for the ones this start needs (the
 * saved language, the saved view's editor), so they download in parallel
 * with the bundle.
 *
 * Each listed chunk comes with its own static imports, minus what the entry
 * already loads. The list is `<script type="application/json">` data (the
 * CSP allows no inline script; data is not run), placed just before boot.js.
 *
 * This module is build tooling: imported by vite.config.ts and tests, never
 * by the app bundle.
 */
import type { Plugin } from "vite";

/** The id of the data tag boot.js reads. */
export const BOOT_PRELOAD_ID = "lumen-boot-preload";

/** Lazy modules every start loads (main.tsx, before the first render). */
export const ALWAYS = ["src/storage/vault/location.ts", "src/store/vaultDocs.ts"];
/** The editor each saved view mounts (layouts/EditorLayout.tsx). */
export const EDITORS: Record<string, string> = { source: "src/editor/Editor.tsx", wysiwyg: "src/editor/WysiwygEditor.tsx" };
const LOCALE_FILE = /\/src\/i18n\/locales\/([^/]+)\/[^/]+\.json$/;

/** The parts of a Rollup/Rolldown output chunk this reads. */
export interface ChunkInfo {
  type: "chunk" | "asset";
  fileName: string;
  facadeModuleId?: string | null;
  imports?: readonly string[];
  isEntry?: boolean;
}

export interface BootPreload {
  always: string[];
  editors: Record<string, string[]>;
  locales: Record<string, string[]>;
}

const norm = (id: string) => id.replace(/\\/g, "/").replace(/\?.*$/, "");

/** `file` and its static imports, recursively. */
function closure(bundle: Record<string, ChunkInfo>, file: string, out = new Set<string>()): Set<string> {
  if (out.has(file)) return out;
  const c = bundle[file];
  if (!c || c.type !== "chunk") return out;
  out.add(file);
  for (const dep of c.imports ?? []) closure(bundle, dep, out);
  return out;
}

/** The preload list for the page whose entry chunk is `entry` (pure part; tests). */
export function bootPreloadList(bundle: Record<string, ChunkInfo>, entry: string, base = "/"): BootPreload {
  const eager = closure(bundle, entry);
  const chunks = Object.values(bundle).filter((c) => c.type === "chunk");
  const byModule = (suffix: string) => chunks.find((c) => c.facadeModuleId && norm(c.facadeModuleId).endsWith(`/${suffix}`));
  const files = (c: ChunkInfo | undefined): string[] => (c ? [...closure(bundle, c.fileName)].filter((f) => !eager.has(f)).map((f) => base + f) : []);
  const uniq = (xs: string[]) => [...new Set(xs)];
  const locales: Record<string, string[]> = {};
  for (const c of chunks) {
    const m = LOCALE_FILE.exec(norm(c.facadeModuleId ?? ""));
    if (m && m[1] !== "en") locales[m[1]] = uniq([...(locales[m[1]] ?? []), ...files(c)]);
  }
  return {
    always: uniq(ALWAYS.flatMap((m) => files(byModule(m)))),
    editors: Object.fromEntries(Object.entries(EDITORS).map(([k, m]) => [k, files(byModule(m))])),
    locales,
  };
}

/** index.html with the list as a data tag right before boot.js (unchanged when boot.js is not there). */
export function injectBootPreload(html: string, list: BootPreload): string {
  const tag = '<script src="/boot.js"></script>';
  const at = html.indexOf(tag);
  if (at < 0) return html;
  // `<` escaped, so no text in a file name can close the tag.
  const json = JSON.stringify(list).replace(/</g, "\\u003c");
  return `${html.slice(0, at)}<script type="application/json" id="${BOOT_PRELOAD_ID}">${json}</script>\n    ${html.slice(at)}`;
}

export function bootPreloadPlugin(): Plugin {
  let base = "/";
  return {
    name: "lumen-boot-preload",
    apply: "build",
    configResolved(config) {
      base = config.base || "/";
    },
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        if (!ctx.bundle || !ctx.chunk || !/(^|\/)index\.html$/.test(ctx.path)) return html;
        return injectBootPreload(html, bootPreloadList(ctx.bundle as unknown as Record<string, ChunkInfo>, ctx.chunk.fileName, base));
      },
    },
  };
}
