/**
 * The immersive reader (plan W13.R5), after Microsoft's Immersive Reader,
 * with what it lacks in Hebrew: parts of speech in colour (nouns, verbs,
 * adjectives — tagged on this device), syllables for English and niqqud for
 * display as Hebrew's parallel aid (W5.6), a word's translation and its
 * sound on a click, and line focus of 1, 3 or 5 lines — the same profile
 * fields as every reading mode (W13.R1). The note is only read.
 *
 * Keyboard: ← → move along the words (in the text's direction), ↑ ↓ move a
 * line, Enter opens the word, Escape closes the word and then the reader.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import "../reading/immersiveStrings";
// The line-focus names are the reading menu's (the readingMode chunk).
import "../reading/readingModeStrings";
import { getLocale, t } from "../i18n";
import { useAppStore } from "../store/useStore";
import { immersiveParagraphs, lexiconTranslation, syllables, POS_COLORS } from "../reading/immersive";
import type { LineFocusLines, ReadingProfile } from "../reading/settings";
import type { Pos } from "../text/hebrewPos";
import { Modal } from "./Modal";
import { HelpButton } from "./HelpButton";

type Shown = Record<Exclude<Pos, "other">, boolean>;
const ctl: CSSProperties = { border: "1px solid hsl(var(--border-strong))", borderRadius: 8, padding: "4px 10px", background: "hsl(var(--bg))", color: "hsl(var(--fg))", font: "inherit", fontSize: 13, cursor: "pointer" };

interface Props {
  content: string;
  profile: Pick<ReadingProfile, "pos" | "syllables" | "lineFocus">;
  close: () => void;
  /** The on-device translation (plan 6.4); tests pass a stand-in. */
  translate?: (word: string, rtl: boolean) => Promise<string>;
}

async function localTranslate(word: string, rtl: boolean): Promise<string> {
  const [{ viaLocalLayers }, { uiConfirm }] = await Promise.all([import("../ai/mt/sideBySide"), import("./PromptDialog")]);
  const pair = rtl ? { source: "he", target: "en" } : { source: "en", target: "he" };
  const r = await viaLocalLayers(pair, { confirm: uiConfirm, t, locale: getLocale() })([word]);
  return r.texts[0] ?? "";
}

/**
 * On-device voices only, through the audited speech route (ai/tts.ts; INT7: cloud-routes gate).
 * Loaded on demand (review 13 M1: a static import put ai/tts, and its English, in this
 * dialog's chunk): fetched when a word's card opens, so the click itself still speaks at once.
 */
type SpeakFn = (word: string, lang: string) => boolean;
let speakFn: SpeakFn | null = null;
const loadSpeak = (): Promise<SpeakFn> => (speakFn ? Promise.resolve(speakFn) : import("../ai/tts").then((m) => (speakFn = m.speakWordLocally)));
async function speak(word: string, rtl: boolean): Promise<boolean> {
  const lang = rtl ? "he" : "en";
  if (speakFn) return speakFn(word, lang);
  try {
    return (await loadSpeak())(word, lang);
  } catch {
    return false;
  }
}

export function ImmersiveReader({ content, profile, close, translate = localTranslate }: Props) {
  const paragraphs = useMemo(() => immersiveParagraphs(content), [content]);
  const [shown, setShown] = useState<Shown>({ noun: profile.pos, verb: profile.pos, adj: profile.pos });
  const [labels, setLabels] = useState(false);
  const [syl, setSyl] = useState(profile.syllables);
  const [lines, setLines] = useState<LineFocusLines>(profile.lineFocus);
  const [current, setCurrent] = useState(0);
  const [open, setOpen] = useState<{ word: string; pos: Pos | null; rtl: boolean } | null>(null);
  const [gloss, setGloss] = useState<{ state: "idle" | "busy" | "none" | "failed"; text: string[] }>({ state: "idle", text: [] });
  const [band, setBand] = useState<{ top: number; bottom: number } | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const dark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  const anyHebrew = paragraphs.some((p) => p.some((x) => x.rtl));

  // The words in reading order, for the keyboard.
  const wordEls = () => [...(pageRef.current?.querySelectorAll<HTMLElement>("[data-w]") ?? [])];

  // Line focus: a band of 1/3/5 lines around the current word's line.
  useLayoutEffect(() => {
    const page = pageRef.current;
    const el = wordEls()[current];
    if (!page || !el || !lines) return setBand(null);
    const lh = parseFloat(getComputedStyle(el).lineHeight) || el.getBoundingClientRect().height * 1.6;
    const pr = page.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const mid = r.top + r.height / 2 - pr.top + page.scrollTop;
    setBand({ top: Math.max(0, mid - (lh * lines) / 2), bottom: mid + (lh * lines) / 2 });
    el.scrollIntoView?.({ block: "nearest" });
  }, [current, lines, syl, labels, paragraphs]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setGloss({ state: "busy", text: [] });
    void lexiconTranslation(open.word).then((hit) => live && setGloss(hit.length ? { state: "idle", text: hit } : { state: "none", text: [] }));
    return () => {
      live = false;
    };
  }, [open]);

  const openWord = (i: number) => {
    const el = wordEls()[i];
    if (!el) return;
    setCurrent(i);
    setOpen({ word: el.dataset.w ?? "", pos: (el.dataset.pos as Pos) ?? null, rtl: el.dataset.rtl === "1" });
    void loadSpeak().catch(() => undefined);
  };

  const moveLine = (dir: 1 | -1) => {
    const els = wordEls();
    const here = els[current]?.getBoundingClientRect();
    if (!here) return;
    // The nearest word, horizontally, on the next line up or down.
    let best = -1;
    let bestScore = Infinity;
    els.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      const dy = (r.top - here.top) * dir;
      if (dy <= here.height / 2) return;
      const score = dy * 1000 + Math.abs(r.left + r.width / 2 - (here.left + here.width / 2));
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    });
    if (best >= 0) setCurrent(best);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest("button, input, select, label")) return;
    const rtl = wordEls()[current]?.dataset.rtl === "1";
    const n = wordEls().length;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const forward = (e.key === "ArrowLeft") === rtl;
      setCurrent((c) => Math.max(0, Math.min(n - 1, c + (forward ? 1 : -1))));
    } else if (e.key === "ArrowDown") moveLine(1);
    else if (e.key === "ArrowUp") moveLine(-1);
    else if (e.key === "Enter") openWord(current);
    else if (e.key === "Escape" && open) setOpen(null);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  let index = -1;
  const colorOf = (pos: Pos | null) => (pos && pos !== "other" && shown[pos] ? POS_COLORS[pos][dark ? "dark" : "light"] : undefined);

  return (
    <Modal onClose={() => (open ? setOpen(null) : close())} aria-labelledby="immersive-title" data-testid="immersive-reader" data-reading-mode="immersive" style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh", maxWidth: "none", maxHeight: "none", margin: 0, padding: 0, border: 0, background: "hsl(var(--bg))", color: "hsl(var(--fg))" }}>
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <header style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", padding: "10px 16px", borderBottom: "1px solid hsl(var(--border))", fontSize: 13 }}>
          <HelpButton topic="editor/reading-modes#immersive-reader" size={20} />
          <h2 id="immersive-title" style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
            {t("immersive.title")}
          </h2>
          <fieldset style={{ display: "flex", gap: 10, border: 0, margin: 0, padding: 0, alignItems: "center" }}>
            <legend style={{ float: "inline-start", marginInlineEnd: 6, padding: 0 }}>{t("immersive.pos")}</legend>
            {(Object.keys(POS_COLORS) as Array<keyof Shown>).map((k) => (
              <label key={k} style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <input type="checkbox" checked={shown[k]} onChange={(e) => {
                    const on = e.currentTarget.checked;
                    setShown((s) => ({ ...s, [k]: on }));
                  }} data-testid={`immersive-pos-${k}`} />
                <span style={{ color: POS_COLORS[k][dark ? "dark" : "light"], fontWeight: 600 }}>{t(`immersive.pos.${k}`)}</span>
              </label>
            ))}
          </fieldset>
          <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <input type="checkbox" checked={labels} onChange={(e) => setLabels(e.currentTarget.checked)} data-testid="immersive-labels" />
            {t("immersive.labels")}
          </label>
          <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <input type="checkbox" checked={syl} onChange={(e) => setSyl(e.currentTarget.checked)} data-testid="immersive-syllables" />
            {t("immersive.syllables")}
          </label>
          {anyHebrew && (
            <button type="button" style={ctl} data-testid="immersive-nikud" onClick={() => void import("./ReadingAids").then((m) => m.toggleDisplayNikud())}>
              {t("immersive.nikud")}
            </button>
          )}
          <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
            {t("immersive.lineFocus")}
            <select style={ctl} value={lines} onChange={(e) => setLines(Number(e.currentTarget.value) as LineFocusLines)} data-testid="immersive-lines">
              {[0, 1, 3, 5].map((n) => (
                <option key={n} value={n}>
                  {t(`readingMode.lineFocus.${n}`)}
                </option>
              ))}
            </select>
          </label>
          <span style={{ flex: 1 }} />
          <button type="button" style={ctl} onClick={close} aria-label={t("immersive.close")}>
            ✕
          </button>
        </header>

        <div
          ref={pageRef}
          className="prose-lumen immersive-page"
          role="document"
          tabIndex={0}
          aria-label={t("immersive.page")}
          onKeyDown={onKey}
          onClick={(e) => {
            const el = (e.target as HTMLElement).closest<HTMLElement>("[data-w]");
            if (el) openWord(wordEls().indexOf(el));
          }}
          data-testid="immersive-page"
          style={{ position: "relative", flex: 1, overflow: "auto", padding: "24px max(16px, calc((100% - var(--reading-width, 72ch)) / 2))", fontSize: "calc(var(--reading-size, 17px) + 5px)", lineHeight: labels ? 2.6 : "var(--reading-line-height, 1.9)", fontFamily: "var(--reading-font, var(--font-serif))", outline: "none" }}
        >
          {paragraphs.map((p, pi) => (
            <p key={pi} dir="auto" style={{ margin: "0 0 1em" }}>
              {p.map((tok, ti) => {
                if (!tok.pos) return <span key={ti}>{tok.text}</span>;
                index++;
                const i = index;
                const color = colorOf(tok.pos);
                const shownText = syl && !tok.rtl ? syllables(tok.text).join("·") : tok.text;
                const word = (
                  <span
                    data-w={tok.text}
                    data-pos={tok.pos}
                    data-rtl={tok.rtl ? "1" : "0"}
                    style={{ color, cursor: "pointer", borderRadius: 3, outline: i === current ? "2px solid hsl(var(--accent))" : undefined, outlineOffset: 1 }}
                  >
                    {shownText}
                  </span>
                );
                return labels && color && tok.pos !== "other" ? (
                  <ruby key={ti}>
                    {word}
                    <rt style={{ fontSize: "0.45em", color, fontFamily: "var(--font-sans)", letterSpacing: 0 }}>{t(`immersive.label.${tok.pos}`)}</rt>
                  </ruby>
                ) : (
                  <span key={ti}>{word}</span>
                );
              })}
            </p>
          ))}
          {band && (
            <>
              <div aria-hidden="true" data-testid="immersive-band" style={{ position: "absolute", insetInline: 0, top: 0, height: band.top, background: "hsl(var(--bg) / 0.78)", pointerEvents: "none" }} />
              <div aria-hidden="true" style={{ position: "absolute", insetInline: 0, top: band.bottom, height: Math.max(0, (pageRef.current?.scrollHeight ?? 0) - band.bottom), background: "hsl(var(--bg) / 0.78)", pointerEvents: "none" }} />
            </>
          )}
        </div>

        {open && (
          <div role="dialog" aria-label={t("immersive.word")} data-testid="immersive-word" style={{ position: "fixed", insetInlineEnd: 16, bottom: 16, width: 280, padding: 14, borderRadius: 12, border: "1px solid hsl(var(--border))", background: "hsl(var(--bg))", boxShadow: "0 6px 24px rgb(0 0 0 / 0.15)" }}>
            <p dir="auto" lang={open.rtl ? "he" : "en"} style={{ fontSize: 26, margin: "0 0 4px" }}>
              {open.word}
            </p>
            {open.pos && open.pos !== "other" && <p style={{ margin: "0 0 8px", fontSize: 13, color: colorOf(open.pos) ?? "inherit" }}>{t(`immersive.pos.${open.pos}`)}</p>}
            <p aria-live="polite" dir="auto" data-testid="immersive-gloss" style={{ margin: "0 0 10px", fontSize: 15 }}>
              {gloss.state === "busy" ? t("immersive.translating") : gloss.text.length ? gloss.text.join(", ") : gloss.state === "failed" ? t("immersive.translateFailed") : ""}
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {gloss.state === "none" && (
                <button
                  type="button"
                  style={ctl}
                  data-testid="immersive-translate"
                  onClick={() => {
                    setGloss({ state: "busy", text: [] });
                    translate(open.word, open.rtl).then(
                      (x) => setGloss(x ? { state: "idle", text: [x] } : { state: "failed", text: [] }),
                      () => setGloss({ state: "failed", text: [] }),
                    );
                  }}
                >
                  {t("immersive.translate")}
                </button>
              )}
              <button type="button" style={ctl} data-testid="immersive-speak" onClick={() => void speak(open.word, open.rtl).then((ok) => !ok && setGloss((g) => ({ ...g, state: g.text.length ? g.state : "idle", text: g.text.length ? g.text : [t("immersive.noVoice")] })))}>
                {t("immersive.speak")}
              </button>
              <button type="button" style={ctl} onClick={() => setOpen(null)}>
                {t("immersive.closeWord")}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

let unmount: (() => void) | null = null;

/** Open the immersive reader on the current note with the note's reading profile. */
export function openImmersiveReader(profile: Pick<ReadingProfile, "pos" | "syllables" | "lineFocus">): void {
  if (unmount) return;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  unmount = () => {
    unmount = null;
    root.unmount();
    host.remove();
  };
  root.render(<ImmersiveReader content={useAppStore.getState().doc.content} profile={profile} close={() => unmount?.()} />);
}
