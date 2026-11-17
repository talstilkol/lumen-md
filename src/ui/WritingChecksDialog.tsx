/**
 * The local writing checks dialog (W13.W11 repetition and clichés, W13.W15
 * loanwords): every finding of the open note with the sentence it is in;
 * "Go to" selects it in the editor, "Ignore" switches the word / phrase /
 * term off for good (the user's lists, ./writingCheckSettings),
 * and a finding with a fix is *proposed*, never applied: it goes to the
 * review panel, where it is accepted or rejected on its own, with its diff,
 * as one undo step. No model and no network: rule engines on this device.
 *
 * Loaded on first use from the command palette.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { EditorView } from "@codemirror/view";
import { t } from "../i18n";
import { showAiToast } from "./AiToast";
import { Modal } from "./Modal";
import type { WritingSuggestion } from "../agents/writing/writingSuggestion";
import { loadWritingChecks, saveWritingChecks, type WritingCheckSettings } from "./writingCheckSettings";
import { stageFinding } from "../agents/writingReview";
import "./writingChecksDialogStrings";
import { explainError } from "../lib/userError";

export type WritingCheckId = "repetition" | "loanwords";

export interface WritingChecksTarget {
  check: WritingCheckId;
  getView: () => EditorView | null;
  getContent: () => string;
  path: string | null;
  lang: "he" | "en";
  /** Runs the check (the dialog passes the current settings). */
  run: (text: string, settings: WritingCheckSettings) => WritingSuggestion[];
}

/** The sentence-ish context of a finding: up to 40 characters each side, on its line. */
function around(text: string, s: WritingSuggestion): { pre: string; hit: string; post: string } {
  const ls = text.lastIndexOf("\n", s.range.from - 1) + 1;
  const le = text.indexOf("\n", s.range.to);
  const start = Math.max(ls, s.range.from - 40);
  const end = Math.min(le < 0 ? text.length : le, s.range.to + 40);
  return { pre: (start > ls ? "…" : "") + text.slice(start, s.range.from), hit: text.slice(s.range.from, s.range.to), post: text.slice(s.range.to, end) + (end < (le < 0 ? text.length : le) ? "…" : "") };
}

/** What "Ignore" switches off for a finding. */
function ignore(s: WritingSuggestion, set: WritingCheckSettings): WritingCheckSettings {
  const d = s.data ?? {};
  if (s.kind === "repetition" && typeof d.lemma === "string") return { ...set, ignoredLemmas: [...new Set([...set.ignoredLemmas, d.lemma])] };
  if (s.kind === "cliche" && typeof d.phrase === "string") return { ...set, disabledCliches: [...new Set([...set.disabledCliches, d.phrase])] };
  if (s.kind === "loanword" && typeof d.term === "string") return { ...set, disabledTerms: [...new Set([...set.disabledTerms, d.term])] };
  return set;
}

export function WritingChecksDialogImpl({ target, onClose }: { target: WritingChecksTarget; onClose: () => void }) {
  const [settings, setSettings] = useState<WritingCheckSettings>(() => loadWritingChecks());
  const [text, setText] = useState(() => target.getContent());
  const [kind, setKind] = useState<string>("all");
  const [staged, setStaged] = useState<Set<string>>(new Set());
  const ref = useRef<HTMLDivElement | null>(null);
  const found = useMemo(() => target.run(text, settings), [text, settings, target]);
  const kinds = useMemo(() => [...new Set(found.map((s) => s.kind))], [found]);
  const shown = kind === "all" ? found : found.filter((s) => s.kind === kind);
  const fixable = shown.filter((s) => s.replacement != null && !staged.has(`${s.range.from}:${s.kind}`));
  const title = t(`wchk.${target.check}.title`);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("select, button")?.focus();
  }, []);

  const update = (next: WritingCheckSettings) => {
    setSettings(next);
    saveWritingChecks(next);
  };

  const goTo = (s: WritingSuggestion) => {
    const view = target.getView();
    if (!view || view.state.doc.toString() !== text) {
      showAiToast(t("wchk.changed"), "info");
      return;
    }
    view.dispatch({ selection: { anchor: s.range.from, head: s.range.to }, scrollIntoView: true });
    onClose();
    view.focus();
  };

  const propose = (list: WritingSuggestion[]) => {
    const current = target.getContent();
    if (current !== text) {
      setText(current);
      showAiToast(t("wchk.changed"), "info");
      return;
    }
    let n = 0;
    const done = new Set(staged);
    for (const s of list) {
      try {
        // The one review path: the finding is made a W1 suggestion, then staged (agents/writingReview).
        if (!stageFinding(s, text, target.path, { tool: `writing.${target.check}` })) continue;
        done.add(`${s.range.from}:${s.kind}`);
        n++;
      } catch (e) {
        showAiToast(explainError(e, "writing-checks"), "error");
        break;
      }
    }
    setStaged(done);
    if (n) {
      showAiToast(t("wchk.proposed", { count: n }), "success");
      window.dispatchEvent(new Event("lumen-open-agent-review"));
    }
  };

  return (
    <Modal
      onClose={onClose}
      aria-labelledby="wchk-title"
      data-testid="writing-checks-dialog"
      style={{ position: "fixed", inset: 0, background: "var(--overlay)", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "6vh", zIndex: 9999 }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        dir={target.lang === "he" ? "rtl" : "ltr"}
        style={{ background: "hsl(var(--bg))", color: "hsl(var(--fg))", border: "1px solid hsl(var(--border-strong))", borderRadius: 12, width: "min(680px, calc(100vw - 32px))", maxHeight: "84vh", overflow: "auto", padding: 18, display: "flex", flexDirection: "column", gap: 10 }}
      >
        <h2 id="wchk-title" style={{ margin: 0, fontSize: 16 }}>
          {title}
        </h2>
        <p style={{ margin: 0, fontSize: 12, opacity: 0.8 }}>{t("wchk.local")}</p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", fontSize: 13 }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {t("wchk.show")}
            <select value={kind} onChange={(e) => setKind(e.target.value)} data-testid="wchk-kind">
              <option value="all">{t("wchk.kind.all", { count: found.length })}</option>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {t(`wchk.kind.${k}`, { count: found.filter((s) => s.kind === k).length })}
                </option>
              ))}
            </select>
          </label>
          {target.check === "repetition" && (
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {t("wchk.window")}
              <input type="number" min={5} max={500} step={5} value={settings.windowWords} style={{ width: 70 }} onChange={(e) => update({ ...settings, windowWords: Math.min(500, Math.max(5, Number(e.target.value) || 50)) })} />
            </label>
          )}
          {target.check === "loanwords" && (
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {t("wchk.register")}
              <select value={settings.register} onChange={(e) => update({ ...settings, register: e.target.value === "academic" ? "academic" : "everyday" })} data-testid="wchk-register">
                <option value="everyday">{t("wchk.register.everyday")}</option>
                <option value="academic">{t("wchk.register.academic")}</option>
              </select>
            </label>
          )}
        </div>
        {/* empty-allow: the result count of a check ("no findings"); the check picker above is the next step */}
        <div role="status" style={{ fontSize: 13, fontWeight: 600 }} data-testid="wchk-count">
          {shown.length ? t("wchk.count", { count: shown.length }) : target.check === "loanwords" && settings.register === "everyday" ? t("wchk.loanwords.everyday") : t("wchk.none")}
        </div>
        {shown.length > 0 && (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }} data-testid="wchk-list">
            {shown.slice(0, 300).map((s) => {
              const c = around(text, s);
              const key = `${s.range.from}:${s.kind}`;
              return (
                <li key={key} style={{ border: "1px solid hsl(var(--border))", borderRadius: 8, padding: "8px 10px", display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }} dir="auto">
                    {s.message}
                  </div>
                  <div style={{ fontSize: 13 }} dir="auto">
                    {c.pre}
                    <mark style={{ background: "hsl(var(--accent) / 0.25)", color: "inherit", borderRadius: 3 }}>{c.hit}</mark>
                    {c.post}
                  </div>
                  {s.replacement != null && (
                    <div style={{ fontSize: 12 }} dir="auto">
                      <span style={{ textDecoration: "line-through", opacity: 0.7 }}>{c.hit}</span> → <strong>{s.replacement || t("wchk.cut")}</strong>
                    </div>
                  )}
                  <div style={{ fontSize: 12, opacity: 0.8 }} dir="auto">
                    {s.rationale}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button type="button" onClick={() => goTo(s)}>
                      {t("wchk.goto")}
                    </button>
                    {s.replacement != null && (
                      <button type="button" disabled={staged.has(key)} onClick={() => propose([s])}>
                        {staged.has(key) ? t("wchk.proposedOne") : t("wchk.propose")}
                      </button>
                    )}
                    <button type="button" onClick={() => update(ignore(s, settings))} aria-label={t("wchk.ignoreLabel", { what: c.hit })}>
                      {t("wchk.ignore")}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
          {(settings.ignoredLemmas.length + settings.disabledCliches.length + settings.disabledTerms.length > 0) && (
            <button type="button" onClick={() => update({ ...settings, ignoredLemmas: [], disabledCliches: [], disabledTerms: [] })}>
              {t("wchk.resetIgnored")}
            </button>
          )}
          <button type="button" onClick={onClose}>
            {t("wchk.close")}
          </button>
          <button type="button" disabled={!fixable.length} onClick={() => propose(fixable)} data-testid="wchk-propose-all">
            {t("wchk.proposeAll", { count: fixable.length })}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function openWritingChecksDialog(target: WritingChecksTarget): void {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const close = () => {
    try {
      root.unmount();
    } catch {
      // why: the dialog root is already unmounted
    }
    host.remove();
  };
  root.render(<WritingChecksDialogImpl target={target} onClose={close} />);
}
