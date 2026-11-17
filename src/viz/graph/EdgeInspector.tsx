/**
 * The claim card and "why is this edge here" (plan R12.8) for the edges of
 * a band or a table row: two separate Admiralty badges (A–F the source,
 * 1–6 the information), the quote with its note and paragraph, the counts
 * for and against, and the chain note → paragraph → quote → edge with the
 * tool that proposed it and who confirmed it. Escape or the close button
 * closes it; "Copy the claim" is refused for a claim without a quote.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { t } from "../../i18n";
import "../vizStrings";
import "../viz.css";
import type { Edge, Entity } from "../../entities/model";
import { explainEdge, exportClaim, gradeClaim, type SourceMeta } from "../../views/graph/claims";

interface Props {
  ids: readonly string[];
  edges: readonly Edge[];
  entities: ReadonlyMap<string, Entity>;
  sourceOf: (note: string) => SourceMeta | undefined;
  onClose: () => void;
  /** Open the source note at the paragraph (`note#^anchor`). */
  onOpenSource?: (note: string, anchor: string) => void;
}

export default function EdgeInspector({ ids, edges, entities, sourceOf, onClose, onOpenSource }: Props) {
  const byId = useMemo(() => new Map(edges.map((e) => [e.id, e])), [edges]);
  const list = ids.map((id) => byId.get(id)).filter((e): e is Edge => !!e);
  const [at, setAt] = useState(0);
  const [copied, setCopied] = useState<"ok" | "refused" | null>(null);
  const edge = list[Math.min(at, list.length - 1)];
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), [edge?.id]);
  if (!edge) return null;
  const grade = gradeClaim(edge, edges, sourceOf);
  const why = explainEdge(edge, edges, entities);
  const name = (id: string) => entities.get(id)?.name ?? id;
  const copy = () => {
    const text = exportClaim(edge, grade, entities);
    if (!text) return setCopied("refused");
    void navigator.clipboard?.writeText(text).then(() => setCopied("ok"));
  };
  return (
    <section
      className="lumen-viz-inspector"
      aria-labelledby="lumen-edge-inspector"
      data-edge-inspector={edge.id}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="lumen-viz-bar">
        <h3 id="lumen-edge-inspector" tabIndex={-1} ref={heading} className="lumen-viz-title" dir="auto">
          {t("viz.claim.title", { subject: name(edge.subject), predicate: t(`entityGraph.predicate.${edge.predicate}`), object: name(edge.object) })}
        </h3>
        <button type="button" onClick={onClose} aria-label={t("viz.claim.close")}>
          ×
        </button>
      </div>
      {list.length > 1 && (
        <label className="lumen-viz-note">
          {t("viz.claim.which", { count: list.length })}{" "}
          <select value={at} onChange={(e) => setAt(Number(e.target.value))}>
            {list.map((e, i) => (
              <option key={e.id} value={i}>
                {e.provenance.note}#^{e.provenance.anchor}
              </option>
            ))}
          </select>
        </label>
      )}
      <dl className="lumen-viz-claim">
        <dt>{t("viz.claim.reliability")}</dt>
        <dd data-reliability={grade.reliability}>
          <strong>{grade.reliability}</strong> — {t(`viz.claim.reliability.${grade.reliability}`)}
        </dd>
        <dt>{t("viz.claim.credibility")}</dt>
        <dd data-credibility={grade.credibility}>
          <strong>{grade.credibility}</strong> — {t(`viz.claim.credibility.${grade.credibility}`)}
        </dd>
        <dt>{t("viz.claim.counts")}</dt>
        <dd>{t("viz.claim.forAgainst", { for: grade.for, against: grade.against })}</dd>
        <dt>{t("viz.claim.quote")}</dt>
        <dd data-anchor={grade.anchor ? "" : undefined}>
          {grade.anchor ? (
            <>
              <blockquote dir="auto">{grade.anchor.quote}</blockquote>
              <button type="button" onClick={() => onOpenSource?.(grade.anchor!.note, grade.anchor!.anchor)} dir="auto">
                {grade.anchor.note}#^{grade.anchor.anchor}
              </button>
            </>
          ) : (
            <strong className="lumen-viz-claim-missing">{t("viz.claim.noAnchor")}</strong>
          )}
        </dd>
      </dl>
      <h4>{t("viz.why.title")}</h4>
      <ol className="lumen-viz-why" data-edge-why="">
        {why.chain.map((c) => (
          <li key={c.step}>
            <span>{t(`viz.why.step.${c.step}`)}</span>: <span dir="auto">{c.value}</span>
          </li>
        ))}
      </ol>
      <p className="lumen-viz-note">
        {t("viz.why.tool", { extractor: why.tool.extractor, model: why.tool.model ?? "—", date: why.tool.date })} · {t("viz.why.confidence", { value: why.features.confidence })} ·{" "}
        {why.confirmed ? t("viz.why.confirmed") : t("viz.why.nobody")}
      </p>
      <button type="button" onClick={copy} data-claim-copy="">
        {t("viz.claim.copy")}
      </button>
      {copied && <span role="status">{copied === "ok" ? t("viz.claim.copied") : t("viz.claim.refused")}</span>}
    </section>
  );
}
