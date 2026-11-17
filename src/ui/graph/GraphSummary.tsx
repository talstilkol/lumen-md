/**
 * The graph in a sentence (plan W13.G11): "12 relations between 9
 * entities, in 3 clusters; most connected: …; 4 people, 3 places." — in a
 * polite live region that speaks again when the filters change. The text
 * waits for the filters to settle (`SETTLE_MS`), so a playing time slider
 * does not flood the screen reader, and the sentence is only recomputed
 * then (Leiden on 10k nodes is not free).
 */
import { useEffect, useState } from "react";
import { t, tPlural } from "../../i18n";
import { summarize, type AltGraph, type GraphSummary as Summary } from "../../graph/textAlt";

export const SETTLE_MS = 400;

/** The sentence, in the active language (a hub's name is isolated, FSI…PDI, so a Hebrew name keeps its count beside it in an English sentence). */
export function summaryText(s: Summary, kindLabel?: (kind: string, count: number) => string): string {
  if (!s.nodes) return t("graphAlt.summary.empty");
  const parts = [tPlural("graphAlt.summary.nodes", s.nodes), tPlural("graphAlt.summary.edges", s.edges)];
  parts.push(tPlural(s.clusterMethod === "leiden" ? "graphAlt.summary.clusters" : "graphAlt.summary.components", s.clusters));
  if (s.unconnected) parts.push(tPlural("graphAlt.summary.unconnected", s.unconnected));
  let text = parts.join(", ") + ".";
  if (s.hubs.length) text += " " + t("graphAlt.summary.hubs", { list: s.hubs.map((h) => `\u2068${h.label}\u2069 (${h.degree})`).join(", ") }) + ".";
  if (s.kinds.length && kindLabel) text += " " + s.kinds.map((k) => kindLabel(k.kind, k.count)).join(", ") + ".";
  return text;
}

export function GraphSummary({ graph, kindLabel, testId = "graph-summary" }: { graph: AltGraph; kindLabel?: (kind: string, count: number) => string; testId?: string }) {
  const [text, setText] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setText(summaryText(summarize(graph), kindLabel)), SETTLE_MS);
    return () => clearTimeout(id);
  }, [graph, kindLabel]);
  return (
    <p role="status" aria-live="polite" aria-atomic="true" data-testid={testId} style={{ margin: 0, fontSize: 12, color: "hsl(var(--fg-muted))", flexBasis: "100%" }}>
      {text}
    </p>
  );
}
