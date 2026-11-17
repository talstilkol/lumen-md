/**
 * Review 12, L4: "Cite from a DOI" through OpenAlex (D1 §6) was logged in the
 * privacy ledger under the citation graph's reason ("the references of a
 * DOI"), so the user could not tell the two lookups apart. Each now has its
 * own entry, read from the request each one really makes; both stay in the
 * research category (a local-only policy blocks both).
 */
import { describe, expect, it } from "vitest";
import { classify } from "../ai/privacyLedger";
import { lookupDoiViaOpenAlex } from "../citations/doiOpenAlex";
import { openAlexReferences } from "../citations/openAlex";

/** The URL a lookup requests, from a fetch that records it. */
async function urlOf(run: (f: typeof fetch) => Promise<unknown>): Promise<string> {
  let seen = "";
  const f = (async (u: RequestInfo | URL) => {
    seen = String(u);
    return Response.json({ referenced_works: [], title: "T", authorships: [] });
  }) as typeof fetch;
  await run(f);
  return seen;
}

describe("the OpenAlex DOI lookup has its own ledger reason (review 12, L4)", () => {
  it("cite-from-DOI and the citation graph are told apart; both are research", async () => {
    const cite = await urlOf((f) => lookupDoiViaOpenAlex("10.1000/xyz123", { enabled: () => true, confirm: async () => true, fetch: f }));
    const graph = await urlOf((f) => openAlexReferences("10.1000/xyz123", { consent: true, fetch: f, mailto: "me@example.org" }));
    expect(cite).toMatch(/^https:\/\/api\.openalex\.org\/works\/doi:/);
    expect(graph).toMatch(/^https:\/\/api\.openalex\.org\/works\/doi:/);
    expect(classify(cite)).toMatchObject({ category: "research", reason: expect.stringMatching(/cite from a DOI/) });
    expect(classify(graph)).toMatchObject({ category: "research", reason: expect.stringMatching(/citation graph/) });
    expect(classify("https://api.openalex.org/works?filter=openalex:W1&select=id,doi")?.reason).toMatch(/citation graph/);
  });
});
