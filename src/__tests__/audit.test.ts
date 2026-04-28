/**
 * Tests for the audit-log client (ε.2). Verifies:
 *   - When `VITE_AUDIT_ENDPOINT` isn't set, recordAudit() is a no-op.
 *   - When set, it issues a POST with the correct shape + bearer token.
 *   - listAudit serialises query params and parses the response.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
// NOTE: do not statically import "../lib/audit" — every test below uses
// vi.resetModules() + dynamic import so the module re-reads `import.meta.env`
// after `vi.stubEnv()`.

// Module-scope state — must be reset between tests; we re-import via
// dynamic-import to get a clean copy each time.
beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("recordAudit", () => {
  it("is a no-op when VITE_AUDIT_ENDPOINT is unset", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const mod = await import("../lib/audit");
    mod.recordAudit("user-1", "doc.publish");
    // fire-and-forget: no synchronous fetch call expected.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts when the endpoint env var is set", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    const mod = await import("../lib/audit");
    // Vite inlines `import.meta.env.VITE_*` at transform time, so
    // `vi.stubEnv` can't reach this module's static read. Use the
    // explicit test hook instead.
    mod.__setAuditConfigForTesting({
      endpoint: "https://audit.lumen.md",
      bearer: "secret-token",
    });
    mod.recordAudit("user-1", "doc.publish", {
      orgId: "org-7",
      payload: { slug: "hello" },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://audit.lumen.md/audit");
    const initWithHeaders = init as RequestInit;
    expect(initWithHeaders.method).toBe("POST");
    expect((initWithHeaders.headers as Record<string, string>).Authorization).toBe(
      "Bearer secret-token",
    );
    const body = JSON.parse(initWithHeaders.body as string);
    expect(body).toMatchObject({
      user_id: "user-1",
      org_id: "org-7",
      action: "doc.publish",
    });
    expect(body.payload_json).toBe(JSON.stringify({ slug: "hello" }));
    expect(body.ts).toBeGreaterThan(0);
  });
});

describe("listAudit", () => {
  it("returns [] when the endpoint isn't configured", async () => {
    vi.resetModules();
    const mod = await import("../lib/audit");
    const rows = await mod.listAudit({ orgId: "org-1" });
    expect(rows).toEqual([]);
  });

  it("serialises query params and parses the response", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          rows: [
            { user_id: "u1", org_id: "org-1", action: "x", ts: 100 },
          ],
          count: 1,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const mod = await import("../lib/audit");
    mod.__setAuditConfigForTesting({
      endpoint: "https://audit.lumen.md",
      bearer: "",
    });
    const rows = await mod.listAudit({
      orgId: "org-1",
      limit: 50,
      action: "x",
    });
    expect(fetchSpy).toHaveBeenCalledOnce();
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain("orgId=org-1");
    expect(url).toContain("limit=50");
    expect(url).toContain("action=x");
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe("u1");
  });
});
