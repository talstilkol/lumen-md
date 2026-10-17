// @vitest-environment node
/** Research worker (edge-workers/research): who may call it, decoding, and the extraction deadline. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import worker, { TOKEN_HEADER, type Env } from "../../edge-workers/research/worker";

const ORIGIN = "https://lumen-md.app";
const ctx = { waitUntil: () => {} };
let ip = 0;

function call(path: string, init: { method?: string; headers?: Record<string, string> } = {}, env: Env = { ALLOWED_ORIGINS: ORIGIN }) {
  // A fresh client IP per request keeps the per-IP limit out of the way.
  const headers = { "CF-Connecting-IP": `203.0.113.${++ip % 250}`, ...init.headers };
  return worker.fetch(new Request(`https://research.example${path}`, { method: init.method ?? "GET", headers }), env, ctx);
}

const page = (body: BodyInit, headers: Record<string, string> = { "Content-Type": "text/html" }, status = 200) => new Response(body, { status, headers });

beforeEach(() => {
  vi.stubGlobal("caches", { default: { match: async () => undefined, put: async () => {} } });
});
afterEach(() => vi.unstubAllGlobals());

describe("research worker access", () => {
  it("refuses requests without an allowed Origin", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => page("<p>x</p>")));
    expect((await call("/extract?url=https://a.example/")).status).toBe(403);
    expect((await call("/extract?url=https://a.example/", { headers: { Origin: "https://evil.example" } })).status).toBe(403);
    expect((await call("/extract?url=https://a.example/", { headers: { Origin: ORIGIN } })).status).toBe(200);
    expect((await call("/healthz")).status).toBe(200);
  });

  it("requires the shared token when RESEARCH_TOKEN is set", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => page("<p>x</p>")));
    const env: Env = { ALLOWED_ORIGINS: ORIGIN, RESEARCH_TOKEN: "s3cret" };
    const pre = await call("/extract", { method: "OPTIONS", headers: { Origin: ORIGIN } }, env);
    expect(pre.status).toBe(204); // preflights carry no custom headers
    expect(pre.headers.get("Access-Control-Allow-Headers")).toContain(TOKEN_HEADER);
    expect((await call("/extract?url=https://a.example/", { headers: { Origin: ORIGIN } }, env)).status).toBe(401);
    expect((await call("/extract?url=https://a.example/", { headers: { Origin: ORIGIN, [TOKEN_HEADER]: "wrong!" } }, env)).status).toBe(401);
    expect((await call("/extract?url=https://a.example/", { headers: { Origin: ORIGIN, [TOKEN_HEADER]: "s3cret" } }, env)).status).toBe(200);
  });
});

describe("research worker extraction", () => {
  it("decodes a page with a quoted charset", async () => {
    // "café" in windows-1252: é is the single byte 0xE9 (invalid as UTF-8).
    const bytes = new Uint8Array([...new TextEncoder().encode("<p>caf"), 0xe9, ...new TextEncoder().encode("</p>")]);
    vi.stubGlobal("fetch", vi.fn(async () => page(bytes, { "Content-Type": 'text/html; charset="windows-1252"' })));
    const out = (await (await call("/extract?url=https://a.example/", { headers: { Origin: ORIGIN } })).json()) as { text: string };
    expect(out.text).toBe("café");
  });

  it("uses one deadline across redirect hops", async () => {
    const signals: Array<AbortSignal | null | undefined> = [];
    const replies = [page("", { Location: "https://b.example/" }, 302), page("", { Location: "https://c.example/" }, 301), page("<p>done</p>")];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init?: RequestInit) => (signals.push(init?.signal), replies.shift()!)));
    const out = (await (await call("/extract?url=https://a.example/", { headers: { Origin: ORIGIN } })).json()) as { finalUrl: string; text: string };
    expect(out).toMatchObject({ finalUrl: "https://c.example/", text: "done" });
    expect(signals).toHaveLength(3);
    expect(signals[0]).toBeDefined();
    expect(new Set(signals).size).toBe(1);
  });
});

describe("research worker — SearXNG (keyless)", () => {
  const post = (body: unknown, env: Env) =>
    worker.fetch(
      new Request("https://research.example/search", {
        method: "POST",
        headers: { Origin: ORIGIN, "Content-Type": "application/json", "CF-Connecting-IP": `198.51.100.${++ip % 250}` },
        body: JSON.stringify(body),
      }),
      env,
      ctx,
    );

  it("queries SEARXNG_URL as JSON without a key and keeps only fetchable URLs", async () => {
    const f = vi.fn(async () =>
      new Response(JSON.stringify({ results: [{ title: "A", url: "https://a.example/", content: "snippet" }, { title: "L", url: "http://127.0.0.1/x", content: "" }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", f);
    const res = await post({ provider: "searxng", query: "local llm" }, { ALLOWED_ORIGINS: ORIGIN, SEARXNG_URL: "http://searxng:8080/" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: [{ title: "A", url: "https://a.example/", snippet: "snippet" }] });
    expect(String((f.mock.calls[0] as unknown[])[0])).toBe("http://searxng:8080/search?q=local%20llm&format=json");
  });

  it("reports a missing SEARXNG_URL and still requires a key for Brave / Tavily", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const r = await post({ provider: "searxng", query: "q" }, { ALLOWED_ORIGINS: ORIGIN });
    expect(r.status).toBe(502);
    expect((await r.json()).error).toMatch(/SEARXNG_URL/);
    expect((await post({ provider: "brave", query: "q" }, { ALLOWED_ORIGINS: ORIGIN })).status).toBe(400);
  });
});
