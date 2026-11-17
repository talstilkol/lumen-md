/**
 * Typst → PDF in the browser (plan W12.F2): the typst.ts compiler
 * (Myriad-Dreamin/typst.ts, Apache-2.0) as WebAssembly, loaded on demand
 * from this origin, with a Hebrew font from this origin — no network, no
 * CDN (the CSP allows neither), nothing in the startup bundle or in any
 * chunk: the compiler is a separate vendored module, imported by URL only
 * when the user exports.
 *
 * The vendored folder (`/vendor/typst/`, git-ignored like public/pyodide)
 * is written by scripts/typst/vendor.mjs from the npm packages:
 *   typst.mjs      our entry (scripts/typst/entry.mjs) bundled with typst.ts,
 *                  exporting createCompiler({ wasmUrl, fonts })
 *   compiler.wasm  typst-ts-web-compiler's wasm
 *   fonts.json     the font files (TTF/OTF: Typst reads no WOFF2) and their licences
 * A build without it has no Typst PDF, and says so; the .typ export works
 * either way.
 */
export const TYPST_BASE = "/vendor/typst/";

export interface TypstCompiler {
  /** The PDF of a Typst source, or throws with the compiler's diagnostics. */
  pdf(main: string): Promise<Uint8Array>;
}

export interface TypstVendor {
  createCompiler(opts: { wasmUrl: string; fonts: Uint8Array[] }): Promise<TypstCompiler>;
}

export class TypstUnavailableError extends Error {
  constructor(readonly reason: "not-installed" | "no-fonts") {
    super(reason);
  }
}

export interface TypstDeps {
  /** import() of the vendored module, by URL (kept out of every bundle). */
  importVendor: (url: string) => Promise<TypstVendor>;
  fetch: (url: string) => Promise<Response>;
  base?: string;
}

const defaultDeps = (): TypstDeps => ({
  importVendor: (url) => import(/* @vite-ignore */ url) as Promise<TypstVendor>,
  // privacy-ledger: same-origin static files of this app (the vendored compiler and fonts)
  fetch: (url) => fetch(url, { credentials: "omit" }),
});

let loading: Promise<TypstCompiler> | null = null;

/** The compiler, loaded once: the vendored module, its wasm, and every listed font (all same origin). */
export function loadTypstCompiler(deps: TypstDeps = defaultDeps()): Promise<TypstCompiler> {
  loading ??= (async () => {
    const base = deps.base ?? TYPST_BASE;
    const list = await deps.fetch(`${base}fonts.json`).catch(() => null);
    if (!list?.ok) throw new TypstUnavailableError("not-installed");
    const { fonts } = (await list.json()) as { fonts: Array<{ file: string }> };
    const bytes = await Promise.all(
      (fonts ?? []).map(async (f) => {
        if (!/^[\w.-]+\.(ttf|otf)$/i.test(f.file)) throw new TypstUnavailableError("no-fonts");
        const r = await deps.fetch(`${base}fonts/${f.file}`);
        if (!r.ok) throw new TypstUnavailableError("no-fonts");
        return new Uint8Array(await r.arrayBuffer());
      }),
    );
    if (!bytes.length) throw new TypstUnavailableError("no-fonts");
    const vendor = await deps.importVendor(`${base}typst.mjs`).catch(() => {
      throw new TypstUnavailableError("not-installed");
    });
    return vendor.createCompiler({ wasmUrl: `${base}compiler.wasm`, fonts: bytes });
  })();
  loading.catch(() => (loading = null));
  return loading;
}

/** Markdown → Typst (the app's writer, ./exportTypst.ts) → PDF. */
export async function markdownToTypstPdf(md: string, title: string, deps?: TypstDeps): Promise<Uint8Array> {
  const [{ markdownToTypst }, compiler] = await Promise.all([import("./exportTypst"), loadTypstCompiler(deps)]);
  return compiler.pdf(markdownToTypst(md, { title }));
}

/** Test hook. */
export function __resetTypst(): void {
  loading = null;
}
