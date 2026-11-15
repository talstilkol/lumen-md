/**
 * Plan W8.7: one source for the embed providers. security/policy.json's
 * embedProviders is rendered into the content frame's frame-src (W6.40: the
 * app frames only the content frame's own site) and into Tauri's rule, read
 * by the embed block's link logic and by the airplane switch; `npm run
 * headers` fails a second list.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// @ts-expect-error — plain .mjs script, no type declarations
import { directivesFor, embedProviderProblems, EMBED_PROVIDERS, run } from "../../scripts/headers.mjs";
import { EMBED_PROVIDER_ORIGINS, isEmbedProvider } from "../lib/embedProviders";
import { EMBED_ORIGINS as AIRPLANE_ORIGINS } from "../privacy/airplane";
import { embedFor } from "../plugins/embedUrl";

const ROOT = process.cwd();
const policy = JSON.parse(readFileSync(resolve(ROOT, "security/policy.json"), "utf8"));
const clone = () => JSON.parse(JSON.stringify(policy));
const httpsOf = (list: string[]) => list.filter((t) => t.startsWith("https://")).sort();
const FRAME_SITE = "https://lumen-md-frame.pages.dev";

describe("embed providers: one list (W8.7)", () => {
  it("the content frame's frame-src and Tauri's rule name the list; the app, the airplane switch and every rendered header have exactly it", () => {
    expect(policy.routes["content-frame"].csp["frame-src"]).toEqual([EMBED_PROVIDERS]);
    const list = [...policy.embedProviders].sort();
    expect([...EMBED_PROVIDER_ORIGINS].sort()).toEqual(list);
    // The airplane switch: the list, plus the content frame's own site and the Gist script.
    // No gist.github.com (W10.D2): a Gist is a link, so the airplane switch has nothing to stop there.
    expect([...AIRPLANE_ORIGINS].sort()).toEqual([...list, FRAME_SITE].sort());
    for (const host of ["vercel", "cloudflare", "netlify", "deploy-nginx", "meta", "tauri"]) {
      if (!policy.hosts?.[host]) continue;
      const cf = (directivesFor(policy, "content-frame", host) as Map<string, string[]>).get("frame-src") ?? [];
      expect(httpsOf(cf), `${host} content-frame`).toEqual(list);
      const app = httpsOf((directivesFor(policy, "app", host) as Map<string, string[]>).get("frame-src") ?? []);
      // Tauri sends one policy for every asset, so its app policy carries the providers too.
      expect(app, `${host} app`).toEqual(host === "tauri" ? [...list, FRAME_SITE].sort() : [FRAME_SITE]);
    }
    const headers = readFileSync(resolve(ROOT, "public/_headers"), "utf8");
    const frameSrcs = [...headers.matchAll(/frame-src ([^;]+);/g)].map((m) => httpsOf(m[1].split(" ")));
    expect(frameSrcs).toContainEqual(list);
  });

  it("every frame the embed block makes is on the list; a site outside it gets no frame", () => {
    const links = [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://vimeo.com/76979871",
      "https://www.loom.com/share/abc123",
      "https://codepen.io/someone/pen/xyzAB",
      "https://codesandbox.io/s/my-box-1",
      "https://www.figma.com/file/AbC/Design",
      "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC",
      "https://www.google.com/maps?q=Tel+Aviv",
      "https://www.google.com/maps/embed?pb=xyz",
      "https://www.openstreetmap.org/#map=12/32.0853/34.7818",
      "https://twitter.com/user/status/1234567890",
      "https://www.facebook.com/page/posts/123",
      "https://www.instagram.com/reel/AbC-12/",
      "https://www.tiktok.com/@some.one/video/7000000000",
      "https://www.reddit.com/r/typescript/comments/abc12/title",
      "https://www.linkedin.com/embed/feed/update/urn:li:share:123",
      "https://soundcloud.com/artist/track",
    ];
    for (const link of links) {
      const e = embedFor(link);
      expect(e, link).not.toBeNull();
      expect(e!.generic, link).toBeFalsy();
      expect(isEmbedProvider(e!.src), `${link} → ${e!.src}`).toBe(true);
    }
    // A Gist is a link (W10.D2), not a frame from gist.github.com.
    expect(embedFor("https://gist.github.com/someone/abc123")?.gist).toEqual({ user: "someone", id: "abc123" });
    for (const link of ["https://example.com/page", "http://www.youtube.com/embed/x", "https://www.google.co.il/maps/embed?pb=1", "https://evil.example/www.google.com/maps/embed?pb=1"]) {
      const e = embedFor(link);
      if (e) expect(e.generic || isEmbedProvider(e.src), link).toBe(true);
      if (e?.generic) expect(e.src, link).toBe(link);
    }
    expect(embedFor("https://evil.example/www.google.com/maps/embed?pb=1")?.generic).toBe(true);
  });

  it("headers --check fails a gap: an https site beside the list, a provider copied into the app, or one added by a host rule", () => {
    expect(embedProviderProblems(policy)).toEqual([]);
    const beside = clone();
    beside.routes["content-frame"].csp["frame-src"].push("https://example.com");
    expect((run({ root: ROOT, policy: beside }).problems as string[]).some((p) => p.includes("frame-src names https://example.com itself"))).toBe(true);
    const copied = clone();
    copied.routes.app.csp["frame-src"].push("https://www.youtube.com");
    expect(embedProviderProblems(copied).some((p: string) => p.includes("route app frame-src names https://www.youtube.com itself"))).toBe(true);
    const host = clone();
    host.hosts.vercel.csp = [...(host.hosts.vercel.csp ?? []), { routes: ["app"], add: { "frame-src": ["https://example.com"] } }];
    expect((run({ root: ROOT, policy: host }).problems as string[]).some((p) => p.includes("adds https://example.com to frame-src"))).toBe(true);
  });

  it("the app may still frame the content frame's own site, which is not a provider (W6.40)", () => {
    expect(policy.routes.app.csp["frame-src"]).toContain(FRAME_SITE);
    expect(policy.embedProviders).not.toContain(FRAME_SITE);
    expect(embedProviderProblems(policy).filter((p: string) => p.includes(FRAME_SITE))).toEqual([]);
  });

  it("headers --check fails when the list and the rendered headers part: a provider added to the list but not rendered", () => {
    const more = clone();
    more.embedProviders.push("https://www.example.org");
    const problems = run({ root: ROOT, policy: more }).problems as string[];
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join("\n")).toContain("https://www.example.org");
  });

  it("the list holds bare https origins, once each", () => {
    for (const bad of [["https://www.youtube.com/embed"], ["http://player.vimeo.com"], ["https://codepen.io", "https://codepen.io"], []]) {
      const p = clone();
      p.embedProviders = bad;
      expect(embedProviderProblems(p).length, JSON.stringify(bad)).toBeGreaterThan(0);
    }
  });
});
