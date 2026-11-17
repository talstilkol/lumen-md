/**
 * The accessible PDF export in the app (plan W13.F3), loaded on use.
 *
 * A browser cannot write a PDF without its print dialog, so the export is
 * two steps the person sees: (1) the note prints with the accessibility pass
 * (./accessiblePdf.ts) and Chromium's "Save as PDF" writes a tagged PDF —
 * headings, figures with their text, tables with headers, the language;
 * (2) "Finish the saved PDF…" reads that file here, adds what PDF/UA-1
 * needs (./pdfUa.ts: the PDF/UA identification, the title shown, he-IL),
 * checks it, and saves it. Nothing leaves the device.
 */
import { t } from "../i18n";
import { useToastStore } from "../store/useToastStore";
import { finishPdfUa, inspectPdfUa } from "./pdfUa";
import { pdfLang } from "./accessiblePdf";

function pickPdf(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf,.pdf";
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

async function savePdf(bytes: Uint8Array, name: string): Promise<void> {
  const blob = new Blob([bytes as unknown as BlobPart], { type: "application/pdf" });
  const w = window as Window & { showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandle> };
  if (w.showSaveFilePicker) {
    try {
      const handle = await w.showSaveFilePicker({ suggestedName: name, types: [{ description: "PDF", accept: { "application/pdf": [".pdf"] } }] });
      const out = await handle.createWritable();
      await out.write(blob);
      await out.close();
      return;
    } catch (err) {
      if ((err as Error).name === "AbortError") throw err;
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

/** Pick a PDF, finish it as PDF/UA-1 and save it. `lang` is the note's language; `title` its title. */
export async function finishPickedPdf(opts: { lang?: string; title?: string } = {}): Promise<void> {
  const push = useToastStore.getState().push;
  const file = await pickPdf();
  if (!file) return;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const lang = pdfLang(opts.lang ?? (/[\u0590-\u05ff]/.test(file.name) ? "he" : document.documentElement.lang || "en"));
    const out = finishPdfUa(bytes, { lang, title: opts.title });
    const report = inspectPdfUa(out);
    if (out === bytes || !report.structTree) {
      push({ kind: "warning", title: t("pdfUa.notTagged"), body: t("pdfUa.notTaggedBody") });
      return;
    }
    await savePdf(out, file.name.replace(/\.pdf$/i, "") + ".pdf");
    if (report.problems.length) push({ kind: "warning", title: t("pdfUa.savedWithProblems"), body: report.problems.map((p) => t(`pdfUa.problem.${p}`)).join(" · "), ttlMs: 0 });
    else push({ kind: "success", title: t("pdfUa.saved"), body: t("pdfUa.savedBody", { figures: report.figures, tables: report.tables }) });
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    push({ kind: "error", title: t("pdfUa.failed"), body: (err as Error).message });
  }
}

/** Step 1 and the way to step 2: print with the accessibility pass, then offer to finish the saved PDF. */
export async function exportAccessiblePdf(doc: { name: string; content: string }): Promise<void> {
  const { preparePrint, printDocument } = await import("../ui/PrintExport");
  const push = useToastStore.getState().push;
  const prep = await preparePrint(doc.content, doc.name, { appStyles: false });
  const missing = prep.preflight.imagesWithoutAlt.length;
  if (missing) push({ kind: "warning", title: t("pdfUa.noAlt", { n: missing }), body: prep.preflight.imagesWithoutAlt.slice(0, 5).join(", "), ttlMs: 0 });
  await printDocument(doc.content, doc.name);
  push({ kind: "info", title: t("pdfUa.step2"), body: t("pdfUa.step2Body"), ttlMs: 0, action: { label: t("pdfUa.finish"), run: () => void finishPickedPdf({ lang: prep.lang, title: prep.title }) } });
}
