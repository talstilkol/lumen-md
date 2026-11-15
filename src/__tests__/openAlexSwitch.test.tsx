/**
 * Plan W12.X3 — the OpenAlex lookup's switch in Settings → Privacy: off by
 * default; while it is off nothing is sent and nothing is asked; while it
 * is on, every lookup still asks first, and a "no" sends nothing. The
 * requests are counted at the network boundary (the window's fetch, which
 * the lookup uses in the app); the DOIs and the response are SYNTHETIC.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SettingsScreen } from "../ui/SettingsScreen";
import { OPENALEX_ENABLED_KEY, lookupOpenAlexReferences, openAlexEnabled } from "../citations/openAlexLookup";
import { searchSettings } from "../settings/schema";
import { exportSettings, importSettings, SETTINGS_FORMAT } from "../settings/io";
import { t } from "../i18n";

const realFetch = globalThis.fetch;
let sent: string[] = [];

beforeEach(() => {
  localStorage.clear();
  sent = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    sent.push(url);
    const body = url.includes("/works/doi:") ? { referenced_works: ["https://openalex.org/W1"] } : { results: [{ id: "https://openalex.org/W1", doi: "https://doi.org/10.5555/S02" }] };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  document.body.innerHTML = "";
});

const doi = (i: number) => `10.5555/s${String(i).padStart(2, "0")}`;

async function privacySwitch(): Promise<HTMLInputElement> {
  render(<SettingsScreen tab="privacy" onClose={() => {}} />);
  const section = await screen.findByTestId("settings-openalex");
  return section.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
}

describe("OpenAlex switch (Settings → Privacy)", () => {
  it("is in the Privacy tab, off by default", async () => {
    const box = await privacySwitch();
    expect(box.checked).toBe(false);
    expect(openAlexEnabled()).toBe(false);
    expect(screen.getByText("Look up the references of a DOI in OpenAlex")).toBeTruthy();
    expect(searchSettings("openalex", t).tabs.has("privacy")).toBe(true);
  });

  it("while it is off, 50 lookups send nothing and ask nothing", async () => {
    let asked = 0;
    for (let i = 1; i <= 50; i++) {
      expect(await lookupOpenAlexReferences(doi(i), { ask: async () => (asked++, true) })).toEqual({ status: "off", dois: [] });
    }
    // The app's own consent dialog is not opened either.
    expect(await lookupOpenAlexReferences(doi(1))).toEqual({ status: "off", dois: [] });
    expect(document.querySelector(".prompt-dialog")).toBeNull();
    expect(asked).toBe(0);
    expect(sent).toEqual([]);
  });

  it("turned on, each lookup asks; a no sends nothing, a yes sends only the DOI to api.openalex.org", async () => {
    const box = await privacySwitch();
    fireEvent.click(box);
    await waitFor(() => expect(box.checked).toBe(true));
    expect(localStorage.getItem(OPENALEX_ENABLED_KEY)).toBe("1");

    const questions: string[] = [];
    expect(await lookupOpenAlexReferences(doi(1), { ask: async (d) => (questions.push(d), false) })).toEqual({ status: "declined", dois: [] });
    expect(sent).toEqual([]);

    expect(await lookupOpenAlexReferences(doi(1), { ask: async (d) => (questions.push(d), true) })).toEqual({ status: "done", dois: ["10.5555/s02"] });
    expect(await lookupOpenAlexReferences(doi(2), { ask: async (d) => (questions.push(d), true) })).toMatchObject({ status: "done" });
    expect(questions).toEqual([doi(1), doi(1), doi(2)]); // asked every time, not once per session
    expect(sent.every((u) => u.startsWith("https://api.openalex.org/"))).toBe(true);
    expect(sent[0]).toBe("https://api.openalex.org/works/doi:10.5555%2Fs01?select=referenced_works");

    // Turned off again: nothing more goes out.
    fireEvent.click(box);
    await waitFor(() => expect(box.checked).toBe(false));
    const before = sent.length;
    expect(await lookupOpenAlexReferences(doi(3), { ask: async () => true })).toEqual({ status: "off", dois: [] });
    expect(sent.length).toBe(before);
  });

  it("is never exported, and an imported settings file cannot turn it on", () => {
    localStorage.setItem(OPENALEX_ENABLED_KEY, "1");
    const target = { getApp: () => ({}), applyApp: () => {}, storage: localStorage };
    expect(Object.keys(exportSettings(target).local)).not.toContain(OPENALEX_ENABLED_KEY);
    localStorage.clear();
    const r = importSettings({ format: SETTINGS_FORMAT, version: 1, app: {}, local: { [OPENALEX_ENABLED_KEY]: "1" } }, target);
    expect(r.skipped).toContain(OPENALEX_ENABLED_KEY);
    expect(openAlexEnabled()).toBe(false);
  });
});
