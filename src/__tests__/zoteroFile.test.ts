/**
 * Plan W5.23: Zotero by file, with no api.zotero.org and nothing fetched.
 * The fixtures are written in the shapes Zotero 7's exporters produce (CSL
 * JSON, BibTeX, RIS); a real export from the owner's library is owed on
 * the Mac (plan/mac-pack/FC2.json, FC2.zotero-file).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectFormat, identities, mergeZoteroImport, parseRis, parseZoteroExport, recordToCsl, toRis, ZoteroFileError } from "../citations/zoteroFile";
import { exportForZotero, importZoteroFile, libraryCsl, type ZoteroFileDeps } from "../citations/zoteroFileRun";
import { fromBibtex, fromCslJson, ZOTERO_FILE } from "../citations/library";
import type { CslItem } from "../citations/csl";

const CSL = JSON.stringify([
  { id: "http://zotero.org/users/1/items/ABCD1234", type: "article-journal", title: "Reading Hebrew right to left", author: [{ family: "Cohen", given: "Dana" }], issued: { "date-parts": [[2021, 3]] }, "container-title": "Journal of Scripts", volume: "12", page: "1-20", DOI: "10.1000/xyz123", note: "Citation Key: cohen2021" },
  { id: "http://zotero.org/users/1/items/EFGH5678", type: "book", title: "ספר הדקדוק", author: [{ family: "לוי", given: "משה" }], issued: { "date-parts": [[1999]] }, publisher: "מאגנס", language: "he" },
]);

const BIB = `@article{cohen2021,
  title = {Reading {Hebrew} Right to Left},
  author = {Cohen, Dana and Katz, Ron},
  year = {2021},
  journal = {Journal of Scripts},
  volume = {12},
  pages = {1--20},
  doi = {10.1000/xyz123}
}
@book{levi1999,
  title = {ספר הדקדוק},
  author = {לוי, משה},
  year = {1999},
  publisher = {מאגנס},
  langid = {hebrew}
}
`;

const RIS = ["TY  - JOUR", "TI  - Reading Hebrew right to left", "AU  - Cohen, Dana", "AU  - Katz, Ron", "PY  - 2021", "T2  - Journal of Scripts", "VL  - 12", "SP  - 1", "EP  - 20", "DO  - https://doi.org/10.1000/xyz123", "N1  - Citation Key: cohen2021", "ER  - ", "", "TY  - BOOK", "TI  - ספר הדקדוק", "AU  - לוי, משה", "PY  - 1999", "PB  - מאגנס", "LA  - he", "ER  - ", ""].join("\r\n");

describe("reading an export", () => {
  it("tells the three formats apart by their text", () => {
    expect(detectFormat("x.json", CSL)).toBe("csl-json");
    expect(detectFormat("x.bib", BIB)).toBe("bibtex");
    expect(detectFormat("export.txt", RIS)).toBe("ris");
    expect(detectFormat("notes.md", "# a note")).toBeNull();
    expect(() => parseZoteroExport("notes.md", "# a note")).toThrow(ZoteroFileError);
    expect(() => parseZoteroExport("x.json", "[{")).toThrow(/json/);
    expect(() => parseZoteroExport("x.json", "[]")).toThrow(/empty/);
  });

  it("CSL JSON, BibTeX and RIS give the same keys, titles and years", () => {
    const keysOf = (items: CslItem[]) => fromCslJson(JSON.stringify(items), "x.csl.json").map((i) => [i.key, i.record.title, i.record.year]);
    const csl = keysOf(parseZoteroExport("a.json", CSL).items);
    const bib = parseZoteroExport("a.bib", BIB).items;
    const ris = parseZoteroExport("a.ris", RIS).items;
    expect(csl[0]).toEqual(["cohen2021", "Reading Hebrew right to left", "2021"]);
    expect(bib.map((i) => i["citation-key"])).toEqual(["cohen2021", "levi1999"]);
    expect(bib[1]).toMatchObject({ title: "ספר הדקדוק", publisher: "מאגנס", language: "hebrew", author: [{ family: "לוי", given: "משה" }] });
    expect(ris[0]).toMatchObject({ "citation-key": "cohen2021", DOI: "10.1000/xyz123", page: "1-20", "container-title": "Journal of Scripts", author: [{ family: "Cohen", given: "Dana" }, { family: "Katz", given: "Ron" }] });
    expect(ris[1]).toMatchObject({ type: "book", title: "ספר הדקדוק", language: "he" });
  });

  it("RIS out and back keeps what a citation needs, the key included", () => {
    const items = parseZoteroExport("a.json", CSL).items.map((it, i) => (i === 0 ? { ...it, "citation-key": "cohen2021" } : it));
    const back = parseRis(toRis(items));
    expect(back.map((b) => [b.title, b["citation-key"], b.DOI, b.page])).toEqual([
      ["Reading Hebrew right to left", "cohen2021", "10.1000/xyz123", "1-20"],
      ["ספר הדקדוק", undefined, undefined, undefined],
    ]);
  });

  it("a BibTeX library exported for Zotero keeps its keys when it comes back", () => {
    const lib = fromBibtex(BIB, "refs.bib");
    const out = libraryCsl(lib);
    expect(out.map((o) => o["citation-key"])).toEqual(["cohen2021", "levi1999"]);
    const again = fromCslJson(JSON.stringify(out), ZOTERO_FILE, "zotero");
    expect(again.map((a) => a.key)).toEqual(["cohen2021", "levi1999"]);
    expect(again[0]!.record.pages).toBe("1–20");
    expect(recordToCsl("k", lib[0]!.record).page).toBe("1-20");
  });
});

describe("merging into the vault's copy", () => {
  const lib = (n: number, rev = 0): CslItem[] =>
    Array.from({ length: n }, (_, i) => ({ id: `http://zotero.org/users/1/items/K${i}`, type: "article-journal", title: `Paper ${i}${rev && i % 100 === 0 ? " (revised)" : ""}`, author: [{ family: `Author${i}`, given: "A" }], issued: { "date-parts": [[2000 + (i % 25)]] }, note: `Citation Key: key${i}` }));

  it("matches by key, then Zotero id, then DOI, then title and year", () => {
    expect(identities({ id: "z1", title: "T", DOI: "10.1/AB", issued: { "date-parts": [[2020]] }, note: "Citation Key: k1" })).toEqual(["k:k1", "i:z1", "d:10.1/ab", "t:t|2020"]);
  });

  it("1,000 items: the first import adds all; the second adds only what changed; well under 60 s", () => {
    const t0 = performance.now();
    const first = mergeZoteroImport([], lib(1000));
    expect(first).toMatchObject({ added: 1000, updated: 0, unchanged: 0, missing: 0 });
    const second = mergeZoteroImport(first.items, [...lib(1000, 1), ...lib(1002).slice(1000)]);
    expect(second).toMatchObject({ added: 2, updated: 10, unchanged: 990, missing: 0 });
    expect(second.items).toHaveLength(1002);
    expect(second.items[100]!.title).toBe("Paper 100 (revised)");
    expect(performance.now() - t0).toBeLessThan(5000);
  });

  it("a collection's export does not delete the rest, unless asked", () => {
    const all = mergeZoteroImport([], lib(10)).items;
    const kept = mergeZoteroImport(all, lib(3));
    expect(kept).toMatchObject({ unchanged: 3, missing: 7, removed: 0 });
    expect(kept.items).toHaveLength(10);
    const gone = mergeZoteroImport(all, lib(3), { removeMissing: true });
    expect(gone).toMatchObject({ removed: 7 });
    expect(gone.items.map((i) => i.title)).toEqual(["Paper 0", "Paper 1", "Paper 2"]);
  });
});

describe("the commands, on this device only", () => {
  let files: Map<string, string>;
  let toasts: Array<[string, string]>;
  let downloads: Array<{ name: string; text: string; type: string }>;
  let answer: boolean;
  const deps = (pick: { name: string; text: string } | null): ZoteroFileDeps => ({
    pick: async () => pick,
    read: async (p) => files.get(p) ?? null,
    write: async (p, text) => void files.set(p, text),
    confirm: async () => answer,
    toast: (m, k) => void toasts.push([k, m]),
    download: (name, text, type) => void downloads.push({ name, text, type }),
    library: async () => fromCslJson(files.get(ZOTERO_FILE) ?? "[]", ZOTERO_FILE, "zotero"),
  });
  const fetchSpy = vi.fn(async () => {
    throw new Error("no network in the Zotero file path");
  });
  beforeEach(() => {
    files = new Map();
    toasts = [];
    downloads = [];
    answer = false;
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("imports a CSL JSON export into the Zotero copy the cite dialog reads, then nothing on the same file", async () => {
    const r = await importZoteroFile(deps({ name: "My Library.json", text: CSL }));
    expect(r).toMatchObject({ added: 2 });
    expect(fromCslJson(files.get(ZOTERO_FILE)!, ZOTERO_FILE, "zotero").map((i) => i.key)).toEqual(["cohen2021", expect.stringMatching(/^לוי1999|^\S+1999/)]);
    expect(toasts.at(-1)).toEqual(["success", expect.stringContaining("2 added")]);
    const before = files.get(ZOTERO_FILE);
    files.set("marker", "x");
    const again = await importZoteroFile(deps({ name: "My Library.json", text: CSL }));
    expect(again).toMatchObject({ added: 0, updated: 0, unchanged: 2 });
    expect(files.get(ZOTERO_FILE)).toBe(before);
    expect(toasts.at(-1)![0]).toBe("info");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("asks before removing sources the file lacks, and says why a file was refused", async () => {
    await importZoteroFile(deps({ name: "a.json", text: CSL }));
    const one = JSON.stringify(JSON.parse(CSL).slice(0, 1));
    expect(await importZoteroFile(deps({ name: "one.json", text: one }))).toMatchObject({ missing: 1, removed: 0 });
    answer = true;
    expect(await importZoteroFile(deps({ name: "one.json", text: one }))).toMatchObject({ removed: 1 });
    expect(JSON.parse(files.get(ZOTERO_FILE)!)).toHaveLength(1);
    expect(await importZoteroFile(deps({ name: "x.docx", text: "PK\u0003\u0004" }))).toBeNull();
    expect(toasts.at(-1)).toEqual(["error", expect.stringContaining("CSL JSON, BibTeX or RIS")]);
    expect(await importZoteroFile(deps(null))).toBeNull();
  });

  it("exports the vault's sources as CSL JSON and RIS that read back with the same keys", async () => {
    await importZoteroFile(deps({ name: "a.bib", text: BIB }));
    expect(await exportForZotero("csl-json", deps(null))).toBe(2);
    expect(await exportForZotero("ris", deps(null))).toBe(2);
    const [json, ris] = downloads;
    expect(json).toMatchObject({ name: "lumen-sources.json", type: "application/json" });
    expect(ris!.name).toBe("lumen-sources.ris");
    expect(parseZoteroExport(json!.name, json!.text).items.map((i) => i["citation-key"])).toEqual(["cohen2021", "levi1999"]);
    expect(parseZoteroExport(ris!.name, ris!.text).items.map((i) => i["citation-key"])).toEqual(["cohen2021", "levi1999"]);
    files.clear();
    expect(await exportForZotero("csl-json", deps(null))).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
