/**
 * Plan W4.19: the OneNote client id is a runtime setting — the user's own
 * app registration or the deployment's /lumen-runtime.json — never a
 * VITE_* build variable (which would have to join the env allow-list).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { installFakeOpfs } from "./helpers/fakeOpfs";
import { __resetOneNoteClientId, CLIENT_ID_KEY, isClientId, loadDeployedClientId, oneNoteClientId, RUNTIME_CONFIG_PATH, setUserClientId, userClientId } from "../storage/import/onenoteClientId";
import { oneNoteConfig } from "../storage/import/onenoteGraph";
import { ImportWizard } from "../storage/import/ImportWizard";

const ID = "0a1b2c3d-4e5f-6789-abcd-ef0123456789";
const OTHER = "11111111-2222-3333-4444-555555555555";
const served = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

beforeEach(() => {
  installFakeOpfs();
  localStorage.clear();
  __resetOneNoteClientId();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("where the client id comes from", () => {
  it("accepts only a GUID, from the user, and forgets it on empty", () => {
    expect(isClientId(ID)).toBe(true);
    expect(isClientId("my-app")).toBe(false);
    expect(setUserClientId("not a guid")).toBe(false);
    expect(userClientId()).toBe("");
    expect(setUserClientId(` ${ID.toUpperCase()} `)).toBe(true);
    expect(localStorage.getItem(CLIENT_ID_KEY)).toBe(ID);
    expect(oneNoteConfig("https://lumen-md.vercel.app")).toEqual({ clientId: ID, redirectUri: "https://lumen-md.vercel.app/oauth/onenote", tenant: "common" });
    expect(setUserClientId("")).toBe(true);
    expect(oneNoteConfig("https://lumen-md.vercel.app")).toBeNull();
  });

  it("reads the deployment's runtime config once, same origin, without credentials", async () => {
    const f = served({ onenote: { clientId: ID } });
    expect(oneNoteClientId()).toBe("");
    expect(await loadDeployedClientId(f as unknown as typeof fetch)).toBe(ID);
    expect(await loadDeployedClientId(f as unknown as typeof fetch)).toBe(ID);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(RUNTIME_CONFIG_PATH);
    expect(init.credentials).toBe("omit");
    expect(oneNoteClientId()).toBe(ID);
    // The user's own app wins over the deployment's.
    setUserClientId(OTHER);
    expect(oneNoteClientId()).toBe(OTHER);
  });

  it("ignores a missing file, a bad id and a network error", async () => {
    expect(await loadDeployedClientId(served({}, 404) as unknown as typeof fetch)).toBeNull();
    __resetOneNoteClientId();
    expect(await loadDeployedClientId(served({ onenote: { clientId: "<script>" } }) as unknown as typeof fetch)).toBeNull();
    __resetOneNoteClientId();
    expect(await loadDeployedClientId((async () => Promise.reject(new TypeError("offline"))) as unknown as typeof fetch)).toBeNull();
    expect(oneNoteClientId()).toBe("");
  });

  it("no source file reads a VITE_ONENOTE_* build variable", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        if (n === "__tests__" || n === "node_modules") continue;
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(tsx?|mjs|js)$/.test(n) && /VITE_ONENOTE/.test(readFileSync(p, "utf8"))) hits.push(p);
      }
    };
    walk(join(process.cwd(), "src"));
    expect(hits).toEqual([]);
  });
});

describe("the wizard", () => {
  it("asks for the user's own client id when none is set, then offers the sign-in", async () => {
    render(<ImportWizard open onClose={() => undefined} />);
    fireEvent.click(screen.getByTestId("import-source-onenote"));
    expect(screen.queryByTestId("import-onenote-signin")).toBeNull();
    fireEvent.change(screen.getByTestId("import-onenote-clientid-input"), { target: { value: "nope" } });
    fireEvent.click(screen.getByTestId("import-onenote-clientid-save"));
    expect(screen.getByTestId("import-error").textContent).toContain("00000000-0000-0000-0000-000000000000");
    fireEvent.change(screen.getByTestId("import-onenote-clientid-input"), { target: { value: ID } });
    await act(async () => fireEvent.click(screen.getByTestId("import-onenote-clientid-save")));
    expect(screen.getByTestId("import-onenote-signin")).toBeTruthy();
    expect(screen.queryByTestId("import-onenote-clientid")).toBeNull();
    expect(localStorage.getItem(CLIENT_ID_KEY)).toBe(ID);
  });

  it("offers the sign-in when the deployment's runtime config has a client id", async () => {
    vi.stubGlobal("fetch", served({ onenote: { clientId: ID } }));
    render(<ImportWizard open onClose={() => undefined} />);
    fireEvent.click(screen.getByTestId("import-source-onenote"));
    await waitFor(() => expect(screen.getByTestId("import-onenote-signin")).toBeTruthy());
  });
});
