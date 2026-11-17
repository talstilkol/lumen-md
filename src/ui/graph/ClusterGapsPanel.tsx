/**
 * "Clusters and gaps" beside the note graph (plan W13.G8): Leiden
 * communities with their modularity, each named by its top three terms and
 * drawn as a hull in its colour on the canvas, and the structural gaps —
 * clusters about related things that barely link — each with the link the
 * link agent would add. Chosen gaps are staged as proposals: the review
 * panel shows each diff, and nothing is written without approval.
 *
 * Loaded by GraphView with a dynamic import only; the notes' text is read
 * from the vault index when the analysis is asked for.
 */
import { useState } from "react";
import { t } from "../../i18n";
import { analyzeClusters, type ClusterAnalysis, type GapNode } from "../../graph/clusterGaps";
import { stageGapLinks } from "../../graph/clusterGapsStage";
import "./clusterGapsStrings";

export interface ClusterGapsPanelProps {
  /** The graph on screen: note paths, labels and links. */
  nodes: ReadonlyArray<{ id: string; label: string }>;
  edges: ReadonlyArray<{ source: string; target: string }>;
  /** The texts by path (the vault index by default). */
  texts?: (paths: string[]) => Promise<Map<string, string>>;
  read?: (path: string) => Promise<string>;
  /** Tells the graph to colour by cluster and draw hulls (null: back to its own colours). */
  onAnalysis: (a: ClusterAnalysis | null) => void;
  /** Open a bridge note. */
  onFocus?: (path: string) => void;
  colorOf: (cluster: number) => string;
  onClose: () => void;
}

async function indexTexts(paths: string[]): Promise<Map<string, string>> {
  const { indexedNotes } = await import("../../storage/workspaceIndex");
  return new Map((await indexedNotes(paths)).map((n) => [n.path, n.content]));
}
async function readNote(path: string): Promise<string> {
  return (await import("../../storage/workspace")).readWorkspaceFile(path);
}

export function ClusterGapsPanel({ nodes, edges, texts = indexTexts, read = readNote, onAnalysis, onFocus, colorOf, onClose }: ClusterGapsPanelProps) {
  const [busy, setBusy] = useState(false);
  const [a, setA] = useState<ClusterAnalysis | null>(null);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [status, setStatus] = useState("");
  const labelOf = new Map(nodes.map((n) => [n.id, n.label]));

  const run = async () => {
    setBusy(true);
    setStatus(t("graphClusters.working"));
    try {
      const tx = await texts(nodes.map((n) => n.id));
      const input: GapNode[] = nodes.map((n) => ({ id: n.id, label: n.label, text: tx.get(n.id) ?? "" }));
      // Let the status paint before the analysis takes the thread.
      await new Promise((r) => setTimeout(r, 0));
      const res = analyzeClusters({ nodes: input, edges });
      setA(res);
      setChosen(new Set(res.gaps.map((_, i) => i)));
      onAnalysis(res);
      setStatus(t("graphClusters.done", { clusters: res.clusters.length, gaps: res.gaps.length }));
    } catch (e) {
      setStatus(t("graphClusters.failed", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  };

  const propose = async () => {
    if (!a) return;
    const gaps = a.gaps.filter((_, i) => chosen.has(i));
    try {
      const staged = await stageGapLinks({
        gaps,
        paths: nodes.map((n) => n.id),
        read,
        line: (link, terms) => t("graphClusters.seeAlso", { link, terms }),
        summary: (from, to) => t("graphClusters.summary", { from: labelOf.get(from) ?? from, to: labelOf.get(to) ?? to }),
      });
      setStatus(t("graphClusters.staged", { n: staged.length }));
    } catch (e) {
      setStatus(t("graphClusters.failed", { error: e instanceof Error ? e.message : String(e) }));
    }
  };

  const name = (c: number) => a?.clusters[c]?.terms.join(" · ") || t("graphClusters.unnamed");
  return (
    <aside aria-label={t("graphClusters.title")} data-testid="cluster-gaps" style={{ position: "absolute", insetBlock: 0, insetInlineEnd: 0, inlineSize: "min(380px, 90%)", overflow: "auto", background: "hsl(var(--bg))", borderInlineStart: "1px solid hsl(var(--border))", padding: 12, fontSize: 12, zIndex: 3, color: "hsl(var(--fg))" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>{t("graphClusters.title")}</h3>
        <button
          type="button"
          onClick={() => {
            onAnalysis(null);
            onClose();
          }}
          style={{ marginInlineStart: "auto" }}
        >
          {t("graphClusters.close")}
        </button>
      </div>
      <p style={{ color: "hsl(var(--fg-muted))" }}>{t("graphClusters.intro")}</p>
      <button type="button" onClick={() => void run()} disabled={busy || nodes.length < 2} data-testid="cluster-gaps-run">
        {a ? t("graphClusters.again") : t("graphClusters.run")}
      </button>
      <p role="status" aria-live="polite" data-testid="cluster-gaps-status">
        {status}
      </p>
      {a && (
        <>
          <p data-testid="cluster-gaps-modularity">{t("graphClusters.modularity", { q: a.modularity.toFixed(3), clusters: a.clusters.length, communities: a.communities })}</p>
          <h4 style={{ margin: "8px 0 4px" }}>{t("graphClusters.clusters")}</h4>
          <ol style={{ margin: 0, paddingInlineStart: 20, display: "grid", gap: 2 }} data-testid="cluster-gaps-clusters">
            {a.clusters.map((c) => (
              <li key={c.index}>
                <span aria-hidden style={{ display: "inline-block", inlineSize: 8, blockSize: 8, borderRadius: 4, background: colorOf(c.index), marginInlineEnd: 4 }} />
                <bdi>{c.terms.join(" · ") || t("graphClusters.unnamed")}</bdi> <span style={{ color: "hsl(var(--fg-muted))" }}>({t("graphClusters.size", { n: c.members.length })})</span>
              </li>
            ))}
          </ol>
          <h4 style={{ margin: "12px 0 4px" }}>{t("graphClusters.gaps")}</h4>
          {!a.gaps.length && <p>{t("graphClusters.noGaps")}</p>}
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }} data-testid="cluster-gaps-gaps">
            {a.gaps.map((g, i) => (
              <li key={`${g.a}:${g.b}`} style={{ borderBlockEnd: "1px solid hsl(var(--border))", paddingBlockEnd: 6 }}>
                <label style={{ display: "flex", gap: 6, alignItems: "start" }}>
                  <input type="checkbox" checked={chosen.has(i)} onChange={() => setChosen((s) => (s.has(i) ? new Set([...s].filter((x) => x !== i)) : new Set([...s, i])))} />
                  <span>
                    <bdi>{name(g.a)}</bdi> ↔ <bdi>{name(g.b)}</bdi>
                    <br />
                    <span style={{ color: "hsl(var(--fg-muted))" }}>{t("graphClusters.gapWhy", { shared: g.shared.slice(0, 3).join(", "), links: g.links, expected: g.expected.toFixed(1) })}</span>
                  </span>
                </label>
                <div style={{ paddingInlineStart: 22 }}>
                  {t("graphClusters.bridge")}{" "}
                  <button type="button" onClick={() => onFocus?.(g.from)} style={{ background: "none", border: 0, padding: 0, color: "inherit", textDecoration: "underline", cursor: "pointer" }}>
                    <bdi>{labelOf.get(g.from)}</bdi>
                  </button>{" "}
                  →{" "}
                  <button type="button" onClick={() => onFocus?.(g.to)} style={{ background: "none", border: 0, padding: 0, color: "inherit", textDecoration: "underline", cursor: "pointer" }}>
                    <bdi>{labelOf.get(g.to)}</bdi>
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {a.gaps.length > 0 && (
            <button type="button" onClick={() => void propose()} disabled={!chosen.size} data-testid="cluster-gaps-propose" style={{ marginBlockStart: 8 }}>
              {t("graphClusters.propose", { n: chosen.size })}
            </button>
          )}
        </>
      )}
    </aside>
  );
}

export default ClusterGapsPanel;
