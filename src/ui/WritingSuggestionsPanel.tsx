/**
 * The writing suggestions panel (plan W13.W1): one card per suggestion of
 * the writing agents, in both editors, like Grammarly's sidebar:
 *  - the kind, the message, a word-level diff (deleted / inserted words,
 *    Hebrew-aware, W3.11), how sure the agent is, and why (opened on
 *    demand);
 *  - Accept, Reject and Edit per card; with several word changes, a tick
 *    per change (accept only some); with alternatives (the tone shifter's
 *    three versions), a choice between them;
 *  - Accept all / Reject all: one transaction, so one Ctrl+Z undoes all;
 *  - keyboard: ↑/↓ between cards, Enter accepts, Delete rejects, E edits,
 *    Esc closes; the status line is announced to screen readers.
 * A card a guard blocked (a number or name the rewrite changed) says what
 * changed and cannot be accepted as is — only edited.
 *
 * Lazy: mounted by the writing commands; never in the startup bundle.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createRoot, type Root } from "react-dom/client";
import { t } from "../i18n";
import "./writingPanelStrings";
import { HelpButton } from "./HelpButton";
import { hunksOf, suggestionDiff, type WritingSuggestion } from "../agents/writing/suggestion";
import type { AcceptChoice, ChangePlan } from "../agents/writing/engine";

/** What the panel needs from the editor that shows the suggestions (cmBridge or pmBridge). */
export interface WritingHost {
  subscribe(fn: (list: readonly WritingSuggestion[]) => void): () => void;
  accept(choices: readonly AcceptChoice[]): ChangePlan;
  reject(ids: readonly string[]): void;
  focus(id: string | null): void;
  /** Re-runs the agent that filled the panel (the level changed, or the user asks again). */
  rerun?: () => void;
}

export interface PanelState {
  agentLabel: string;
  busy?: boolean;
  error?: string | null;
  /** The writing level and its setter (re-runs the agent). */
  level?: string;
  onLevel?: (level: string) => void;
  /** Rank the coach's findings with the local model. */
  rank?: boolean;
  onRank?: (on: boolean) => void;
}

const LEVELS = ["everyday", "professional", "academic"] as const;

const KIND_HUE: Record<string, number> = { grammar: 0, spelling: 0, clarity: 210, passive: 210, nominalization: 210, readability: 210, structure: 210, concision: 150, wordiness: 150, redundancy: 150, hedge: 150, repetition: 150, tone: 275, register: 275, wordChoice: 275, expansion: 275, logic: 30, consistency: 30 };
const hue = (k: string) => KIND_HUE[k] ?? 210;

const btn: React.CSSProperties = { padding: "3px 10px", fontSize: 12, borderRadius: 6, border: "1px solid hsl(var(--border))", background: "transparent", color: "inherit", cursor: "pointer", minHeight: 28 };
const primary: React.CSSProperties = { ...btn, background: "hsl(var(--accent, 210 70% 50%))", borderColor: "transparent", color: "hsl(var(--accent-fg, 0 0% 100%))", fontWeight: 600 };
const muted: React.CSSProperties = { fontSize: 12, color: "hsl(var(--fg-muted))" };
const srOnly: React.CSSProperties = { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" };

/** The diff of a suggestion, as text with <del>/<ins> (screen readers hear "deleted" / "inserted"). */
export function DiffView({ s, replacement }: { s: WritingSuggestion; replacement: string | null }) {
  const ops = suggestionDiff(s, replacement);
  return (
    <p dir="auto" data-testid="ws-diff" style={{ margin: 0, fontSize: 14, lineHeight: 1.6, unicodeBidi: "plaintext", wordBreak: "break-word" }}>
      {ops.map((op, i) =>
        op.type === "equal" ? (
          <span key={i}>{op.text}</span>
        ) : op.type === "delete" ? (
          <del key={i} style={{ background: "hsl(0 80% 60% / 0.16)", color: "inherit", textDecorationColor: "hsl(0 70% 50%)" }}>
            <span style={srOnly}>{t("writing.deleted")} </span>
            {op.text}
          </del>
        ) : (
          <ins key={i} style={{ background: "hsl(140 60% 45% / 0.18)", textDecoration: "none", borderBottom: "1px solid hsl(140 55% 38%)" }}>
            <span style={srOnly}>{t("writing.inserted")} </span>
            {op.text}
          </ins>
        ),
      )}
    </p>
  );
}

function Card({ s, host, onDone, active, onFocusCard }: { s: WritingSuggestion; host: WritingHost; onDone: (plan: ChangePlan | null, rejected?: boolean) => void; active: boolean; onFocusCard: () => void }) {
  const [alt, setAlt] = useState<number | undefined>(undefined);
  const base = alt === undefined ? s.replacement : (s.alternatives?.[alt] ?? s.replacement);
  const hunks = useMemo(() => hunksOf(suggestionDiff(s, base)), [s, base]);
  const [picked, setPicked] = useState<Set<number>>(() => new Set(hunks.map((h) => h.index)));
  useEffect(() => setPicked(new Set(hunks.map((h) => h.index))), [hunks]);
  const [editing, setEditing] = useState<string | null>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (editing !== null) editRef.current?.focus();
  }, [editing !== null]); // eslint-disable-line react-hooks/exhaustive-deps
  const advice = s.replacement === null;
  const canAccept = !advice && !s.blocked && (hunks.length <= 1 || picked.size > 0);
  const accept = () => {
    if (editing !== null) return onDone(host.accept([{ id: s.id, text: editing }]));
    if (!canAccept) return;
    onDone(host.accept([{ id: s.id, alternative: alt, hunks: hunks.length > 1 && picked.size < hunks.length ? picked : undefined }]));
  };
  const reject = () => {
    host.reject([s.id]);
    onDone(null, true);
  };
  const onKey = (e: KeyboardEvent<HTMLLIElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter") {
      e.preventDefault();
      accept();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      reject();
    } else if (e.key.toLowerCase() === "e" && !advice) {
      e.preventDefault();
      setEditing(base ?? s.original);
    }
  };
  const pct = Math.round(s.confidence * 100);
  const titleId = `ws-${s.id.replace(/[^\w-]/g, "_")}`;
  return (
    <li
      tabIndex={0}
      data-testid="ws-card"
      data-ws-id={s.id}
      aria-labelledby={titleId}
      aria-current={active ? "true" : undefined}
      onFocus={onFocusCard}
      onKeyDown={onKey}
      style={{ listStyle: "none", border: `1px solid ${active ? `hsl(${hue(s.kind)} 60% 50%)` : "hsl(var(--border))"}`, borderInlineStart: `3px solid hsl(${hue(s.kind)} 60% 50%)`, borderRadius: 8, padding: 10, display: "flex", flexDirection: "column", gap: 6, outlineOffset: 2 }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 600, padding: "1px 6px", borderRadius: 999, background: `hsl(${hue(s.kind)} 60% 50% / 0.16)`, color: "hsl(var(--fg))", border: `1px solid hsl(${hue(s.kind)} 60% 45% / 0.6)` }}>{t(`writing.kind.${s.kind}`, { defaultValue: s.kind })}</span>
        <strong id={titleId} dir="auto" style={{ fontSize: 13, flex: 1 }}>
          {s.message}
        </strong>
        <span style={muted} title={t("writing.confidence")}>
          <span style={srOnly}>{t("writing.confidence")} </span>
          {pct}%
        </span>
      </div>
      {editing === null ? (
        <DiffView s={s} replacement={base} />
      ) : (
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={muted}>{t("writing.editLabel")}</span>
          <textarea
            ref={editRef}
            dir="auto"
            data-testid="ws-edit"
            value={editing}
            onChange={(e) => setEditing(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) accept();
              if (e.key === "Escape") {
                e.stopPropagation();
                setEditing(null);
              }
            }}
            rows={Math.min(8, Math.max(2, Math.ceil(editing.length / 40)))}
            style={{ font: "inherit", fontSize: 14, padding: 6, borderRadius: 6, border: "1px solid hsl(var(--border))", background: "hsl(var(--bg))", color: "inherit" }}
          />
        </label>
      )}
      {s.blocked ? (
        <p role="note" data-testid="ws-blocked" dir="auto" style={{ margin: 0, fontSize: 12, color: "hsl(0 65% 42%)" }}>
          {t("writing.blocked", { why: s.blocked })}
        </p>
      ) : null}
      {s.alternatives?.length && editing === null ? (
        <fieldset style={{ border: 0, margin: 0, padding: 0, display: "flex", gap: 6, flexWrap: "wrap" }}>
          <legend style={muted}>{t("writing.versions")}</legend>
          {[s.replacement, ...s.alternatives].map((_, i) => (
            <label key={i} style={{ ...btn, display: "inline-flex", alignItems: "center", gap: 4 }}>
              <input type="radio" name={`${titleId}-v`} checked={(alt ?? -1) === i - 1} onChange={() => setAlt(i === 0 ? undefined : i - 1)} />
              {t("writing.version", { n: i + 1 })}
            </label>
          ))}
        </fieldset>
      ) : null}
      {hunks.length > 1 && editing === null && !s.blocked ? (
        <fieldset style={{ border: 0, margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          <legend style={muted}>{t("writing.changes", { n: hunks.length })}</legend>
          {hunks.map((h) => (
            <label key={h.index} dir="auto" style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={picked.has(h.index)}
                onChange={(e) => {
                  const next = new Set(picked);
                  if (e.target.checked) next.add(h.index);
                  else next.delete(h.index);
                  setPicked(next);
                }}
              />
              <span>
                {h.del ? <del>{h.del.trim()}</del> : null}
                {h.del && h.ins ? " → " : null}
                {h.ins ? <ins style={{ textDecoration: "none", fontWeight: 600 }}>{h.ins.trim()}</ins> : null}
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}
      <details>
        <summary style={{ ...muted, cursor: "pointer" }}>{t("writing.why")}</summary>
        <p dir="auto" style={{ ...muted, margin: "4px 0 0" }}>
          {s.rationale} · {s.model === "rules" ? t("writing.byRules") : t("writing.byModel", { model: s.model })}
        </p>
      </details>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {advice ? null : (
          <button type="button" data-testid="ws-accept" style={canAccept || editing !== null ? primary : { ...btn, opacity: 0.5 }} disabled={!(canAccept || editing !== null)} onClick={accept}>
            {editing !== null ? t("writing.acceptEdit") : t("writing.accept")}
          </button>
        )}
        {advice || editing !== null ? null : (
          <button type="button" data-testid="ws-editBtn" style={btn} onClick={() => setEditing(base ?? s.original)}>
            {t("writing.edit")}
          </button>
        )}
        <button type="button" data-testid="ws-reject" style={btn} onClick={reject}>
          {advice ? t("writing.dismiss") : t("writing.reject")}
        </button>
      </div>
    </li>
  );
}

export function WritingPanel({ host, state, onClose }: { host: WritingHost; state: PanelState; onClose: () => void }) {
  const [list, setList] = useState<readonly WritingSuggestion[]>([]);
  const [status, setStatus] = useState("");
  const [active, setActive] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  /** Audit r4 A2.4: after a keyboard accept or reject the card is gone; focus goes to the card now in its place (or the panel), never to <body>. */
  const refocus = useRef<number | null>(null);
  useEffect(() => host.subscribe(setList), [host]);
  useEffect(() => {
    const at = refocus.current;
    if (at === null) return;
    refocus.current = null;
    const panel = panelRef.current;
    if (!panel || (document.activeElement && document.activeElement !== document.body && panel.contains(document.activeElement))) return;
    const cards = [...(listRef.current?.querySelectorAll<HTMLLIElement>("[data-testid=ws-card]") ?? [])];
    (cards[Math.min(at, cards.length - 1)] ?? panel).focus();
  }, [list]);
  const keepFocus = (el: Element | null) => {
    const cards = [...(listRef.current?.querySelectorAll<HTMLLIElement>("[data-testid=ws-card]") ?? [])];
    const i = cards.findIndex((c) => c === el || c.contains(el));
    refocus.current = i < 0 ? 0 : i;
  };
  const say = useCallback((plan: ChangePlan | null, rejected?: boolean) => {
    if (rejected) return setStatus(t("writing.statusRejected"));
    if (!plan) return;
    const skipped = plan.skipped.length;
    setStatus(skipped ? t("writing.statusAcceptedSkipped", { n: plan.changes.length, skipped }) : t("writing.statusAccepted", { n: plan.changes.length }));
  }, []);
  const acceptable = list.filter((s) => s.replacement !== null && !s.blocked);
  const move = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const cards = [...(listRef.current?.querySelectorAll<HTMLLIElement>("[data-testid=ws-card]") ?? [])];
    if (!cards.length) return;
    e.preventDefault();
    const i = cards.findIndex((c) => c === document.activeElement || c.contains(document.activeElement));
    const next = cards[Math.max(0, Math.min(cards.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
    next.focus();
  };
  const ui = typeof document !== "undefined" ? document.documentElement.dir || "ltr" : "ltr";
  return (
    <aside
      ref={panelRef}
      tabIndex={-1}
      dir={ui}
      data-testid="writing-panel"
      aria-label={t("writing.title")}
      onKeyDown={move}
      style={{ position: "fixed", insetInlineEnd: 12, top: 72, width: 340, maxWidth: "calc(100vw - 24px)", maxHeight: "calc(100vh - 96px)", overflow: "auto", zIndex: 40, background: "hsl(var(--bg))", color: "hsl(var(--fg))", border: "1px solid hsl(var(--border))", borderRadius: 10, boxShadow: "var(--shadow-sm, 0 2px 10px rgb(0 0 0 / 0.12))", padding: 12, display: "flex", flexDirection: "column", gap: 10 }}
    >
      <header style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 14, flex: 1 }}>
          {t("writing.title")} <span style={{ ...muted, fontWeight: 400 }}>· {state.agentLabel}</span>
        </h2>
        <span style={muted} data-testid="ws-count">
          {t("writing.count", { n: list.length })}
        </span>
        <HelpButton topic="editor/writing-agents" size={20} />
        <button type="button" style={btn} onClick={onClose} aria-label={t("writing.close")}>
          ×
        </button>
      </header>
      {state.onLevel || state.onRank ? (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 12 }}>
          {state.onLevel ? (
            <label style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
              {t("writing.level")}
              <select data-testid="ws-level" value={state.level} onChange={(e) => state.onLevel!(e.target.value)} style={{ font: "inherit", fontSize: 12, background: "hsl(var(--bg))", color: "inherit", border: "1px solid hsl(var(--border))", borderRadius: 6 }}>
                {LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {t(`writing.level.${l}`)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {state.onRank ? (
            <label style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
              <input type="checkbox" data-testid="ws-rank" checked={!!state.rank} onChange={(e) => state.onRank!(e.target.checked)} />
              {t("writing.rank")}
            </label>
          ) : null}
        </div>
      ) : null}
      <p role="status" aria-live="polite" data-testid="ws-status" style={{ ...muted, margin: 0, minHeight: 16 }}>
        {state.busy ? t("writing.busy") : status}
      </p>
      {state.error ? (
        <p role="alert" dir="auto" style={{ margin: 0, fontSize: 13, color: "hsl(0 65% 42%)" }}>
          {state.error}
        </p>
      ) : null}
      {list.length > 1 ? (
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" data-testid="ws-acceptAll" style={acceptable.length ? primary : { ...btn, opacity: 0.5 }} disabled={!acceptable.length} onClick={() => {
              keepFocus(null);
              say(host.accept(acceptable.map((s) => ({ id: s.id }))));
            }}>
            {t("writing.acceptAll", { n: acceptable.length })}
          </button>
          <button
            type="button"
            data-testid="ws-rejectAll"
            style={btn}
            onClick={() => {
              keepFocus(null);
              host.reject(list.map((s) => s.id));
              setStatus(t("writing.statusRejected"));
            }}
          >
            {t("writing.rejectAll")}
          </button>
        </div>
      ) : null}
      {!list.length && !state.busy && !state.error ? (
        <p data-testid="ws-empty" style={{ ...muted, margin: 0 }}>
          {t("writing.empty")}
        </p>
      ) : null}
      <ul ref={listRef} aria-label={t("writing.listLabel")} style={{ margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        {list.map((s) => (
          <Card
            key={s.id}
            s={s}
            host={host}
            active={active === s.id}
            onFocusCard={() => {
              setActive(s.id);
              host.focus(s.id);
            }}
            onDone={(plan, rejected) => {
              keepFocus(document.activeElement);
              say(plan, rejected);
            }}
          />
        ))}
      </ul>
      <p style={{ ...muted, margin: 0 }}>{t("writing.keys")}</p>
    </aside>
  );
}

/* ── mounting ───────────────────────────────────────────────────────── */

let root: Root | null = null;
let host: HTMLDivElement | null = null;

/** Opens (or refreshes) the panel for `h`. */
export function openWritingPanel(h: WritingHost, state: PanelState): void {
  if (!host) {
    host = document.createElement("div");
    host.dataset.writingPanelRoot = "";
    document.body.appendChild(host);
    root = createRoot(host);
  }
  root!.render(<WritingPanel host={h} state={state} onClose={() => closeWritingPanel(h)} />);
}

export function closeWritingPanel(h?: WritingHost): void {
  h?.focus(null);
  root?.unmount();
  host?.remove();
  root = null;
  host = null;
}

export function writingPanelOpen(): boolean {
  return !!host;
}
