/**
 * vercel.json routing on the production host: the static pages' clean URLs
 * are rewritten to their .html files before the SPA fallback catches them.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "..", "..");
type Rewrite = { source: string; destination: string };
const rewrites = (JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8")) as { rewrites: Rewrite[] }).rewrites;
const spa = rewrites.findIndex((r) => r.destination === "/index.html");

describe("vercel.json rewrites", () => {
  it.each(["roadmap", "landing", "benchmarks"])("/%s goes to its .html page before the SPA fallback", (name) => {
    const i = rewrites.findIndex((r) => r.source === `/${name}`);
    expect(i, `no rewrite for /${name}`).toBeGreaterThanOrEqual(0);
    expect(rewrites[i].destination).toBe(`/${name}.html`);
    expect(i).toBeLessThan(spa);
    expect(existsSync(join(ROOT, "public", `${name}.html`))).toBe(true);
  });

  it("the service worker keeps /api/ and the clean static URLs off the cached index.html", () => {
    const vite = readFileSync(join(ROOT, "vite.config.ts"), "utf8");
    const m = vite.match(/navigateFallbackDenylist:\s*\[([^\]]*)\]/);
    expect(m, "navigateFallbackDenylist").not.toBeNull();
    const patterns = [...m![1].matchAll(/\/((?:\\\/|[^/])+)\//g)].map((x) => new RegExp(x[1]));
    const denied = (p: string) => patterns.some((re) => re.test(p));
    expect(denied("/api/sso/callback")).toBe(true);
    expect(denied("/roadmap")).toBe(true);
    expect(denied("/notes/a")).toBe(false);
    expect(denied("/")).toBe(false);
  });
});
