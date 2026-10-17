/**
 * Auth status messages + docs links (PRODUCT_IMPROVEMENT 1.4 / 2.4).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  classifyAuthError,
  describeAuthError,
  describeAuthStatus,
  consumeSsoFlash,
} from "../auth/authStatus";
import { DOCS_TOPICS, docsUrl } from "../lib/docsLinks";
import { useAuth } from "../auth/useAuth";
import { localProvider } from "../auth/localProvider";
import type { AuthProvider } from "../auth/types";

describe("docsLinks", () => {
  it("every topic points at a page that exists in docs/", () => {
    const base = resolve(__dirname, "..", "..", "docs", "src", "content", "docs");
    for (const slug of Object.values(DOCS_TOPICS)) {
      const found = [".md", ".mdx"].some((ext) => existsSync(resolve(base, slug + ext)));
      expect(found, `missing docs page for ${slug}`).toBe(true);
    }
  });

  it("builds absolute URLs with optional anchors", () => {
    expect(docsUrl("signIn")).toBe("https://lumen-md-docs.vercel.app/account/sign-in/");
    expect(docsUrl("sso", "error-reasons")).toBe("https://lumen-md-docs.vercel.app/account/sso/#error-reasons");
  });
});

describe("classifyAuthError", () => {
  it.each([
    ["Sign in requires Lumen Cloud. Set VITE_SUPABASE_URL…", "notConfigured"],
    ["WorkOS endpoint not configured (VITE_WORKOS_ENDPOINT)", "notConfigured"],
    [new TypeError("Failed to fetch"), "network"],
    ["NetworkError when attempting to fetch resource.", "network"],
    ["Invalid login credentials", "invalidCredentials"],
    ["JWT expired", "sessionExpired"],
    ["no_sso_connection", "ssoNoConnection"],
    ["state_mismatch", "ssoStateMismatch"],
    ["access_denied", "ssoDenied"],
    ["kaboom", "unknown"],
    ["", "unknown"],
  ])("%s → %s", (input, reason) => {
    expect(classifyAuthError(input)).toBe(reason);
  });
});

describe("describeAuthStatus", () => {
  it("signed in: no docs link, names the user", () => {
    const d = describeAuthStatus({ status: "authenticated", providerName: "supabase", userLabel: "ada@acme.com" });
    expect(d.kind).toBe("signedIn");
    expect(d.title).toBe("Signed in");
    expect(d.hint).toContain("ada@acme.com");
    expect(d.learnMoreUrl).toBeUndefined();
  });

  it("local provider → not configured, with a setup link", () => {
    const d = describeAuthStatus({ status: "anonymous", providerName: "local" });
    expect(d.kind).toBe("notConfigured");
    expect(d.title).toBe("Sign-in not configured");
    expect(d.learnMoreUrl).toBe(docsUrl("signIn", "enable-accounts"));
  });

  it("cloud provider, anonymous → signed out", () => {
    const d = describeAuthStatus({ status: "anonymous", providerName: "supabase" });
    expect(d.kind).toBe("signedOut");
    expect(d.learnMoreUrl).toBe(docsUrl("signIn"));
  });

  it("error → actionable hint + troubleshooting link", () => {
    const d = describeAuthStatus({ status: "error", providerName: "supabase", error: "Failed to fetch" });
    expect(d.kind).toBe("error");
    expect(d.reason).toBe("network");
    expect(d.hint).toMatch(/check your connection/i);
    expect(d.learnMoreUrl).toBe(docsUrl("signIn", "troubleshooting"));
  });

  it("SSO errors link to the SSO page", () => {
    expect(describeAuthError("no_sso_connection").learnMoreUrl).toBe(docsUrl("sso", "error-reasons"));
  });

  it("loading has a status message too", () => {
    expect(describeAuthStatus({ status: "loading" }).title).toBe("Checking sign-in…");
  });
});

describe("consumeSsoFlash", () => {
  it("returns null without the flag", () => {
    expect(consumeSsoFlash({ search: "?x=1", pathname: "/", hash: "" }, vi.fn())).toBeNull();
  });

  it("parses ok / error and strips only the SSO params", () => {
    const replace = vi.fn();
    expect(consumeSsoFlash({ search: "?sso=ok&doc=a", pathname: "/app", hash: "#h" }, replace)).toEqual({ ok: true });
    expect(replace).toHaveBeenCalledWith("/app?doc=a#h");
    expect(
      consumeSsoFlash({ search: "?sso=error&reason=state_mismatch", pathname: "/", hash: "" }, replace),
    ).toEqual({ ok: false, reason: "state_mismatch" });
    expect(replace).toHaveBeenLastCalledWith("/");
  });
});

describe("useAuth failure state", () => {
  beforeEach(() => {
    useAuth.setState({ status: "anonymous", user: null, provider: localProvider, error: undefined });
  });

  it("publishes status=error + message to subscribers on a failed sign-in", async () => {
    const seen: string[] = [];
    const unsub = useAuth.subscribe((s) => seen.push(s.status));
    await expect(useAuth.getState().signIn("a@b.co", "secret123")).rejects.toThrow();
    unsub();
    expect(useAuth.getState().status).toBe("error");
    expect(useAuth.getState().error).toMatch(/Lumen Cloud/);
    expect(seen).toContain("error");
  });

  it("keeps an existing session when a later action fails", async () => {
    const failing: AuthProvider = {
      name: "supabase",
      loadSession: async () => null,
      signInWithProvider: async () => {
        throw new Error("Failed to fetch");
      },
      signOut: async () => {},
    };
    useAuth.setState({ status: "authenticated", user: { id: "u1", provider: "supabase" }, provider: failing });
    await expect(useAuth.getState().signInWithProvider("github")).rejects.toThrow();
    expect(useAuth.getState().status).toBe("authenticated");
    expect(useAuth.getState().error).toBe("Failed to fetch");
  });
});
