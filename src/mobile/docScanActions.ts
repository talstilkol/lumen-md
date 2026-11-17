/**
 * The palette's "Scan a document…" (plan W13.M4), loaded when it runs: the
 * best scanner there is, OCR on this device, the note opened when it is
 * written. See ./docScanner.ts for the rules.
 */
import { t } from "../i18n";
import { showAiToast } from "../ui/AiToast";
import "./docScanStrings";
import { scanDocument, scanToNote, type ScannerPlugin } from "./docScanner";
import { explainError } from "../lib/userError";

/** The ordinary picker: the camera on a phone, the library or files elsewhere. */
export function pickPhotos(doc: Document = document): Promise<Blob[]> {
  return new Promise((resolve) => {
    const input = doc.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.setAttribute("capture", "environment");
    input.style.display = "none";
    let done = false;
    const finish = (files: Blob[]) => {
      if (done) return;
      done = true;
      input.remove();
      resolve(files);
    };
    input.addEventListener("change", () => finish([...(input.files ?? [])]));
    input.addEventListener("cancel", () => finish([]));
    doc.body.append(input);
    input.click();
  });
}

export async function scanDocumentCommand(): Promise<string | null> {
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  const plugin = cap?.isNativePlatform?.() ? (await import("@capacitor/core")).registerPlugin<ScannerPlugin>("LumenNative") : null;
  const [{ getAiPolicy }, ledger] = await Promise.all([import("../ai/policy"), import("../ai/privacyLedger")]);
  const scan = await scanDocument({
    plugin,
    pickPhotos: () => pickPhotos(),
    allowService: getAiPolicy() !== "local-only",
    ledger: { onDevice: (n) => ledger.recordOnDeviceModel(n), service: (n, why) => void ledger.recordBrowserService(n, why) },
  });
  if (!scan) return null;
  showAiToast(t("docScan.reading", { pages: scan.pages.length }), "info");
  const [{ ocrImage }, ws, { notifyWorkspaceChanged }] = await Promise.all([import("../ai/ocr"), import("../storage/workspace"), import("../storage/workspaceEvents")]);
  try {
    const path = await scanToNote(scan, {
      ocr: (page) => ocrImage(page),
      writeBlob: (p, bytes) => ws.writeWorkspaceBlob(p, bytes),
      writeNote: (p, text) => ws.writeWorkspaceFile(p, text),
      text: {
        title: t("docScan.title", { when: new Date().toLocaleString(document.documentElement.lang || undefined) }),
        page: (n) => t("docScan.page", { n }),
        uncertain: t("docScan.uncertain"),
        empty: t("docScan.empty"),
        source: t("docScan.source"),
      },
    });
    notifyWorkspaceChanged({ kind: "structure", paths: [path] });
    window.dispatchEvent(new CustomEvent("lumen-open-file", { detail: { path } }));
    showAiToast(t("docScan.saved", { path }), "success");
    return path;
  } catch (e) {
    showAiToast(t("docScan.failed", { error: explainError(e, "doc-scan") }), "error");
    return null;
  }
}
