/**
 * W13.G8 — clusters and structural gaps:
 * - Hebrew-aware words for the labels (niqqud out, gershayim kept, stop
 *   words out, a one-letter prefix folded when the bare word occurs);
 * - clusters named by their top TF-IDF terms; a gap between two clusters
 *   about the same thing that do not link, none to an unrelated cluster,
 *   none once they are well linked; the bridge notes share the terms;
 * - a 10k-note vault: modularity reported and 10 gap suggestions;
 * - every suggestion goes through the approval screen: staged, pending,
 *   and not one note written; a note that already links across is skipped;
 * - the panel: run, clusters, gaps, propose → staged; axe.
 * Synthetic data.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement as h } from "react";
import axe from "axe-core";
import { applyLocale, loadLocale } from "../i18n";
import { analyzeClusters, convexHull, words, type GapInput } from "../graph/clusterGaps";
import { stageGapLinks, wikiLink, withSeeAlso, GAP_AGENT, GAP_TOOL } from "../graph/clusterGapsStage";
import { clearStagedChanges, listStagedChanges } from "../agents/staging";
import { ClusterGapsPanel } from "../ui/graph/ClusterGapsPanel";

/** Topics as vocabularies; a cluster is `size` notes that link in a ring and to a few others of their own. */
const TOPICS: Record<string, string[]> = {
  bake: ["שאור", "קמח", "לחם", "בצק", "תנור", "אפייה", "מחמצת", "לישה"],
  grain: ["חיטה", "קמח", "לחם", "שעורה", "טחינה", "מחמצת", "שדה", "קציר"],
  climb: ["טיפוס", "חבל", "סלע", "קרבינר", "אבטחה", "מסלול", "נעליים", "גריגרי"],
  shabbat: ["שבת", "הדלקת", "נרות", "קידוש", "הבדלה", "מלאכה", "עירוב", "צה״ל"],
};
function topicCluster(prefix: string, topic: string, size: number, seed: number): GapInput {
  const v = TOPICS[topic];
  const nodes = Array.from({ length: size }, (_, i) => ({ id: `${prefix}/${i}.md`, label: `${prefix} ${i}`, text: Array.from({ length: 12 }, (_, k) => v[(i * 3 + k * 5 + seed) % v.length]).join(" ") + " על של את" }));
  const edges = nodes.flatMap((n, i) => [1, 2, 5].map((d) => ({ source: n.id, target: nodes[(i + d) % size].id })));
  return { nodes, edges };
}
const merge = (...g: GapInput[]): GapInput => ({ nodes: g.flatMap((x) => x.nodes), edges: g.flatMap((x) => x.edges) });

beforeEach(async () => {
  await loadLocale("he");
  applyLocale("he");
});
afterEach(() => {
  applyLocale("en");
  clearStagedChanges();
});

describe("W13.G8 words and hulls", () => {
  it("Hebrew-aware tokens", () => {
    expect(words("שָׁלוֹם על הַלֶּחֶם, ו-צה״ל ו-API 2026 the bread")).toEqual(["שלום", "הלחם", "צה״ל", "api", "bread"]);
    expect(words("[[דף אחר|כינוי]] ראו")).toEqual(["דף", "אחר", "ראו"]);
  });
  it("convex hull", () => {
    expect(convexHull([[0, 0], [2, 0], [1, 1], [2, 2], [0, 2], [1, 3]])).toEqual([[0, 0], [2, 0], [2, 2], [1, 3], [0, 2]]);
    expect(convexHull([[0, 0], [1, 1]])).toHaveLength(2);
  });
});

describe("W13.G8 clusters and gaps", () => {
  const vault = () => merge(topicCluster("אפייה", "bake", 12, 0), topicCluster("דגנים", "grain", 12, 1), topicCluster("טיפוס", "climb", 12, 2), topicCluster("שבת", "shabbat", 12, 3), {
    nodes: [],
    // One weak link from climbing to Shabbat (so the graph is connected), none between baking and grain.
    edges: [{ source: "טיפוס/0.md", target: "שבת/0.md" }],
  });

  it("names clusters by their terms; a gap between baking and grain, none to climbing", () => {
    const a = analyzeClusters(vault());
    expect(a.modularity).toBeGreaterThan(0.6);
    expect(a.clusters).toHaveLength(4);
    const byFirst = new Map(a.clusters.map((c) => [c.members[0].split("/")[0], c]));
    expect(byFirst.get("טיפוס")!.terms.every((t) => TOPICS.climb.includes(t))).toBe(true);
    expect(byFirst.get("שבת")!.terms.length).toBe(3);
    expect(a.gaps.length).toBeGreaterThan(0);
    const g = a.gaps[0];
    const pair = [a.clusters[g.a].members[0].split("/")[0], a.clusters[g.b].members[0].split("/")[0]].sort();
    expect(pair).toEqual(["אפייה", "דגנים"]);
    expect(g.links).toBe(0);
    expect(g.shared).toEqual(expect.arrayContaining(["לחם", "קמח", "מחמצת"]));
    // The bridge notes contain the shared terms.
    for (const id of [g.from, g.to]) expect(vault().nodes.find((n) => n.id === id)!.text).toMatch(/לחם|קמח|מחמצת/);
    // No gap pairs climbing with baking or grain (nothing in common).
    for (const x of a.gaps) {
      const names = [a.clusters[x.a], a.clusters[x.b]].map((c) => c.members[0].split("/")[0]);
      expect(names.includes("טיפוס") && (names.includes("אפייה") || names.includes("דגנים"))).toBe(false);
    }
  });

  it("well-linked clusters are not a gap", () => {
    const v = vault();
    const linked = { nodes: v.nodes, edges: [...v.edges, ...Array.from({ length: 12 }, (_, i) => ({ source: `אפייה/${i}.md`, target: `דגנים/${i}.md` }))] };
    const a = analyzeClusters(linked);
    const names = a.gaps.map((x) => [a.clusters[x.a], a.clusters[x.b]].map((c) => c.members[0].split("/")[0]).sort().join("+"));
    expect(names).not.toContain("אפייה+דגנים");
  });

  it("a 10k-note vault: modularity reported, 10 gap suggestions", () => {
    const keys = Object.keys(TOPICS);
    const parts: GapInput[] = [];
    // 200 clusters of 50 notes: each topic in 50 separate link-communities that share its words.
    for (let c = 0; c < 200; c++) parts.push(topicCluster(`c${c}`, keys[c % keys.length], 50, c));
    const big = merge(...parts, { nodes: [], edges: Array.from({ length: 199 }, (_, c) => ({ source: `c${c}/0.md`, target: `c${c + 1}/0.md` })) });
    expect(big.nodes).toHaveLength(10_000);
    const t0 = performance.now();
    const a = analyzeClusters(big);
    const ms = performance.now() - t0;
    console.log(`[W13.G8] 10k notes, ${big.edges.length} links: modularity ${a.modularity.toFixed(3)}, ${a.communities} communities, ${a.clusters.length} clusters kept, ${a.gaps.length} gaps, ${ms.toFixed(0)} ms`);
    expect(a.modularity).toBeGreaterThan(0.8);
    expect(a.gaps).toHaveLength(10);
    for (const g of a.gaps) {
      expect(g.links).toBeLessThan(g.expected * 0.5);
      expect(g.from).not.toBe(g.to);
    }
  });
});

describe("W13.G8 through the approval screen", () => {
  it("each gap is a staged proposal; not one note is written; an existing link is not proposed again", async () => {
    const v = merge(topicCluster("אפייה", "bake", 12, 0), topicCluster("דגנים", "grain", 12, 1));
    const a = analyzeClusters(v);
    expect(a.gaps.length).toBeGreaterThan(0);
    const files = new Map(v.nodes.map((n) => [n.id, `# ${n.label}\n\n${n.text}\n`]));
    const snapshot = JSON.stringify([...files]);
    let writes = 0;
    const staged = await stageGapLinks({ gaps: a.gaps, paths: [...files.keys()], read: async (p) => files.get(p)!, line: (l, t) => `ראו גם: ${l} (משותף: ${t})`, summary: (f, t) => `${f} → ${t}` });
    expect(staged.length).toBe(a.gaps.length);
    const pending = listStagedChanges();
    expect(pending.map((c) => [c.status, c.tool, c.agentId])).toEqual(staged.map(() => ["pending", GAP_TOOL, GAP_AGENT]));
    expect(pending[0].kind === "file" && pending[0].after).toContain(`ראו גם: ${wikiLink(a.gaps[0].to, [...files.keys()])}`);
    expect(JSON.stringify([...files])).toBe(snapshot);
    expect(writes).toBe(0);
    // A note that already links across is left alone.
    expect(withSeeAlso("ראו [[2]] כאן", "[[2]]", "x")).toBeNull();
    expect(wikiLink("א/ב.md", ["א/ב.md", "ג/ב.md"])).toBe("[[א/ב]]");
    expect(wikiLink("א/ב.md", ["א/ב.md"])).toBe("[[ב]]");
  });
});

describe("W13.G8 panel", () => {
  it("run → modularity, named clusters, gaps; propose → staged for review; axe", async () => {
    const v = merge(topicCluster("אפייה", "bake", 12, 0), topicCluster("דגנים", "grain", 12, 1), topicCluster("טיפוס", "climb", 12, 2));
    const files = new Map(v.nodes.map((n) => [n.id, n.text]));
    let analysis: unknown = null;
    const { container } = render(
      h(ClusterGapsPanel, {
        nodes: v.nodes.map((n) => ({ id: n.id, label: n.label })),
        edges: v.edges,
        texts: async (paths: string[]) => new Map(paths.map((p) => [p, files.get(p)!])),
        read: async (p: string) => files.get(p)!,
        onAnalysis: (x: unknown) => (analysis = x),
        colorOf: () => "#888",
        onClose: () => {},
      }),
    );
    await act(async () => void fireEvent.click(screen.getByTestId("cluster-gaps-run")));
    await waitFor(() => expect(screen.getByTestId("cluster-gaps-modularity").textContent).toMatch(/מודולריות 0\.\d{3}/));
    expect(analysis).not.toBeNull();
    expect(screen.getByTestId("cluster-gaps-clusters").querySelectorAll("li")).toHaveLength(3);
    const gaps = screen.getByTestId("cluster-gaps-gaps").querySelectorAll("li");
    expect(gaps.length).toBeGreaterThan(0);
    await act(async () => void fireEvent.click(screen.getByTestId("cluster-gaps-propose")));
    await waitFor(() => expect(screen.getByTestId("cluster-gaps-status").textContent).toContain("בחלונית הסקירה"));
    expect(listStagedChanges().length).toBe(gaps.length);
    expect(listStagedChanges().every((c) => c.status === "pending")).toBe(true);
    const r = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(r.violations.map((x) => x.id)).toEqual([]);
  });
});
