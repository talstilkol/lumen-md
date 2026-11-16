/**
 * Plan W6.40 (review E52): the content frame runs on its own origin, never
 * the app's. In e2e the frame site is the dev server by its other loopback
 * name (playwright.config.ts: VITE_CONTENT_FRAME_URL). Code evaluated inside
 * each frame stands in for a future XSS there: it must not reach the app's
 * localStorage, IndexedDB or document.
 *
 * W10.D2: a Gist is never framed (its embed is GitHub's script
 * document.write()ing into the page): the app shows a link. A hostile
 * request, and the frame page opened by its URL directly, run no script of
 * the request's and reach none of the app's storage.
 */
import { expect, test, type Frame, type Page } from "@playwright/test";
import { testHooks, type LumenTestWindow } from "./_lumen";

const SECRET = "lumen-e2e-vault-secret";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

/** A content frame made by the app's own module, as the preview makes it. */
async function contentFrame(page: Page, request: object): Promise<{ tag: string; src: string; frame: Frame | null }> {
  // W4.2: through the app's own chunks, so the spec also runs on the VITE_E2E=1 build the gate serves.
  await testHooks(page);
  const made = await page.evaluate(async (r) => {
    const m = await (window as unknown as LumenTestWindow).__lumenTest.load("lib/contentFrame");
    const el = m.createContentFrame(r as Parameters<typeof m.createContentFrame>[0]);
    document.body.append(el);
    return { tag: el.tagName, src: el.getAttribute("src") ?? el.getAttribute("href") ?? "" };
  }, request);
  if (made.tag !== "IFRAME") return { ...made, frame: null };
  await expect.poll(() => page.frames().some((f) => f.url() === made.src)).toBe(true);
  const frame = page.frames().find((f) => f.url() === made.src)!;
  await frame.waitForLoadState();
  return { ...made, frame };
}

/** What code running in `frame` can reach. */
const reach = (frame: Frame) =>
  frame.evaluate(async (secret) => {
    const t = (f: () => unknown) => {
      try {
        return String(f());
      } catch (e) {
        return (e as Error).name;
      }
    };
    const dbs = await indexedDB.databases().then((l) => l.map((d) => d.name).join(","), (e: Error) => e.name);
    return { origin: self.origin, storage: t(() => localStorage.getItem(secret)), parent: t(() => parent.document.title), dbs };
  }, SECRET);

test.beforeEach(async ({ page }) => {
  await page.context().route(/^https:\/\/(img\.lumen-e2e\.test|www\.youtube-nocookie\.com)\//, (route) =>
    route.request().url().includes("img.")
      ? route.fulfill({ contentType: "image/png", body: PNG })
      : route.fulfill({ contentType: "text/html", body: "<!doctype html><title>player</title>" }),
  );
  await page.goto("/");
  await page.evaluate((s) => {
    localStorage.setItem(s, "SECRET");
    indexedDB.open("lumen-e2e-app-db");
  }, SECRET);
});

for (const [kind, request] of [
  ["img", { kind: "img", src: "https://img.lumen-e2e.test/a.png", alt: "a" }],
  ["video", { kind: "video", src: "https://img.lumen-e2e.test/v.mp4" }],
  ["embed", { kind: "embed", src: "https://www.youtube-nocookie.com/embed/e2e", title: "Player" }],
 ] as const) {
  test(`${kind}: a script in the content frame can't reach the app's storage or document`, async ({ page }) => {
    const app = new URL(page.url()).origin;
    const { tag, src, frame } = await contentFrame(page, request);
    expect(tag).toBe("IFRAME");
    expect(new URL(src).origin).not.toBe(app);
    const r = await reach(frame!);
    expect(r.origin).not.toBe(app);
    expect(r.storage).not.toBe("SECRET");
    expect(r.parent).toBe("SecurityError");
    expect(r.dbs).not.toContain("lumen-e2e-app-db");
    // Only an embed keeps an origin of its own, and it is the frame site's.
    expect(r.origin).toBe(kind === "embed" ? new URL(src).origin : "null");
  });
}

test("gist: a link to gist.github.com, no frame and no third-party script on any page of ours", async ({ page }) => {
  const scripts: string[] = [];
  page.on("request", (r) => {
    if (/gist\.github(usercontent)?\.com/.test(r.url())) scripts.push(r.url());
  });
  const { tag, src } = await contentFrame(page, { kind: "gist", user: "someone", id: "abc123" });
  expect(tag).toBe("A");
  expect(new URL(src).origin).toBe("https://gist.github.com");
  const link = page.locator('a[data-content-frame="gist"]');
  await expect(link).toHaveAttribute("rel", /noopener/);
  expect(await page.locator('iframe[data-content-frame="gist"], script[src*="gist.github"]').count()).toBe(0);
  expect(scripts).toEqual([]);
});

/** The frame page's own URL, as the app builds it for an image. */
async function frameUrl(page: Page): Promise<string> {
  const { src } = await contentFrame(page, { kind: "img", src: "https://img.lumen-e2e.test/a.png", alt: "a" });
  return src.split("#")[0];
}

test("hostile requests opened directly at the frame's URL: no script of theirs runs, the app's storage is out of reach", async ({ page }) => {
  const app = new URL(page.url()).origin;
  const base = await frameUrl(page);
  const hostile = [
    { kind: "img", src: "https://img.lumen-e2e.test/a.png", alt: '"><img src=x onerror="window.__pwned=1">', title: "<script>window.__pwned=1</script>" },
    { kind: "img", src: "javascript:window.__pwned=1" },
    { kind: "embed", src: "javascript:window.__pwned=1", title: "x" },
    { kind: "embed", src: "https://evil.lumen-e2e.test/x.html", title: "<svg onload=window.__pwned=1>" },
    { kind: "video", src: "data:text/html,<script>window.__pwned=1</script>" },
    { kind: "gist", user: "someone", id: "abc123" },
  ];
  // A provider not on the frame page's frame-src list is never fetched (its CSP blocks it).
  const evil: string[] = [];
  await page.context().route(/^https:\/\/evil\.lumen-e2e\.test\//, (route) => {
    evil.push(route.request().url());
    return route.fulfill({ contentType: "text/html", body: "<script>parent.__pwned=1</script>" });
  });
  for (const req of hostile) {
    const direct = await page.context().newPage();
    const errors: string[] = [];
    direct.on("pageerror", (e) => errors.push(e.message));
    await direct.goto(`${base}#${encodeURIComponent(JSON.stringify(req))}`);
    await direct.waitForLoadState();
    const r = await direct.evaluate(async (secret) => {
      const t = (f: () => unknown) => {
        try {
          return String(f());
        } catch (e) {
          return (e as Error).name;
        }
      };
      const dbs = await indexedDB.databases().then((l) => l.map((d) => d.name).join(","), (e: Error) => e.name);
      return {
        origin: self.origin,
        pwned: (window as unknown as { __pwned?: number }).__pwned ?? 0,
        storage: t(() => localStorage.getItem(secret)),
        dbs,
        scripts: document.scripts.length,
        frames: [...document.querySelectorAll("iframe")].map((f) => f.getAttribute("src") ?? ""),
      };
    }, SECRET);
    expect(r.origin, JSON.stringify(req)).not.toBe(app);
    expect(r.pwned, JSON.stringify(req)).toBe(0);
    expect(r.storage, JSON.stringify(req)).not.toBe("SECRET");
    expect(r.dbs, JSON.stringify(req)).not.toContain("lumen-e2e-app-db");
    expect(r.scripts, JSON.stringify(req)).toBe(1); // the page's own, allowed by its hash
    for (const f of r.frames) expect(f, JSON.stringify(req)).toMatch(/^https:\/\//);
    await direct.close();
  }
  expect(evil).toEqual([]);
});
