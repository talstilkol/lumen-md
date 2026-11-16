/**
 * W5.1 through the app's own modules, on a real vault (OPFS): the paths the
 * palette commands and the graph view call, not the pure helpers the unit
 * tests (sefariaSources, sefariaRefTrigger) exercise.
 *
 *  - The 50 reference formats, as typed at the end of a line, through the
 *    editor's trigger (findTypedRef) — at least 48 give the right verse.
 *  - Lookup → the user's yes → one request through the privacy ledger →
 *    "save for offline" writes the source note into the vault; the second
 *    lookup, with the network gone, makes 0 requests and asks nothing.
 *  - "My notes on this verse" (notesOnVerse) reads the vault: the notes that
 *    cite the verse in any spelling, not the source note itself.
 *  - The graph view's data (loadVaultGraph, over the vault index): notes
 *    that link one verse in two spellings meet at the verse's node.
 *
 * Needs a browser with OPFS (navigator.storage.getDirectory): headless
 * Chromium in the offline shim or vitest's browser mode.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fixture from "./fixtures/sefaria/refs.json";
import { findTypedRef } from "../editor/refTrigger";
import { lookup, notesOnVerse, parseSourceRef, saveForOffline } from "../sources/sefaria/app";
import { sourceNotePath } from "../sources/sefaria/store";
import { writeWorkspaceFile, readWorkspaceFile, workspaceHasFile, isOPFSAvailable } from "../storage/workspace";
import { loadVaultGraph } from "../ui/graph/graphData";

const FORMATS = (fixture as { items: Array<{ input: string; tref: string }> }).items;
const HE = "בְּרֵאשִׁ֖ית בָּרָ֣א אֱלֹהִ֑ים אֵ֥ת הַשָּׁמַ֖יִם וְאֵ֥ת הָאָֽרֶץ׃";
const RESPONSE = {
  ref: "Genesis 1:1",
  heRef: "בראשית א׳:א׳",
  versions: [
    { text: HE, language: "he", actualLanguage: "he", direction: "rtl", versionTitle: "Miqra according to the Masorah", versionSource: "https://he.wikisource.org/wiki/User:Dovi/Miqra_according_to_the_Masorah", license: "CC-BY-SA", isSource: true },
    { text: "When God began to create heaven and earth", language: "en", actualLanguage: "en", direction: "ltr", versionTitle: "The Contemporary Torah, Jewish Publication Society, 2006", versionSource: "https://jps.org", license: "CC-BY-NC", isSource: false },
  ],
};

const hasOpfs = typeof navigator !== "undefined" && !!navigator.storage?.getDirectory && !/happy-dom|jsdom/i.test(navigator.userAgent);
const requests: string[] = [];
let network: "up" | "down" = "up";
const realFetch = globalThis.fetch;

// skip-reason: OPFS (navigator.storage.getDirectory) is in real browsers only; Node and jsdom have none, so the file runs in the Chromium runner | task: W5.1 | until: 2027-05-16
describe.skipIf(!hasOpfs)("Sefaria sources in the app, on a real vault (W5.1)", () => {
  beforeAll(async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      requests.push(url);
      if (network === "down") throw new TypeError("Failed to fetch");
      if (/sefaria\.org\/api\//.test(url)) return new Response(JSON.stringify(RESPONSE), { status: 200, headers: { "content-type": "application/json" } });
      return new Response("not here", { status: 404 });
    }) as typeof fetch;
    // A fresh vault: the notes this test writes and nothing else.
    const root = await navigator.storage.getDirectory();
    for await (const name of (root as unknown as { keys(): AsyncIterable<string> }).keys()) await root.removeEntry(name, { recursive: true });
  });
  afterAll(() => {
    globalThis.fetch = realFetch;
  });

  it("the vault is OPFS", () => {
    expect(isOPFSAvailable()).toBe(true);
  });

  it("50 reference formats typed at the end of a line: at least 48 give the right verse through the editor trigger", () => {
    expect(FORMATS).toHaveLength(50);
    const right = FORMATS.filter(({ input, tref }) => {
      const before = `כתוב ב-${input}`;
      const typed = findTypedRef(before, parseSourceRef);
      const parsed = typed?.ref ?? parseSourceRef(input);
      return parsed?.tref === tref;
    });
    expect(right.length).toBeGreaterThanOrEqual(48);
  });

  it("lookup asks once, sends one request; saved for offline, the second lookup makes 0 requests and asks nothing", async () => {
    const ref = parseSourceRef("בראשית א:א")!;
    let asked = 0;
    requests.length = 0;
    const first = await lookup(ref, async () => (asked++, true));
    expect(asked).toBe(1);
    expect(first?.from).toBe("network");
    expect(requests.filter((u) => u.includes("sefaria.org"))).toHaveLength(1);
    // Nothing is in the vault until the user saves it.
    expect(await workspaceHasFile(sourceNotePath(ref))).toBe(false);
    const path = await saveForOffline(first!.passage);
    expect(path).toBe(sourceNotePath(ref));
    const note = await readWorkspaceFile(path!);
    expect(note).toContain(HE);
    expect(note).toContain('license: "CC-BY-SA"');
    expect(note).not.toContain("When God began");

    network = "down";
    requests.length = 0;
    const second = await lookup(ref, async () => (asked++, true));
    expect(second?.from).toBe("vault");
    expect(requests).toHaveLength(0);
    expect(asked).toBe(1);
    network = "up";
  });

  it("declined: no request at all", async () => {
    requests.length = 0;
    const r = await lookup(parseSourceRef("שמות כ:ג")!, async () => false);
    expect(r).toBeNull();
    expect(requests).toHaveLength(0);
  });

  it("My notes on this verse: the notes that cite it, in any spelling, from the vault", async () => {
    await writeWorkspaceFile("Torah/creation.md", "על [[בראשית א:א]] כתב רש״י…\n");
    await writeWorkspaceFile("Torah/english.md", "See [[Genesis 1:1|the first verse]].\n");
    await writeWorkspaceFile("Torah/other.md", "[[שמות כ:ג]]\n");
    const notes = await notesOnVerse(parseSourceRef("Genesis 1:1")!);
    expect([...notes].sort()).toEqual(["Torah/creation.md", "Torah/english.md"]);
  });

  it("the graph view: both spellings meet at the verse's node, the saved source note", async () => {
    const graph = await loadVaultGraph();
    const verse = graph.paths.indexOf("Sources/Sefaria/Genesis.1.1.md");
    expect(verse).toBeGreaterThanOrEqual(0);
    const linked = [...graph.neighbors.slice(graph.offsets[verse], graph.offsets[verse + 1])].map((i) => graph.paths[i]).sort();
    expect(linked).toEqual(["Torah/creation.md", "Torah/english.md"]);
    // Exodus 20:3 has no saved note: a node of its own, labelled in Hebrew, linked from other.md.
    const exodus = graph.paths.indexOf("Sources/Sefaria/Exodus.20.3.md");
    expect(exodus).toBeGreaterThanOrEqual(0);
    expect(graph.labels[exodus]).toMatch(/שמות/);
    expect([...graph.neighbors.slice(graph.offsets[exodus], graph.offsets[exodus + 1])].map((i) => graph.paths[i])).toEqual(["Torah/other.md"]);
  });
});
