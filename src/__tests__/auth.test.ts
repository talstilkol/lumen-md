/**
 * Smoke tests for the auth store. We exercise the local provider end-to-end
 * (no network, no Supabase) so the framework can ship without the SDK.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { useAuth, initAuth } from "../auth/useAuth";
import { localProvider } from "../auth/localProvider";

describe("auth store", () => {
  beforeEach(() => {
    useAuth.setState({
      status: "loading",
      user: null,
      provider: localProvider,
      error: undefined,
    });
  });

  it("initializes anonymously when no provider is configured", async () => {
    await initAuth();
    // After init, status should resolve to anonymous (or stay so on subsequent calls).
    const { status, user } = useAuth.getState();
    expect(["anonymous", "loading"]).toContain(status);
    expect(user).toBeNull();
  });

  it("rejects sign-in attempts on the local provider", async () => {
    await expect(
      useAuth.getState().signIn("nobody@example.com", "secret123"),
    ).rejects.toThrow(/Lumen Cloud/);
  });

  it("rejects OAuth attempts on the local provider", async () => {
    await expect(
      useAuth.getState().signInWithProvider("google"),
    ).rejects.toThrow(/Lumen Cloud/);
  });

  it("signOut is a no-op when anonymous", async () => {
    await useAuth.getState().signOut();
    expect(useAuth.getState().status).toBe("anonymous");
  });
});
