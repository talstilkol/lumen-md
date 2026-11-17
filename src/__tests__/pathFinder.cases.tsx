/**
 * W13.G4 — the path finder: Yen's k shortest paths over the entity graph,
 * weighted by confidence, against a brute-force enumeration; the relation
 * and length filters (the length limit exact, not a post-filter); each path
 * as a chain of citations whose every link opens a paragraph that exists;
 * k = 5 on a 10,000-entity graph within 300 ms; and the panel (RTL, keyboard,
 * opening the paragraph, axe).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import axe from "axe-core";
import { edgeId, entityId, type Edge, type Entity, type EntityType } from "../entities/model";
import { buildPathGraph, citeChain, edgeCost, findPaths, kShortestPaths } from "../graph/paths";
import PathFinderPanel from "../viz/graph/PathFinderPanel";

function prng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ent = (type: EntityType, name: string): Entity => ({ id: entityId(type, name), type, name, aliases: [] });
const mkEdge = (s: string, p: string, o: string, confidence: number, note: string, anchor: string, status: Edge["status"] = "approved"): Edge => ({
  id: edgeId(s, p, o, note, anchor),
  subject: s,
  predicate: p,
  object: o,
  confidence,
  status,
  provenance: { note, anchor, quote: `${s} ${p} ${o}`, paragraphHash: "sha256:0", extractor: "test", model: null, date: "2026-11-01" },
});

/* A small investigative graph, Hebrew names, each relation cited from a paragraph of a note. */
const P = ["דוד כהן", "רחל לוי", "משה ישראלי"].map((n) => ent("person", n));
const O = ["חברת אלפא", "ועד השכונה"].map((n) => ent("organization", n));
const L = ["חיפה", "תל אביב"].map((n) => ent("place", n));
const [david, rachel, moshe] = P.map((e) => e.id);
const [alpha, vaad] = O.map((e) => e.id);
const [haifa, tlv] = L.map((e) => e.id);
const NOTE_A = "תחקיר/פגישה.md";
const NOTE_B = "תחקיר/רשם.md";
const TEXTS = new Map([
  [NOTE_A, "דוד כהן עובד בחברת אלפא. ^a1\n\nרחל לוי חברה בוועד השכונה. ^a2\n\nמשה ישראלי מנהל את חברת אלפא. ^a3"],
  [NOTE_B, "חברת אלפא רשומה בחיפה. ^b1\n\nרחל לוי נולדה בחיפה. ^b2\n\nדוד כהן חבר בוועד השכונה, לפי הפרוטוקול. ^b3\n\nמשה ישראלי נולד בתל אביב. ^b4"],
]);
const EDGES: Edge[] = [
  mkEdge(david, "employer", alpha, 0.9, NOTE_A, "a1"),
  mkEdge(rachel, "member_of", vaad, 0.95, NOTE_A, "a2"),
  mkEdge(alpha, "founded_by", moshe, 0.85, NOTE_A, "a3"),
  mkEdge(alpha, "located_in", haifa, 0.9, NOTE_B, "b1"),
  mkEdge(rachel, "born_in", haifa, 0.6, NOTE_B, "b2"),
  mkEdge(david, "member_of", vaad, 0.4, NOTE_B, "b3"),
  mkEdge(moshe, "born_in", tlv, 0.9, NOTE_B, "b4"),
  mkEdge(david, "born_in", tlv, 0.9, NOTE_B, "gone", "rejected"),
];
const ENTITIES = [...P, ...O, ...L];

describe("the search", () => {
  it("prefers sure links over few links: דוד → רחל goes through the company and Haifa before the doubtful committee link", () => {
    const paths = findPaths(ENTITIES, EDGES, david, rachel, { k: 5 });
    expect(paths.map((p) => p.nodes)).toEqual([
      [david, alpha, haifa, rachel],
      [david, vaad, rachel],
    ]);
    // −ln 0.9 − ln 0.9 − ln 0.6 + 3·0.1 ≈ 1.02 against −ln 0.4 − ln 0.95 + 2·0.1 ≈ 1.17.
    expect(paths[0].cost).toBeCloseTo(edgeCost(0.9) + edgeCost(0.9) + edgeCost(0.6));
    expect(paths[1].cost).toBeCloseTo(edgeCost(0.4) + edgeCost(0.95));
  });
  it("the steps read in the relation's own direction, and a rejected edge never carries a path", () => {
    const [p] = findPaths(ENTITIES, EDGES, moshe, david, { k: 1 });
    expect(p.nodes).toEqual([moshe, alpha, david]);
    expect(p.steps.map((s) => [s.edge.predicate, s.forward])).toEqual([
      ["founded_by", false],
      ["employer", false],
    ]);
    expect(findPaths(ENTITIES, EDGES, david, tlv, { k: 3 }).every((q) => q.steps.every((s) => s.edge.status !== "rejected"))).toBe(true);
    expect(findPaths(ENTITIES, EDGES, david, tlv, { k: 1 })[0].nodes).toEqual([david, alpha, moshe, tlv]);
  });
  it("filters by relation type", () => {
    const only = new Set(["employer", "founded_by", "located_in", "born_in"]);
    const paths = findPaths(ENTITIES, EDGES, david, rachel, { k: 5, predicates: only });
    expect(paths.map((p) => p.nodes)).toEqual([[david, alpha, haifa, rachel]]);
    expect(findPaths(ENTITIES, EDGES, david, rachel, { predicates: new Set(["founded_by"]) })).toEqual([]);
  });
  it("a length limit is exact: the cheapest path within the limit, not the cheapest path cut off", () => {
    // A cheap 4-hop chain and a dear 2-hop one between s and t.
    const n = ["s", "a", "b", "c", "t"].map((x) => ent("concept", x));
    const id = (x: string) => entityId("concept", x);
    const es = [mkEdge(id("s"), "related_to", id("a"), 1, "n.md", "1"), mkEdge(id("a"), "related_to", id("b"), 1, "n.md", "2"), mkEdge(id("b"), "related_to", id("c"), 1, "n.md", "3"), mkEdge(id("c"), "related_to", id("t"), 1, "n.md", "4"), mkEdge(id("s"), "related_to", id("t"), 0.05, "n.md", "5")];
    expect(findPaths(n, es, id("s"), id("t"), { k: 1 })[0].steps.length).toBe(4);
    expect(findPaths(n, es, id("s"), id("t"), { k: 1, maxHops: 3 })[0].steps.length).toBe(1);
    expect(findPaths(n, es, id("s"), id("t"), { k: 5, maxHops: 3 })).toHaveLength(1);
  });
  it("two entities with several relations: one step on the strongest, the others listed with it", () => {
    const extra = [...EDGES, mkEdge(david, "part_of", alpha, 0.5, NOTE_A, "a1")];
    const [p] = findPaths(ENTITIES, extra, david, alpha, { k: 1 });
    expect(p.steps[0].edge.predicate).toBe("employer");
    expect(p.steps[0].others.map((e) => e.predicate)).toEqual(["part_of"]);
  });
  it("no path, same entity, unknown entity: an empty answer", () => {
    const lone = ent("concept", "בודד");
    expect(findPaths([...ENTITIES, lone], EDGES, david, lone.id)).toEqual([]);
    expect(findPaths(ENTITIES, EDGES, david, david)).toEqual([]);
    expect(findPaths(ENTITIES, EDGES, david, "person:nobody")).toEqual([]);
  });
});

/** Every simple path s → t (DFS), with its cost, cheapest first. */
function brute(g: ReturnType<typeof buildPathGraph>, s: number, t: number, maxHops: number): number[] {
  const out: number[] = [];
  const on = new Uint8Array(g.ids.length);
  const walk = (v: number, cost: number, hops: number) => {
    if (v === t) return void out.push(cost);
    if (hops === maxHops) return;
    on[v] = 1;
    for (let j = g.offsets[v]; j < g.offsets[v + 1]; j++) if (!on[g.nbr[j]]) walk(g.nbr[j], cost + g.cost[g.link[j]], hops + 1);
    on[v] = 0;
  };
  walk(s, 0, 0);
  return out.sort((a, b) => a - b);
}

describe("Yen against brute force", () => {
  it("the k cheapest loopless paths, on 40 random graphs, with and without a length limit", () => {
    const rnd = prng(5);
    for (let trial = 0; trial < 40; trial++) {
      const n = 9;
      const es: Entity[] = Array.from({ length: n }, (_, i) => ent("concept", `n${i}`));
      const edges: Edge[] = [];
      for (let e = 0; e < 18; e++) {
        const a = Math.floor(rnd() * n);
        const b = Math.floor(rnd() * n);
        if (a !== b) edges.push(mkEdge(es[a].id, "related_to", es[b].id, 0.2 + 0.8 * rnd(), "n.md", `x${e}`));
      }
      const g = buildPathGraph(es, edges);
      const limit = trial % 2 ? 3 : Infinity;
      const want = brute(g, 0, n - 1, limit === Infinity ? n : limit).slice(0, 6);
      const got = kShortestPaths(g, es[0].id, es[n - 1].id, { k: 6, maxHops: limit === Infinity ? undefined : limit });
      expect(got.map((p) => +p.cost.toFixed(9))).toEqual(want.map((c) => +c.toFixed(9)));
      for (const p of got) expect(new Set(p.nodes).size).toBe(p.nodes.length);
    }
  });
});

describe("the chain of citations", () => {
  it("every link of every path opens a paragraph that exists in its note", () => {
    const paths = findPaths(ENTITIES, EDGES, moshe, rachel, { k: 5 });
    expect(paths.length).toBeGreaterThanOrEqual(2);
    for (const p of paths)
      for (const s of citeChain(p, TEXTS)) {
        expect(s.paragraph).not.toBeNull();
        expect(TEXTS.get(s.edge.provenance.note)).toContain(`${s.paragraph} ^${s.edge.provenance.anchor}`);
      }
  });
  it("a paragraph that left the note reads as gone, not as some other paragraph", () => {
    const [p] = findPaths(ENTITIES, EDGES, david, alpha, { k: 1 });
    const edited = new Map([[NOTE_A, "הפסקה נמחקה."]]);
    expect(citeChain(p, edited)[0].paragraph).toBeNull();
  });
});

describe("10,000 entities", () => {
  it("k = 5 in 300 ms or less per query (and to build the graph), and every link of the answer cites a paragraph", () => {
    const rnd = prng(9);
    const n = 10_000;
    const types: EntityType[] = ["person", "place", "organization", "event", "concept"];
    const ents = Array.from({ length: n }, (_, i) => ent(types[i % 5], `e${i}`));
    const edges: Edge[] = [];
    const preds = ["related_to", "member_of", "employer", "born_in"];
    // Communities of 100 with a few bridges: about 30,000 relations.
    for (let e = 0; e < 30_000; e++) {
      const a = Math.floor(rnd() * n);
      const b = rnd() < 0.95 ? Math.floor(a / 100) * 100 + Math.floor(rnd() * 100) : Math.floor(rnd() * n);
      if (a !== b) edges.push(mkEdge(ents[a].id, preds[e % 4], ents[b].id, 0.3 + 0.7 * rnd(), `notes/${a % 500}.md`, `p${e}`));
    }
    // The panel builds the graph once (when it opens or the relation filter changes) and searches it per query.
    const t0 = performance.now();
    const g = buildPathGraph(ents, edges);
    const build = performance.now() - t0;
    const t1 = performance.now();
    const paths = kShortestPaths(g, ents[17].id, ents[9_876].id, { k: 5 });
    const query = performance.now() - t1;
    expect(paths).toHaveLength(5);
    expect(query).toBeLessThanOrEqual(300);
    expect(build).toBeLessThanOrEqual(300);
    // A second query on the same graph (another pair): the panel's usual case.
    const t2 = performance.now();
    expect(kShortestPaths(g, ents[4_242].id, ents[123].id, { k: 5, maxHops: 8 }).length).toBeGreaterThan(0);
    expect(performance.now() - t2).toBeLessThanOrEqual(300);
    for (let i = 1; i < paths.length; i++) expect(paths[i].cost).toBeGreaterThanOrEqual(paths[i - 1].cost - 1e-12);
    const texts = new Map<string, string>();
    for (const p of paths) for (const s of p.steps) texts.set(s.edge.provenance.note, `${texts.get(s.edge.provenance.note) ?? ""}\n\nפסקה ${s.edge.provenance.anchor}. ^${s.edge.provenance.anchor}`);
    for (const p of paths) expect(citeChain(p, texts).every((s) => s.paragraph !== null)).toBe(true);
  });
});

describe("the panel, in Hebrew", () => {
  beforeEach(() => {
    document.documentElement.dir = "rtl";
    document.documentElement.lang = "he";
  });
  afterEach(() => {
    document.documentElement.dir = "";
  });

  it("finds paths from typed names, shows each link with its paragraph, opens the paragraph; axe clean", async () => {
    const opened: string[] = [];
    const entities: string[] = [];
    const { container } = render(<PathFinderPanel entities={ENTITIES} edges={EDGES} texts={TEXTS} onOpenSource={(n, a) => opened.push(`${n}#^${a}`)} onOpenEntity={(id) => entities.push(id)} />);
    fireEvent.change(screen.getByTestId("path-from"), { target: { value: "משה ישראלי" } });
    fireEvent.change(screen.getByTestId("path-to"), { target: { value: "רחל לוי" } });
    await act(async () => {
      fireEvent.submit(screen.getByTestId("path-search").closest("form")!);
    });
    const results = screen.getByTestId("path-results");
    const paths = within(results).getAllByRole("listitem").filter((li) => li.hasAttribute("data-path"));
    expect(paths.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByTestId("path-status").textContent).toMatch(/entityGraph\.paths\.found|נמצאו|paths found/);
    const first = paths[0];
    expect(first.textContent).toContain("משה ישראלי מנהל את חברת אלפא.");
    expect(first.textContent).toContain("חברת אלפא רשומה בחיפה.");
    const buttons = within(first).getAllByRole("button").filter((b) => b.hasAttribute("data-open-source"));
    for (const b of buttons) fireEvent.click(b);
    expect(opened).toEqual(["תחקיר/פגישה.md#^a3", "תחקיר/רשם.md#^b1", "תחקיר/רשם.md#^b2"]);
    for (const o of opened) {
      const [note, anchor] = o.split("#^");
      expect(TEXTS.get(note)).toContain(`^${anchor}`);
    }
    // In RTL every arrow of a path points left, the way it is read, also on a link read backwards
    // (חברת אלפא נוסדה על ידי משה: the step runs משה ← חברה and says "(בכיוון ההפוך)"). INT7: no mixed arrows.
    for (const p of paths) for (const step of p.querySelectorAll("[data-step]")) {
      expect(step.textContent).toContain("←");
      expect(step.textContent).not.toContain("→");
    }
    expect(first.querySelector("[data-step='0']")!.textContent).toMatch(/entityGraph\.paths\.inverse|בכיוון ההפוך|reversed/);
    fireEvent.click(within(first).getAllByRole("button", { name: "משה ישראלי" })[0]);
    expect(entities).toEqual([moshe]);
    const r = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(r.violations.map((v) => v.id)).toEqual([]);
  });
  it("says so when a name is unknown, when both ends are the same, and when the filters leave no path", async () => {
    render(<PathFinderPanel entities={ENTITIES} edges={EDGES} texts={TEXTS} />);
    const form = screen.getByTestId("path-search").closest("form")!;
    const status = screen.getByTestId("path-status");
    fireEvent.change(screen.getByTestId("path-from"), { target: { value: "אין כזה" } });
    fireEvent.change(screen.getByTestId("path-to"), { target: { value: "רחל לוי" } });
    await act(async () => void fireEvent.submit(form));
    expect(status.textContent).toMatch(/unknown|אין ישות/);
    fireEvent.change(screen.getByTestId("path-from"), { target: { value: "רחל לוי" } });
    await act(async () => void fireEvent.submit(form));
    expect(status.textContent).toMatch(/same|שתי ישויות/);
    fireEvent.change(screen.getByTestId("path-from"), { target: { value: "דוד כהן" } });
    fireEvent.change(screen.getByTestId("path-max"), { target: { value: "1" } });
    await act(async () => void fireEvent.submit(form));
    expect(status.textContent).toMatch(/none|אין מסלול/);
    expect(screen.queryByTestId("path-results")).toBeNull();
  });
  it("matches a name without its niqqud, and swaps the two ends", async () => {
    render(<PathFinderPanel entities={[...ENTITIES, ent("person", "שָׁלוֹם")]} edges={[...EDGES, mkEdge(entityId("person", "שָׁלוֹם"), "member_of", vaad, 0.9, NOTE_A, "a2")]} texts={TEXTS} />);
    fireEvent.change(screen.getByTestId("path-from"), { target: { value: "שלום" } });
    fireEvent.change(screen.getByTestId("path-to"), { target: { value: "רחל לוי" } });
    fireEvent.click(screen.getByRole("button", { name: /swap|החלפה/ }));
    expect((screen.getByTestId("path-from") as HTMLInputElement).value).toBe("רחל לוי");
    await act(async () => void fireEvent.submit(screen.getByTestId("path-search").closest("form")!));
    expect(screen.getByTestId("path-results").querySelectorAll("[data-path]").length).toBeGreaterThanOrEqual(1);
  });
});
