/**
 * The RSVP reader (plan W13.R3, experimental): the note one word at a time
 * at a fixed place, the recognition point marked (from the right in
 * Hebrew), with rewind built in — the research shows comprehension falls
 * without it (./../reading/rsvp.ts). Space plays or pauses; arrows go back
 * and forward along the text's direction; Shift+arrow or Backspace goes back
 * a sentence; ↑ ↓ change the speed. Paused, the sentence is shown around
 * the word. The note is only read.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import "../reading/rsvpStrings";
import { t } from "../i18n";
import { useAppStore } from "../store/useStore";
import { RSVP_RESEARCH, WPM, keyAction, minutesLeft, rewindSentence, rsvpWords, sentenceAround, wordDuration } from "../reading/rsvp";
import { Modal } from "./Modal";
// The palette's dialog look (.cmd-palette): loaded with this dialog too, which can open before the palette ever has (INT7).
import "./CommandPalette.css";

const btn: CSSProperties = { border: "1px solid hsl(var(--border-strong))", borderRadius: 8, padding: "6px 12px", background: "hsl(var(--bg))", color: "hsl(var(--fg))", font: "inherit", fontSize: 13, cursor: "pointer" };

export function RsvpReader({ content, initialWpm, close }: { content: string; initialWpm: number; close: () => void }) {
  const words = useMemo(() => rsvpWords(content), [content]);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [wpm, setWpm] = useState(Math.min(WPM.max, Math.max(WPM.min, initialWpm)));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const word = words[Math.min(i, words.length - 1)];
  const rtl = word?.rtl ?? false;

  useEffect(() => {
    if (!playing || !word) return;
    timer.current = setTimeout(() => {
      if (i >= words.length - 1) setPlaying(false);
      else setI(i + 1);
    }, wordDuration(word, wpm));
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [playing, i, wpm, word, words.length]);

  const act = useCallback(
    (a: ReturnType<typeof keyAction>) => {
      if (!a) return false;
      if (a === "toggle") {
        // At the end, play starts again from the first word.
        if (!playing && i >= words.length - 1) setI(0);
        setPlaying(!playing);
      } else if (a === "back") {
        setPlaying(false);
        setI((x) => Math.max(0, x - 1));
      } else if (a === "forward") {
        setPlaying(false);
        setI((x) => Math.min(words.length - 1, x + 1));
      } else if (a === "sentenceBack") setI((x) => rewindSentence(words, x));
      else if (a === "faster") setWpm((w) => Math.min(WPM.max, w + WPM.step));
      else if (a === "slower") setWpm((w) => Math.max(WPM.min, w - WPM.step));
      else if (a === "close") close();
      return true;
    },
    [close, i, playing, words],
  );

  const onKey = (e: React.KeyboardEvent) => {
    // Controls keep their own keys (Tab, Enter on a button, arrows on the slider).
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" && e.key !== " " && e.key !== "Escape") return;
    if (tag === "BUTTON" && (e.key === " " || e.key === "Enter")) return;
    if (act(keyAction(e.key, { rtl, shift: e.shiftKey }))) e.preventDefault();
  };

  if (!word) {
    return (
      <Modal onClose={close} className="cmd-palette-backdrop" aria-label={t("rsvp.title")} data-testid="rsvp-reader" data-reading-mode="rsvp">
        <div className="cmd-palette" style={{ padding: 24, maxWidth: 420 }}>
          <p>{t("rsvp.empty")}</p>
          <button type="button" style={btn} onClick={close}>
            {t("rsvp.close")}
          </button>
        </div>
      </Modal>
    );
  }

  const before = word.graphemes.slice(0, word.orp).join("");
  const pivot = word.graphemes[word.orp] ?? "";
  const after = word.graphemes.slice(word.orp + 1).join("");
  const ctx = sentenceAround(words, i);
  const left = Math.max(0, Math.ceil(minutesLeft(words, i, wpm)));

  return (
    <Modal onClose={close} aria-labelledby="rsvp-title" data-testid="rsvp-reader" style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh", maxWidth: "none", maxHeight: "none", margin: 0, padding: 0, border: 0, background: "hsl(var(--bg))", color: "hsl(var(--fg))" }}>
      <div onKeyDown={onKey} style={{ display: "flex", flexDirection: "column", height: "100%", padding: 16, boxSizing: "border-box" }}>
        <header style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <h2 id="rsvp-title" style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
            {t("rsvp.title")}
          </h2>
          <span style={{ fontSize: 11, border: "1px solid hsl(var(--border-strong))", borderRadius: 4, padding: "0 5px" }}>{t("readingMode.experimental")}</span>
          <a href={RSVP_RESEARCH} target="_blank" rel="noreferrer noopener" style={{ fontSize: 12 }}>
            {t("rsvp.research")}
          </a>
          <span style={{ flex: 1 }} />
          <button type="button" style={btn} onClick={close} aria-label={t("rsvp.close")}>
            ✕
          </button>
        </header>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 18 }}>
          {/* The fixed recognition point: two ticks above and below the pivot column. */}
          <div aria-hidden="true" style={{ width: "min(720px, 94vw)", position: "relative" }}>
            <div style={{ position: "absolute", insetInlineStart: "50%", top: -14, height: 10, borderInlineStart: "2px solid hsl(var(--fg-muted))" }} />
            <div style={{ position: "absolute", insetInlineStart: "50%", bottom: -14, height: 10, borderInlineStart: "2px solid hsl(var(--fg-muted))" }} />
            <div
              data-testid="rsvp-word"
              dir={rtl ? "rtl" : "ltr"}
              lang={rtl ? "he" : undefined}
              style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "baseline", fontSize: "clamp(32px, 6vw, 56px)", fontFamily: "var(--reading-font, var(--font-serif))", lineHeight: 1.4, whiteSpace: "pre" }}
            >
              <span style={{ textAlign: "end" }}>{before}</span>
              <span data-testid="rsvp-pivot" style={{ color: "#c2410c", fontWeight: 600 }}>
                {pivot}
              </span>
              <span style={{ textAlign: "start" }}>{after}</span>
            </div>
          </div>
          {/* Screen readers: the word, and the sentence when paused. */}
          <p className="sr-only" aria-live="polite" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clipPath: "inset(50%)" }}>
            {playing ? "" : words.slice(ctx.from, ctx.to).map((w) => w.text).join(" ")}
          </p>
          <p data-testid="rsvp-context" dir="auto" style={{ minHeight: "3.2em", maxWidth: "min(720px, 94vw)", margin: 0, fontSize: 16, lineHeight: 1.6, color: "hsl(var(--fg-muted))", visibility: playing ? "hidden" : "visible" }}>
            {words.slice(ctx.from, ctx.to).map((w, k) => (
              <span key={ctx.from + k} style={ctx.from + k === i ? { color: "hsl(var(--fg))", fontWeight: 600, textDecoration: "underline" } : undefined}>
                {w.text}{" "}
              </span>
            ))}
          </p>
        </div>

        <footer style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "center", flexWrap: "wrap" }}>
          <button type="button" style={btn} onClick={() => act("sentenceBack")} data-testid="rsvp-rewind" title={t("rsvp.rewind.hint")}>
            {t("rsvp.rewind")}
          </button>
          <button type="button" style={btn} onClick={() => act("back")} aria-label={t("rsvp.back")}>
            {rtl ? "→" : "←"}
          </button>
          <button type="button" style={{ ...btn, minWidth: 96, fontWeight: 600 }} onClick={() => act("toggle")} data-testid="rsvp-play" aria-pressed={playing}>
            {playing ? t("rsvp.pause") : t("rsvp.play")}
          </button>
          <button type="button" style={btn} onClick={() => act("forward")} aria-label={t("rsvp.forward")}>
            {rtl ? "←" : "→"}
          </button>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
            {t("rsvp.wpm")}
            <input type="range" min={WPM.min} max={WPM.max} step={WPM.step} value={wpm} onChange={(e) => setWpm(Number(e.currentTarget.value))} data-testid="rsvp-wpm" />
            <output dir="ltr" style={{ minWidth: 36, fontVariantNumeric: "tabular-nums" }}>
              {wpm}
            </output>
          </label>
          <span style={{ fontSize: 12, color: "hsl(var(--fg-muted))" }} data-testid="rsvp-progress">
            {t("rsvp.progress", { n: i + 1, total: words.length, min: left })}
          </span>
        </footer>
        <p style={{ textAlign: "center", fontSize: 12, color: "hsl(var(--fg-muted))", margin: "8px 0 0" }}>{t("rsvp.keys")}</p>
      </div>
    </Modal>
  );
}

let unmount: (() => void) | null = null;

/** Open the RSVP reader on the current note (the reading mode menu's "Open"). */
export function openRsvpReader(wpm: number): void {
  if (unmount) return;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  unmount = () => {
    unmount = null;
    root.unmount();
    host.remove();
  };
  root.render(<RsvpReader content={useAppStore.getState().doc.content} initialWpm={wpm} close={() => unmount?.()} />);
}
