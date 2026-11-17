/**
 * Plan W12.E7 + W12.X3 — the entity graph's host: ⌘K "Entity graph" opens a
 * full-screen view of the vault's entities and relations, the citation
 * graph's `cites` edges included, with the "Citations only" filter. The run
 * is the real path: the palette command's action, the host mounted as App
 * mounts it, the loader reading the vault (on an in-memory OPFS), and the
 * W12.E7 view in its table mode (no WebGL here).
 *
 * The vault is SYNTHETIC, written for the test.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { installFakeOpfs } from "./helpers/fakeOpfs";
import { writeWorkspaceFile } from "../storage/workspace";
import { buildEntityCommands } from "../commands/domains/entities";
import type { CommandContext } from "../commands/domains/context";
import { EntityGraphHost } from "../ui/EntityGraphHost";
import { EntityGraphScreen } from "../ui/EntityGraphScreen";
import { graphFromFiles } from "../entities/graphData";
import { entityId, type Edge } from "../entities/model";
import { EDGES_PATH } from "../entities/store";
import { useAppStore } from "../store/useStore";
import { builtinTypes } from "../types/vaultTypes";
import { loadTypeRegistry } from "../types/typeRegistry";

const DANA = entityId("person", "דנה כהן");
const KNESSET = entityId("organization", "הכנסת");
const prov = { note: "notes/a.md", anchor: "p1", quote: "דנה כהן חברת הכנסת", paragraphHash: `sha256:${"0".repeat(64)}`, extractor: "user", model: null, date: "2026-11-01T00:00:00Z" };
const member: Edge = { id: `${DANA}|member_of|${KNESSET}|notes/a.md#^p1`, subject: DANA, predicate: "member_of", object: KNESSET, provenance: prov, confidence: 1, status: "approved" };
const proposed: Edge = { ...member, id: "proposed-one", predicate: "employer", status: "proposed" };

const VAULT: Record<string, string> = {
  "ישויות/אנשים/דנה כהן.md": "---\nentity-type: person\naliases: [Dana Cohen]\n---\n\n# דנה כהן\n",
  "ישויות/ארגונים/הכנסת.md": "---\nentity-type: organization\n---\n\n# הכנסת\n",
  [EDGES_PATH]: `${JSON.stringify(member)}\n${JSON.stringify(proposed)}\n`,
  "Sources/cohen.md": "---\ntype: source\ncitekey: cohen2020\ntags: [reading]\ndate: 2020-05-01\n---\n\n# Cohen 2020\n\nAs [@levi2018] showed, and [@nobody1999].\n",
  "Sources/levi.md": "---\ntype: source\ncitekey: levi2018\n---\n\n# Levi 2018\n\nSee also [[cohen]].\n",
  ".lumen/zotero-library.csl.json": JSON.stringify([
    { id: "bar2021", "citation-key": "bar2021", type: "article-journal", title: "Bar 2021", references: ["cohen2020", "10.5555/none"] },
  ]),
};

async function writeVault(files: Record<string, string>): Promise<void> {
  for (const [p, text] of Object.entries(files)) await writeWorkspaceFile(p, text);
}

const stats = () => screen.getByTestId("entity-graph-stats").textContent;

beforeEach(() => {
  installFakeOpfs();
  document.body.innerHTML = "";
  useAppStore.setState({ locale: "en" });
});

describe("the graph's data from the vault", () => {
  it("entity notes, approved edges and the citation graph in one graph; proposals and unknown keys left out", () => {
    const g = graphFromFiles(new Map(Object.entries(VAULT)), [{ path: ".lumen/zotero-library.csl.json", items: JSON.parse(VAULT[".lumen/zotero-library.csl.json"]) }]);
    expect(g.entities.map((e) => e.id).sort()).toEqual([KNESSET, DANA, entityId("source", "bar2021"), entityId("source", "cohen2020"), entityId("source", "levi2018")].sort());
    const triples = g.edges.map((e) => `${e.subject} ${e.predicate} ${e.object}`).sort();
    expect(triples).toEqual(
      [
        `${DANA} member_of ${KNESSET}`,
        `${entityId("source", "cohen2020")} cites ${entityId("source", "levi2018")}`,
        `${entityId("source", "levi2018")} cites ${entityId("source", "cohen2020")}`,
        `${entityId("source", "bar2021")} cites ${entityId("source", "cohen2020")}`,
      ].sort(),
    );
    expect(g.unresolved).toBe(2); // @nobody1999 and the unknown DOI
    expect(g.noteOf.get(DANA)).toBe("ישויות/אנשים/דנה כהן.md");
    expect(g.noteOf.get(entityId("source", "cohen2020"))).toBe("Sources/cohen.md");
    expect(g.notes.get("Sources/cohen.md")).toEqual({ tags: ["reading"], date: "2020-05-01" });
  });
});

describe("⌘K Entity graph", () => {
  it("is in the palette and opens the view, which shows entities and citations together", async () => {
    await writeVault(VAULT);
    render(<EntityGraphHost />);
    const cmd = buildEntityCommands({} as CommandContext).find((c) => c.id === "entities.graph")!;
    expect(cmd.label).toBe("Entity graph");
    act(() => void cmd.action());
    await screen.findByTestId("entity-graph-screen");
    // The view starts in the graph; without WebGL / a worker here it falls back to the same data as a table.
    await waitFor(() => expect(stats()).toBe("5 entities · 4 relations"));
    expect(screen.getByRole("heading", { name: "Entity graph" })).toBeTruthy();
  });

  it("'Citations only' keeps the cites edges between sources and drops the rest", async () => {
    await writeVault(VAULT);
    render(<EntityGraphScreen onClose={() => {}} initialMode="table" />);
    await waitFor(() => expect(stats()).toBe("5 entities · 4 relations"));
    const only = screen.getByRole("button", { name: "Citations only" });
    fireEvent.click(only);
    expect(only.getAttribute("aria-pressed")).toBe("true");
    expect(stats()).toBe("3 entities · 3 relations");
    expect([...document.querySelectorAll("tr[data-edge]")].every((r) => r.getAttribute("data-edge")!.startsWith("cites:"))).toBe(true);
    fireEvent.click(only);
    expect(stats()).toBe("5 entities · 4 relations");
  });

  it("an entity opens its page (W12.E6); the page opens its note; Escape closes the view", async () => {
    await writeVault(VAULT);
    let closed = 0;
    render(<EntityGraphScreen onClose={() => closed++} initialMode="table" />);
    const row = await waitFor(() => {
      const r = document.querySelector<HTMLTableRowElement>(`tr[data-node="${entityId("source", "levi2018")}"]`);
      if (!r) throw new Error("not yet");
      return r;
    });
    fireEvent.dblClick(row);
    await screen.findByTestId("entity-page-panel");
    expect(document.getElementById("entity-page-title")?.textContent).toBe("levi");
    expect(closed).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Open the note" }));
    await waitFor(() => expect(useAppStore.getState().doc.workspaceName).toBe("Sources/levi.md"));
    expect(closed).toBe(1);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(closed).toBe(2);
  });

  it("the page shows the relations, the mentions with their paragraph and a timeline; a source link selects its paragraph (W12.E6, R12.7)", async () => {
    await writeVault({ ...VAULT, "notes/a.md": "---\ndate: 2026-11-01\n---\n\nדנה כהן חברת הכנסת מאז 2021.\n^p1\n" });
    let closed = 0;
    render(<EntityGraphScreen onClose={() => closed++} initialMode="table" />);
    const row = await waitFor(() => {
      const r = document.querySelector<HTMLTableRowElement>(`tr[data-node="${DANA}"]`);
      if (!r) throw new Error("not yet");
      return r;
    });
    fireEvent.dblClick(row);
    const panel = await screen.findByTestId("entity-page-panel");
    expect(panel.textContent).toContain("דנה כהן חברת הכנסת");
    expect(screen.getByTestId("entity-mentions").querySelectorAll("li").length).toBeGreaterThanOrEqual(1);
    // The edge has no date and its quote names none: the claim goes to the undated group, never placed (R12.7).
    expect((await screen.findByTestId("timeline-undated")).textContent).toContain("הכנסת");
    const reveals: Array<{ line: number; endLine: number }> = [];
    const on = (e: Event) => reveals.push((e as CustomEvent).detail);
    window.addEventListener("lumen-reveal-line", on);
    fireEvent.click(screen.getByRole("button", { name: /notes\/a#\^p1/ }));
    await waitFor(() => expect(useAppStore.getState().doc.workspaceName).toBe("notes/a.md"));
    window.removeEventListener("lumen-reveal-line", on);
    expect(reveals[0]).toMatchObject({ line: 5, endLine: 5 });
    expect(closed).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Back to the graph" }));
  });

  it("exports the graph as JSON-LD from the screen, as a download (W12.E8)", async () => {
    await writeVault(VAULT);
    const blobs: Blob[] = [];
    const orig = URL.createObjectURL;
    URL.createObjectURL = ((b: Blob) => (blobs.push(b), "blob:x")) as typeof URL.createObjectURL;
    try {
      render(<EntityGraphScreen onClose={() => {}} initialMode="table" />);
      const sel = await screen.findByTestId("entity-graph-export");
      fireEvent.change(sel, { target: { value: "jsonld" } });
      await waitFor(() => expect(blobs.length).toBe(1));
      const doc = JSON.parse(await blobs[0].text());
      expect(JSON.stringify(doc)).toContain("דנה כהן");
    } finally {
      URL.createObjectURL = orig;
    }
  });

  it("an empty vault says what to do", async () => {
    render(<EntityGraphScreen onClose={() => {}} initialMode="table" />);
    expect((await screen.findByTestId("entity-graph-empty")).textContent).toMatch(/No entities or citations yet/);
  });
});

describe("one built-in source type (W12.X2's reading list meets W12.E1's entities)", () => {
  it("declared once, with the reading list's fields and the entity's wikidata", () => {
    const defs = builtinTypes();
    expect(defs.filter((d) => d.id === "source")).toHaveLength(1);
    const reg = loadTypeRegistry([], defs);
    expect(reg.errors).toEqual([]);
    const names = reg.get("source")!.effective.map((f) => f.name);
    expect(names).toEqual(expect.arrayContaining(["status", "kind", "progress", "page", "pages", "rating", "citekey", "file", "wikidata"]));
  });
});
