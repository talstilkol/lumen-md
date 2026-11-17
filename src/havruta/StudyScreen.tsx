/**
 * Havruta, part 2 (plan W12.H2): the study screen.
 *
 *  - Two columns per segment: the text (each free version, Hebrew/Aramaic
 *    right to left, a translation when there is one), and the shared notes
 *    on that segment, split into mine and my partner's (the verse panel's
 *    "my notes on this verse", W10.C24, as two columns).
 *  - The partner's place and selection (encrypted presence) in their
 *    colour; "Follow my partner" scrolls along with them.
 *  - Keyboard: the segments are one roving tab stop (↑/↓, Home/End), Enter
 *    goes to the segment's note box, Escape comes back.
 *  - Niqqud is for display only (W5.6): "Hide niqqud" strips it from the
 *    pointed text on screen; "Show niqqud" points unpointed text (Aramaic)
 *    through the on-device model when the app passes one. The text itself
 *    is never changed, and never leaves the device.
 *  - "Save to vault" writes the session note (./sessionNote.ts); "End
 *    session" saves it and deletes the room (./session.ts end).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as Y from "yjs";
import { t } from "../i18n";
import { scrollBehavior } from "../lib/motion";
import "./havrutaStrings";
import { removeNikud } from "../text/nikud";
import { addHighlight, addNote, listHighlights, notesBySegment, roomRef, SourceTextInNoteError, type HavrutaHighlight, type HavrutaPresence } from "./room";
import { localSegments, segmentCount, type StudyText } from "./text";

/** What the screen needs of a session (./session.ts HavrutaSession). */
export interface StudySession {
  doc: Y.Doc;
  awareness: {
    clientID: number;
    getStates(): Map<number, Record<string, unknown>>;
    on(e: "change", fn: () => void): void;
    off(e: "change", fn: () => void): void;
  };
  setPresence(p: HavrutaPresence): void;
}

export interface StudyScreenProps {
  session: StudySession;
  text: StudyText;
  me: { name: string; color: string };
  /** Write the session note; resolves with its path. */
  onSave: () => Promise<string | null>;
  onEnd: () => Promise<void>;
  /** The on-device niqqud model (W5.6), for unpointed text. */
  pointNikud?: (texts: string[]) => Promise<string[]>;
}

/** The partner's presence, when someone else is in the room. */
function partnerOf(s: StudySession): (HavrutaPresence & { id: number }) | null {
  for (const [id, st] of s.awareness.getStates()) if (id !== s.awareness.clientID && st && typeof st.name === "string") return { ...(st as unknown as HavrutaPresence), id };
  return null;
}

/** Text with marks: each range [start, end) of `marks` wrapped in <mark>. */
function Marked({ text, marks }: { text: string; marks: Array<{ start: number; end: number; kind: "highlight" | "partner"; color?: string }> }) {
  if (!marks.length) return <>{text}</>;
  const cuts = [...new Set([0, text.length, ...marks.flatMap((m) => [Math.max(0, Math.min(text.length, m.start)), Math.max(0, Math.min(text.length, m.end))])])].sort((a, b) => a - b);
  const out: React.ReactNode[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const [a, b] = [cuts[i], cuts[i + 1]];
    const piece = text.slice(a, b);
    const on = marks.filter((m) => m.start <= a && m.end >= b);
    if (!on.length) out.push(piece);
    else {
      const partner = on.find((m) => m.kind === "partner");
      out.push(
        <mark key={a} data-mark={partner ? "partner" : "highlight"} style={{ background: partner ? `color-mix(in srgb, ${partner.color ?? "#e8a"} 35%, transparent)` : "hsl(var(--warn) / 0.25)", color: "inherit" }}>
          {piece}
        </mark>,
      );
    }
  }
  return <>{out}</>;
}

/** Offsets of the current selection inside `el`'s text, or null. */
function selectionIn(el: HTMLElement): { start: number; end: number } | null {
  const sel = typeof window !== "undefined" ? window.getSelection() : null;
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const r = sel.getRangeAt(0);
  if (!el.contains(r.startContainer) || !el.contains(r.endContainer)) return null;
  const before = document.createRange();
  before.selectNodeContents(el);
  before.setEnd(r.startContainer, r.startOffset);
  const start = before.toString().length;
  return { start, end: start + r.toString().length };
}

export function StudyScreen({ session, text, me, onSave, onEnd, pointNikud }: StudyScreenProps) {
  const [, setTick] = useState(0);
  const rerender = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    session.doc.on("update", rerender);
    session.awareness.on("change", rerender);
    return () => {
      session.doc.off("update", rerender);
      session.awareness.off("change", rerender);
    };
  }, [session, rerender]);

  const count = segmentCount(text);
  const [active, setActive] = useState(0);
  const [follow, setFollow] = useState(false);
  const [showNikud, setShowNikud] = useState(true);
  const [pointed, setPointed] = useState<Map<string, string>>(new Map());
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const segRefs = useRef<Array<HTMLLIElement | null>>([]);
  const noteRef = useRef<HTMLTextAreaElement | null>(null);
  const local = useMemo(() => localSegments(text), [text]);
  const freeVersions = useMemo(() => text.versions.filter((v) => v.free && v.segments), [text]);
  const linkOnly = useMemo(() => text.versions.filter((v) => !v.free || !v.segments), [text]);
  const asked = useRef(new Set<string>());
  const partner = partnerOf(session);
  const bySeg = notesBySegment(session.doc);
  const highlights = listHighlights(session.doc);
  const ref = roomRef(session.doc);

  // My place goes out with the presence (no text, only where I am).
  useEffect(() => {
    session.setPresence({ name: me.name, color: me.color, segment: active, selection: null, leading: false });
  }, [session, me.name, me.color, active]);

  // Follow my partner: their segment comes into view.
  const partnerSegment = partner?.segment ?? null;
  useEffect(() => {
    if (!follow || partnerSegment === null) return;
    setActive(partnerSegment);
    segRefs.current[partnerSegment]?.scrollIntoView?.({ block: "center", behavior: scrollBehavior() });
  }, [follow, partnerSegment]);

  // Display-only niqqud for unpointed segments, through the on-device model when given.
  useEffect(() => {
    if (!showNikud || !pointNikud) return;
    const want = freeVersions.flatMap((v) => v.segments ?? []).filter((s) => v_isHebrew(s) && removeNikud(s) === s && !asked.current.has(s));
    if (!want.length) return;
    for (const s of want) asked.current.add(s);
    let live = true;
    void pointNikud(want).then((out) => {
      if (!live) return;
      setPointed((m) => {
        const n = new Map(m);
        // Only the same letters with marks added are used (as displayNikud does).
        want.forEach((s, i) => out[i] && removeNikud(out[i]) === s && n.set(s, out[i]));
        return n;
      });
    });
    return () => {
      live = false;
    };
  }, [showNikud, pointNikud, freeVersions]);

  const shown = (s: string) => (showNikud ? (pointed.get(s) ?? s) : removeNikud(s));

  const move = (to: number) => {
    const i = Math.max(0, Math.min(count - 1, to));
    setActive(i);
    segRefs.current[i]?.focus();
  };
  const onSegKey = (e: React.KeyboardEvent, i: number) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "ArrowDown") (e.preventDefault(), move(i + 1));
    else if (e.key === "ArrowUp") (e.preventDefault(), move(i - 1));
    else if (e.key === "Home") (e.preventDefault(), move(0));
    else if (e.key === "End") (e.preventDefault(), move(count - 1));
    else if (e.key === "Enter") (e.preventDefault(), setActive(i), setTimeout(() => noteRef.current?.focus(), 0));
  };

  const add = () => {
    try {
      addNote(session.doc, { segment: active, text: draft, name: me.name, sourceSegments: local });
      setDraft("");
      setError(null);
    } catch (e) {
      setError(e instanceof SourceTextInNoteError ? t("havruta.noCopy") : t("havruta.emptyNote"));
    }
  };
  const onSelect = (version: string, i: number, el: HTMLElement) => {
    const r = selectionIn(el);
    session.setPresence({ name: me.name, color: me.color, segment: i, selection: r ? { version, ...r } : null });
  };
  const highlightSelection = (version: string, i: number, el: HTMLElement | null) => {
    const r = el ? selectionIn(el) : null;
    if (r) addHighlight(session.doc, { segment: i, version, ...r });
  };

  const marksFor = (version: string, i: number) => {
    const hs = highlights.filter((h: HavrutaHighlight) => h.segment === i && h.version === version).map((h) => ({ start: h.start, end: h.end, kind: "highlight" as const }));
    const ps = partner?.selection && partner.segment === i && partner.selection.version === version ? [{ start: partner.selection.start, end: partner.selection.end, kind: "partner" as const, color: partner.color }] : [];
    return [...hs, ...ps];
  };

  const textEls = useRef(new Map<string, HTMLElement>());

  return (
    <section dir="rtl" lang="he" aria-labelledby="havruta-title" data-testid="havruta-screen" style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12, height: "100%", overflow: "auto", background: "hsl(var(--bg))", color: "hsl(var(--fg))" }}>
      <header style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <h2 id="havruta-title" style={{ margin: 0, fontSize: 16, flex: 1 }}>
          {t("havruta.title", { ref: text.heRef ?? ref?.he ?? text.ref.tref })}
        </h2>
        <span role="status" data-testid="havruta-partner" style={{ fontSize: 12, color: partner ? partner.color : "hsl(var(--fg-muted))" }}>
          {partner ? t("havruta.partnerHere", { name: partner.name, n: (partner.segment ?? 0) + 1 }) : t("havruta.partnerAway")}
        </span>
        <label style={{ fontSize: 12 }}>
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} data-testid="havruta-follow" /> {t("havruta.follow")}
        </label>
        <button type="button" onClick={() => setShowNikud((v) => !v)} aria-pressed={showNikud} data-testid="havruta-nikud">
          {showNikud ? t("havruta.hideNikud") : t("havruta.showNikud")}
        </button>
        <button
          type="button"
          disabled={busy}
          data-testid="havruta-save"
          onClick={async () => {
            setBusy(true);
            const p = await onSave().finally(() => setBusy(false));
            setStatus(p ? t("havruta.saved", { path: p }) : null);
          }}
        >
          {t("havruta.save")}
        </button>
        <button
          type="button"
          disabled={busy}
          data-testid="havruta-end"
          onClick={async () => {
            setBusy(true);
            await onEnd().finally(() => setBusy(false));
          }}
        >
          {t("havruta.end")}
        </button>
      </header>
      {status && <div role="status">{status}</div>}
      {linkOnly.length > 0 && (
        <ul aria-label={t("havruta.linkOnly")} style={{ fontSize: 12, margin: 0, color: "hsl(var(--fg-muted))" }}>
          {linkOnly.map((v) => (
            <li key={v.title} dir="auto">
              <bdi>{v.title}</bdi> · {v.licenseLabel} · <a href={`https://www.sefaria.org/${encodeURI(text.ref.tref)}`} target="_blank" rel="noreferrer noopener">{t("havruta.readOnSefaria")}</a>
            </li>
          ))}
        </ul>
      )}
      <ol aria-label={t("havruta.segments")} style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        {Array.from({ length: count }, (_, i) => {
          const row = bySeg.get(i) ?? { mine: [], theirs: [] };
          const here = partner?.segment === i;
          return (
            <li
              key={i}
              ref={(el) => {
                segRefs.current[i] = el;
              }}
              tabIndex={i === active ? 0 : -1}
              aria-current={i === active ? "true" : undefined}
              aria-label={t("havruta.segment", { n: i + 1 })}
              data-testid={`havruta-seg-${i}`}
              data-partner-here={here ? "1" : undefined}
              onFocus={() => setActive(i)}
              onKeyDown={(e) => onSegKey(e, i)}
              style={{ display: "grid", gridTemplateColumns: "minmax(0, 3fr) minmax(0, 2fr)", gap: 8, padding: 8, borderRadius: 6, border: `2px solid ${here ? (partner?.color ?? "transparent") : i === active ? "hsl(var(--accent))" : "hsl(var(--border))"}` }}
            >
              <div>
                {freeVersions.map((v) => {
                  const s = v.segments?.[i];
                  if (!s) return null;
                  const key = `${v.title}|${i}`;
                  return (
                    <p
                      key={v.title}
                      lang={v.language === "he" ? "he" : v.language}
                      dir={v.direction}
                      data-testid={`havruta-text-${i}-${v.language}`}
                      ref={(el) => {
                        if (el) textEls.current.set(key, el);
                      }}
                      onMouseUp={(e) => onSelect(v.title, i, e.currentTarget)}
                      onKeyUp={(e) => onSelect(v.title, i, e.currentTarget)}
                      style={{ margin: "0 0 4px", fontSize: v.language === "he" ? 18 : 14, lineHeight: 1.7 }}
                    >
                      <Marked text={shown(s)} marks={marksFor(v.title, i)} />
                    </p>
                  );
                })}
                {i === active && freeVersions.length > 0 && (
                  <button type="button" style={{ fontSize: 11 }} onClick={() => highlightSelection(freeVersions[0].title, i, textEls.current.get(`${freeVersions[0].title}|${i}`) ?? null)}>
                    {t("havruta.highlight")}
                  </button>
                )}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: 13 }}>
                <div>
                  <h3 style={{ fontSize: 11, margin: 0 }}>{t("havruta.mine")}</h3>
                  <ul data-testid={`havruta-mine-${i}`} style={{ margin: 0, paddingInlineStart: 16 }}>
                    {row.mine.map((n) => (
                      <li key={n.id} dir="auto">{n.text}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 style={{ fontSize: 11, margin: 0 }}>{partner ? t("havruta.theirsNamed", { name: partner.name }) : t("havruta.theirs")}</h3>
                  <ul data-testid={`havruta-theirs-${i}`} style={{ margin: 0, paddingInlineStart: 16 }}>
                    {row.theirs.map((n) => (
                      <li key={n.id} dir="auto">
                        <bdi>{n.name}</bdi>: {n.text}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
        style={{ display: "flex", gap: 6, alignItems: "flex-start" }}
      >
        <label htmlFor="havruta-note" style={{ fontSize: 12 }}>
          {t("havruta.noteOn", { n: active + 1 })}
        </label>
        <textarea
          id="havruta-note"
          ref={noteRef}
          dir="auto"
          rows={2}
          value={draft}
          data-testid="havruta-note"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") (e.preventDefault(), segRefs.current[active]?.focus());
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (e.preventDefault(), add());
          }}
          style={{ flex: 1 }}
        />
        <button type="submit" data-testid="havruta-add">{t("havruta.add")}</button>
      </form>
      {error && (
        <div role="alert" style={{ color: "hsl(var(--danger))", fontSize: 12 }}>
          {error}
        </div>
      )}
    </section>
  );
}

const v_isHebrew = (s: string) => /[א-ת]/.test(s);
