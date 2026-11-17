/**
 * Titles, abstract and TL;DR (W13.W12): the three title options, the TL;DR
 * and the abstract, every sentence with the paragraph it rests on (¶n —
 * "Go to" selects that paragraph), and how many sentences the gate deleted.
 * "Use this title" and "Insert the abstract" only propose: each goes to the
 * review panel as one change. Loaded on first use.
 */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { EditorView } from "@codemirror/view";
import { t } from "../i18n";
import { Modal } from "./Modal";
import { showAiToast } from "./AiToast";
import { abstractMarkdown, type AbstractResult, type AnchoredSentence } from "../agents/writing/abstractWriter";
import { noteParagraphs } from "../ai/paragraphAnchors";
import { makeSuggestion } from "../agents/writing/suggestion";
import { stageSuggestion } from "../agents/writingReview";
import "./abstractDialogStrings";
import { explainError } from "../lib/userError";
import { EmptyState, learnHow } from "./EmptyState";

export interface AbstractTarget {
  getView: () => EditorView | null;
  getContent: () => string;
  path: string | null;
  lang: "he" | "en";
}

/** Where the abstract goes: after the frontmatter and the first heading. */
export function insertionPoint(text: string): number {
  const at = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(text)?.[0].length ?? 0;
  const h1 = /^\s*#\s[^\n]*(?:\n|$)/.exec(text.slice(at));
  return h1 ? at + h1[0].length : at;
}

/** The one review path (agents/writingReview): a W1 suggestion for the range, staged; nothing is written here. */
function stage(target: AbstractTarget, from: number, to: number, after: string, summary: string, engine: AbstractResult["engine"]): boolean {
  const text = target.getContent();
  try {
    const s = makeSuggestion(text, { range: { from, to }, kind: "structure", message: summary, rationale: summary, confidence: 1, replacement: after, agentId: "abstractWriter", model: engine === "model" ? "abstractWriter" : "rules", ruleId: "abstract" });
    if (!stageSuggestion(s, text, target.path, { tool: "writing.abstract" })) return false;
    window.dispatchEvent(new Event("lumen-open-agent-review"));
    return true;
  } catch (e) {
    showAiToast(explainError(e, "abstract"), "error");
    return false;
  }
}

export function AbstractView({ r, target, onClose }: { r: AbstractResult; target: AbstractTarget; onClose: () => void }) {
  const [done, setDone] = useState<Set<string>>(new Set());
  const goTo = (s: AnchoredSentence) => {
    const view = target.getView();
    const p = noteParagraphs(target.getContent()).find((x) => x.anchor === s.anchor);
    if (!view || !p) return;
    view.dispatch({ selection: { anchor: p.start, head: p.end }, scrollIntoView: true });
    onClose();
    view.focus();
  };
  const sentence = (s: AnchoredSentence, i: number) => (
    <span key={i} dir="auto">
      {s.text}{" "}
      <button type="button" onClick={() => goTo(s)} title={s.quote} aria-label={t("abs.goto", { n: s.paragraph })} style={{ fontSize: 11, padding: "0 4px", border: "1px solid hsl(var(--border))", borderRadius: 4, background: "transparent", color: "inherit", cursor: "pointer" }}>
        ¶{s.paragraph}
      </button>{" "}
    </span>
  );
  const useTitle = (title: string) => {
    const text = target.getContent();
    const fm = /^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n/.exec(text)?.[0].length ?? 0;
    const h1 = /^#\s[^\n]*/m.exec(text.slice(fm));
    const ok = h1 && text.slice(fm, fm + h1.index).trim() === "" ? stage(target, fm + h1.index, fm + h1.index + h1[0].length, `# ${title}`, t("abs.titleSummary", { title }), r.engine) : stage(target, fm, fm, `# ${title}\n\n`, t("abs.titleSummary", { title }), r.engine);
    if (ok) setDone(new Set([...done, `t:${title}`]));
  };
  const insert = () => {
    const text = target.getContent();
    const at = insertionPoint(text);
    if (stage(target, at, at, `${at && text[at - 1] !== "\n" ? "\n" : ""}\n${abstractMarkdown(r, target.lang)}\n\n`, t("abs.insertSummary"), r.engine)) setDone(new Set([...done, "abstract"]));
  };
  const part = (k: "background" | "method" | "findings") =>
    r.parts && r.parts[k].length > 0 && (
      <p style={{ margin: "0 0 6px" }} key={k}>
        <strong>{t(`abs.part.${k}`)}.</strong> {r.parts[k].map(sentence)}
      </p>
    );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <p style={{ margin: 0, fontSize: 12, opacity: 0.8 }}>
        {t(r.engine === "model" ? "abs.engine.model" : "abs.engine.extractive")} · {t("abs.words", { n: r.words })}
        {!r.lengthOk && ` · ${t("abs.lengthOff")}`}
      </p>
      {r.titles.length > 0 && (
        <section aria-labelledby="abs-titles">
          <h3 id="abs-titles" style={{ margin: "0 0 4px", fontSize: 14 }}>{t("abs.titles")}</h3>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }} data-testid="abs-titles">
            {r.titles.map((tt) => (
              <li key={tt} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span dir="auto" style={{ flex: 1 }}>{tt}</span>
                <button type="button" disabled={done.has(`t:${tt}`)} onClick={() => useTitle(tt)}>{done.has(`t:${tt}`) ? t("abs.proposed") : t("abs.useTitle")}</button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {r.tldr && (
        <section aria-labelledby="abs-tldr">
          <h3 id="abs-tldr" style={{ margin: "0 0 4px", fontSize: 14 }}>{t("abs.tldr")}</h3>
          <p style={{ margin: 0 }} data-testid="abs-tldr">{sentence(r.tldr, 0)}</p>
        </section>
      )}
      <section aria-labelledby="abs-abstract">
        <h3 id="abs-abstract" style={{ margin: "0 0 4px", fontSize: 14 }}>{t("abs.abstract")}</h3>
        <div data-testid="abs-abstract" style={{ lineHeight: 1.7 }}>
          {r.parts ? (["background", "method", "findings"] as const).map(part) : r.abstract.length ? <p style={{ margin: 0 }}>{r.abstract.map(sentence)}</p> : <EmptyState style={{ padding: 0 }} message={t("abs.empty")} action={learnHow("editor/writing-agents")} />}
        </div>
      </section>
      <p role="status" style={{ margin: 0, fontSize: 12 }} data-testid="abs-deleted">
        {t("abs.deleted", { count: r.deleted.length })}
      </p>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" onClick={onClose}>{t("abs.close")}</button>
        <button type="button" disabled={!r.abstract.length || done.has("abstract")} onClick={insert} data-testid="abs-insert">
          {done.has("abstract") ? t("abs.proposed") : t("abs.insert")}
        </button>
      </div>
    </div>
  );
}

export function openAbstractDialog(r: AbstractResult, target: AbstractTarget): void {
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
    <Modal onClose={close} aria-labelledby="abs-title" data-testid="abstract-dialog" style={{ position: "fixed", inset: 0, background: "var(--overlay)", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "6vh", zIndex: 9999 }} onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div dir={target.lang === "he" ? "rtl" : "ltr"} style={{ background: "hsl(var(--bg))", color: "hsl(var(--fg))", border: "1px solid hsl(var(--border-strong))", borderRadius: 12, width: "min(700px, calc(100vw - 32px))", maxHeight: "84vh", overflow: "auto", padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 id="abs-title" style={{ margin: 0, fontSize: 16 }}>{t("abs.title")}</h2>
        <AbstractView r={r} target={target} onClose={close} />
      </div>
    </Modal>,
  );
}
