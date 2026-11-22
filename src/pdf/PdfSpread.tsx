/**
 * W12.R2 — the reader's two-page view: the mode and direction controls,
 * the rows (each row in the book's direction, so page 1 of a Hebrew spread
 * is on the right), and paging with the arrow keys (ArrowLeft is "next" in
 * a right-to-left book). The page elements stay direct-offset children of
 * the scroll box, so the reading position (readingPosition.ts) keeps
 * working; a spread's position is its first page.
 */
import { Children, useCallback, useEffect, useState, type ReactNode, type RefObject } from "react";
import { t } from "../i18n";
import type { PdfDocument } from "./pdfjs";
import { bookDirOf, pagingDelta, parsePrefs, rowOfPage, spreadRows, type BookDir, type SpreadMode, type SpreadPrefs } from "./spread";
import "./spreadStrings";

const KEY = "lumen.pdf.spread";
/** Pages read to guess the direction. */
const SAMPLE_PAGES = 5;

export interface Spread {
  mode: SpreadMode;
  dir: BookDir;
  /** The direction came from the text, not from the reader. */
  auto: boolean;
  setMode: (m: SpreadMode) => void;
  setDir: (d: BookDir) => void;
}

function readPrefs(): Record<string, SpreadPrefs> {
  try {
    return parsePrefs(localStorage.getItem(KEY));
  } catch {
    return {};
  }
}

function writePrefs(path: string, p: SpreadPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readPrefs(), [path]: p }));
  } catch {
    /* why: private mode or full storage; the choice lasts this session only */
  }
}

/** The text of the first pages, for the direction. */
async function sampleText(doc: PdfDocument): Promise<string> {
  const parts: string[] = [];
  for (let n = 1; n <= Math.min(doc.numPages, SAMPLE_PAGES); n++) {
    const tc = await (await doc.getPage(n)).getTextContent();
    parts.push(tc.items.map((i) => (i as { str?: string }).str ?? "").join(" "));
  }
  return parts.join(" ");
}

export function useSpread(doc: PdfDocument | null, path: string, scrollRef: RefObject<HTMLDivElement | null>, pageEls: RefObject<Map<number, HTMLDivElement>>): Spread {
  const [prefs, setPrefs] = useState<SpreadPrefs>(() => readPrefs()[path] ?? { mode: "none" });
  const [autoDir, setAutoDir] = useState<BookDir>("ltr");
  useEffect(() => setPrefs(readPrefs()[path] ?? { mode: "none" }), [path]);
  useEffect(() => {
    if (!doc) return;
    let live = true;
    sampleText(doc)
      .then((text) => live && setAutoDir(bookDirOf(text)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [doc]);
  const dir = prefs.dir ?? autoDir;
  const update = useCallback(
    (p: SpreadPrefs) => {
      setPrefs(p);
      writePrefs(path, p);
    },
    [path],
  );

  // Paging: the arrows move a whole spread, in the book's direction.
  useEffect(() => {
    const box = scrollRef.current;
    if (!box || prefs.mode === "none") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || (e.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable]")) return;
      const delta = pagingDelta(e.key, dir);
      const els = pageEls.current;
      if (!delta || !els?.size) return;
      const rows = spreadRows(els.size, prefs.mode);
      let page = 1;
      for (const [n, el] of els) if (el.offsetTop <= box.scrollTop + 1 && n > page) page = n;
      const next = rows[Math.min(rows.length - 1, Math.max(0, rowOfPage(rows, page) + delta))];
      const el = els.get(next[0]);
      if (!el) return;
      e.preventDefault();
      box.scrollTop = el.offsetTop;
    };
    // Anywhere in the reader (toolbar buttons included), not only on the scroll box.
    const root = box.parentElement?.parentElement ?? box;
    const onDocKey = (e: KeyboardEvent) => {
      if (root.contains(document.activeElement)) onKey(e);
    };
    document.addEventListener("keydown", onDocKey);
    return () => document.removeEventListener("keydown", onDocKey);
  }, [scrollRef, pageEls, prefs.mode, dir]);

  return { mode: prefs.mode, dir, auto: !prefs.dir, setMode: (mode) => update({ ...prefs, mode }), setDir: (d) => update({ ...prefs, dir: d }) };
}

/** The pages (children, page 1 first) in rows; one page per row in mode none. */
export function SpreadRows({ spread, children }: { spread: Pick<Spread, "mode" | "dir">; children: ReactNode }) {
  const pages = Children.toArray(children);
  if (spread.mode === "none") return <>{pages}</>;
  return (
    <>
      {spreadRows(pages.length, spread.mode).map((row) => (
        <div key={row[0]} className="pdf-spread-row" data-testid="pdf-spread-row" dir={spread.dir} style={{ display: "flex", justifyContent: "center", alignItems: "flex-start", gap: 8 }}>
          {row.map((p) => pages[p - 1])}
        </div>
      ))}
    </>
  );
}

export function SpreadControls({ spread }: { spread: Spread }) {
  return (
    <>
      <select aria-label={t("pdf.spread.label")} value={spread.mode} onChange={(e) => spread.setMode(e.target.value as SpreadMode)} data-testid="pdf-spread-mode">
        <option value="none">{t("pdf.spread.none")}</option>
        <option value="odd">{t("pdf.spread.odd")}</option>
        <option value="even">{t("pdf.spread.even")}</option>
      </select>
      {spread.mode !== "none" && (
        <button type="button" className="icon-btn pdf-text-btn" aria-pressed={spread.dir === "rtl"} onClick={() => spread.setDir(spread.dir === "rtl" ? "ltr" : "rtl")} data-testid="pdf-spread-dir">
          {spread.dir === "rtl" ? t("pdf.spread.rtl") : t("pdf.spread.ltr")}
        </button>
      )}
    </>
  );
}
