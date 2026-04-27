/**
 * Tests for the Louvain community detection used by the knowledge-graph
 * clustering (P3-05). We exercise three canonical small graphs whose
 * communities are easy to verify by inspection.
 */

import { describe, it, expect } from "vitest";
import { louvain, communityPalette } from "../views/louvain";

describe("louvain", () => {
  it("returns empty result on empty graph", () => {
    const r = louvain({ nodes: [], edges: [] });
    expect(r.numCommunities).toBe(0);
    expect(r.communities.size).toBe(0);
  });

  it("groups two disjoint triangles into two communities", () => {
    const r = louvain({
      nodes: ["a", "b", "c", "d", "e", "f"],
      edges: [
        // Triangle 1
        { source: "a", target: "b" },
        { source: "b", target: "c" },
        { source: "c", target: "a" },
        // Triangle 2
        { source: "d", target: "e" },
        { source: "e", target: "f" },
        { source: "f", target: "d" },
      ],
    });
    expect(r.numCommunities).toBe(2);
    expect(r.communities.get("a")).toBe(r.communities.get("b"));
    expect(r.communities.get("a")).toBe(r.communities.get("c"));
    expect(r.communities.get("d")).toBe(r.communities.get("e"));
    expect(r.communities.get("d")).toBe(r.communities.get("f"));
    expect(r.communities.get("a")).not.toBe(r.communities.get("d"));
    expect(r.modularity).toBeGreaterThan(0.4);
  });

  it("single connected clique → one community", () => {
    const nodes = ["a", "b", "c", "d"];
    const edges = [
      { source: "a", target: "b" },
      { source: "a", target: "c" },
      { source: "a", target: "d" },
      { source: "b", target: "c" },
      { source: "b", target: "d" },
      { source: "c", target: "d" },
    ];
    const r = louvain({ nodes, edges });
    expect(r.numCommunities).toBeGreaterThanOrEqual(1);
    // Every node lands together in this fully-connected clique.
    const labels = new Set(nodes.map((n) => r.communities.get(n)));
    expect(labels.size).toBe(1);
  });

  it("isolated nodes each become their own community", () => {
    const r = louvain({
      nodes: ["solo1", "solo2", "solo3"],
      edges: [],
    });
    expect(r.numCommunities).toBe(3);
  });

  it("communityPalette returns n distinct HSL colours", () => {
    const colours = communityPalette(5);
    expect(colours).toHaveLength(5);
    expect(new Set(colours).size).toBe(5);
    for (const c of colours) {
      expect(c.startsWith("hsl(")).toBe(true);
    }
  });
});
