/**
 * W12.R1 — PDF highlight cards on the canvas: the card's link is the
 * highlight's own fragment (the one the reader opens and re-anchors), it
 * round-trips through JSON Canvas as a file node with a subpath, and a
 * card whose highlight was deleted is marked, not removed.
 */
import { describe, expect, it } from "vitest";
import { DELETED_MARK, highlightCard, highlightCardLink, markSourceDeleted, parseCardLink } from "../canvas/highlightCards";
import { excalidrawToJsonCanvas, jsonCanvasToExcalidraw } from "../canvas/jsonCanvas";
import { parsePdfFragment, shortId } from "../pdf/annotations";
import type { ExcalidrawElement } from "../canvas/tldrawToExcalidraw";

const ID = "urn:uuid:3f2a9c1e-7b44-4c1d-9e2a-0d5b6c7a8e90";
const drag = { pdf: "מאמרים/כהן 2020.pdf", id: ID, page: 14, quote: "הקריאה היא שיחה עם הטקסט, לא העתקה שלו." };
const pageWord = (n: number) => `עמ׳ ${n}`;

describe("card links", () => {
  it("are the highlight's fragment, which the reader parses to the same page and highlight", () => {
    const link = highlightCardLink(drag);
    expect(link).toBe(`מאמרים/כהן 2020.pdf#page=14&highlight=${shortId(ID)}`);
    const c = parseCardLink(link)!;
    expect(c).toEqual({ path: "מאמרים/כהן 2020.pdf", fragment: `page=14&highlight=${shortId(ID)}`, page: 14, highlight: shortId(ID) });
    expect(parsePdfFragment(c.fragment)).toMatchObject({ page: 14, highlight: shortId(ID) });
  });

  it("read annotation= as a synonym, and nothing that is not a PDF highlight", () => {
    expect(parseCardLink("a.pdf#page=2&annotation=abc")?.highlight).toBe("abc");
    expect(parseCardLink("a.pdf#page=2")).toBeNull();
    expect(parseCardLink("note.md#page=2&highlight=x")).toBeNull();
    expect(parseCardLink("https://e.com/a.pdf")).toBeNull();
    expect(parseCardLink("lumen-note:x.md")).toBeNull();
  });
});

describe("the card", () => {
  it("is a rectangle with the quote and the page bound in it, right-aligned for Hebrew", () => {
    const [rect, text] = highlightCard(drag, { x: 100, y: 50 }, pageWord, 0);
    expect(rect).toMatchObject({ type: "rectangle", x: 100, y: 50, link: highlightCardLink(drag), boundElements: [{ id: text.id, type: "text" }] });
    expect(text).toMatchObject({ type: "text", containerId: rect.id, textAlign: "right" });
    expect(text.text.split("\n").at(-1)).toBe("— עמ׳ 14");
    expect(text.text).toContain("הקריאה היא שיחה");
    expect(highlightCard({ ...drag, quote: "Reading is a conversation" }, { x: 0, y: 0 }, (n) => `p. ${n}`, 0)[1].textAlign).toBe("left");
  });

  it("goes into JSON Canvas as a file node with the highlight as its subpath, and comes back with the same link", () => {
    const els = highlightCard(drag, { x: 0, y: 0 }, pageWord, 0) as unknown as ExcalidrawElement[];
    const { canvas } = excalidrawToJsonCanvas({ elements: els, appState: {} } as never);
    const node = canvas.nodes.find((n) => n.type === "file")!;
    expect(node).toMatchObject({ type: "file", file: "מאמרים/כהן 2020.pdf", subpath: `#page=14&highlight=${shortId(ID)}` });
    const back = jsonCanvasToExcalidraw(canvas, { noteCards: true }).file.elements.find((e) => e.type === "rectangle")!;
    expect(parseCardLink(back.link)).toMatchObject({ path: "מאמרים/כהן 2020.pdf", page: 14, highlight: shortId(ID) });
  });
});

describe("a deleted highlight", () => {
  it("marks its card (dashed, a first line saying so) instead of removing it, and unmarks it if it comes back", () => {
    const els = [...highlightCard(drag, { x: 0, y: 0 }, pageWord, 0), ...highlightCard({ ...drag, id: "urn:uuid:aaaaaaaa-0000", pdf: "other.pdf" }, { x: 400, y: 0 }, pageWord, 0)];
    const gone = markSourceDeleted(els, new Map([["מאמרים/כהן 2020.pdf", new Set<string>()]]), "המקור נמחק");
    expect(gone.changed).toBe(2);
    expect(gone.elements).toHaveLength(4);
    expect(gone.elements[0]).toMatchObject({ strokeStyle: "dashed", opacity: 60 });
    expect((gone.elements[1] as { text: string }).text.startsWith(`${DELETED_MARK} המקור נמחק\n`)).toBe(true);
    // The other PDF's highlights were not read: its card is left alone.
    expect(gone.elements.slice(2)).toEqual(els.slice(2));
    expect(markSourceDeleted(gone.elements, new Map([["מאמרים/כהן 2020.pdf", new Set<string>()]]), "המקור נמחק").changed).toBe(0);
    const back = markSourceDeleted(gone.elements, new Map([["מאמרים/כהן 2020.pdf", new Set([ID])]]), "המקור נמחק");
    expect(back.changed).toBe(2);
    expect((back.elements[1] as { text: string }).text).toBe((els[1] as { text: string }).text);
    expect(back.elements[0]).toMatchObject({ strokeStyle: "solid", opacity: 100 });
  });
});
