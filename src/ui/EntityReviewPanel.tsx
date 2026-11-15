/**
 * "Graph proposals" (plan W12.E5): the entity graph's review queue, shown
 * above the agent review panel's list. Each proposal shows its paragraph
 * with the quote marked; approve or reject one or a selection; merge two
 * entities; split aliases and relations off into a new entity. Every
 * action is undone in one step (Undo restores the touched files byte for
 * byte). Nothing reaches a note until the user acts here.
 *
 * Keyboard: the list is a listbox — ↑/↓ move, Space selects, A approves,
 * R rejects, Ctrl/⌘+Z undoes. Hebrew text is laid out with dir="auto".
 */
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { t } from "../i18n";
import { entityId } from "../entities/model";
import { splitParagraphs } from "../entities/paragraphs";
import type { Proposal } from "../entities/store";
import { approve, edgesOf, entitiesOf, merge, proposalsOf, reject, split, undoOp, type Files, type OpResult, type Undo } from "../entities/review";
import "./entityGraphStrings";
import { explainError } from "../lib/userError";
import { EmptyState, learnHow } from "./EmptyState";

export interface EntityReviewPanelProps {
  files: Files;
  /** Writes an operation's files (the vault writer); resolves when written. */
  onApply: (result: OpResult) => void | Promise<void>;
  /** "rules-only" when no local NER model is on the device; "no-relations" when no local engine runs relation extraction. */
  notices?: ReadonlyArray<"rules-only" | "no-relations">;
}

const box: React.CSSProperties = { border: "1px solid hsl(var(--border))", borderRadius: 6, padding: 8 };
const btn: React.CSSProperties = { padding: "4px 10px", fontSize: 12, borderRadius: 6, border: "1px solid hsl(var(--border))", background: "transparent", color: "inherit", cursor: "pointer" };

function Quote({ text, quote }: { text: string; quote: string }) {
  const at = quote ? text.indexOf(quote) : -1;
  if (at < 0) return <span dir="auto">{text}</span>;
  return (
    <span dir="auto">
      {text.slice(0, at)}
      <mark>{quote}</mark>
      {text.slice(at + quote.length)}
    </span>
  );
}

function label(p: Proposal, names: Map<string, string>): string {
  if (p.kind === "entity") return `${p.name} · ${t(`entityGraph.type.${p.type}`)}${p.matches ? ` → ${names.get(p.matches) ?? p.matches}` : ""}`;
    return `${names.get(p.edge.subject) ?? p.edge.subject} — ${t(`entityGraph.predicate.${p.edge.predicate}`)} — ${names.get(p.edge.object) ?? p.edge.object}`;
}

export function EntityReviewPanel({ files, onApply, notices = [] }: EntityReviewPanelProps) {
  const proposals = useMemo(() => proposalsOf(files), [files]);
  const entities = useMemo(() => entitiesOf(files), [files]);
  const edges = useMemo(() => edgesOf(files), [files]);
  const names = useMemo(() => new Map([...entities.map((e) => [e.id, e.name] as const), ...proposals.flatMap((p) => (p.kind === "entity" ? [[entityId(p.type, p.name), p.name] as const] : []))]), [entities, proposals]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focus, setFocus] = useState(0);
  const [history, setHistory] = useState<Undo[]>([]);
  const [status, setStatus] = useState("");
  const [keep, setKeep] = useState("");
  const [gone, setGone] = useState("");
  const [splitFrom, setSplitFrom] = useState("");
  const [splitName, setSplitName] = useState("");
  const [splitPick, setSplitPick] = useState<Set<string>>(new Set());
  const list = useRef<HTMLUListElement>(null);

  const run = async (op: () => OpResult, done: string) => {
    try {
      const r = op();
      await onApply(r);
      setHistory((h) => [...h, r.undo]);
      setSelected(new Set());
      setStatus(done);
    } catch (e) {
      setStatus(explainError(e));
    }
  };
  const targets = () => (selected.size ? [...selected] : proposals[focus] ? [proposals[focus].id] : []);
  const doApprove = () => void run(() => approve(files, targets()), t("entityGraph.review.approved"));
  const doReject = () => void run(() => reject(files, targets()), t("entityGraph.review.rejected"));
  const doUndo = async () => {
    const last = history[history.length - 1];
    if (!last) return;
    try {
      await onApply(undoOp(files, last));
      setHistory((h) => h.slice(0, -1));
      setStatus(t("entityGraph.review.undone"));
    } catch (e) {
      setStatus(explainError(e));
    }
  };

  const onKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const n = proposals.length;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setFocus((f) => (n ? (f + (e.key === "ArrowDown" ? 1 : n - 1)) % n : 0));
    } else if (e.key === " ") {
      e.preventDefault();
      const id = proposals[focus]?.id;
      if (id) setSelected((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])));
    } else if (e.key === "a" || e.key === "A") doApprove();
    else if (e.key === "r" || e.key === "R") doReject();
  };

  const fromEntity = entities.find((x) => x.id === splitFrom);
  return (
    <section
      aria-labelledby="entity-review-title"
      style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}
      data-testid="entity-review"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
          e.preventDefault();
          void doUndo();
        }
      }}
    >
      <h2 id="entity-review-title" style={{ fontSize: 14, margin: 0 }}>
        {t("entityGraph.review.title")} ({proposals.length})
      </h2>
      {notices.map((n) => (
        <p key={n} role="note" style={{ margin: 0, color: "hsl(var(--fg-muted))" }}>
          {t(`entityGraph.notice.${n}`)}
        </p>
      ))}
      <div role="toolbar" aria-label={t("entityGraph.review.actions")} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button type="button" style={btn} onClick={doApprove} disabled={!proposals.length}>
          {selected.size ? t("entityGraph.review.approveSelected", { n: String(selected.size) }) : t("entityGraph.review.approve")}
        </button>
        <button type="button" style={btn} onClick={doReject} disabled={!proposals.length}>
          {selected.size ? t("entityGraph.review.rejectSelected", { n: String(selected.size) }) : t("entityGraph.review.reject")}
        </button>
        <button type="button" style={btn} onClick={() => void doUndo()} disabled={!history.length}>
          {t("entityGraph.review.undo")}
        </button>
      </div>
      <p role="status" aria-live="polite" style={{ margin: 0, minBlockSize: "1em" }}>
        {status}
      </p>
      {proposals.length === 0 ? (
        <EmptyState style={{ padding: 0 }} message={t("entityGraph.review.empty")} action={learnHow("workspace/entity-graph")} />
      ) : (
        <ul ref={list} role="listbox" aria-multiselectable="true" aria-label={t("entityGraph.review.list")} aria-activedescendant={proposals[focus] ? `ep-${focus}` : undefined} tabIndex={0} onKeyDown={onKey} style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {proposals.map((p, i) => {
            const quote = p.kind === "edge" ? p.edge.provenance.quote : "";
            const pv = p.kind === "edge" ? p.edge.provenance : null;
            const paragraph = pv ? (splitParagraphs(files.get(pv.note) ?? "").find((x) => x.anchor === pv.anchor || x.hash === pv.paragraphHash)?.text ?? quote) : p.kind === "entity" ? (p.mentions[0]?.text ?? "") : "";
            return (
              <li key={p.id} id={`ep-${i}`} role="option" aria-selected={selected.has(p.id)} data-focused={i === focus || undefined} onClick={() => setFocus(i)} style={{ ...box, outline: i === focus ? "2px solid hsl(var(--accent))" : undefined }}>
                {/* The option's aria-selected carries the selection (Space toggles it); the box is only its mouse target, so no control nests inside the option (axe nested-interactive). */}
                <div style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
                  <span aria-hidden="true" title={t("entityGraph.review.select")} data-testid="entity-review-select" onClick={(e) => (e.stopPropagation(), setFocus(i), setSelected((s) => (s.has(p.id) ? new Set([...s].filter((x) => x !== p.id)) : new Set([...s, p.id]))))} style={{ cursor: "pointer", userSelect: "none" }}>
                    {selected.has(p.id) ? "☑" : "☐"}
                  </span>
                  <strong dir="auto">{label(p, names)}</strong>
                </div>
                <div style={{ marginBlockStart: 4 }}>
                  <Quote text={paragraph} quote={quote} />
                </div>
                <small style={{ color: "hsl(var(--fg-muted))" }} dir="auto">
                  {p.kind === "edge" ? `${p.edge.provenance.note}#^${p.edge.provenance.anchor} · ${p.edge.provenance.model ?? p.edge.provenance.extractor}` : `${p.mentions.length} · ${p.extractor}`}
                </small>
              </li>
            );
          })}
        </ul>
      )}
      <fieldset style={box}>
        <legend>{t("entityGraph.merge.title")}</legend>
        <label>
          {t("entityGraph.merge.keep")}{" "}
          <select value={keep} onChange={(e) => setKeep(e.target.value)}>
            <option value="">—</option>
            {entities.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} ({t(`entityGraph.type.${e.type}`)})
              </option>
            ))}
          </select>
        </label>{" "}
        <label>
          {t("entityGraph.merge.into")}{" "}
          <select value={gone} onChange={(e) => setGone(e.target.value)}>
            <option value="">—</option>
            {entities.filter((e) => e.id !== keep).map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} ({t(`entityGraph.type.${e.type}`)})
              </option>
            ))}
          </select>
        </label>{" "}
        <button type="button" style={btn} disabled={!keep || !gone} onClick={() => void run(() => merge(files, keep, gone), t("entityGraph.merge.done"))}>
          {t("entityGraph.merge.action")}
        </button>
      </fieldset>
      <fieldset style={box}>
        <legend>{t("entityGraph.split.title")}</legend>
        <label>
          {t("entityGraph.split.from")}{" "}
          <select value={splitFrom} onChange={(e) => (setSplitFrom(e.target.value), setSplitPick(new Set()))}>
            <option value="">—</option>
            {entities.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        {fromEntity && (
          <div role="group" aria-label={t("entityGraph.split.pick")} style={{ display: "flex", flexDirection: "column", gap: 2, marginBlock: 6 }}>
            {[...fromEntity.aliases.map((a) => ({ k: `alias:${a}`, l: a })), ...edges.filter((x) => x.subject === fromEntity.id || x.object === fromEntity.id).map((x) => ({ k: `edge:${x.id}`, l: `${t(`entityGraph.predicate.${x.predicate}`)}: “${x.provenance.quote}”` }))].map(({ k, l }) => (
              <label key={k} dir="auto">
                <input type="checkbox" checked={splitPick.has(k)} onChange={() => setSplitPick((s) => (s.has(k) ? new Set([...s].filter((x) => x !== k)) : new Set([...s, k])))} /> {l}
              </label>
            ))}
          </div>
        )}
        <label>
          {t("entityGraph.split.name")} <input dir="auto" value={splitName} onChange={(e) => setSplitName(e.target.value)} />
        </label>{" "}
        <button
          type="button"
          style={btn}
          disabled={!fromEntity || !splitName.trim() || !splitPick.size}
          onClick={() =>
            void run(
              () =>
                split(files, splitFrom, splitName.trim(), {
                  aliases: [...splitPick].filter((k) => k.startsWith("alias:")).map((k) => k.slice(6)),
                  edges: [...splitPick].filter((k) => k.startsWith("edge:")).map((k) => k.slice(5)),
                }),
              t("entityGraph.split.done"),
            )
          }
        >
          {t("entityGraph.split.action")}
        </button>
      </fieldset>
    </section>
  );
}
