import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getMarketplaceBackendUrl,
  fetchMarketplaceItems,
  publishToMarketplace,
  rateMarketplaceItem,
  recordRemoteInstall,
} from "../storage/templateMarketplace";

const BACKEND = "https://mkt.example.com";

function stubFetch(impl: (url: string) => unknown) {
  const f = vi.fn(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () => impl(url),
    text: async () => "",
  }));
  vi.stubGlobal("fetch", f);
  return f;
}

describe("marketplace client ↔ real backend", () => {
  beforeEach(() => localStorage.setItem("lumen.marketplace.url", BACKEND + "/"));
  afterEach(() => {
    localStorage.removeItem("lumen.marketplace.url");
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reads the configured backend URL (trailing slash trimmed)", () => {
    expect(getMarketplaceBackendUrl()).toBe(BACKEND);
  });

  it("lists items from the backend and maps them to MarketplaceTemplate", async () => {
    const f = stubFetch(() => [
      {
        id: "a",
        type: "plugin",
        name: "Alpha",
        description: "d",
        author: "x",
        version: "1",
        url: "u",
        tags: ["t"],
        downloads: 3,
        rating: 4,
      },
    ]);
    const items = await fetchMarketplaceItems({ type: "plugin", query: "al" });
    expect(String(f.mock.calls[0][0])).toContain(`${BACKEND}/items?type=plugin&q=al`);
    expect(items[0]).toMatchObject({
      id: "a",
      name: "Alpha",
      category: "plugin",
      downloads: 3,
      rating: 4,
    });
  });

  it("publishes, rates, and records installs against the backend", async () => {
    const f = stubFetch((url) =>
      url.includes("/rate")
        ? { rating: 4.5 }
        : {
            id: "p",
            type: "plugin",
            name: "P",
            description: "",
            author: "",
            version: "1",
            url: "",
            tags: [],
            downloads: 0,
            rating: 0,
          },
    );
    await publishToMarketplace({ id: "p", type: "plugin", name: "P" });
    expect(await rateMarketplaceItem("p", 5)).toBe(4.5);
    await recordRemoteInstall("p");
    // Captured at fetch-time (recordRemoteInstall never reads .json()).
    const urls = f.mock.calls.map((c) => String(c[0]));
    expect(urls).toContain(`${BACKEND}/items`);
    expect(urls.some((u) => u.endsWith("/items/p/rate"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/items/p/install"))).toBe(true);
  });

  it("falls back to offline/static mode when no backend is configured", async () => {
    localStorage.removeItem("lumen.marketplace.url");
    expect(getMarketplaceBackendUrl()).toBeNull();
    // recordRemoteInstall is a no-op offline (must not throw or call fetch)
    await expect(recordRemoteInstall("x")).resolves.toBeUndefined();
  });
});
