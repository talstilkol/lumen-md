/** The body of the LaTeX export command (plan W5.22), loaded on first use (./latex.ts). */
import { t } from "../../i18n";
import { useToastStore } from "../../store/useToastStore";
import { explainError } from "../../lib/userError";
import { uiAlert } from "../../ui/PromptDialog";

export async function exportLatexFor(doc: { name: string; content: string; workspaceName?: string | null }): Promise<void> {
  try {
    const { exportLatexProject } = await import("../../latex/app");
    const r = await exportLatexProject(doc.name, doc.content, doc.workspaceName ?? undefined);
    useToastStore.getState().push({ kind: "success", title: t("latex.exported", { file: r.file }), ...(r.missingKeys.length ? { body: t("latex.missingKeys", { keys: r.missingKeys.join(", ") }) } : {}) });
  } catch (e) {
    useToastStore.getState().push({ kind: "error", title: t("latex.failed", { error: explainError(e) }) });
  }
}

/** "PDF from LaTeX" (W10.E14): on the desktop with Tectonic; TeX's errors, with their main.tex lines, when it fails. */
export async function exportLatexPdfFor(doc: { name: string; content: string; workspaceName?: string | null }): Promise<void> {
  try {
    const [{ exportLatexPdf }, { latexPdfStatus, LatexCompileError, formatTexError }] = await Promise.all([import("../../latex/app"), import("../../latex/tectonicDesktop")]);
    const status = await latexPdfStatus();
    if (status.kind !== "ready") {
      await uiAlert({ message: t(status.kind === "web" ? "latex.pdf.web" : "latex.pdf.noTectonic") });
      return;
    }
    try {
      const r = await exportLatexPdf(doc.name, doc.content, doc.workspaceName ?? undefined);
      useToastStore.getState().push({ kind: "success", title: t("latex.pdf.saved", { file: r.file }), ...(r.missingKeys.length ? { body: t("latex.missingKeys", { keys: r.missingKeys.join(", ") }) } : {}) });
    } catch (e) {
      if (!(e instanceof LatexCompileError)) throw e;
      const lines = e.errors.length ? e.errors.map(formatTexError) : [e.logTail.trim().split("\n").slice(-12).join("\n")];
      await uiAlert({ message: [t("latex.pdf.errors", { count: e.errors.length }), ...lines].join("\n") });
    }
  } catch (e) {
    useToastStore.getState().push({ kind: "error", title: t("latex.failed", { error: explainError(e) }) });
  }
}
