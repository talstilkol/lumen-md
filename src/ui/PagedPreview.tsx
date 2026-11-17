/**
 * The page view (W13.R10, over W10.E18 / W2.23): the note's pages as the PDF
 * export prints them — the same document, the same print CSS, the same
 * footnotes at the bottom of each page — laid out by the browser's own
 * fragmentation (src/print/pagedPreview.ts). Size (A4 / Letter), margins and
 * page numbers (1 2 3 or א ב ג) are chosen here; "Print" prints exactly what
 * is shown. Loaded lazily with the page view; nothing of it is in the
 * startup bundle.
 *
 * Keyboard: PageDown / PageUp, Home / End, and the arrows in the reading
 * direction (in RTL, ← is the next page) move between pages; the page
 * number is announced politely.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { t } from "../i18n";
import english from "../i18n/lazy/paged.json";
import { registerEnglish } from "../i18n";
import { fitScale, layoutPages, pageAtScroll, pagedGeometry, readPagedPrefs, savePagedPrefs, sheetOffsetPx, ZOOMS, type PagedZoom } from "../print/pagedPreview";
import { printFrontmatter, type PageMargins, type PageNumbering } from "../print/printLayout";
import { extractFrontmatter } from "../renderer/pipeline";

registerEnglish(english);

interface Props {
  markdownText: string;
  docName: string;
  /** Debounce before a change re-lays the pages out, ms. */
  delay?: number;
}

type Status = "laying" | "ready" | "empty" | "error";

const selectStyle = { background: "hsl(var(--bg-subtle))", color: "hsl(var(--fg))", border: "1px solid hsl(var(--border))", borderRadius: 4, padding: "2px 6px", fontSize: 12 } as const;

export function PagedPreview({ markdownText, docName, delay = 350 }: Props) {
  const fm = (() => {
    try {
      return printFrontmatter(extractFrontmatter(markdownText));
    } catch {
      // why: malformed frontmatter: the preview still shows the note with defaults
      return {};
    }
  })();
  // The pages start as the export prints them: the note's own print settings
  // (frontmatter), else the export's defaults. A choice made here is for this
  // preview and its Print button; only the zoom is remembered on this device.
  const saved = readPagedPrefs();
  const [pageSize, setPageSize] = useState<"A4" | "Letter">(fm.pageSize ?? "A4");
  const [margins, setMargins] = useState<PageMargins>(fm.margins ?? "normal");
  const [numbering, setNumbering] = useState<PageNumbering>(fm.numbering ?? "decimal");
  const [zoom, setZoom] = useState<PagedZoom>(saved.zoom ?? "fit");
  const [pages, setPages] = useState(0);
  const [current, setCurrent] = useState(1);
  const [status, setStatus] = useState<Status>("laying");
  const [error, setError] = useState("");
  const [dir, setDir] = useState<"rtl" | "ltr">("ltr");
  /** The length of the text the pages show (tests wait for it). */
  const [laid, setLaid] = useState(-1);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const frameRef = useRef<HTMLIFrameElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const run = useRef(0);
  const g = pagedGeometry(pageSize, margins);

  useEffect(() => savePagedPrefs({ zoom }), [zoom]);
  // An edit of the note's print frontmatter is followed, as the export follows it.
  const fmKey = `${fm.pageSize ?? ""}|${fm.margins ?? ""}|${fm.numbering ?? ""}`;
  const lastFm = useRef(fmKey);
  useEffect(() => {
    if (lastFm.current === fmKey) return;
    lastFm.current = fmKey;
    setPageSize(fm.pageSize ?? "A4");
    setMargins(fm.margins ?? "normal");
    setNumbering(fm.numbering ?? "decimal");
  }, [fmKey, fm.pageSize, fm.margins, fm.numbering]);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setViewport({ width: box.clientWidth, height: box.clientHeight }));
    ro.observe(box);
    setViewport({ width: box.clientWidth, height: box.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Lay the pages out: the export's document in the frame, then the columns.
  useEffect(() => {
    const id = ++run.current;
    setStatus("laying");
    const timer = setTimeout(async () => {
      try {
        if (!markdownText.trim()) {
          setPages(0);
          setLaid(markdownText.length);
          setStatus("empty");
          return;
        }
        const { preparePrint, hydratePrintDocument } = await import("./PrintExport");
        const p = await preparePrint(markdownText, docName, { overrides: { pageSize, margins, numbering } });
        const doc = frameRef.current?.contentDocument;
        if (id !== run.current || !doc) return;
        hydratePrintDocument(doc, p.title, p.themeClass, p.dir, p.lang, p.styles, p.html);
        await doc.fonts?.ready;
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        if (id !== run.current) return;
        const fmNow = printFrontmatter(extractFrontmatter(markdownText));
        const header = fmNow.header ?? p.title;
        const n = layoutPages(doc, { pageSize, margins, numbering, header, footer: fmNow.footer ?? "", dir: p.dir });
        setDir(p.dir);
        setPages(n);
        setLaid(markdownText.length);
        setCurrent((c) => Math.min(Math.max(1, c), Math.max(1, n)));
        setStatus("ready");
      } catch (e) {
        if (id !== run.current) return;
        setError(e instanceof Error ? e.message : String(e));
        setStatus("error");
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [markdownText, docName, pageSize, margins, numbering, delay]);

  const goTo = useCallback(
    (n: number) => {
      const target = Math.min(Math.max(1, n), Math.max(1, pages));
      setCurrent(target);
      const win = frameRef.current?.contentWindow;
      const off = sheetOffsetPx(target, g);
      win?.scrollTo({ left: dir === "rtl" ? -off : off, top: 0 });
    },
    [pages, dir, g],
  );

  // The current page follows the frame's scroll, and its sheet is outlined.
  useEffect(() => {
    const win = frameRef.current?.contentWindow;
    const doc = frameRef.current?.contentDocument;
    if (!win || !doc || status !== "ready") return;
    const onScroll = () => {
      const n = pageAtScroll(win.scrollX, g, pages);
      // At the end of the strip the last sheets cannot scroll to the start: a later page chosen there stays chosen.
      const max = doc.documentElement.scrollWidth - win.innerWidth;
      setCurrent((c) => (Math.abs(win.scrollX) >= max - 2 && c > n ? c : n));
    };
    const onKey = (e: KeyboardEvent) => onNavKey(e);
    win.addEventListener("scroll", onScroll, { passive: true });
    doc.addEventListener("keydown", onKey);
    return () => {
      win.removeEventListener("scroll", onScroll);
      doc.removeEventListener("keydown", onKey);
    };
  });

  useEffect(() => {
    const doc = frameRef.current?.contentDocument;
    doc?.querySelectorAll(".paged-sheet").forEach((s) => s.classList.toggle("paged-current", (s as HTMLElement).dataset.page === String(current)));
  }, [current, pages, status]);

  const onNavKey = (e: KeyboardEvent | React.KeyboardEvent) => {
    const nextKey = dir === "rtl" ? "ArrowLeft" : "ArrowRight";
    const prevKey = dir === "rtl" ? "ArrowRight" : "ArrowLeft";
    const target = e.target as HTMLElement | null;
    if (target && /^(SELECT|INPUT|TEXTAREA)$/.test(target.tagName)) return;
    let n: number | null = null;
    if (e.key === "PageDown" || e.key === nextKey) n = current + 1;
    else if (e.key === "PageUp" || e.key === prevKey) n = current - 1;
    else if (e.key === "Home") n = 1;
    else if (e.key === "End") n = pages;
    if (n === null) return;
    e.preventDefault();
    goTo(n);
  };

  const count = zoom === "two" ? 2 : 1;
  const scale = zoom === "fit" || zoom === "two" ? fitScale(viewport, g, count) : Number(zoom);
  const frameW = viewport.width ? viewport.width / scale : 800;
  const frameH = viewport.height ? viewport.height / scale : 600;

  return (
    <div data-testid="page-view" data-reading-mode="page-view" data-ready={String(status === "ready" || status === "empty")} data-pages={pages} data-laid={laid} style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, width: "100%" }}>
      <div role="toolbar" aria-label={t("paged.toolbar")} onKeyDown={onNavKey} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, padding: "6px 12px", borderBottom: "1px solid hsl(var(--border))", background: "hsl(var(--bg))", fontSize: 12, color: "hsl(var(--fg-muted))", flexShrink: 0 }}>
        <button type="button" className="icon-btn" onClick={() => goTo(current - 1)} disabled={current <= 1 || status !== "ready"} aria-label={t("pageView.prev")} title={t("pageView.prev")} style={{ padding: "2px 8px" }}>
          <span aria-hidden>{dir === "rtl" ? "▶" : "◀"}</span>
        </button>
        <select aria-label={t("pageView.jump")} value={current} disabled={status !== "ready"} onChange={(e) => goTo(Number(e.target.value))} style={selectStyle}>
          {Array.from({ length: Math.max(1, pages) }, (_, i) => (
            <option key={i} value={i + 1}>
              {t("pageView.page", { n: i + 1 })}
            </option>
          ))}
        </select>
        <span data-testid="paged-indicator" aria-live="polite" style={{ minWidth: 90, textAlign: "center", color: "hsl(var(--fg))" }}>
          {status === "ready" ? t("paged.pageOf", { n: current, total: pages }) : status === "empty" ? t("paged.empty") : status === "error" ? t("paged.error", { error }) : t("paged.laying")}
        </span>
        <button type="button" className="icon-btn" onClick={() => goTo(current + 1)} disabled={current >= pages || status !== "ready"} aria-label={t("pageView.next")} title={t("pageView.next")} style={{ padding: "2px 8px" }}>
          <span aria-hidden>{dir === "rtl" ? "◀" : "▶"}</span>
        </button>
        <label style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
          {t("paged.size")}
          <select data-testid="paged-size" value={pageSize} onChange={(e) => setPageSize(e.target.value === "Letter" ? "Letter" : "A4")} style={selectStyle}>
            <option value="A4">A4</option>
            {/* i18n-allow: the paper size's name, the same in every language */}
            <option value="Letter">Letter</option>
          </select>
        </label>
        <label style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
          {t("paged.margins")}
          <select data-testid="paged-margins" value={margins} onChange={(e) => setMargins(e.target.value as PageMargins)} style={selectStyle}>
            {(["normal", "narrow", "wide"] as const).map((m) => (
              <option key={m} value={m}>
                {t(`paged.margins.${m}`)}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
          {t("paged.numbering")}
          <select data-testid="paged-numbering" value={numbering} onChange={(e) => setNumbering(e.target.value as PageNumbering)} style={selectStyle}>
            {(["decimal", "hebrew", "none"] as const).map((m) => (
              <option key={m} value={m}>
                {t(`paged.numbering.${m}`)}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
          {t("paged.zoom")}
          <select data-testid="paged-zoom" value={zoom} onChange={(e) => setZoom(e.target.value as PagedZoom)} style={selectStyle}>
            {ZOOMS.map((z) => (
              <option key={z} value={z}>
                {z === "fit" ? t("paged.zoom.fit") : z === "two" ? t("paged.zoom.two") : `${Math.round(Number(z) * 100)}%`}
              </option>
            ))}
          </select>
        </label>
        <button type="button" data-testid="paged-print" onClick={() => frameRef.current?.contentWindow?.print()} disabled={status !== "ready"} style={{ marginInlineStart: "auto", padding: "2px 10px" }}>
          {t("paged.print")}
        </button>
      </div>
      <div ref={boxRef} style={{ position: "relative", flex: 1, minHeight: 0, overflow: "hidden", background: "#d9dce1" }}>
        <iframe
          ref={frameRef}
          title={t("paged.frame", { title: docName || t("print.untitled") })}
          data-testid="paged-frame"
          tabIndex={0}
          style={{ position: "absolute", top: 0, left: 0, border: 0, width: frameW, height: frameH, transform: `scale(${scale})`, transformOrigin: "0 0", background: "#d9dce1" }}
        />
      </div>
    </div>
  );
}

export default PagedPreview;
