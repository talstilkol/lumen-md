/** T48 — the live-js runner's policy and the deploy security headers. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "..");
const headers = readFileSync(join(root, "public/_headers"), "utf8");
const vercel = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")) as {
  headers: { source: string; headers: { key: string; value: string }[] }[];
};
const tauri = JSON.parse(readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8"));

function vercelHeader(source: string, key: string): string | undefined {
  return vercel.headers.find((h) => h.source === source)?.headers.find((x) => x.key === key)?.value;
}

describe("live-js runner CSP", () => {
  const block = headers.slice(headers.indexOf("/livejs-runner.html"));
  const csp = /Content-Security-Policy: (.*)/.exec(block)?.[1] ?? "";

  it("Cloudflare: no network, no framing by others, own policy instead of the app's", () => {
    expect(block).toMatch(/! Content-Security-Policy/);
    expect(block).toMatch(/! X-Frame-Options/);
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("default-src 'none'");
  });

  it("Vercel serves the same runner policy", () => {
    expect(vercelHeader("/livejs-runner.html", "Content-Security-Policy")).toBe(csp);
  });
});

describe("Vercel security headers", () => {
  it("sends HSTS, nosniff, referrer and permissions policies everywhere", () => {
    for (const key of ["Strict-Transport-Security", "X-Content-Type-Options", "Referrer-Policy", "Permissions-Policy"]) {
      expect(vercelHeader("/(.*)", key)).toBeTruthy();
    }
  });

  it("frames and CSP for the app exclude the two runner pages", () => {
    const entry = vercel.headers.find((h) => h.headers.some((x) => x.key === "X-Frame-Options"))!;
    const re = new RegExp(`^${entry.source}$`);
    expect(re.test("/index.html")).toBe(true);
    expect(re.test("/livejs-runner.html")).toBe(false);
    expect(re.test("/playground-runner.html")).toBe(false);
    const csp = entry.headers.find((x) => x.key === "Content-Security-Policy")!.value;
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });
});

describe("Tauri CSP", () => {
  const csp: string = tauri.app?.security?.csp ?? tauri.tauri?.security?.csp;
  it("no inline scripts; objects and foreign bases blocked", () => {
    const script = /script-src ([^;]*)/.exec(csp)?.[1] ?? "";
    expect(script).not.toContain("'unsafe-inline'");
    expect(/default-src ([^;]*)/.exec(csp)?.[1]).not.toContain("'unsafe-inline'");
    expect(csp).toContain("object-src 'none'");
  });
});
