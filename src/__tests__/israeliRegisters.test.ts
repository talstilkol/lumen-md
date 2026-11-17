/**
 * Plan R12.19: the non-profits and companies registers (data.gov.il) and
 * Reshumot links, each with a licence light.
 *
 * The register answers are SYNTHETIC (fixtures/registers/*.synthetic.json:
 * invented organisations in the CKAN datastore_search shape, labelled so in
 * the files). A recorded live answer is owed: the network is closed to the
 * build that wrote this. A small CKAN stand-in below answers `filters` and
 * `q` over those rows the way datastore_search does, so the request and
 * parsing code under test is the real one.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatNumber, lookupUrl, parseLookup, registerNumber, REGISTERS_REASON, sourceNote } from "../sources/registers/ckanRegister";
import { AMUTOT, searchAmutot } from "../sources/amutot/register";
import { COMPANIES, searchCompanies } from "../sources/companies/register";
import { parseYalkutRef, yalkutCitation, yalkutUrl } from "../sources/reshumot/yalkut";
import { mayBundle, REGISTER_TERMS } from "../sources/open/rights";
import { searchLocal, searchOnline, type LocalSources } from "../sources/open/search";
import { dialogFetch } from "../sources/open/app";
import { saveSourceNote } from "../sources/registers/app";
import { __resetLedger, ledgerEntries } from "../ai/privacyLedger";

const F = (name: string) => JSON.parse(readFileSync(join(__dirname, "fixtures", "registers", name), "utf8"));
const ANSWERS: Record<string, { success: boolean; result: { records: Array<Record<string, unknown>> } }> = {
  [AMUTOT.resourceId]: F("amutot.datastore.synthetic.json"),
  [COMPANIES.resourceId]: F("companies.datastore.synthetic.json"),
};

const requested: string[] = [];
/** datastore_search over the synthetic rows: `filters` match a field exactly, `q` needs every word somewhere in the row. */
const ckan: typeof fetch = async (input) => {
  const url = new URL(String(input instanceof Request ? input.url : input));
  requested.push(url.href);
  const answer = ANSWERS[url.searchParams.get("resource_id") ?? ""];
  if (!answer) return new Response(JSON.stringify({ success: false, error: { message: "Not found" } }), { status: 404 });
  let rows = answer.result.records;
  const filters = url.searchParams.get("filters");
  if (filters) for (const [k, v] of Object.entries(JSON.parse(filters) as Record<string, unknown>)) rows = rows.filter((r) => r[k] === v);
  const q = url.searchParams.get("q");
  if (q) rows = rows.filter((r) => q.split(/\s+/).every((w) => Object.values(r).some((v) => String(v ?? "").includes(w))));
  return new Response(JSON.stringify({ success: true, result: { ...answer.result, records: rows, total: rows.length } }), { status: 200, headers: { "content-type": "application/json" } });
};

const OFF = { sefaria: false, knesset: false, datagov: false, benyehuda: false, registers: false };
const ON = { ...OFF, registers: true };

beforeEach(() => {
  requested.length = 0;
});

describe("registers: search by name and by number (R12.19)", () => {
  it("reads a registration number however it is typed", () => {
    expect(registerNumber("58-000000-1")).toBe("580000001");
    expect(registerNumber("580000001")).toBe("580000001");
    expect(registerNumber("58000000")).toBeNull();
    expect(registerNumber("עמותה")).toBeNull();
    expect(formatNumber("580000001")).toBe("58-000000-1");
  });

  it("a number is a filter on the number field; a name is a full-text query", () => {
    const byNumber = new URL(lookupUrl(AMUTOT, "58-000000-1"));
    expect(byNumber.origin + byNumber.pathname).toBe("https://data.gov.il/api/3/action/datastore_search");
    expect(byNumber.searchParams.get("resource_id")).toBe(AMUTOT.resourceId);
    expect(JSON.parse(byNumber.searchParams.get("filters")!)).toEqual({ "מספר עמותה": 580000001 });
    expect(byNumber.searchParams.has("q")).toBe(false);
    const byName = new URL(lookupUrl(AMUTOT, "חינוך"));
    expect(byName.searchParams.get("q")).toBe("חינוך");
  });

  it("finds a non-profit by name and by number against the recorded (synthetic) answer", async () => {
    const byName = await searchAmutot("חינוך", ckan);
    expect(byName.map((r) => r.number)).toEqual(["580000001", "580000003"]);
    expect(byName[0]).toMatchObject({ name: "עמותת דוגמה לחינוך מדעי", nameEn: "Example Science Education Association", status: "רשומה", url: "https://data.gov.il/dataset/moj-amutot" });
    const byNumber = await searchAmutot("58-000000-2", ckan);
    expect(byNumber).toHaveLength(1);
    expect(byNumber[0]).toMatchObject({ number: "580000002", status: "מחוקה" });
  });

  it("finds a company the same way", async () => {
    expect((await searchCompanies("החזקות", ckan)).map((r) => r.number)).toEqual(["520000002"]);
    expect((await searchCompanies("510000001", ckan))[0]).toMatchObject({ name: 'דוגמה טכנולוגיות בע"מ', status: "פעילה" });
  });

  it("a row without a number is attributed to nobody; a CKAN error is an error", () => {
    const rows = parseLookup(AMUTOT, "שורה", F("amutot.datastore.synthetic.json"));
    expect(rows).toEqual([]);
    expect(() => parseLookup(AMUTOT, "x", { success: false, error: { message: "Not authorized" } })).toThrow("Not authorized");
  });

  it("the dialog's online search sends a number only to the register it belongs to", async () => {
    const out = await searchOnline("58-000000-1", ON, ckan, "register");
    expect(requested).toHaveLength(1);
    expect(new URL(requested[0]).searchParams.get("resource_id")).toBe(AMUTOT.resourceId);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ source: "registers", kind: "register", title: "עמותת דוגמה לחינוך מדעי", rights: "gov-open", local: false });
    requested.length = 0;
    await searchOnline("דוגמה", ON, ckan, "register");
    expect(requested.map((u) => new URL(u).searchParams.get("resource_id")).sort()).toEqual([AMUTOT.resourceId, COMPANIES.resourceId].sort());
  });

  it("an off source is sent nothing", async () => {
    expect(await searchOnline("דוגמה", OFF, ckan)).toEqual([]);
    expect(requested).toEqual([]);
  });
});

describe("every network call is in the privacy ledger (R12.19)", () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    __resetLedger();
    localStorage.setItem("lumen.openSources", JSON.stringify({ registers: true }));
    globalThis.fetch = ckan;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    localStorage.removeItem("lumen.openSources");
    __resetLedger();
  });

  it("a register lookup through the dialog's fetch is consented traffic under the registers' reason", async () => {
    const out = await searchOnline("דוגמה", ON, dialogFetch(async () => true), "register");
    expect(out.length).toBeGreaterThan(0);
    const mine = ledgerEntries().filter((e) => e.host === "data.gov.il");
    expect(mine).toHaveLength(requested.length);
    expect(mine.length).toBe(2);
    for (const e of mine) expect(e).toMatchObject({ reason: REGISTERS_REASON, category: "cloud-text", decision: "allowed" });
  });

  it("declined: nothing is sent and nothing is recorded", async () => {
    await expect(searchOnline("דוגמה", ON, dialogFetch(async () => false), "register")).rejects.toThrow("declined");
    expect(requested).toEqual([]);
    expect(ledgerEntries().filter((e) => e.host === "data.gov.il")).toEqual([]);
  });

  it("with the registers switched off, the dialog's fetch refuses the request", async () => {
    localStorage.setItem("lumen.openSources", JSON.stringify({ registers: false }));
    await expect(searchOnline("דוגמה", ON, dialogFetch(async () => true), "register")).rejects.toThrow(/off/);
    expect(requested).toEqual([]);
  });
});

describe("licence lights and terms (R12.19)", () => {
  it("every source has a light, its terms page and what it allows", () => {
    for (const t of Object.values(REGISTER_TERMS)) {
      expect(["green", "amber", "red"]).toContain(t.light);
      expect(t.termsUrl).toMatch(/^https:\/\//);
      expect(t.noteHe.length).toBeGreaterThan(10);
      expect(t.noteEn.length).toBeGreaterThan(10);
      // Not read live from here: no date is claimed.
      expect(t.checked).toBeNull();
    }
    expect(REGISTER_TERMS.amutot).toMatchObject({ light: "green", rights: "gov-open", commercial: true });
    expect(REGISTER_TERMS.reshumot).toMatchObject({ light: "amber", rights: "link-only", commercial: false });
  });

  it("a non-commercial source never goes into a commercial bundle", () => {
    expect(mayBundle(REGISTER_TERMS.reshumot)).toBe(false);
    expect(mayBundle(REGISTER_TERMS.companies)).toBe(true);
    expect(mayBundle({ ...REGISTER_TERMS.companies, light: "red" })).toBe(false);
  });

  it("each register result carries its terms for the dialog to show", async () => {
    const [r] = await searchOnline("510000001", ON, ckan, "register");
    expect(r.terms).toBe(REGISTER_TERMS.companies);
  });
});

describe("a result is a source note with a quote and the retrieval date (R12.19)", () => {
  it("quotes the record field by field, with the credit, the date and the terms", async () => {
    const [rec] = await searchAmutot("58-000000-1", ckan);
    const note = sourceNote(rec, "2026-11-15");
    expect(note.content).toMatch(/^---\ntype: source\nregister: amutot\nnumber: "580000001"\n/);
    expect(note.content).toContain("retrieved: 2026-11-15");
    expect(note.content).toContain("licence-light: green");
    expect(note.content).toContain("> **שם עמותה בעברית:** עמותת דוגמה לחינוך מדעי");
    expect(note.content).toContain("> **סטטוס עמותה:** רשומה");
    expect(note.content).toContain("נשלף 2026-11-15");
    expect(note.content).toContain("https://data.gov.il/terms");
    expect(note.content).toContain("לא נתון שמתעדכן");
    expect(note.path).toBe("Sources/amutot/עמותת דוגמה לחינוך מדעי 580000001.md");
  });

  it("is written once per record and day, and the asking note gets a link", async () => {
    const [rec] = await searchAmutot("58-000000-1", ckan);
    const files = new Map<string, string>();
    const deps = { retrieved: "2026-11-15", has: async (p: string) => files.has(p), write: async (p: string, c: string) => void files.set(p, c) };
    const a = await saveSourceNote(rec, deps);
    const b = await saveSourceNote(rec, deps);
    expect([a.written, b.written]).toEqual([true, false]);
    expect(files.size).toBe(1);
    expect(a.link).toBe("[[Sources/amutot/עמותת דוגמה לחינוך מדעי 580000001 2026-11-15|עמותת דוגמה לחינוך מדעי]]");
  });
});

describe("Reshumot: a Yalkut HaPirsumim reference is a link, nothing is fetched (R12.19)", () => {
  it("reads the usual forms of a reference", () => {
    expect(parseYalkutRef("י״פ 11234")).toEqual({ issue: 11234, page: null });
    expect(parseYalkutRef('י"פ 11234')).toEqual({ issue: 11234, page: null });
    expect(parseYalkutRef("ילקוט הפרסומים 11234, עמ' 5678")).toEqual({ issue: 11234, page: 5678 });
    expect(parseYalkutRef("Yalkut 9876 p. 12")).toEqual({ issue: 9876, page: 12 });
    expect(parseYalkutRef("ילקוט")).toBeNull();
  });

  it("a local result with the amber light, and a link-only citation", () => {
    const src: LocalSources = { enabled: ON, laws: [], library: null };
    const [r] = searchLocal("י״פ 11234", src, "gazette");
    expect(r).toMatchObject({ source: "registers", kind: "gazette", rights: "link-only", local: true, url: yalkutUrl(11234) });
    expect(r.terms?.light).toBe("amber");
    expect(yalkutCitation({ issue: 11234, page: 5678 })).toBe(
      `[ילקוט הפרסומים 11234, עמ׳ 5678](${yalkutUrl(11234)}) — מקור: ${REGISTER_TERMS.reshumot.he} · [תנאי השימוש](${REGISTER_TERMS.reshumot.termsUrl})`,
    );
    expect(searchLocal("י״פ 11234", { ...src, enabled: OFF }, "gazette")).toEqual([]);
  });
});
