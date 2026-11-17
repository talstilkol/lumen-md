/**
 * The argument map's two built-in types, claim and evidence (plan W12),
 * apart from the graph (./argumentMap.ts) so that the graph's readers —
 * the argument checker of W13.W8 among them — do not load the type schema.
 */
import { typeDefFromObject, type TypeDef } from "../types/typeSchema";

const relationField = (he: string, en: string) => ({ type: "relation", to: "claim", multiple: true, label: { he, en } });

/** The two built-in types of the argument map. */
export function argumentTypes(): TypeDef[] {
  const fields = {
    supports: relationField("תומך ב", "supports"),
    contradicts: relationField("סותר את", "contradicts"),
    qualifies: relationField("מסייג את", "qualifies"),
  };
  const out: TypeDef[] = [];
  const claim = typeDefFromObject("claim", { label: { he: "טענה", en: "Claim" }, tag: "claim", fields: { ...fields, conclusion: { type: "checkbox", label: { he: "מסקנה", en: "Conclusion" } } } }, "builtin:argument-map");
  const evidence = typeDefFromObject("evidence", { label: { he: "מקור", en: "Source" }, tag: "evidence", fields: { ...fields, url: { type: "url" } } }, "builtin:argument-map");
  for (const p of [claim, evidence]) if (p.ok) out.push(p.type);
  return out;
}
