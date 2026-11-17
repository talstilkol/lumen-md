/**
 * W12.E10 — linking an entity to Wikidata: 0 requests before consent
 * (checked in the privacy ledger); "this once" asks again next time,
 * "always on this device" does not (an app setting since review Z7-M3, see
 * z7/wikidataLocalOnly.test.tsx for local-only and the vault file); only the name goes out, with a generic
 * Api-User-Agent; the QID lands in the note's `wikidata` property with
 * the rest of the note byte for byte; the entity card says CC0; nothing in
 * airplane mode. Wikidata is faked (offline): a recorded response shape.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { setVaultBackend } from "../storage/vault";
import { createMemoryBackend } from "../storage/vault/memory";
import type { VaultBackend } from "../storage/vault/types";
import * as workspace from "../storage/workspace";
import { __resetLedger, ledgerEntries, withLedger } from "../ai/privacyLedger";
import { __setAirplaneFlag } from "../privacy/airplaneBoot";
import { setAiPolicy } from "../ai/policy";
import { CONSENT_KEY, API_USER_AGENT, LEDGER_REASON, searchUrl, withQid } from "../entities/wikidata";
import { WikidataLink } from "../ui/WikidataLink";
import { WikidataHost } from "../ui/WikidataHost";
import { buildEntityCommands, WIKIDATA_EVENT } from "../commands/domains/entities";
import { EntityPage } from "../ui/EntityPage";
import { parseEntityNote } from "../entities/notes";
import type { CommandContext } from "../commands/domains/context";

const T = { timeout: 10_000 };
const PATH = "ישויות/אנשים/דוד בן-גוריון.md";
const NOTE = "---\ntype: person\nentity-type: person\naliases:\n  - בן-גוריון\n---\n\n# דוד בן-גוריון\n\nגוף הפתק נשאר כמו שהוא.\n";
let previous: VaultBackend | null = null;
const calls: Array<{ url: string; headers: Record<string, string> }> = [];
const inner = (async (input: RequestInfo | URL, init?: RequestInit) => {
  calls.push({ url: String(input), headers: (init?.headers ?? {}) as Record<string, string> });
  const lang = new URL(String(input)).searchParams.get("language");
  const search = lang === "he" ? [{ id: "Q37085", label: "דוד בן-גוריון", description: "ראש הממשלה הראשון" }] : [{ id: "Q37085", label: "David Ben-Gurion" }, { id: "Q999999", label: "Ben Gurion Airport" }];
  return new Response(JSON.stringify({ search }), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;
const ledgered = () => withLedger(inner, { force: { category: "cloud-text", reason: LEDGER_REASON } });
const wikidataEntries = () => ledgerEntries().filter((e) => e.host === "www.wikidata.org");

beforeEach(async () => {
  calls.length = 0;
  __resetLedger();
  localStorage.clear();
  // Z7-M3: Wikidata is refused under local-only (the default with no cloud key); these tests run under local-first.
  setAiPolicy("local-first");
  __setAirplaneFlag(false);
  previous = setVaultBackend(createMemoryBackend());
  await workspace.writeWorkspaceFile(PATH, NOTE);
  document.documentElement.dir = "rtl";
});
afterEach(() => {
  setVaultBackend(previous);
  __setAirplaneFlag(false);
  document.documentElement.dir = "";
});

describe("W12.E10 pieces", () => {
  it("the QID goes into the front matter; the rest of the note stays byte for byte", () => {
    const out = withQid(NOTE, "Q37085");
    expect(out).toBe(NOTE.replace("  - בן-גוריון\n---", "  - בן-גוריון\nwikidata: Q37085\n---"));
    expect(withQid(out, "Q1")).toBe(out.replace("Q37085", "Q1"));
    expect(withQid("# no front matter\n", "Q2")).toBe("---\nwikidata: Q2\n---\n# no front matter\n");
    expect(() => withQid(NOTE, "37085")).toThrow();
  });

  it("the request carries the name only, in Hebrew and English", () => {
    const u = new URL(searchUrl("דוד בן-גוריון", "he"));
    expect(u.host).toBe("www.wikidata.org");
    expect(Object.fromEntries(u.searchParams)).toEqual({ action: "wbsearchentities", search: "דוד בן-גוריון", language: "he", uselang: "he", type: "item", limit: "7", format: "json", origin: "*" });
    expect(API_USER_AGENT).not.toMatch(/@|user|vault/i);
  });
});

describe("W12.E10 consent and the ledger", () => {
  it("0 requests before consent; this once; always for this vault; the QID written", async () => {
    const first = render(<WikidataLink name="דוד בן-גוריון" path={PATH} onClose={() => {}} fetchImpl={ledgered()} vault={workspace} />);
    await screen.findByRole("button", { name: "Search this once" });
    expect(calls).toEqual([]);
    expect(wikidataEntries()).toEqual([]);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Search this once" }));
    });
    await screen.findByRole("button", { name: /Q37085/ }, T);
    expect(calls.map((c) => new URL(c.url).searchParams.get("language"))).toEqual(["he", "en"]);
    for (const c of calls) expect(c.headers["Api-User-Agent"]).toBe(API_USER_AGENT);
    expect(wikidataEntries().map((e) => [e.category, e.reason, e.decision])).toEqual([
      ["cloud-text", "Wikidata search: the entity name only", "allowed"],
      ["cloud-text", "Wikidata search: the entity name only", "allowed"],
    ]);
    // Not a consent that overrides a policy (Z7-M3): under local-first cloud-text is allowed anyway.
    expect(wikidataEntries().map((e) => e.consent)).toEqual([undefined, undefined]);
    expect(screen.getAllByRole("listitem")).toHaveLength(2); // one row per item

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Q37085/ }));
    });
    await screen.findByText(/Linked: wikidata: Q37085/);
    expect(screen.getByText(/CC0 1\.0/)).toBeTruthy();
    expect(await workspace.readWorkspaceFile(PATH)).toBe(withQid(NOTE, "Q37085"));
    first.unmount();

    // "This once" was not remembered: the next time asks again, and sends nothing until then.
    calls.length = 0;
    const second = render(<WikidataLink name="דוד בן-גוריון" path={PATH} onClose={() => {}} fetchImpl={ledgered()} vault={workspace} />);
    await screen.findByRole("button", { name: "Always on this device" });
    expect(calls).toEqual([]);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Always on this device" }));
    });
    await screen.findByRole("button", { name: /Q37085/ }, T);
    expect(localStorage.getItem(CONSENT_KEY)).toBe("1");
    expect(await workspace.workspaceHasFile(".lumen/entities/wikidata.json")).toBe(false);
    second.unmount();

    // Always on this device: no question, straight to the search.
    calls.length = 0;
    render(<WikidataLink name="דוד בן-גוריון" path={PATH} onClose={() => {}} fetchImpl={ledgered()} vault={workspace} />);
    await screen.findByRole("button", { name: /Q37085/ }, T);
    expect(screen.queryByRole("button", { name: "Search this once" })).toBeNull();
    expect(calls).toHaveLength(2);
  });

  it("a note changed underneath is not overwritten", async () => {
    expect(localStorage.getItem(CONSENT_KEY)).toBe(null);
    render(<WikidataLink name="דוד בן-גוריון" path={PATH} onClose={() => {}} fetchImpl={ledgered()} vault={workspace} />);
    const once = await screen.findByRole("button", { name: "Search this once" }, T);
    await act(async () => {
      fireEvent.click(once);
    });
    const pick = await screen.findByRole("button", { name: /Q37085/ }, T);
    await workspace.writeWorkspaceFile(PATH, NOTE + "שורה חדשה\n");
    await act(async () => {
      fireEvent.click(pick);
    });
    await screen.findByRole("alert");
    expect(await workspace.readWorkspaceFile(PATH)).toBe(NOTE + "שורה חדשה\n");
  });

  it("the entity card shows the QID with CC0", () => {
    const e = parseEntityNote(PATH, withQid(NOTE, "Q37085"))!;
    render(<EntityPage entity={e} edges={[]} notes={new Map()} names={new Map()} onOpenBlock={() => {}} />);
    expect(screen.getByText("Q37085")).toBeTruthy();
    expect(screen.getByText(/CC0 1\.0/)).toBeTruthy();
  });
});

describe("W12.E10 airplane mode", () => {
  it("no command and no dialog", async () => {
    const ctx = { liveDoc: () => ({ workspaceName: PATH, content: NOTE }) } as unknown as CommandContext;
    // entities.graph (W12.E7, #928) is a local view: it stays in airplane mode; only the Wikidata link goes.
    expect(buildEntityCommands(ctx).map((c) => c.id)).toEqual(["entities.review", "entities.graph", "entities.contradictions", "entities.wikidata"]);
    __setAirplaneFlag(true);
    // The contradiction finder (R12.10) reads the vault on this device: it stays too.
    expect(buildEntityCommands(ctx).map((c) => c.id)).toEqual(["entities.review", "entities.graph", "entities.contradictions"]);
    render(<WikidataHost />);
    await act(async () => {
      window.dispatchEvent(new CustomEvent(WIKIDATA_EVENT, { detail: { name: "x", path: PATH } }));
    });
    expect(screen.queryByTestId("wikidata-link")).toBeNull();
    expect(calls).toEqual([]);
  });

  it("with airplane mode off, the command opens the dialog for the open entity note", async () => {
    const ctx = { liveDoc: () => ({ workspaceName: PATH, content: NOTE }) } as unknown as CommandContext;
    render(<WikidataHost />);
    await act(async () => {
      buildEntityCommands(ctx).find((c) => c.id === "entities.wikidata")!.action();
    });
    await waitFor(() => expect(screen.getByTestId("wikidata-link")).toBeTruthy(), { timeout: 10_000 });
    expect(calls).toEqual([]);
  });
});
