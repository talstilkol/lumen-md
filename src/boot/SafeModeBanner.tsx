/**
 * Safe mode's banner (plan W13.T5). Shown only in safe mode, in its own lazy
 * chunk. It says why the app is in safe mode and what is off, and offers:
 *
 *   - diagnostics (W3.7): save the bundle, report the problem;
 *   - "Leave safe mode…": pick what comes back (each enabled CSS snippet,
 *     AI agents) and leave without a restart, as Obsidian 1.13 does; what
 *     is left unticked stays off, so the culprit can be kept out;
 *   - hide: the banner folds into a small "Safe mode" button.
 *
 * Keyboard: every control is a real button or checkbox; focus goes to the
 * banner's heading when it opens, into the list when "Leave…" opens, and
 * back to the editor (or the page's main region) when safe mode ends.
 */
import { useId, useRef, useState, useSyncExternalStore, useEffect, type RefObject } from "react";
import { t } from "../i18n";
import "./safeModeStrings";
import { bootDecision, exitSafeMode, isSafeMode, onSafeModeChange } from "./bootSentinel";
import { useAppStore } from "../store/useStore";

function focusEditor(): void {
  // why: in priority order — a selector list would return whichever comes first in the document (#root)
  const el = [".cm-content", ".ProseMirror", "[data-editor-root] [contenteditable]", "main", "#root"].map((q) => document.querySelector<HTMLElement>(q)).find(Boolean);
  if (!el) return;
  if (!el.hasAttribute("tabindex") && !el.isContentEditable) el.setAttribute("tabindex", "-1");
  el.focus();
}

export function SafeModeBanner() {
  const on = useSyncExternalStore(onSafeModeChange, isSafeMode, isSafeMode);
  const decision = bootDecision();
  const snippets = useAppStore((s) => s.enabledSnippets);
  const [hidden, setHidden] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [keep, setKeep] = useState<Set<string>>(() => new Set(snippets));
  const [agents, setAgents] = useState(true);
  const headRef = useRef<HTMLHeadingElement>(null);
  const firstRef = useRef<HTMLInputElement | HTMLButtonElement>(null);
  const pillRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (on && !hidden && !choosing) headRef.current?.focus({ preventScroll: true });
  }, [on, hidden, choosing]);
  useEffect(() => {
    if (choosing) firstRef.current?.focus();
  }, [choosing]);

  if (!on) return null;

  if (hidden) {
    return (
      <div className="vault-folder-banner" data-testid="safe-mode-pill" style={{ insetBlockStart: "auto", insetBlockEnd: 12 }}>
        <button
          ref={pillRef}
          type="button"
          className="vault-folder-btn secondary"
          aria-label={t("safeMode.show")}
          onClick={() => {
            setHidden(false);
          }}
        >
          {t("safeMode.badge")}
        </button>
      </div>
    );
  }

  const reason = decision?.reason === "manual" ? t("safeMode.reasonManual") : t("safeMode.reasonCrash", { count: Math.max(1, decision?.failures ?? 1) });

  const leave = () => {
    const store = useAppStore.getState();
    for (const name of snippets) if (!keep.has(name)) store.setSnippetEnabled(name, false);
    exitSafeMode({ agents });
    // why: after the banner unmounts, focus must land in the editor, never on <body>
    requestAnimationFrame(focusEditor);
  };

  return (
    <section className="vault-folder-banner" aria-labelledby={titleId} data-testid="safe-mode-banner" data-safe-mode={decision?.reason ?? "manual"} style={{ maxInlineSize: "min(640px, calc(100vw - 24px))", flexDirection: "column", alignItems: "stretch" }}>
      <h2 id={titleId} ref={headRef} tabIndex={-1} style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
        {t("safeMode.title")}
      </h2>
      <p style={{ margin: 0 }} role="status">
        {reason} {t("safeMode.whatIsOff")}
      </p>
      {decision?.rollbackTo && typeof window !== "undefined" && "__TAURI_INTERNALS__" in window && <p style={{ margin: 0 }}>{t("safeMode.rollbackHint", { version: decision.rollbackTo })}</p>}
      {choosing ? (
        <fieldset style={{ border: 0, margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          <legend style={{ fontWeight: 600, paddingBlockEnd: 4 }}>{t("safeMode.chooseLegend")}</legend>
          {snippets.map((name, i) => (
            <label key={name} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                ref={i === 0 ? (firstRef as RefObject<HTMLInputElement>) : undefined}
                type="checkbox"
                checked={keep.has(name)}
                onChange={(e) => setKeep((cur) => {
                  const next = new Set(cur);
                  if (e.target.checked) next.add(name);
                  else next.delete(name);
                  return next;
                })}
              />
              <span>{t("safeMode.snippet", { name: `\u2068${name}\u2069` })}</span>
            </label>
          ))}
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input ref={snippets.length ? undefined : (firstRef as RefObject<HTMLInputElement>)} type="checkbox" checked={agents} onChange={(e) => setAgents(e.target.checked)} />
            <span>{t("safeMode.agents")}</span>
          </label>
          <p style={{ margin: 0, fontSize: 12, opacity: 0.8 }}>{t("safeMode.pluginsNote")}</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="vault-folder-btn" onClick={leave} data-testid="safe-mode-leave">
              {t("safeMode.leaveNow")}
            </button>
            <button type="button" className="vault-folder-btn secondary" onClick={() => setChoosing(false)}>
              {t("safeMode.back")}
            </button>
          </div>
        </fieldset>
      ) : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button ref={firstRef as RefObject<HTMLButtonElement>} type="button" className="vault-folder-btn" onClick={() => setChoosing(true)} data-testid="safe-mode-choose">
            {t("safeMode.leave")}
          </button>
          <button type="button" className="vault-folder-btn secondary" onClick={() => void import("../ui/diagnosticsActions").then((m) => m.saveDiagnostics())}>
            {t("errorScreen.diagnostics")}
          </button>
          <button type="button" className="vault-folder-btn secondary" onClick={() => void import("../ui/FeedbackDialog").then((m) => m.openFeedback({ kind: "bug" }))}>
            {t("errorScreen.report")}
          </button>
          <button
            type="button"
            className="vault-folder-btn secondary"
            onClick={() => {
              setHidden(true);
              requestAnimationFrame(() => pillRef.current?.focus());
            }}
          >
            {t("safeMode.hide")}
          </button>
        </div>
      )}
    </section>
  );
}
