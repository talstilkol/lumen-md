/**
 * "Explain my change" (W13.W13): the summary of what changed between an
 * older version of the note and now, the meaning changes found by rule
 * (numbers, negation, names) and the changes themselves, before → after.
 * Read-only: nothing is written to the note. Loaded on first use.
 */
import { createRoot } from "react-dom/client";
import { t } from "../i18n";
import { Modal } from "./Modal";
import type { ChangeExplanation, MeaningKind } from "../agents/writing/explainChange";
import "./explainChangeDialogStrings";
import { HelpButton } from "./HelpButton";

const KIND_COLOR: Record<MeaningKind, string> = { number: "217 91% 45%", negation: "0 72% 45%", entity: "262 60% 50%" };

export function ExplainChangeView({ r, versionLabel, lang }: { r: ChangeExplanation; versionLabel: string; lang: "he" | "en" }) {
  return (
    <div dir={lang === "he" ? "rtl" : "ltr"} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <p style={{ margin: 0, fontSize: 12, opacity: 0.8 }}>
        {t("xchg.against", { version: versionLabel })} · {t("xchg.stats", { added: r.stats.added, removed: r.stats.removed })} · {t(r.engine === "model" ? "xchg.engine.model" : "xchg.engine.rules")}
      </p>
      {!r.hunks.length ? (
        <div role="status" data-testid="xchg-none">
          {/* empty-allow: the result of a comparison ("nothing changed"), not an empty panel */}
          {t("xchg.none")}
        </div>
      ) : (
        <>
          <section aria-labelledby="xchg-sum">
            <h3 id="xchg-sum" style={{ margin: "0 0 4px", fontSize: 14 }}>
              {t("xchg.summary")}
            </h3>
            <ul data-testid="xchg-summary" style={{ margin: 0, paddingInlineStart: 18, fontSize: 14, lineHeight: 1.6 }}>
              {r.summary.map((l, i) => (
                <li key={i} dir="auto">
                  {l}
                </li>
              ))}
            </ul>
            {r.dropped.length > 0 && <p style={{ margin: "4px 0 0", fontSize: 12, opacity: 0.75 }}>{t("xchg.dropped", { count: r.dropped.length })}</p>}
          </section>
          <section aria-labelledby="xchg-mean">
            <h3 id="xchg-mean" style={{ margin: "0 0 4px", fontSize: 14 }}>
              {t("xchg.meaning")}
            </h3>
            {r.meaning.length ? (
              <ul data-testid="xchg-meaning" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
                {r.meaning.map((m, i) => (
                  <li key={i} dir="auto">
                    <span style={{ display: "inline-block", minWidth: 64, padding: "0 6px", marginInlineEnd: 6, borderRadius: 4, color: "white", background: `hsl(${KIND_COLOR[m.kind]})`, fontSize: 12, textAlign: "center" }}>{t(`xchg.kind.${m.kind}`)}</span>
                    {m.before ? <del>{m.before}</del> : <em>{t("xchg.absentBefore")}</em>} → {m.after ? <ins>{m.after}</ins> : <em>{t("xchg.absentAfter")}</em>}
                    <span style={{ opacity: 0.7 }}> — {r.hunks[m.hunk]?.context}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p style={{ margin: 0, fontSize: 13 }}>{t("xchg.meaningNone")}</p>
            )}
          </section>
          <details>
            <summary style={{ cursor: "pointer", fontSize: 13 }}>{t("xchg.changes", { count: r.hunks.length })}</summary>
            <ol style={{ margin: "6px 0 0", paddingInlineStart: 18, fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
              {r.hunks.slice(0, 200).map((h, i) => (
                <li key={i}>
                  {h.old.text.trim() && (
                    <bdi>
                      <del style={{ background: "hsl(0 80% 50% / 0.12)" }}>{h.old.text}</del>
                    </bdi>
                  )}{" "}
                  → {h.new.text.trim() && (
                    <bdi>
                      <ins style={{ background: "hsl(140 60% 40% / 0.15)" }}>{h.new.text}</ins>
                    </bdi>
                  )}
                </li>
              ))}
            </ol>
          </details>
        </>
      )}
    </div>
  );
}

export function openExplainChangeDialog(r: ChangeExplanation, versionLabel: string, lang: "he" | "en"): void {
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
  root.render(
    <Modal
      onClose={close}
      aria-labelledby="xchg-title"
      data-testid="explain-change-dialog"
      style={{ position: "fixed", inset: 0, background: "var(--overlay)", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "6vh", zIndex: 9999 }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div style={{ background: "hsl(var(--bg))", color: "hsl(var(--fg))", border: "1px solid hsl(var(--border-strong))", borderRadius: 12, width: "min(680px, calc(100vw - 32px))", maxHeight: "84vh", overflow: "auto", padding: 18, display: "flex", flexDirection: "column", gap: 10 }} dir={lang === "he" ? "rtl" : "ltr"}>
        <span style={{ float: "inline-end", marginInlineStart: 8 }}><HelpButton topic="workspace/history" /></span>
        <h2 id="xchg-title" style={{ margin: 0, fontSize: 16 }}>
          {t("xchg.title")}
        </h2>
        <ExplainChangeView r={r} versionLabel={versionLabel} lang={lang} />
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button type="button" onClick={close} autoFocus>
            {t("xchg.close")}
          </button>
        </div>
      </div>
    </Modal>,
  );
}
