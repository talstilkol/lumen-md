/**
 * Plan W10.C24 (audit W5.1): typing a source reference offers its text, with
 * no request before the user says yes; "My notes on this verse" is a side
 * panel that follows the cursor; verses are graph nodes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { findTypedRef, onCursorVerse, sefariaRefTrigger, type RefSuggestion } from "../editor/refTrigger";
import { parseSourceRef, type SourceRef } from "../sources/sefaria/refs";
import { withVerseNodes } from "../graph/nodes";
import { buildGraph, neighborsOf } from "../graph/graphModel";
import { VersePanel } from "../sources/sefaria/VersePanel";

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

function editor(insert: (v: EditorView, s: RefSuggestion) => Promise<void>) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({ state: EditorState.create({ doc: "", extensions: [sefariaRefTrigger({ parse: parseSourceRef, insert })] }), parent });
  const type = async (text: string) => {
    for (const ch of text) view.dispatch({ changes: { from: view.state.doc.length, insert: ch }, selection: { anchor: view.state.doc.length + ch.length }, userEvent: "input.type" });
    await flush();
  };
  return { view, parent, type };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("findTypedRef: the reference that ends at the cursor", () => {
  it("finds full references in Hebrew and English, after other words; a bare chapter is not offered", () => {
    expect(findTypedRef("בראשית א ג", parseSourceRef)).toMatchObject({ start: 0, ref: { tref: "Genesis 1:3" } });
    expect(findTypedRef("כמו שכתוב בבראשית א ג", parseSourceRef)).toBeNull(); // "בבראשית" is not a book name
    expect(findTypedRef("כמו שכתוב: בראשית א ג", parseSourceRef)).toMatchObject({ text: "בראשית א ג", ref: { tref: "Genesis 1:3" } });
    expect(findTypedRef("see Gen. 1:3", parseSourceRef)).toMatchObject({ text: "Gen. 1:3", ref: { tref: "Genesis 1:3" } });
    expect(findTypedRef("שמות כ׳:ב׳", parseSourceRef)?.ref.tref).toBe("Exodus 20:2");
    expect(findTypedRef("ברכות ב.", parseSourceRef)?.ref.tref).toBe("Berakhot 2a");
    expect(findTypedRef("בראשית א", parseSourceRef)).toBeNull();
    expect(findTypedRef("[[בראשית א ג", parseSourceRef)).toBeNull(); // inside a link being typed
    expect(findTypedRef("`בראשית א ג", parseSourceRef)).toBeNull(); // inside code
    expect(findTypedRef("סתם משפט בלי הפניה", parseSourceRef)).toBeNull();
  });
});

describe("the editor suggestion", () => {
  it("typing \"בראשית א ג\" offers the quote, and nothing is sent until Insert", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const inserted: RefSuggestion[] = [];
    const { view, parent, type } = editor(async (_v, s) => void inserted.push(s));
    await type("וכתוב: בראשית א ג");
    const box = parent.ownerDocument.querySelector("[data-testid=sefaria-suggest]");
    expect(box?.textContent).toContain("בראשית א׳:ג׳");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(inserted).toEqual([]);
    // Insert (the click is the consent): the typed range and the parsed reference.
    fireEvent.click(parent.ownerDocument.querySelector("[data-testid=sefaria-suggest-insert]")!);
    await flush();
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ from: 7, to: 17, text: "בראשית א ג", ref: { key: "Genesis.1.3" } });
    view.destroy();
    fetchSpy.mockRestore();
  });

  it("0 requests while typing 20 references; Alt+Enter inserts, Escape dismisses for that reference", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const inserted: RefSuggestion[] = [];
    const { view, type } = editor(async (_v, s) => void inserted.push(s));
    const refs = ["בראשית א ג", "שמות כ ב", "ויקרא יט יח", "במדבר ו כד", "דברים ו ד", "תהלים כג א", "משלי ג ה", "ישעיהו ב ד", "ירמיהו לא טו", "איוב א כא", "Gen. 1:1", "Exodus 3:14", "Psalms 23:1", "Deut. 6:4", "ברכות ב.", "שבת לא.", "קהלת א ב", "רות א טז", "שיר השירים ב א", "יונה א ג"];
    for (const r of refs) await type(` ${r}\n`);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(inserted).toEqual([]);
    await type("דברים ו ה");
    const esc = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    view.contentDOM.dispatchEvent(esc);
    await flush();
    expect(document.querySelector("[data-testid=sefaria-suggest]")).toBeNull();
    // Moving away and back to the dismissed reference does not reopen it.
    view.dispatch({ selection: { anchor: 0 } });
    await flush();
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    await flush();
    expect(document.querySelector("[data-testid=sefaria-suggest]")).toBeNull();
    await type("\nמשלי א ז");
    view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", altKey: true, bubbles: true, cancelable: true }));
    await flush();
    expect(inserted.map((s) => s.ref.tref)).toEqual(["Proverbs 1:7"]);
    expect(fetchSpy).not.toHaveBeenCalled(); // the insert here is the test's; the app's goes through lookup()
    view.destroy();
    fetchSpy.mockRestore();
  });

  it("publishes the verse under the cursor, typed or in a [[link]]", async () => {
    const seen: Array<string | null> = [];
    const off = onCursorVerse((r) => seen.push(r?.key ?? null));
    const { view, type } = editor(async () => {});
    await type("ראו [[דברים ו:ד]] ועוד");
    view.dispatch({ selection: { anchor: 8 } });
    await flush();
    expect(seen).toContain("Deuteronomy.6.4");
    off();
    view.destroy();
  });
});

describe("verses as graph nodes", () => {
  it("two spellings of one verse meet at one node with its Hebrew label; other links are untouched", () => {
    const notes = [
      { path: "a.md", wikiTargets: ["בראשית א:א", "b"] },
      { path: "b.md", wikiTargets: ["Genesis 1:1|the first verse"] },
      { path: "c.md", wikiTargets: ["ברכות ב."] },
    ];
    const g = buildGraph(withVerseNodes(notes, parseSourceRef));
    expect(g.paths).toEqual(["a.md", "b.md", "c.md", "Sources/Sefaria/Genesis.1.1.md", "Sources/Sefaria/Berakhot.2a.md"]);
    const verse = g.indexOf.get("Sources/Sefaria/Genesis.1.1.md")!;
    expect(g.labels[verse]).toBe("בראשית א׳:א׳");
    expect(g.props[verse]).toMatchObject({ type: "verse", sefaria: "Genesis 1:1" });
    expect([...neighborsOf(g, verse)].map((i) => g.paths[i]).sort()).toEqual(["a.md", "b.md"]);
    expect([...neighborsOf(g, g.indexOf.get("a.md")!)].map((i) => g.paths[i]).sort()).toEqual(["Sources/Sefaria/Genesis.1.1.md", "b.md"]);
  });

  it("a saved source note is the verse's node (no second node)", () => {
    const notes = [
      { path: "Sources/Sefaria/Genesis.1.1.md", wikiTargets: [] },
      { path: "a.md", wikiTargets: ["בראשית א:א"] },
    ];
    const g = buildGraph(withVerseNodes(notes, parseSourceRef));
    expect(g.paths).toHaveLength(2);
    expect([...neighborsOf(g, 0)].map((i) => g.paths[i])).toEqual(["a.md"]);
  });
});

describe("My notes on this verse: a side panel that follows the cursor", () => {
  it("lists the notes citing the verse, follows a new verse, opens a note, closes", async () => {
    const gen = parseSourceRef("בראשית א:א")!;
    const ex = parseSourceRef("שמות כ:ב")!;
    let push: (r: SourceRef | null) => void = () => {};
    const follow = (fn: (r: SourceRef | null) => void) => ((push = fn), () => {});
    const notesFor = vi.fn(async (r: SourceRef) => (r.key === gen.key ? ["notes/creation.md", "notes/light.md"] : []));
    const opened: string[] = [];
    const onClose = vi.fn();
    render(<VersePanel initial={gen} notesFor={notesFor} onOpen={(p) => opened.push(p)} onClose={onClose} follow={follow} />);
    await act(async () => flush());
    expect(screen.getByTestId("verse-panel-list").textContent).toContain("notes/creation.md");
    fireEvent.click(screen.getByText("notes/light.md"));
    expect(opened).toEqual(["notes/light.md"]);
    await act(async () => (push(ex), flush()));
    expect(screen.getByTestId("verse-panel-empty")).toBeTruthy();
    await act(async () => (push(null), flush())); // moving off every verse keeps the last one
    expect(notesFor.mock.calls.map((c) => c[0].key)).toEqual(["Genesis.1.1", "Exodus.20.2"]);
    fireEvent.click(screen.getByTestId("verse-panel-close"));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
