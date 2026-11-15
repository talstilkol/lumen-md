/**
 * Review Z7-M3 (#938): the Wikidata search was a consented ledger fetch, so local-only did not block it, and its
 * "always" consent was a vault file (`.lumen/entities/wikidata.json`) that arrived with any vault the user opened.
 * Now: under local-only nothing is sent and nothing is asked, whatever is stored; the standing consent is the app
 * setting `lumen.wikidata.always` (kind "data": never exported or imported); the vault file is not read.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { setVaultBackend } from "../../storage/vault";
import { createMemoryBackend } from "../../storage/vault/memory";
import type { VaultBackend } from "../../storage/vault/types";
import * as workspace from "../../storage/workspace";
import { __resetLedger, ledgerEntries, withLedger, PrivacyBlockedError } from "../../ai/privacyLedger";
import { setAiPolicy } from "../../ai/policy";
import { __setAirplaneFlag } from "../../privacy/airplaneBoot";
import { CONSENT_KEY, LEDGER_REASON, searchWikidata } from "../../entities/wikidata";
import { WikidataLink } from "../../ui/WikidataLink";
import { t } from "../../i18n";
import { exportSettings, importSettings, SETTINGS_FORMAT } from "../../settings/io";

const T = { timeout: 10_000 };
const PATH = "ישויות/אנשים/x.md";
const VAULT_CONSENT = ".lumen/entities/wikidata.json";
let previous: VaultBackend | null = null;
const calls: string[] = [];
const inner = (async (input: RequestInfo | URL) => {
  calls.push(String(input));
  return new Response(JSON.stringify({ search: [{ id: "Q1", label: "x" }] }), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;
// What the app passes now: the ledger fetch, not marked as consented.
const appFetch = () => withLedger(inner, { force: { category: "cloud-text", reason: LEDGER_REASON } });

beforeEach(async () => {
  calls.length = 0;
  __resetLedger();
  localStorage.clear();
  __setAirplaneFlag(false);
  previous = setVaultBackend(createMemoryBackend());
  await workspace.writeWorkspaceFile(PATH, "# x\n");
});
afterEach(() => {
  setVaultBackend(previous);
});

describe("Z7-M3: local-only blocks the Wikidata search", () => {
  it("a vault that brings {always:true} and a stored device consent: under local-only nothing is sent and nothing asked", async () => {
    setAiPolicy("local-only");
    await workspace.writeWorkspaceFile(VAULT_CONSENT, JSON.stringify({ always: true }));
    localStorage.setItem(CONSENT_KEY, "1");
    // A bare transport, so only the dialog's own check can stop the request (the ledger is checked below).
    render(<WikidataLink name="x" path={PATH} onClose={() => {}} fetchImpl={inner} vault={workspace} />);
    await screen.findByText(t("entityGraph.wikidata.localOnly"), undefined, T);
    expect(screen.queryByRole("button", { name: "Search this once" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Always on this device" })).toBeNull();
    expect(calls).toEqual([]);
  });

  it("the ledger itself refuses the app's Wikidata fetch under local-only", async () => {
    setAiPolicy("local-only");
    await expect(searchWikidata("x", appFetch())).rejects.toBeInstanceOf(PrivacyBlockedError);
    expect(calls).toEqual([]);
    expect(ledgerEntries().map((e) => e.decision)).toEqual(["blocked"]);
  });
});

describe("Z7-M3: the standing consent is not in the vault", () => {
  it("a vault file {always:true} is not read: the dialog still asks (local-first)", async () => {
    setAiPolicy("local-first");
    await workspace.writeWorkspaceFile(VAULT_CONSENT, JSON.stringify({ always: true }));
    render(<WikidataLink name="x" path={PATH} onClose={() => {}} fetchImpl={appFetch()} vault={workspace} />);
    await screen.findByRole("button", { name: "Search this once" }, T);
    expect(calls).toEqual([]);
  });

  it("'Always on this device' writes the app setting, not a vault file", async () => {
    setAiPolicy("local-first");
    render(<WikidataLink name="x" path={PATH} onClose={() => {}} fetchImpl={appFetch()} vault={workspace} />);
    const always = await screen.findByRole("button", { name: "Always on this device" }, T);
    await act(async () => {
      fireEvent.click(always);
    });
    await screen.findByRole("button", { name: /Q1/ }, T);
    expect(localStorage.getItem(CONSENT_KEY)).toBe("1");
    expect(await workspace.workspaceHasFile(VAULT_CONSENT)).toBe(false);
  });

  it("the setting is never exported, and an imported file never turns it on", () => {
    localStorage.setItem(CONSENT_KEY, "1");
    const target = { getApp: () => ({}), applyApp: () => {}, storage: localStorage };
    expect(Object.keys(exportSettings(target).local)).not.toContain(CONSENT_KEY);
    localStorage.removeItem(CONSENT_KEY);
    const r = importSettings({ format: SETTINGS_FORMAT, version: 1, app: {}, local: { [CONSENT_KEY]: "1" } }, target);
    expect(r.skipped).toContain(CONSENT_KEY);
    expect(localStorage.getItem(CONSENT_KEY)).toBe(null);
  });
});
