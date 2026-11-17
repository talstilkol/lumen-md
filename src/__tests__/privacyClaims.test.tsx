/**
 * Plan W4.29, audit r2: the privacy policy said Wikidata was refused under
 * `local-only` while the code sent it (Z7-M3), and privacyDoc.test.ts did not
 * notice — it checks that every route is *named*, not that what the policy
 * *says about it* is what the code *does*. This ties the policy's
 * `local-only` claims to behaviour, both ways:
 *
 *   - PRIVACY.md and PRIVACY.he.md agree, route by route, on which routes are
 *     refused under `local-only` even with the user's consent;
 *   - every such claim has a behavioural check here, run against the real code
 *     (the component or the function that sends), which must find it refused;
 *   - every check that finds a route refused is claimed in both documents.
 *
 * A new "refused even with consent" sentence in either policy without a check
 * fails; a check whose code starts sending fails; the code refusing a route the
 * policy says goes, fails.
 */
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, render } from "@testing-library/react";
import { setAiPolicy } from "../ai/policy";
import { LEDGER_REASON as WIKIDATA_REASON, setWikidataAlways } from "../entities/wikidata";
import { WikidataLink } from "../ui/WikidataLink";

const ROOT = join(__dirname, "..", "..");
const EN = readFileSync(join(ROOT, "PRIVACY.md"), "utf8");
const HE = readFileSync(join(ROOT, "PRIVACY.he.md"), "utf8");

/** The ledger names of the table rows that say "refused under local-only, whatever you agreed". */
export function refusedRoutes(doc: string, lang: "en" | "he"): string[] {
  const claim = lang === "en" ? /Refused under the `local-only` policy/i : /נחסם במדיניות `local-only`/;
  return doc
    .split("\n")
    .filter((l) => l.startsWith("|") && claim.test(l))
    .map((l) => /\| `([^`]+)`/.exec(l)?.[1] ?? `?? ${l.slice(0, 60)}`);
}

/** Behavioural checks: under `local-only`, with every consent the user can give, does the route send? */
const CHECKS: Record<string, () => Promise<"refused" | "sent">> = {
  [WIKIDATA_REASON]: async () => {
    setAiPolicy("local-only");
    setWikidataAlways(true); // "always on this device" — the strongest consent there is
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return new Response(JSON.stringify({ search: [] }));
    }) as unknown as typeof fetch;
    const vault = { readWorkspaceFile: async () => "---\ntype: person\n---\n# דוד\n", writeWorkspaceFile: async () => undefined } as never;
    const view = render(<WikidataLink name="דוד בן-גוריון" path="people/דוד.md" onClose={() => {}} fetchImpl={fetchImpl} vault={vault} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    // Press every button the dialog offers (search, "this once", "always"…): still nothing may go.
    for (const b of [...view.container.ownerDocument.querySelectorAll("button")]) {
      await act(async () => {
        (b as HTMLButtonElement).click();
        await new Promise((r) => setTimeout(r, 20));
      });
    }
    view.unmount();
    return calls === 0 ? "refused" : "sent";
  },
};

afterEach(() => {
  cleanup();
  localStorage.clear();
  setAiPolicy("local-first");
});

describe("what the privacy policy says about local-only is what the code does (W4.29, audit r2)", () => {
  const en = refusedRoutes(EN, "en");
  const he = refusedRoutes(HE, "he");

  it("the extraction finds the claims (it would fail on an empty policy)", () => {
    expect(en.length).toBeGreaterThan(0);
    expect(refusedRoutes("| x | Goes with consent, also under `local-only` | `Some route` (h) | – | `cloud-text` |", "en")).toEqual([]);
    expect(refusedRoutes("| X | y. Refused under the `local-only` policy | `Some route` (h) | – | `cloud-text` |", "en")).toEqual(["Some route"]);
  });

  it("the Hebrew and the English policy make the same claims", () => {
    expect([...he].sort()).toEqual([...en].sort());
  });

  it("every claim has a behavioural check", () => {
    expect(en.filter((r) => !(r in CHECKS))).toEqual([]);
  });

  for (const [route, check] of Object.entries(CHECKS))
    it(`${route}: the code agrees with the policy`, async () => {
      const did = await check();
      const claimed = en.includes(route) && he.includes(route);
      expect(did === "refused", `${route}: the code ${did} it under local-only; the policy ${claimed ? "says it is refused" : "says it goes with consent"}`).toBe(claimed);
    });
});
