/**
 * The vendored Typst module's entry (plan W12.F2), bundled with typst.ts by
 * scripts/typst/vendor.mjs into public/vendor/typst/typst.mjs. It is the
 * only file that knows typst.ts's API; the app sees createCompiler alone
 * (src/storage/typstPdf.ts).
 */
import { $typst } from "@myriaddreamin/typst.ts";
import { TypstSnippet } from "@myriaddreamin/typst.ts/contrib/snippet";

export async function createCompiler({ wasmUrl, fonts }) {
  $typst.setCompilerInitOptions({ getModule: () => wasmUrl, beforeBuild: [TypstSnippet.preloadFonts(fonts)] });
  return {
    async pdf(main) {
      const out = await $typst.pdf({ mainContent: main });
      if (!out) throw new Error("typst: the compiler returned no PDF");
      return out;
    },
  };
}
