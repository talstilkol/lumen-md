/**
 * Tests for the WorkOS SSO provider shell (ε.1 / F4).
 *
 * The actual SAML dance lives in the edge worker (created when the
 * WorkOS account is provisioned); this client just calls JSON
 * endpoints. We mock fetch + the env reader so the tests are
 * hermetic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  signInWithSso,
  loadSsoSession,
  signOutSso,
  workosProvider,
  isWorkosEnabled,
  __setWorkOSConfigForTesting,
} from "../auth/workosProvider";

beforeEach(() => {
  vi.unstubAllGlobals();
  __setWorkOSConfigForTesting(null);
});

afterEach(() => {
  __setWorkOSConfigForTesting(null);
});

describe("isWorkosEnabled", () => {
  it("returns false when no endpoint is configured", () => {
    expect(isWorkosEnabled()).toBe(false);
  });

  it("returns true once the test config is set", () => {
    __setWorkOSConfigForTesting({ endpoint: "https://auth.lumen.md" });
    expect(isWorkosEnabled()).toBe(true);
  });
});

describe("signInWithSso", () => {
  it("throws when no endpoint is configured", async () => {
    await expect(signInWithSso("acme.com")).rejects.toThrow(/not configured/);
  });

  it("requires a non-empty domain", async () => {
    __setWorkOSConfigForTesting({ endpoint: "https://auth.lumen.md" });
    await expect(signInWithSso("")).rejects.toThrow(/domain required/i);
  });

  it("returns the redirect URL on success", async () => {
    __setWorkOSConfigForTesting({ endpoint: "https://auth.lumen.md" });
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ redirect: "https://idp.acme.com/saml/sso" }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const url = await signInWithSso("acme.com");
    expect(url).toBe("https://idp.acme.com/saml/sso");
    expect(fetchSpy.mock.calls[0][0]).toBe(
      "https://auth.lumen.md/api/sso/authorize?domain=acme.com",
    );
  });

  it("throws on a 4xx response", async () => {
    __setWorkOSConfigForTesting({ endpoint: "https://auth.lumen.md" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 404 })),
    );
    await expect(signInWithSso("acme.com")).rejects.toThrow(/404/);
  });
});

describe("loadSsoSession", () => {
  it("returns null when no endpoint is configured", async () => {
    expect(await loadSsoSession()).toBeNull();
  });

  it("returns null on 401 (anonymous)", async () => {
    __setWorkOSConfigForTesting({ endpoint: "https://auth.lumen.md" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 401 })),
    );
    expect(await loadSsoSession()).toBeNull();
  });

  it("returns the User from the worker JSON", async () => {
    __setWorkOSConfigForTesting({ endpoint: "https://auth.lumen.md" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            user: { id: "u1", email: "x@acme.com", provider: "workos" },
          }),
          { status: 200 },
        ),
      ),
    );
    const user = await loadSsoSession();
    expect(user?.id).toBe("u1");
    expect(user?.provider).toBe("workos");
  });

  it("swallows network errors as anonymous (returns null)", async () => {
    __setWorkOSConfigForTesting({ endpoint: "https://auth.lumen.md" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await loadSsoSession()).toBeNull();
  });
});

describe("signOutSso + workosProvider record", () => {
  it("signOutSso is a safe no-op when no endpoint is configured", async () => {
    await expect(signOutSso()).resolves.toBeUndefined();
  });

  it("workosProvider.name is the stable telemetry tag", () => {
    expect(workosProvider.name).toBe("workos");
  });

  it("workosProvider.loadSession + signOut are wired through to the helpers", async () => {
    __setWorkOSConfigForTesting({ endpoint: "https://auth.lumen.md" });
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response("", { status: 401 }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    await workosProvider.loadSession();
    await workosProvider.signOut();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
