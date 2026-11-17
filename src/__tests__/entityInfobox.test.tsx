/**
 * W13.G6 — the entity infobox: the model for a person, a place and an
 * organization (the type's fields from the note and the approved relations,
 * five key relations, the picture); `![[Entity]]` embeds as the card; a
 * hover on `[[Entity]]` shows it; in RTL the card sits on the right; axe
 * clean. Synthetic vault in a fake OPFS.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import { unified } from "unified";
import remarkParse from "remark-parse";
import type { Root } from "mdast";
import { installFakeOpfs } from "./helpers/fakeOpfs";
import { writeWorkspaceFile } from "../storage/workspace";
import { __resetWorkspaceIndex, ensureIndex } from "../storage/workspaceIndex";
import { ENTITY_FOLDERS, infoboxImage, infoboxModel, isEntityNotePath, relationFields } from "../entities/infobox";
import { edgeId, entityId, TYPE_INFO, type Edge, type Entity, type EntityType } from "../entities/model";
import { EDGES_PATH, readEdges, toJsonl } from "../entities/store";
import { makeProvenance } from "../entities/provenance";
import { createEmbedContext, ENTITY_EMBED_FOLDERS, isEntityEmbed } from "../renderer/embeds";
import { EntityInfobox } from "../ui/entity/EntityInfobox";
import EntityInfoboxEmbed, { entityContext, infoboxFor } from "../ui/entity/EntityInfoboxBlock";
import infoboxCss from "../ui/entity/entityInfobox.css?raw";

vi.mock("../ui/AiToast", () => ({ showAiToast: vi.fn() }));

const ent = (type: EntityType, name: string, aliases: string[] = []): Entity => ({ id: entityId(type, name), type, name, aliases });
const edge = (s: string, p: string, o: string, confidence: number, status: Edge["status"] = "approved", anchor = "a1"): Edge => ({
  id: edgeId(s, p, o, "יומן/א.md", anchor),
  subject: s,
  predicate: p,
  object: o,
  confidence,
  status,
  provenance: makeProvenance({ note: "יומן/א.md", anchor, paragraph: "פסקה על דוד בן-גוריון וחבריו.", quote: "דוד בן-גוריון", extractor: "lumen-relations@1", model: null, date: new Date("2026-11-01T00:00:00Z") }),
});

const david = ent("person", "דוד בן-גוריון", ["בן-גוריון"]);
const haifa = ent("place", "חיפה");
const israel = ent("place", "ישראל");
const mapai = ent("organization", "מפא״י");
const histadrut = ent("organization", "ההסתדרות");
const paula = ent("person", "פולה בן-גוריון");
const sde = ent("place", "שדה בוקר");
const plonsk = ent("place", "פלונסק");
const weizmann = ent("person", "חיים ויצמן");
const ALL = [david, haifa, israel, mapai, histadrut, paula, sde, plonsk, weizmann];
const EDGES: Edge[] = [
  edge(david.id, "born_in", plonsk.id, 0.95),
  edge(david.id, "member_of", mapai.id, 0.9),
  edge(david.id, "spouse", paula.id, 0.92),
  edge(david.id, "related_to", sde.id, 0.8),
  edge(david.id, "related_to", sde.id, 0.7, "approved", "a2"),
  edge(weizmann.id, "related_to", david.id, 0.85),
  edge(mapai.id, "founded_by", david.id, 0.9),
  edge(david.id, "related_to", haifa.id, 0.3, "proposed"),
  edge(david.id, "related_to", israel.id, 0.99, "rejected"),
  edge(histadrut.id, "related_to", david.id, 0.6),
  edge(haifa.id, "located_in", israel.id, 0.99),
  edge(mapai.id, "headquarters", israel.id, 0.6),
  edge(mapai.id, "related_to", histadrut.id, 0.8),
];
const nameOf = (id: string) => ALL.find((e) => e.id === id)?.name;
const idOf = (n: string) => ALL.find((e) => e.name === n)?.id;

const NOTE_DAVID = `---\ntype: person\nentity-type: person\naliases: [בן-גוריון]\nborn: 1886-10-16\ndied: 1973-12-01\noccupation: ראש ממשלה\nemployer: ["[[ההסתדרות]]"]\nimage: "[[תמונות/בן-גוריון.png]]"\n---\n\n# דוד בן-גוריון\n`;
const NOTE_HAIFA = `---\nentity-type: place\npopulation: 290000\ncountry: ישראל\n---\n\n# חיפה\n\n![[תמונות/חיפה.jpg]]\n`;
const NOTE_MAPAI = `---\nentity-type: organization\nfounded: 1930\n---\n\n# מפא״י\n`;

describe("the model, for three types", () => {
  it("the synthetic relations are valid ones (the vault reader keeps all of them)", () => {
    expect(readEdges(toJsonl(EDGES)).edges).toHaveLength(EDGES.length);
  });
  it("a person: born, died, occupation, born in, works for (from the note), member of and spouse (from approved relations)", () => {
    const m = infoboxModel({ entity: david, noteText: NOTE_DAVID, edges: EDGES, nameOf, idOf });
    const rows = Object.fromEntries(m.rows.map((r) => [r.label, r.values.map((v) => v.text)]));
    expect(rows).toEqual({
      "entityGraph.infobox.born": ["1886-10-16"],
      "entityGraph.infobox.died": ["1973-12-01"],
      "entityGraph.infobox.occupation": ["ראש ממשלה"],
      "entityGraph.predicate.born_in": ["פלונסק"],
      "entityGraph.predicate.member_of": ["מפא״י"],
      "entityGraph.predicate.employer": ["ההסתדרות"],
      "entityGraph.predicate.spouse": ["פולה בן-גוריון"],
    });
    expect(m.rows.find((r) => r.label === "entityGraph.predicate.employer")!.values[0].id).toBe(histadrut.id);
    expect(m.image).toBe("תמונות/בן-גוריון.png");
  });
  it("key relations: at most five, one per other entity, approved and sure first, never a rejected one, never an entity already in a field", () => {
    const m = infoboxModel({ entity: david, noteText: NOTE_DAVID, edges: EDGES, nameOf, idOf });
    const others = m.key.map((k) => k.other);
    expect(others.length).toBeLessThanOrEqual(5);
    expect(others).not.toContain(israel.id); // rejected
    expect(others).not.toContain(plonsk.id); // already the "born in" field
    expect(others).not.toContain(paula.id); // already the "spouse" field
    expect(others).not.toContain(mapai.id); // already "member of" (also founded by him)
    expect(others).toEqual([sde.id, weizmann.id, haifa.id]);
    expect(others.indexOf(haifa.id)).toBe(others.length - 1); // proposed, doubtful: last
    expect(m.key.find((k) => k.other === sde.id)!.count).toBe(2);
    expect(m.key.find((k) => k.other === weizmann.id)!.outgoing).toBe(false); // the relation points at him
    expect(infoboxModel({ entity: david, noteText: NOTE_DAVID, edges: EDGES, nameOf, idOf, maxKey: 2 }).key).toHaveLength(2);
  });
  it("a place: country, population, located in; the picture from the body", () => {
    const m = infoboxModel({ entity: haifa, noteText: NOTE_HAIFA, edges: EDGES, nameOf, idOf });
    expect(m.rows.map((r) => [r.label, r.values.map((v) => v.text)])).toEqual([
      ["entityGraph.infobox.country", ["ישראל"]],
      ["entityGraph.infobox.population", ["290000"]],
      ["entityGraph.predicate.located_in", ["ישראל"]],
    ]);
    expect(m.image).toBe("תמונות/חיפה.jpg");
  });
  it("an organization: founded, founded by, headquarters; key relations include the ones that point at it", () => {
    const m = infoboxModel({ entity: mapai, noteText: NOTE_MAPAI, edges: EDGES, nameOf, idOf });
    expect(m.rows.map((r) => r.label)).toEqual(["entityGraph.infobox.founded", "entityGraph.predicate.founded_by", "entityGraph.predicate.headquarters"]);
    // Founded by David (a field, though "founded by" may also name an organization); ההסתדרות is a key relation.
    expect(m.rows.find((r) => r.label === "entityGraph.predicate.founded_by")!.values.map((v) => v.text)).toEqual(["דוד בן-גוריון"]);
    expect(m.key.map((k) => [k.other, k.edge.predicate, k.outgoing])).toEqual([[histadrut.id, "related_to", true]]);
    expect(m.image).toBeNull();
  });
  it("a note-less entity, a broken note: what the relations give, nothing invented", () => {
    const m = infoboxModel({ entity: paula, edges: EDGES, nameOf });
    expect(m.rows).toEqual([]);
    expect(m.key.map((k) => k.other)).toEqual([david.id]);
    const broken = infoboxModel({ entity: haifa, noteText: "---\n: : :\n---\n", edges: [], nameOf });
    expect(broken.rows).toEqual([]);
  });
  it("relation fields follow the type registry; picture keys and embeds; an http picture is kept as a URL", () => {
    expect(relationFields("person")).toEqual(expect.arrayContaining(["born_in", "employer", "spouse"]));
    expect(relationFields("place")).not.toContain("born_in");
    expect(infoboxImage({ cover: "a.webp" }, "")).toBe("a.webp");
    expect(infoboxImage({}, "text ![alt](img/b.png) more")).toBe("img/b.png");
    expect(infoboxImage({}, "![[doc.pdf]] ![[c.gif|200]]")).toBe("c.gif");
  });
});

describe("the embed", () => {
  const parse = (md: string) => unified().use(remarkParse).parse(md) as Root;
  type HNode = { type: string; data?: { hName?: string; hProperties?: Record<string, unknown> }; children?: HNode[] };
  const find = (n: HNode, name: string): HNode[] => [...(n.data?.hName === name ? [n] : []), ...(n.children ?? []).flatMap((c) => find(c, name))];
  const expand = (host: string, files: Record<string, string>) => {
    const ctx = createEmbedContext({ hostPath: "host.md", hostText: host, files: Object.entries(files).map(([path, content]) => ({ path, content })), notice: (k) => k });
    const tree = parse(host);
    ctx.expand(tree, parse);
    return tree as unknown as HNode;
  };
  it("the renderer's folder list is the entity model's", () => {
    expect(ENTITY_EMBED_FOLDERS).toEqual(ENTITY_FOLDERS);
    expect(ENTITY_FOLDERS).toEqual(Object.values(TYPE_INFO).map((t) => t.folder));
  });
  it("![[Entity]] of an entity note becomes the infobox; a section of it, or an ordinary note, stays a normal embed", () => {
    const files = { "ישויות/אנשים/דוד בן-גוריון.md": NOTE_DAVID, "ישויות/אנשים/סתם.md": "# לא ישות\n", "רשימות/דוד.md": NOTE_DAVID };
    const tree = expand("![[דוד בן-גוריון]]\n\n![[דוד בן-גוריון#דוד בן-גוריון]]\n\n![[סתם]]\n\n![[רשימות/דוד]]\n", files);
    const boxes = find(tree, "lumen-entity-infobox");
    expect(boxes).toHaveLength(1);
    expect(boxes[0].data!.hProperties).toEqual({ path: "ישויות/אנשים/דוד בן-גוריון.md", text: NOTE_DAVID });
    expect(find(tree, "div").filter((d) => (d.data?.hProperties?.className as string[] | undefined)?.includes("lumen-embed"))).toHaveLength(3);
  });
  it("isEntityEmbed: the folder and an entity-type in the front matter, not in the body", () => {
    expect(isEntityEmbed("ישויות/מקומות/חיפה.md", NOTE_HAIFA)).toBe(true);
    expect(isEntityEmbed("ישויות/מקומות/חיפה.md", "# חיפה\n\nentity-type: place\n")).toBe(false);
    expect(isEntityEmbed("ישויות/מקומות/חיפה.md", "---\ntitle: x\n---\nentity-type: place\n")).toBe(false);
    expect(isEntityEmbed("ישויות/חיפה.md", NOTE_HAIFA)).toBe(false);
    expect(isEntityNotePath("ישויות/ארגונים/מפא״י.md")).toBe(true);
    expect(isEntityNotePath("ישויות/אחר/x.md")).toBe(false);
  });
});

async function axeClean(el: Element) {
  const r = await axe.run(el, { rules: { "color-contrast": { enabled: false } } });
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

describe("the card, in Hebrew", () => {
  beforeEach(() => {
    document.documentElement.dir = "rtl";
    document.documentElement.lang = "he";
  });
  afterEach(() => {
    cleanup();
    document.documentElement.dir = "";
  });
  const files = new Map([
    ["ישויות/אנשים/דוד בן-גוריון.md", NOTE_DAVID],
    ["ישויות/מקומות/חיפה.md", NOTE_HAIFA],
    ["ישויות/ארגונים/מפא״י.md", NOTE_MAPAI],
    ["ישויות/ארגונים/ההסתדרות.md", "---\nentity-type: organization\n---\n"],
    ["ישויות/מקומות/ישראל.md", "---\nentity-type: place\n---\n"],
    [EDGES_PATH, toJsonl(EDGES)],
  ]);
  it("three types render as tables with row headers, the names as links to their notes; axe clean", async () => {
    const ctx = entityContext(files);
    for (const [path, text, rows] of [
      ["ישויות/אנשים/דוד בן-גוריון.md", NOTE_DAVID, 7],
      ["ישויות/מקומות/חיפה.md", NOTE_HAIFA, 3],
      ["ישויות/ארגונים/מפא״י.md", NOTE_MAPAI, 3],
    ] as const) {
      const { container, unmount } = render(infoboxFor(ctx, path, text)!);
      const box = within(container).getByTestId("entity-infobox");
      expect(box.tagName).toBe("ASIDE");
      expect(box.getAttribute("dir")).toBe("rtl");
      expect(within(box).getAllByRole("rowheader")).toHaveLength(rows);
      await axeClean(container);
      unmount();
    }
    const { container } = render(infoboxFor(ctx, "ישויות/אנשים/דוד בן-גוריון.md", NOTE_DAVID)!);
    const link = within(container).getByText("ההסתדרות");
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("data-wiki-target")).toBe("ישויות/ארגונים/ההסתדרות");
    expect(container.querySelector("caption")!.textContent).toBe("דוד בן-גוריון");
  });
  it("sits on the right in RTL (and in LTR, as Wikipedia does), full width on a phone", async () => {
    // Vite and the browser runner give `?raw` as text; an offline Node runner may give the CSS module instead.
    const cssText = typeof infoboxCss === "string" ? infoboxCss : (await import("node:fs")).readFileSync(new URL("../ui/entity/entityInfobox.css", import.meta.url), "utf8");
    expect(cssText).toMatch(/\.lumen-infobox \{[^}]*float: right;/);
    expect(cssText).toMatch(/@media \(max-width: 560px\) \{ \.lumen-infobox \{ float: none;/);
    const style = document.createElement("style");
    style.textContent = cssText;
    document.head.append(style);
    const m = infoboxModel({ entity: haifa, noteText: NOTE_HAIFA, edges: EDGES, nameOf, idOf });
    const { container } = render(
      <div dir="rtl" style={{ inlineSize: 800 }}>
        <EntityInfobox model={m} dir="rtl" />
        <p>טקסט</p>
      </div>,
    );
    const box = container.querySelector(".lumen-infobox") as HTMLElement;
    // In a real layout engine (Chromium) the card's right edge is the container's; happy-dom has no layout.
    if (box.getBoundingClientRect().width > 0) {
      expect(getComputedStyle(box).float).toBe("right");
      expect(Math.round(box.getBoundingClientRect().right)).toBe(Math.round((container.firstChild as HTMLElement).getBoundingClientRect().right));
      expect(box.getBoundingClientRect().width).toBeLessThanOrEqual(300);
    }
    style.remove();
  });
  it("an empty card says so; a picture shows when the vault has it", async () => {
    const lone = infoboxModel({ entity: ent("concept", "רעיון"), edges: [], nameOf });
    render(<EntityInfobox model={lone} />);
    expect(screen.getByText(/entityGraph\.infobox\.empty|אין עדיין|No fields or relations yet/)).toBeTruthy();
    cleanup();
    const m = infoboxModel({ entity: david, noteText: NOTE_DAVID, edges: EDGES, nameOf, idOf });
    render(<EntityInfobox model={m} resolveImage={async (p) => (p === "תמונות/בן-גוריון.png" ? "blob:pic" : undefined)} />);
    await waitFor(() => expect(screen.getByRole("img").getAttribute("src")).toBe("blob:pic"));
  });
});

describe("in the app: embed and hover read the vault", () => {
  beforeAll(async () => {
    installFakeOpfs();
    __resetWorkspaceIndex();
    await writeWorkspaceFile("ישויות/אנשים/דוד בן-גוריון.md", NOTE_DAVID);
    await writeWorkspaceFile("ישויות/ארגונים/מפא״י.md", NOTE_MAPAI);
    await writeWorkspaceFile("ישויות/ארגונים/ההסתדרות.md", "---\nentity-type: organization\n---\n");
    await writeWorkspaceFile("ישויות/מקומות/פלונסק.md", "---\nentity-type: place\n---\n");
    await writeWorkspaceFile(EDGES_PATH, toJsonl(EDGES));
    await writeWorkspaceFile("יומן/א.md", "פגשתי את [[דוד בן-גוריון]] היום.\n");
    await ensureIndex(true);
  });
  afterEach(() => cleanup());
  it("the embed component loads the relations and shows the card", async () => {
    render(<EntityInfoboxEmbed path="ישויות/אנשים/דוד בן-גוריון.md" text={NOTE_DAVID} />);
    await waitFor(() => expect(screen.getByText("מפא״י").tagName).toBe("A"));
    expect(screen.getAllByRole("rowheader").length).toBe(7);
    expect(screen.getByTestId("entity-infobox").getAttribute("data-entity")).toBe(david.id);
    expect(screen.getByText("פלונסק").getAttribute("data-wiki-target")).toBe("ישויות/מקומות/פלונסק");
  });
  it("hovering [[Entity]] shows its infobox instead of the note's first lines", async () => {
    const { renderPreview } = await import("../renderer/hoverPreview");
    const el = await renderPreview("דוד בן-גוריון");
    expect(el).not.toBeNull();
    render(el!);
    const box = screen.getByTestId("entity-infobox");
    expect(box.className).toContain("is-hover");
    expect(within(box).getByText("1886-10-16")).toBeTruthy();
  });
});
