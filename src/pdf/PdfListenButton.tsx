/**
 * The PDF reader's "Read aloud" button (plan W2.6, step 3): every page's text
 * (or its OCR text), read aloud with the note reader's voice, speed and saved
 * position, the view following the page being read. Press again to stop;
 * closing the reader (unmounting its toolbar) stops it. Moved out of
 * PdfReader.tsx (max-lines 800) as #611 wrote it, except that the OCR text
 * is train 5's `ocrPages[p].text`.
 */
import { useCallback, useEffect, useState, type MutableRefObject } from "react";
import { getLocale, t } from "../i18n";
import { showAiToast } from "../ui/AiToast";
import { pageTextFromItems } from "./textMap";
import type { OcrPage } from "./ocrPages";
import type { PdfDocument } from "./pdfjs";

export function PdfListenButton({ doc, ocrPages, pageTexts, path, goToPage }: {
  doc: PdfDocument | null;
  ocrPages: Record<number, OcrPage>;
  pageTexts: MutableRefObject<Map<number, string>>;
  path: string;
  goToPage: (page: number) => void;
}) {
  /** The page being read, while it reads. */
  const [listening, setListening] = useState<number | null>(null);
  const listen = useCallback(async () => {
    if (!doc) return;
    const [tts, { listeningText, pageAt }, { loadAids }, { getAiPolicy }, { uiConfirm }] = await Promise.all([import("../ai/tts"), import("./pdfListen"), import("../reading/readingAids"), import("../ai/policy"), import("../ui/PromptDialog")]);
    if (tts.isSpeaking()) {
      tts.stopSpeaking();
      setListening(null);
      return;
    }
    const pages: { page: number; text: string }[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      let text = ocrPages[p]?.text ?? pageTexts.current.get(p);
      if (text === undefined) {
        text = pageTextFromItems((await (await doc.getPage(p)).getTextContent()).items);
        pageTexts.current.set(p, text);
      }
      pages.push({ page: p, text });
    }
    const lt = listeningText(pages);
    if (!lt.text) {
      showAiToast(t("pdf.listen.empty"), "info");
      return;
    }
    setListening(lt.pages[0].page);
    let shown = -1;
    try {
      await tts.readAloudCommand({
        content: lt.text,
        // Its own saved position: the PDF, not a note.
        doc: { workspaceName: `pdf:${path}` },
        uiLang: getLocale(),
        t,
        toast: showAiToast,
        rate: loadAids().rate,
        confirmNetworkVoice: () => (getAiPolicy() === "local-only" ? Promise.resolve(false) : uiConfirm({ title: t("tts.networkVoice.title"), message: t("tts.networkVoice.body"), okLabel: t("tts.networkVoice.ok") })),
        onRange: (r) => {
          if (!r) return;
          const page = pageAt(lt, r.from);
          if (page === null || page === shown) return;
          shown = page;
          setListening(page);
          goToPage(page);
        },
        onWord: () => undefined,
      });
    } finally {
      setListening(null);
    }
  }, [doc, ocrPages, pageTexts, path, goToPage]);

  // Closing the reader stops its reading.
  useEffect(
    () => () => {
      void import("../ai/tts").then((tts) => {
        if (tts.isSpeaking()) tts.stopSpeaking();
      });
    },
    [],
  );

  return (
    <>
      <button type="button" className="icon-btn pdf-text-btn" data-testid="pdf-listen" aria-pressed={listening !== null} disabled={!doc} onClick={() => void listen()}>
        {listening !== null ? t("pdf.listen.stop") : t("pdf.listen")}
      </button>
      {listening !== null && (
        <span role="status" className="pdf-muted" data-testid="pdf-listen-page">
          {t("pdf.listen.page", { n: listening })}
        </span>
      )}
    </>
  );
}
