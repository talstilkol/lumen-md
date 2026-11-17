/**
 * Plan W10.E49: the OneNote sign-in from the wizard's button to the
 * `/oauth/onenote` redirect and back into the wizard's review step.
 *
 * The identity-platform and Graph answers below are SYNTHETIC: hand-written
 * in the documented shapes (token endpoint, sections, pages, page content),
 * served by a stand-in `fetch`. The real sign-in, redirect, wizard and
 * Graph client code run against them. A live sign-in is owed (see the PR).
 */
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { installFakeOpfs } from "./helpers/fakeOpfs";


import { codeChallenge, type OneNoteTokens } from "../storage/import/onenoteGraph";
import { PENDING_KEY, navigation, finishOneNoteSignIn, giveOneNoteError, giveOneNoteTokens, prepareOneNoteGraphImport, startOneNoteSignIn, takeOneNoteHandoff, tokenSource } from "../storage/import/onenoteSignIn";
import { oneNoteReturn } from "../storage/import/onenoteReturn";
import { ImportWizard } from "../storage/import/ImportWizard";
import { __resetOneNoteClientId, CLIENT_ID_KEY } from "../storage/import/onenoteClientId";

const CLIENT = "00000000-1111-2222-3333-444444444444";
/** W4.19: the client id is a runtime setting (here: the user's own app), not a build variable. */
const useClientId = () => localStorage.setItem(CLIENT_ID_KEY, CLIENT);
const cfg = { clientId: CLIENT, redirectUri: "https://lumen-md.vercel.app/oauth/onenote", tenant: "common" };

function memStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), dump: () => [...m.entries()] };
}

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

/** The token endpoint, answering a code (or refresh) with tokens. */
function tokenEndpoint(seen: URLSearchParams[], token = "AT-1") {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    expect(url).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/token");
    const body = new URLSearchParams(String(init?.body));
    seen.push(body);
    return json({ token_type: "Bearer", scope: "Notes.Read", expires_in: 3600, access_token: body.get("grant_type") === "refresh_token" ? "AT-2" : token, refresh_token: "RT-1" });
  }) as typeof fetch;
}

/** One notebook, one section, two pages (the second fails), in Graph's documented shapes. */
function graph(seen: string[]) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    seen.push(`${new Headers(init?.headers).get("Authorization")} ${url}`);
    const path = url.replace("https://graph.microsoft.com/v1.0", "");
    if (path.startsWith("/me/onenote/sectionGroups")) return json({ value: [] });
    if (path.startsWith("/me/onenote/sections?")) return json({ value: [{ id: "1-S-1", displayName: "שיעורים", parentNotebook: { id: "1-NB", displayName: "מחברת" }, parentSectionGroup: null }] });
    if (path.startsWith("/me/onenote/sections/1-S-1/pages"))
      return json({
        value: [
          { id: "1-P-B", title: "Broken", createdDateTime: "2026-01-02T00:00:00Z", lastModifiedDateTime: "2026-01-02T00:00:00Z", order: 1 },
          { id: "1-P-A", title: "שיעור ראשון", createdDateTime: "2026-01-01T08:00:00Z", lastModifiedDateTime: "2026-01-03T09:30:00Z", order: 0 },
        ],
      });
    if (path === "/me/onenote/pages/1-P-A/content") return new Response("<html><head><title>שיעור ראשון</title></head><body><p>שלום <b>עולם</b></p></body></html>", { headers: { "Content-Type": "text/html" } });
    if (path === "/me/onenote/pages/1-P-B/content") return json({ error: { code: "20102", message: "The requested resource does not exist." } }, 404);
    return json({ error: { code: "itemNotFound", message: path } }, 404);
  }) as typeof fetch;
}

beforeEach(() => {
  installFakeOpfs();
  localStorage.clear();
  sessionStorage.clear();
  __resetOneNoteClientId();
  // No /lumen-runtime.json on this "deployment" unless a test serves one.
  vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
  takeOneNoteHandoff();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  history.replaceState(null, "", "/");
});

describe("the button: start the sign-in", () => {
  it("keeps the verifier and state for this tab and goes to Microsoft with their challenge", async () => {
    const storage = memStorage();
    let went = "";
    const url = await startOneNoteSignIn(cfg, { storage, assign: (u) => (went = u), now: () => 1000 });
    expect(went).toBe(url);
    const pending = JSON.parse(storage.getItem(PENDING_KEY)!) as { verifier: string; state: string; at: number };
    const q = new URL(url).searchParams;
    expect(q.get("state")).toBe(pending.state);
    expect(q.get("code_challenge")).toBe(await codeChallenge(pending.verifier));
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(q.get("scope")).toBe("Notes.Read offline_access");
    expect(pending.at).toBe(1000);
  });

  it("refuses to start without session storage (the verifier would be lost)", async () => {
    await expect(startOneNoteSignIn(cfg, { storage: null, assign: () => undefined })).rejects.toMatchObject({ code: "no_storage" });
  });
});

describe("the redirect: finish the sign-in", () => {
  async function started(storage = memStorage(), now = () => 1000) {
    let went = "";
    await startOneNoteSignIn(cfg, { storage, assign: (u) => (went = u), now });
    const state = new URL(went).searchParams.get("state")!;
    const verifier = (JSON.parse(storage.getItem(PENDING_KEY)!) as { verifier: string }).verifier;
    return { storage, state, verifier };
  }

  it("swaps the code with this tab's verifier; nothing of the sign-in stays in storage", async () => {
    const { storage, state, verifier } = await started();
    const seen: URLSearchParams[] = [];
    const tokens = await finishOneNoteSignIn(`${cfg.redirectUri}?code=C0DE&state=${state}`, cfg, { storage, fetch: tokenEndpoint(seen), now: () => 2000 });
    expect(tokens.accessToken).toBe("AT-1");
    expect(seen).toHaveLength(1);
    expect(Object.fromEntries(seen[0])).toMatchObject({ grant_type: "authorization_code", code: "C0DE", code_verifier: verifier, redirect_uri: cfg.redirectUri, client_id: CLIENT });
    expect(seen[0].has("client_secret")).toBe(false);
    expect(storage.dump()).toEqual([]);
  });

  it("a different state is refused, and the spent sign-in cannot be replayed", async () => {
    const { storage, state } = await started();
    const seen: URLSearchParams[] = [];
    await expect(finishOneNoteSignIn(`${cfg.redirectUri}?code=C0DE&state=OTHER`, cfg, { storage, fetch: tokenEndpoint(seen), now: () => 2000 })).rejects.toMatchObject({ code: "state_mismatch" });
    await expect(finishOneNoteSignIn(`${cfg.redirectUri}?code=C0DE&state=${state}`, cfg, { storage, fetch: tokenEndpoint(seen), now: () => 2000 })).rejects.toMatchObject({ code: "no_pending" });
    expect(seen).toHaveLength(0);
  });

  it("the identity platform's error (the user said no) comes through with its code", async () => {
    const { storage, state } = await started();
    await expect(finishOneNoteSignIn(`${cfg.redirectUri}?error=access_denied&error_description=The+user+declined&state=${state}`, cfg, { storage, fetch: tokenEndpoint([]), now: () => 2000 })).rejects.toMatchObject({ code: "access_denied", message: "The user declined" });
  });

  it("a sign-in older than 15 minutes is not finished", async () => {
    const { storage, state } = await started(memStorage(), () => 0);
    await expect(finishOneNoteSignIn(`${cfg.redirectUri}?code=C&state=${state}`, cfg, { storage, fetch: tokenEndpoint([]), now: () => 15 * 60_000 + 1 })).rejects.toMatchObject({ code: "expired" });
  });

  it("the access token is refreshed in memory once it expires", async () => {
    const seen: URLSearchParams[] = [];
    let t = 0;
    const get = tokenSource(cfg, { accessToken: "AT-1", refreshToken: "RT-1", expiresAt: 100 }, { fetch: tokenEndpoint(seen), now: () => t });
    expect(await get()).toBe("AT-1");
    t = 100;
    expect(await get()).toBe("AT-2");
    expect(seen.map((b) => b.get("grant_type"))).toEqual(["refresh_token"]);
  });
});

describe("into the wizard's review step", () => {
  const tokens: OneNoteTokens = { accessToken: "AT-1", refreshToken: null, expiresAt: Number.MAX_SAFE_INTEGER };

  it("reads the account's OneNote into a prepared import: nothing written yet, the broken page listed", async () => {
    const seen: string[] = [];
    const prep = await prepareOneNoteGraphImport(cfg, tokens, { fetch: graph(seen), sleep: async () => undefined });
    expect(prep.source).toBe("onenote");
    expect(prep.folder).toMatch(/OneNote$/);
    expect([...prep.vault.notes.keys()]).toEqual(["מחברת/שיעורים/שיעור ראשון.md"]);
    expect(prep.vault.notes.get("מחברת/שיעורים/שיעור ראשון.md")).toContain("**עולם**");
    expect(prep.vault.skipped).toEqual([expect.objectContaining({ reason: "unreadable" })]);
    expect(seen.every((s) => s.startsWith("Bearer AT-1 https://graph.microsoft.com/"))).toBe(true);
  });

  it("the redirect page takes the code out of the address bar and hands the tokens over in memory", async () => {
    useClientId();
    let went = "";
    await startOneNoteSignIn({ ...cfg, redirectUri: `${location.origin}/oauth/onenote` }, { assign: (u) => (went = u) });
    const state = new URL(went).searchParams.get("state")!;
    history.replaceState(null, "", `/oauth/onenote?code=C0DE&state=${state}`);
    vi.stubGlobal("fetch", tokenEndpoint([]));
    let opened = 0;
    expect(await oneNoteReturn(Promise.resolve(), { openWizard: () => opened++ })).toBe("tokens");
    expect(location.pathname + location.search).toBe("/");
    expect(opened).toBe(1);
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
    expect(JSON.stringify({ ...localStorage })).not.toContain("AT-1");
    expect(takeOneNoteHandoff()).toEqual({ tokens: expect.objectContaining({ accessToken: "AT-1" }) });
    expect(takeOneNoteHandoff()).toBeNull();
  });

  it("without a client id on the deployment the redirect hands over the reason instead", async () => {
    history.replaceState(null, "", "/oauth/onenote?code=C&state=S");
    expect(await oneNoteReturn(Promise.resolve(), { openWizard: () => undefined })).toBe("error");
    expect(takeOneNoteHandoff()).toEqual({ error: expect.stringContaining("no Microsoft app client id") });
  });

  it("another path is left alone", async () => {
    history.replaceState(null, "", "/oauth/dropbox?code=C");
    expect(await oneNoteReturn(Promise.resolve(), { openWizard: () => undefined })).toBe("skipped");
    expect(location.pathname).toBe("/oauth/dropbox");
  });
});

describe("the wizard", () => {
  it("offers the sign-in for OneNote only when there is a client id", async () => {
    render(<ImportWizard open onClose={() => undefined} />);
    fireEvent.click(screen.getByTestId("import-source-onenote"));
    expect(screen.queryByTestId("import-onenote-signin")).toBeNull();
    cleanup();
    useClientId();
    render(<ImportWizard open onClose={() => undefined} />);
    expect(screen.queryByTestId("import-onenote-signin")).toBeNull();
    fireEvent.click(screen.getByTestId("import-source-onenote"));
    expect(screen.getByTestId("import-onenote-signin")).toBeTruthy();
    const assign = vi.fn();
    const real = navigation.assign;
    navigation.assign = assign;
    onTestFinished(() => void (navigation.assign = real));
    await act(async () => fireEvent.click(screen.getByTestId("import-onenote-signin")));
    await waitFor(() => expect(assign).toHaveBeenCalledOnce());
    expect(String(assign.mock.calls[0][0])).toMatch(/^https:\/\/login\.microsoftonline\.com\/common\/oauth2\/v2\.0\/authorize\?/);
    expect(sessionStorage.getItem(PENDING_KEY)).toContain("verifier");
  });

  it("opened after the redirect, it reads OneNote and shows the review step", async () => {
    useClientId();
    vi.stubGlobal("fetch", graph([]));
    giveOneNoteTokens({ accessToken: "AT-1", refreshToken: null, expiresAt: Number.MAX_SAFE_INTEGER });
    render(<ImportWizard open onClose={() => undefined} />);
    await waitFor(() => expect(screen.getByTestId("import-summary")).toBeTruthy(), { timeout: 5000 });
    expect(screen.getByTestId("import-summary").textContent).toMatch(/\b1\b/);
    expect(screen.getByTestId("import-skipped").textContent).toContain("Broken");
    expect(screen.getByTestId("import-start")).toBeTruthy();
  });

  it("opened after a failed sign-in, it says why", () => {
    useClientId();
    giveOneNoteError("The user declined");
    render(<ImportWizard open onClose={() => undefined} />);
    expect(screen.getByTestId("import-error").textContent).toContain("The user declined");
  });
});
