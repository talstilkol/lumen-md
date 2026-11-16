/**
 * T31: real alt text for pasted/dropped images, filled in the background —
 * OCR on this device (Hebrew + English), else a local vision model; the
 * file-name alt stays otherwise. Works for workspace URLs and for the
 * data-URL fallback (no OPFS / asset store failed) alike: the original
 * `File` is what is read, never the URL.
 */
import type { EditorView } from "@codemirror/view";

export interface PlacedImage {
  file: File;
  url: string;
  alt: string;
}

export async function fillPastedImageText(view: EditorView, placed: PlacedImage[], lang: string): Promise<void> {
  void offerScreenshotNote(view, placed, lang).catch(() => undefined);
  const { imageText, escapeAlt, escapeTitle, documentLanguage } = await import("../ai/vision");
  // Captions follow the note's language; `lang` (the UI's) when it is unclear.
  lang = await documentLanguage(view.state.doc.toString(), lang);
  await Promise.all(
    placed.map(async (p) => {
      const res = await imageText(p.file, lang, { name: p.file.name }).catch(() => null);
      if (!res || res.source === "none") return;
      const target = `![${p.alt}](${p.url})`;
      const at = view.state.doc.toString().indexOf(target);
      if (at < 0) return; // the user already changed it
      const title = res.title ? ` "${escapeTitle(res.title)}"` : "";
      view.dispatch({ changes: { from: at, to: at + target.length, insert: `![${escapeAlt(res.alt)}](${p.url}${title})` } });
    }),
  );
}

/**
 * W10.C22: after an image is pasted, offer to turn it into text (screenshot
 * to note). Nothing is read until the user clicks; the preview shows the
 * text before it is inserted, after the image.
 */
export async function offerScreenshotNote(view: EditorView, placed: PlacedImage[], lang: string): Promise<void> {
  if (!placed.length) return;
  const [{ useToastStore }, { t }] = await Promise.all([import("../store/useToastStore"), import("../i18n"), import("../ai/screenshotNoteStrings")]);
  const p = placed[placed.length - 1]!;
  useToastStore.getState().push({
    kind: "info",
    title: t("screenshotNote.offer"),
    ttlMs: 10_000,
    action: {
      label: t("screenshotNote.offerAction"),
      run: () =>
        void import("../ai/ScreenshotNoteDialog").then(async (m) => {
          const md = await m.previewScreenshotNote(p.file, lang);
          if (!md) return;
          const target = `](${p.url}`;
          const at = view.state.doc.toString().indexOf(target);
          const end = at < 0 ? view.state.selection.main.head : view.state.doc.lineAt(at).to;
          view.dispatch({ changes: { from: end, insert: `\n\n${md}\n` }, userEvent: "input" });
        }),
    },
  });
}

