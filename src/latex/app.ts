/**
 * The app side of the academic LaTeX export (plan W5.22): the note, every
 * .bib in the vault, the images, remark, and the download. Loaded from the
 * palette with a dynamic import.
 */
import "./latexStrings";
import type { Root } from "mdast";
import { downloadBytes } from "../storage/exportFormats";
import { listWorkspace, readWorkspaceBlob, readWorkspaceFile, workspaceHasFile } from "../storage/workspace";
import { latexProject, latexZip } from "./project";
import { compileLatexPdf } from "./tectonicDesktop";

/** The export's files: main.tex, the cited references and the images. */
async function buildProject(markdown: string, notePath?: string) {
  const [{ unified }, { default: remarkParse }, { default: remarkGfm }, { default: remarkMath }] = await Promise.all([import("unified"), import("remark-parse"), import("remark-gfm"), import("remark-math")]);
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
  const bibs: string[] = [];
  for (const f of await listWorkspace().catch(() => [])) if (f.path.toLowerCase().endsWith(".bib")) bibs.push(await readWorkspaceFile(f.path).catch(() => ""));
  const dir = notePath?.includes("/") ? notePath.slice(0, notePath.lastIndexOf("/") + 1) : "";
  return latexProject({
    markdown,
    parse: (md) => processor.parse(md) as Root,
    bib: bibs.join("\n\n"),
    readImage: async (url) => {
      const path = decodeURIComponent(url.replace(/^\.\//, ""));
      for (const p of [dir + path, path]) if (await workspaceHasFile(p).catch(() => false)) return new Uint8Array(await (await readWorkspaceBlob(p)).arrayBuffer());
      return null;
    },
  });
}

export async function exportLatexProject(name: string, markdown: string, notePath?: string): Promise<{ file: string; missingKeys: string[] }> {
  const { files, missingKeys } = await buildProject(markdown, notePath);
  const file = `${name.replace(/\.md$/i, "") || "paper"}-latex.zip`;
  downloadBytes(file, await latexZip(files), "application/zip");
  return { file, missingKeys };
}

/** W10.E14: the same export compiled to PDF by the user's Tectonic (desktop). Throws LatexCompileError with the log's errors. */
export async function exportLatexPdf(name: string, markdown: string, notePath?: string): Promise<{ file: string; missingKeys: string[] }> {
  const { files, missingKeys } = await buildProject(markdown, notePath);
  const pdf = await compileLatexPdf(files);
  const file = `${name.replace(/\.md$/i, "") || "paper"}.pdf`;
  downloadBytes(file, pdf, "application/pdf");
  return { file, missingKeys };
}
