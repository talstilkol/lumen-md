/**
 * The page of the Talmud view (W13.R11): the note's main text with its
 * commentaries around it (src/reading/daf), or — the accessible
 * alternative, and the view on narrow screens — the same texts as linear
 * sections. "My notes" on the passage (W10.C24: the vault's notes that cite
 * it) stand in a column of their own. Print lays the page out again at the
 * paper's width and prints it.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { registerEnglish, t } from "../i18n";
import english from "../i18n/lazy/daf.json";
import { buildDaf, DAF_CSS, layoutDaf } from "../reading/daf/dafDom";
import type { DafContent, DafText } from "../reading/daf/dafSources";

registerEnglish(english);

export interface DafNoteRef {
  path: string;
  title: string;
}

export interface DafChoice {
  /** "" = the note's own commentary block (or none). */
  value: string;
  label: string;
}

interface Props {
  content: DafContent;
  /** The vault's notes that cite this passage (W10.C24). */
  myNotes?: DafNoteRef[];
  /** Notes the user may put in a commentary's place. */
  choices?: DafChoice[];
  /** Load a chosen note as a commentary. */
  loadCommentary?: (path: string, title: string) => Promise<DafText | null>;
  initialInner?: string;
  initialOuter?: string;
  onOpenNote?: (path: string) => void;
  /** Start in the linear view. */
  linear?: boolean;
}

const NARROW = 560;
const MAX_WIDTH = 900;
const PRINT_WIDTH = 650;

const labels = () => ({ main: t("daf.main"), inner: t("daf.inner"), outer: t("daf.outer") });

export function DafView({ content, myNotes = [], choices = [], loadCommentary, initialInner = "", initialOuter = "", onOpenNote, linear: startLinear = false }: Props) {
  const [linearChosen, setLinearChosen] = useState(startLinear);
  const [side, setSide] = useState<"right" | "left">(content.amud === "b" ? "left" : "right");
  const [innerPick, setInnerPick] = useState(initialInner);
  const [outerPick, setOuterPick] = useState(initialOuter);
  const [inner, setInner] = useState<DafText | null>(content.inner);
  const [outer, setOuter] = useState<DafText | null>(content.outer);
  const [width, setWidth] = useState(0);
  const [laid, setLaid] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // A chosen note replaces the note's own block; "" goes back to it.
  useEffect(() => {
    let live = true;
    if (!innerPick || !loadCommentary) setInner(content.inner);
    else void loadCommentary(innerPick, t("daf.rashi")).then((c) => live && setInner(c));
    return () => {
      live = false;
    };
  }, [innerPick, loadCommentary, content.inner]);
  useEffect(() => {
    let live = true;
    if (!outerPick || !loadCommentary) setOuter(content.outer);
    else void loadCommentary(outerPick, t("daf.tosafot")).then((c) => live && setOuter(c));
    return () => {
      live = false;
    };
  }, [outerPick, loadCommentary, content.outer]);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const measure = () => setWidth(box.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  const narrow = width > 0 && width < NARROW;
  const linear = linearChosen || narrow;
  const pageWidth = Math.min(MAX_WIDTH, Math.max(0, width - 8));
  const texts = { main: content.main, inner, outer };

  useLayoutEffect(() => {
    const host = hostRef.current;
    setLaid(false);
    if (!host || linear || !pageWidth || !content.main) return;
    let cancelled = false;
    const page = buildDaf(document, texts, labels());
    host.replaceChildren(page);
    const run = () => {
      if (cancelled) return;
      layoutDaf(page, pageWidth, side);
      setLaid(true);
    };
    run();
    // The faces may arrive after the first layout: lay out again with them.
    void document.fonts?.ready.then(run);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- texts is rebuilt from these each render
  }, [linear, pageWidth, side, content.main, inner, outer]);

  const print = useCallback(() => {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.style.cssText = `position:fixed;inset-inline-start:-10000px;top:0;width:${PRINT_WIDTH + 40}px;height:1200px;border:0;`;
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    if (!doc) return frame.remove();
    doc.open();
    doc.close();
    doc.documentElement.lang = "he";
    doc.documentElement.dir = "rtl";
    doc.title = content.main?.title || t("daf.title");
    const style = doc.createElement("style");
    style.textContent = `${DAF_CSS}\n@page { size: A4; margin: 15mm 14mm; } body { margin: 0; } h1 { font: 700 16pt "Frank Ruhl Libre", serif; text-align: center; margin: 0 0 4mm; }`;
    doc.head.appendChild(style);
    const h = doc.createElement("h1");
    h.textContent = content.main?.title ?? "";
    doc.body.appendChild(h);
    const page = buildDaf(doc, texts, labels());
    doc.body.appendChild(page);
    layoutDaf(page, PRINT_WIDTH, side);
    frame.contentWindow?.addEventListener("afterprint", () => frame.remove(), { once: true });
    setTimeout(() => {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    }, 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- texts is rebuilt from these each render
  }, [content.main, inner, outer, side]);

  if (!content.main) {
    return (
      <div data-testid="daf-view" data-ready="true" style={{ padding: 16 }}>
        <p>{t("daf.empty")}</p>
      </div>
    );
  }

  const section = (key: string, label: string, text: DafText | null) =>
    text?.paragraphs.length ? (
      <section key={key} aria-labelledby={`daf-lin-${key}`} lang="he" dir="rtl" style={{ marginBlockEnd: 20 }}>
        <h2 id={`daf-lin-${key}`} style={{ fontSize: 17, margin: "0 0 6px" }}>
          {text.title ? `${label}: ${text.title}` : label}
        </h2>
        {text.paragraphs.map((p, i) => (
          <p key={i} style={{ margin: "0 0 8px", lineHeight: 1.7 }}>
            {p}
          </p>
        ))}
      </section>
    ) : null;

  const pick = (id: string, label: string, value: string, set: (v: string) => void) =>
    choices.length ? (
      <label style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
        {label}
        <select data-testid={id} value={value} onChange={(e) => set(e.target.value)} style={{ maxInlineSize: 220 }}>
          <option value="">{t("daf.fromNote")}</option>
          {choices.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
    ) : null;

  return (
    <div data-testid="daf-view" data-ready={String(linear || laid)} data-mode={linear ? "linear" : "page"} data-inner-side={side} style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
      <style>{DAF_CSS}</style>
      <div role="toolbar" aria-label={t("daf.toolbar")} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", fontSize: 13 }}>
        <div role="group" aria-label={t("daf.view")} style={{ display: "inline-flex", gap: 2 }}>
          <button type="button" data-testid="daf-mode-page" aria-pressed={!linear} disabled={narrow} onClick={() => setLinearChosen(false)}>
            {t("daf.mode.page")}
          </button>
          <button type="button" data-testid="daf-mode-linear" aria-pressed={linear} onClick={() => setLinearChosen(true)}>
            {t("daf.mode.linear")}
          </button>
        </div>
        <label style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
          {t("daf.side")}
          <select data-testid="daf-side" value={side} onChange={(e) => setSide(e.target.value === "left" ? "left" : "right")}>
            <option value="right">{t("daf.side.a")}</option>
            <option value="left">{t("daf.side.b")}</option>
          </select>
        </label>
        {pick("daf-pick-inner", t("daf.inner"), innerPick, setInnerPick)}
        {pick("daf-pick-outer", t("daf.outer"), outerPick, setOuterPick)}
        <button type="button" data-testid="daf-print" onClick={print} style={{ marginInlineStart: "auto" }}>
          {t("daf.print")}
        </button>
      </div>
      {narrow && <p style={{ margin: 0, fontSize: 12, color: "hsl(var(--fg-muted))" }}>{t("daf.narrow")}</p>}
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: linear ? "wrap" : "nowrap", minHeight: 0 }}>
        <div ref={boxRef} style={{ flex: 1, minWidth: 0 }}>
          {linear ? (
            <div data-testid="daf-linear" style={{ maxInlineSize: "70ch", marginInline: "auto" }}>
              {content.main.title && (
                <h2 lang="he" dir="rtl" style={{ fontSize: 20, textAlign: "center" }}>
                  {content.main.title}
                </h2>
              )}
              {section("main", t("daf.main"), { ...content.main, title: "" })}
              {section("inner", t("daf.inner"), inner)}
              {section("outer", t("daf.outer"), outer)}
            </div>
          ) : (
            <>
              <h2 lang="he" dir="rtl" style={{ fontSize: 18, textAlign: "center", margin: "0 0 8px" }}>
                {content.main.title}
              </h2>
              <div ref={hostRef} />
            </>
          )}
        </div>
        {myNotes.length > 0 && (
          <aside aria-labelledby="daf-my-notes" data-testid="daf-my-notes" style={{ flex: "0 0 200px", fontSize: 13, borderInlineStart: "1px solid hsl(var(--border))", paddingInlineStart: 10 }}>
            <h2 id="daf-my-notes" style={{ fontSize: 14, margin: "0 0 6px" }}>
              {t("daf.myNotes")}
            </h2>
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {myNotes.map((n) => (
                <li key={n.path} style={{ marginBlockEnd: 6 }}>
                  <button type="button" className="link-btn" onClick={() => onOpenNote?.(n.path)} style={{ textAlign: "start" }}>
                    {n.title}
                  </button>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>
    </div>
  );
}

export default DafView;
