/**
 * The entity graph as the text alternative's `AltGraph` (plan W13.G11):
 * kind = entity type, relation = predicate, and the labels the summary and
 * the list use for them.
 */
import { t, tPlural } from "../../i18n";
import type { AltGraph } from "../../graph/textAlt";
import type { VisibleGraph } from "../../entities/view";

export const entityAltGraph = (g: VisibleGraph): AltGraph => ({
  nodes: g.nodes.map((n) => ({ id: n.id, label: n.name, kind: n.type })),
  edges: g.edges.map((e) => ({ source: e.subject, target: e.object, relation: e.predicate })),
});

/** "4 people" — the count of one entity type in the summary. */
export const kindCount = (kind: string, n: number): string => tPlural(`graphAlt.kind.${kind}`, n);

/**
 * Relations read from the object's side by their own name ("Parents",
 * "Born here", "Cited by"); `spouse` reads the same both ways.
 */
const INVERSE = new Set(["child", "born_in", "died_in", "member_of", "employer", "located_in", "part_of", "participant_in", "amends", "cites", "author", "founded_by", "headquarters", "student_of", "enacted_by", "main_subject"]);
const SYMMETRIC = new Set(["spouse", "related_to"]);

/** A neighbour group's heading: the relation, its inverse name, or "Incoming: relation". */
export function relationHeading(relation: string, direction: "out" | "in"): string {
  if (!relation) return t("graphAlt.list.link");
  const name = t(`entityGraph.predicate.${relation}`);
  if (direction === "out" || SYMMETRIC.has(relation)) return name;
  return INVERSE.has(relation) ? t(`graphAlt.inverse.${relation}`) : t("graphAlt.list.in", { relation: name });
}
