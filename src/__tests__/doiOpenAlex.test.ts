/**
 * D1 §6 (16.11.2026): "Cite from a DOI" through OpenAlex while CrossRef stays
 * off. Nothing is sent with the OpenAlex switch off, nothing without the
 * user's yes for this lookup, only the DOI to api.openalex.org (already in
 * the CSP), and CrossRef stays out of the CSP and off.
 * @vitest-environment node
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CROSSREF_HOST, CROSSREF_LOOKUP_ENABLED } from "../citations/doi";
import { OPENALEX_HOST, OpenAlexDoiNotFoundError, lookupDoiViaOpenAlex, recordFromOpenAlex, splitName, type OpenAlexWork } from "../citations/doiOpenAlex";

const ROOT = resolve(__dirname, "..", "..");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

// A work in the shape GET /works/doi:<doi> returns (synthetic, written for this test).
const WORK: OpenAlexWork = {
  doi: "https://doi.org/10.1234/abc.5",
  title: "Reading <i>Hebrew</i>  notes",
  type: "article",
  publication_year: 2021,
  authorships: [{ author: { display_name: "Ada M. Lovelace" } }, { author: { display_name: "Turing, Alan" } }, { author: null, raw_author_name: "Hopper" }],
  primary_location: { source: { display_name: "Journal of Notes", host_organization_name: "Example Press" } },
  biblio: { volume: "12", issue: "3", first_page: "45", last_page: "67" },
};
const ok = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe("Cite from a DOI via OpenAlex (D1 §6)", () => {
  it("maps an OpenAlex work to the reference record", () => {
    expect(recordFromOpenAlex(WORK)).toEqual({
      type: "article",
      authors: [{ family: "Lovelace", given: "Ada M." }, { family: "Turing", given: "Alan" }, { family: "Hopper" }],
      title: "Reading Hebrew notes",
      year: "2021",
      container: "Journal of Notes",
      publisher: "Example Press",
      volume: "12",
      issue: "3",
      pages: "45–67",
      doi: "10.1234/abc.5",
    });
    expect(splitName("  ")).toBeNull();
    expect(recordFromOpenAlex({ type: "book", title: "B", primary_location: { source: { display_name: "Series" } } })).toMatchObject({ type: "book", title: "B" });
    expect(recordFromOpenAlex({ type: "book", title: "B", primary_location: { source: { display_name: "Series" } } }).container).toBeUndefined();
  });

  it("sends nothing and asks nothing while the OpenAlex switch is off", async () => {
    const fetch = ok(WORK);
    const confirm = vi.fn(async () => true);
    expect(await lookupDoiViaOpenAlex("10.1234/abc.5", { enabled: () => false, confirm, fetch })).toEqual({ status: "off" });
    expect(confirm).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("with the switch on, asks first; declined or not a DOI, nothing is sent", async () => {
    const fetch = ok(WORK);
    expect(await lookupDoiViaOpenAlex("10.1234/abc.5", { enabled: () => true, confirm: async () => false, fetch })).toEqual({ status: "declined" });
    expect(await lookupDoiViaOpenAlex("not a doi", { enabled: () => true, confirm: async () => true, fetch })).toEqual({ status: "invalid" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("accepted: one GET to api.openalex.org with only the DOI, and the record back", async () => {
    const fetch = ok(WORK);
    const confirm = vi.fn(async () => true);
    const r = await lookupDoiViaOpenAlex("https://doi.org/10.1234/abc.5", { enabled: () => true, confirm, fetch });
    expect(confirm).toHaveBeenCalledWith("10.1234/abc.5");
    expect(r).toMatchObject({ status: "done", record: { doi: "10.1234/abc.5", year: "2021" } });
    expect(fetch).toHaveBeenCalledTimes(1);
    const url = new URL(String((fetch.mock.calls[0] as unknown[])[0]));
    expect(url.host).toBe(OPENALEX_HOST);
    expect(url.pathname).toBe("/works/doi:10.1234%2Fabc.5");
    expect([...url.searchParams.keys()]).toEqual(["select"]);
    await expect(lookupDoiViaOpenAlex("10.1000/x", { enabled: () => true, confirm, fetch: ok({}, 404) })).rejects.toBeInstanceOf(OpenAlexDoiNotFoundError);
  });

  it("needs no CSP change: api.openalex.org is already allowed, api.crossref.org is not, and CrossRef stays off", () => {
    const policy = read("security/policy.json");
    expect(policy).toContain(`"https://${OPENALEX_HOST}"`);
    expect(policy).not.toContain(CROSSREF_HOST);
    expect(CROSSREF_LOOKUP_ENABLED).toBe(false);
    // The command goes to OpenAlex when CrossRef is off, behind the OpenAlex switch.
    const run = read("src/citations/run.ts");
    expect(run).toContain("if (!CROSSREF_LOOKUP_ENABLED) return citeFromDoiViaOpenAlex();");
    expect(run).toContain('if (!openAlexEnabled()) return showAiToast(t("cite.doi.openAlexOff"), "info");');
  });

  it("its strings are in all 8 languages, and the drafts are listed for native review", () => {
    const keys = ["cite.doi.openAlexOff", "cite.doi.consent.title.openAlex", "cite.doi.consent.message.openAlex", "cite.doi.notFound.openAlex"];
    const en = JSON.parse(read("src/i18n/lazy/citations.json"));
    const review = JSON.parse(read("i18n/needs-review/common.json"));
    for (const k of keys) {
      expect(en[k], k).toBeTruthy();
      for (const lang of ["he", "ar", "ru", "fr", "de", "ja", "zh-CN"]) {
        expect(JSON.parse(read(`src/i18n/locales/${lang}/common.json`))[k], `${lang} ${k}`).toBeTruthy();
        // Hebrew is reviewed by hand (W13.I6): it is never left listed as a draft.
        if (lang === "he") expect(review[k]?.he, `needs-review he ${k}`).toBeUndefined();
        else expect(review[k]?.[lang], `needs-review ${lang} ${k}`).toBeTruthy();
      }
    }
  });
});
