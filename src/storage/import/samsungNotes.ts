/**
 * Samsung Notes (plan W13.F2): the app shares a note as a text file or a
 * PDF (Share → Text file / PDF file), or saves them to a folder. Its own
 * `.sdocx` format is a binary layout that is not read here: those files are
 * reported with the hint to share as text or PDF.
 *
 *  - a text export becomes a note: its first line is the title Samsung
 *    Notes writes on top (kept as `# Title` when it differs from the file
 *    name), the rest as it is; a line `□ item` / `☑ item` (Samsung's
 *    checklist in text) becomes a task;
 *  - a PDF export (handwriting, drawings) stays a PDF and gets a note that
 *    shows it (`![[Note.pdf]]`), so it is found, linked and searchable by
 *    name; its text is not extracted here (the PDF reader can).
 */
import { claimPath, dirOf, mdDest, relativeTo, safeName, stemOf } from "./names";
import { withFrontmatter } from "./frontmatter";
import { emptyVault, type ConvertedVault } from "./types";

/** A Samsung Notes text export → Markdown. */
export function samsungText(text: string, fileStem: string): string {
  const lines = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  const out = lines.map((l) =>
    l
      .replace(/^(\s*)[□☐]\s*/, "$1- [ ] ")
      .replace(/^(\s*)[☑☒✓✔]\s*/, "$1- [x] ")
      .replace(/^(\s*)[•●◦▪]\s+/, "$1- "),
  );
  const first = out.findIndex((l) => l.trim());
  if (first >= 0 && out[first].trim() !== fileStem.trim() && !/^(#|- )/.test(out[first]) && out[first].length <= 120 && out[first + 1]?.trim() === "") out[first] = `# ${out[first].trim()}`;
  else if (first >= 0 && out[first].trim() === fileStem.trim()) out.splice(first, 1);
  return out.join("\n").replace(/^\n+/, "").replace(/\n{3,}/g, "\n\n");
}

export function convertSamsungNotes(files: Map<string, Uint8Array>): ConvertedVault {
  const vault = emptyVault();
  const taken = new Set<string>();
  const dec = new TextDecoder();
  for (const [p, data] of files) {
    const clean = p.normalize("NFC");
    if (/(^|\/)(\.DS_Store|__MACOSX)/.test(p)) {
      vault.skipped.push({ path: p, reason: "appFolder" });
    } else if (/\.sdocx$/i.test(p) || /\.sdoc$/i.test(p)) {
      vault.skipped.push({ path: p, reason: "unsupported", detail: "Share → Text file / PDF file" });
    } else if (/\.(txt|md|markdown)$/i.test(p)) {
      const stem = stemOf(clean);
      const notePath = claimPath(taken, `${dirOf(clean) ? `${dirOf(clean)}/` : ""}${safeName(stem)}.md`);
      const body = samsungText(dec.decode(data), stem);
      if (!body.trim()) vault.skipped.push({ path: p, reason: "empty" });
      else {
        vault.warnings.push({ path: notePath, reason: "noDates" });
        vault.notes.set(notePath, `${body.trimEnd()}\n`);
      }
    } else if (/\.pdf$/i.test(p)) {
      vault.sourceAttachments++;
      const pdf = claimPath(taken, clean);
      vault.attachments.set(pdf, data);
      const notePath = claimPath(taken, pdf.replace(/\.pdf$/i, ".md"));
      vault.notes.set(notePath, withFrontmatter({ source: "Samsung Notes" }, `![${stemOf(pdf).replace(/[[\]]/g, "")}](${mdDest(relativeTo(dirOf(notePath), pdf))})\n`));
      vault.warnings.push({ path: notePath, reason: "pdfOnly" });
    } else {
      vault.sourceAttachments++;
      vault.attachments.set(claimPath(taken, clean), data);
    }
  }
  return vault;
}
