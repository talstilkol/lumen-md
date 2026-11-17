/**
 * The entity graph's view as an export scene (plan W13.G12): visible nodes
 * with the positions, colours and sizes the canvas draws, GEXF attributes
 * from the entity (type, Wikidata id, aliases) and from each relation
 * (predicate, confidence, date, source note, anchor and quote).
 */
import type { Edge, Entity } from "../../entities/model";
import type { Scene, Rgba } from "../../graph/exportImage";

export interface EntitySceneInput {
  title: string;
  description?: string;
  lang?: string;
  nodes: readonly Entity[];
  edges: readonly Edge[];
  /** x, y per node, in node order. */
  positions: Float32Array;
  /** r, g, b, a per node (0..1). */
  colors: Float32Array;
  sizes: Float32Array;
  edgeColor?: Rgba;
  labelColor?: Rgba;
}

export function entityScene(i: EntitySceneInput): Scene {
  return {
    title: i.title,
    description: i.description,
    lang: i.lang,
    edgeColor: i.edgeColor,
    labelColor: i.labelColor,
    background: [1, 1, 1, 1],
    nodes: i.nodes.map((n, k) => ({
      id: n.id,
      label: n.name,
      kind: n.type,
      x: i.positions[2 * k] ?? 0,
      y: i.positions[2 * k + 1] ?? 0,
      color: [i.colors[4 * k], i.colors[4 * k + 1], i.colors[4 * k + 2], i.colors[4 * k + 3]] as const,
      size: i.sizes[k] || 4,
      attrs: { ...(n.qid ? { wikidata: n.qid } : {}), ...(n.aliases.length ? { aliases: n.aliases.join(" | ") } : {}) },
    })),
    edges: i.edges.map((e) => ({
      source: e.subject,
      target: e.object,
      relation: e.predicate,
      attrs: { confidence: e.confidence, ...(e.when ? { when: e.when } : {}), note: e.provenance.note, anchor: e.provenance.anchor, quote: e.provenance.quote },
    })),
  };
}
