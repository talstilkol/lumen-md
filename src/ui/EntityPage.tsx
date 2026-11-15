/**
 * An entity's page (plan W12.E6): its fields, its relations out and in,
 * grouped by predicate, each with the quote and a link to the paragraph it
 * came from (`note#^id`), marked when that paragraph changed; and every
 * mention in the vault with its paragraph (backlinks with context).
 */
import { useMemo } from "react";
import { t } from "../i18n";
import type { Edge, Entity } from "../entities/model";
import { entityPage, type PageEdge } from "../entities/pages";
import { WIKIDATA_LICENCE } from "../entities/wikidata";
import "./entityGraphStrings";
import { EmptyState, learnHow } from "./EmptyState";

export interface EntityPageProps {
  entity: Entity;
  edges: readonly Edge[];
  notes: ReadonlyMap<string, string>;
  names: ReadonlyMap<string, string>;
  onOpenBlock: (note: string, anchor: string | null) => void;
}

function EdgeItem({ e, names, onOpenBlock }: { e: PageEdge; names: ReadonlyMap<string, string>; onOpenBlock: EntityPageProps["onOpenBlock"] }) {
  return (
    <li>
      <span dir="auto">{names.get(e.other) ?? e.other}</span> — <q dir="auto">{e.edge.provenance.quote}</q>{" "}
      <button type="button" onClick={() => onOpenBlock(e.edge.provenance.note, e.edge.provenance.anchor)} aria-label={t("entityGraph.page.openSource", { link: e.link })} disabled={e.source === "missing-note" || e.source === "missing-paragraph"}>
        {e.link}
      </button>
      {e.source !== "ok" && <strong role="note"> {t(`entityGraph.page.source.${e.source}`)}</strong>}
    </li>
  );
}

export function EntityPage({ entity, edges, notes, names, onOpenBlock }: EntityPageProps) {
  const page = useMemo(() => entityPage(entity, edges, notes), [entity, edges, notes]);
  const groups = (side: "outgoing" | "incoming") =>
    page[side].map((g) => (
      <section key={`${side}:${g.predicate}`} aria-label={t(`entityGraph.predicate.${g.predicate}`)}>
        <h4 style={{ margin: "6px 0 2px" }}>{t(`entityGraph.predicate.${g.predicate}`)}</h4>
        <ul>
          {g.edges.map((e) => (
            <EdgeItem key={e.edge.id} e={e} names={names} onOpenBlock={onOpenBlock} />
          ))}
        </ul>
      </section>
    ));
  return (
    <article data-testid="entity-page" aria-labelledby="entity-page-title" style={{ padding: 12, fontSize: 13 }}>
      <h2 id="entity-page-title" dir="auto">
        {entity.name}
      </h2>
      <dl>
        <dt>{t("entityGraph.view.type")}</dt>
        <dd>{t(`entityGraph.type.${entity.type}`)}</dd>
        {entity.qid && (
          <>
            <dt>{t("entityGraph.page.wikidata")}</dt>
            <dd>
              <code>{entity.qid}</code> · {t("entityGraph.wikidata.licence", { licence: WIKIDATA_LICENCE })}
            </dd>
          </>
        )}
        {entity.aliases.length > 0 && (
          <>
            <dt>{t("entityGraph.page.aliases")}</dt>
            <dd dir="auto">{entity.aliases.join(" · ")}</dd>
          </>
        )}
      </dl>
      <h3>{t("entityGraph.page.outgoing")}</h3>
      {page.outgoing.length ? groups("outgoing") : <EmptyState style={{ padding: 0 }} message={t("entityGraph.page.none")} action={learnHow("workspace/entity-graph")} />}
      <h3>{t("entityGraph.page.incoming")}</h3>
      {page.incoming.length ? groups("incoming") : <EmptyState style={{ padding: 0 }} message={t("entityGraph.page.none")} action={learnHow("workspace/entity-graph")} />}
      <h3>
        {t("entityGraph.page.mentions")} ({page.mentions.length})
      </h3>
      <ul data-testid="entity-mentions">
        {page.mentions.map((m, i) => (
          <li key={`${m.note}:${i}`}>
            <button type="button" onClick={() => onOpenBlock(m.note, m.anchor)}>
              {m.note}
            </button>{" "}
            <span dir="auto">
              {m.paragraph.slice(Math.max(0, m.start - 80), m.start)}
              <mark>{m.paragraph.slice(m.start, m.end)}</mark>
              {m.paragraph.slice(m.end, m.end + 80)}
            </span>
          </li>
        ))}
      </ul>
    </article>
  );
}
