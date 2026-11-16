/**
 * Plan W10.C28 (audit W7.24): "@מקור" typed in the editor opens the
 * open-sources dialog, and the dialog's online search also asks Sefaria's
 * text search for free text (only on request, through the gated fetch).
 * The Sefaria response below is SYNTHETIC, in the Elasticsearch shape of
 * POST /api/search-wrapper (hits.hits[]._source.ref, highlight).
 */
import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { openSourcesTrigger, triggerAtEnd } from "../editor/triggers";
import { SEFARIA_SEARCH, searchOnline, searchSefariaText } from "../sources/open/search";

const flush = () => new Promise((r) => setTimeout(r, 0));

function editor(open: () => void) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({ state: EditorState.create({ doc: "", extensions: [openSourcesTrigger(open)] }), parent });
  const type = async (text: string, userEvent = "input.type") => {
    for (const ch of userEvent === "input.type" ? [...text] : [text]) view.dispatch({ changes: { from: view.state.doc.length, insert: ch }, selection: { anchor: view.state.doc.length + ch.length }, userEvent });
    await flush();
  };
  return { view, type };
}

describe("the @מקור trigger", () => {
  it("is a word of its own at the cursor", () => {
    expect(triggerAtEnd("@מקור")).toBe("@מקור");
    expect(triggerAtEnd("ראו @מקור")).toBe("@מקור");
    expect(triggerAtEnd("(@source")).toBe("@source");
    expect(triggerAtEnd("tal@מקור")).toBeNull(); // an address, not a trigger
    expect(triggerAtEnd("@מקורות")).toBeNull();
  });

  it("typing it opens the dialog once and removes it; pasting it does not", async () => {
    let opened = 0;
    const { view, type } = editor(() => opened++);
    await type("כתוב ב");
    await type(" @מקור");
    await flush();
    expect(opened).toBe(1);
    expect(view.state.doc.toString()).toBe("כתוב ב ");
    await type(" @מקור", "input.paste");
    expect(opened).toBe(1);
    await type(" mail@source");
    expect(opened).toBe(1);
    view.destroy();
  });
});

describe("Sefaria free-text search", () => {
  const body = {
    hits: {
      hits: [
        { _id: "Genesis 1:1 (The Koren Jerusalem Bible)", _source: { ref: "Genesis 1:1", heRef: "בראשית א׳:א׳" }, highlight: { naive_lemmatizer: ["<b>בראשית</b> ברא אלהים"] } },
        { _source: { ref: "Genesis 1:1" }, highlight: {} },
        { _source: { ref: "Some Unknown Book 3:4" } },
        { _id: "Psalms 23:1 (Miqra according to the Masorah)" },
      ],
    },
  };

  it("posts only the query; keeps references Lumen knows, once each; snippets without markup", async () => {
    const sent: Array<{ url: string; method?: string; body: unknown }> = [];
    const f = (async (u: RequestInfo | URL, init?: RequestInit) => (sent.push({ url: String(u), method: init?.method, body: JSON.parse(String(init?.body)) }), new Response(JSON.stringify(body)))) as typeof fetch;
    const hits = await searchSefariaText("בראשית ברא", f);
    expect(sent).toEqual([{ url: SEFARIA_SEARCH, method: "POST", body: { query: "בראשית ברא", type: "text", field: "naive_lemmatizer", size: 10, slop: 10, source_proj: ["ref", "heRef"] } }]);
    expect(hits.map((h) => [h.ref.key, h.snippet])).toEqual([
      ["Genesis.1.1", "בראשית ברא אלהים"],
      ["Psalms.23.1", ""],
    ]);
  });

  it("the open-sources online search asks Sefaria only for free text, and only when Sefaria is on", async () => {
    const urls: string[] = [];
    const f = (async (u: RequestInfo | URL) => (urls.push(String(u)), new Response(JSON.stringify(body)))) as typeof fetch;
    const on = { sefaria: true, knesset: false, datagov: false, benyehuda: false };
    const r = await searchOnline("בראשית ברא", on, f);
    expect(r.map((x) => [x.source, x.kind, x.title, x.rights, x.local])).toEqual([
      ["sefaria", "verse", "בראשית א׳:א׳", "link-only", false],
      ["sefaria", "verse", "תהלים כ״ג:א׳", "link-only", false],
    ]);
    expect(urls).toEqual([SEFARIA_SEARCH]);
    await searchOnline("בראשית א:א", on, f); // a reference: answered on the device, no search request
    await searchOnline("בראשית ברא", { ...on, sefaria: false }, f);
    expect(urls).toEqual([SEFARIA_SEARCH]);
  });
});
