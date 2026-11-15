/**
 * The PDF reader as the app mounts it (moved from PdfReader.tsx, verbatim, to
 * keep that file under the 800-line limit, W10.E31).
 */
import { t } from "../i18n";
import { ErrorBoundary } from "../ui/ErrorBoundary";
import { lazy, Suspense } from "react";
import type { Props } from "./pdfReaderParts";

// The reader (and its lazily loaded English, pdf.json) loads with a dynamic import, as the i18n lazy rule wants.
const PdfReader = lazy(() => import("./PdfReader").then((m) => ({ default: m.PdfReader })));

/**
 * What the app mounts: the reader in an error boundary; "Open the notes"
 * closes it and opens the companion note through the app's open-file hub.
 */
export function PdfReaderOverlay(props: Omit<Props, "onOpenNotes">) {
  const { onClose } = props;
  return (
    <ErrorBoundary
      fallback={
        <div className="pdf-reader pdf-message pdf-error" role="alert">
          <p>{t("errorBoundary.heading")}</p>
          <button type="button" className="icon-btn pdf-text-btn" onClick={onClose}>
            {t("privacy.close")}
          </button>
        </div>
      }
    >
      <Suspense fallback={null}>
      <PdfReader
        {...props}
        onOpenNotes={(notePath) => {
          onClose();
          window.dispatchEvent(new CustomEvent("lumen-open-file", { detail: { path: notePath } }));
        }}
      />
      </Suspense>
    </ErrorBoundary>
  );
}
