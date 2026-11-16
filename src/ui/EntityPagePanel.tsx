/**
 * An entity's page inside the entity graph screen (plan W12.E6, R12.7):
 * choosing an entity in the graph or the table opens this panel — the
 * entity's fields, relations and mentions (EntityPage), and its timeline
 * with the time checker (TimelineView), built from the relations that touch
 * it. Every source link opens the note and selects the cited paragraph.
 *
 * Loaded with the graph screen (lazy), never at startup.
 */
import { lazy, Suspense, useMemo } from "react";
import { t } from "../i18n";
import type { Edge, Entity } from "../entities/model";
import { paragraphByAnchor } from "../entities/paragraphs";
import { spanFromText, type TimelineClaim } from "../entities/temporal";
import "./entityGraphStrings";

const EntityPage = lazy(() => import("./EntityPage").then((m) => ({ default: m.EntityPage })));
const TimelineView = lazy(() => import("../views/timeline/TimelineView").then((m) => ({ default: m.TimelineView })));

export interface EntityPagePanelProps {
  entity: Entity;
  entities: readonly Entity[];
  edges: readonly Edge[];
  /** Note path → text, as the graph was loaded. */
  texts: ReadonlyMap<string, string>;
  /** Note path → its `date` property, when it has one (the day a claim was recorded). */
  dates: ReadonlyMap<string, string | undefined>;
  /** Open a note, then select the paragraph `anchor` names (or nothing). */
  onOpen: (note: string, anchor: string | null) => void;
  onOpenNote: () => void;
  onBack: () => void;
}

/** The relations that touch an entity, as timeline claims: dated by the edge's `when`, else by the first date in its quote. */
export function entityClaims(entity: Entity, edges: readonly Edge[], names: ReadonlyMap<string, string>, dates: ReadonlyMap<string, string | undefined>): TimelineClaim[] {
  const out: TimelineClaim[] = [];
  for (const e of edges) {
    if (e.subject !== entity.id && e.object !== entity.id) continue;
    const other = e.subject === entity.id ? e.object : e.subject;
    const observed = dates.get(e.provenance.note) ?? "9999-12-31";
    const start = e.when ? { from: e.when, to: e.when, precision: "day" as const } : spanFromText(e.provenance.quote, dates.get(e.provenance.note));
    out.push({
      id: e.id,
      subject: entity.id,
      predicate: e.predicate,
      value: names.get(other) ?? other,
      ...(start ? { start } : {}),
      observed,
      source: { note: e.provenance.note, anchor: e.provenance.anchor, quote: e.provenance.quote },
    });
  }
  return out;
}

/** The 1-based lines of the paragraph `anchor` names in `text`, for `lumen-reveal-line`. */
export function anchorLines(text: string, anchor: string | null): { line: number; endLine: number } | null {
  const p = anchor ? paragraphByAnchor(text, anchor) : null;
  if (!p) return null;
  const line = text.slice(0, p.start).split("\n").length;
  return { line, endLine: line + p.text.split("\n").length - 1 };
}

const btn: React.CSSProperties = { padding: "4px 12px", fontSize: 12, borderRadius: 6, border: "1px solid hsl(var(--border))", background: "transparent", color: "inherit", cursor: "pointer" };

export function EntityPagePanel({ entity, entities, edges, texts, dates, onOpen, onOpenNote, onBack }: EntityPagePanelProps) {
  const names = useMemo(() => new Map(entities.map((e) => [e.id, e.name])), [entities]);
  const claims = useMemo(() => entityClaims(entity, edges, names, dates), [entity, edges, names, dates]);
  return (
    <div data-testid="entity-page-panel" style={{ padding: "8px 16px" }}>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" style={btn} onClick={onBack}>
          {t("entityGraph.page.back")}
        </button>
        <button type="button" style={btn} onClick={onOpenNote}>
          {t("entityGraph.page.openNote")}
        </button>
      </div>
      <Suspense fallback={null}>
        <EntityPage entity={entity} edges={edges} notes={texts} names={names} onOpenBlock={onOpen} />
        <TimelineView claims={claims} names={names} onOpenSource={onOpen} />
      </Suspense>
    </div>
  );
}
