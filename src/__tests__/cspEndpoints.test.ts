// @vitest-environment node
/**
 * Build-time CSP extension for deployment worker origins (VITE_*_ENDPOINT).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  endpointOrigins,
  addConnectSrc,
  extendIndexHtmlCsp,
  extendHeadersFileCsp,
  ENDPOINT_ENV_VARS,
  EXTRA_CONNECT_ENV_VAR,
  NGINX_PLACEHOLDER,
} from "../build/cspEndpoints";

const ROOT = resolve(__dirname, "..", "..");

describe("endpointOrigins", () => {
  it("collects origins of configured endpoints, deduped and sorted", () => {
    expect(
      endpointOrigins({
        VITE_WORKOS_ENDPOINT: "https://lumen-auth.acme.workers.dev",
        VITE_ENTITLEMENT_ENDPOINT: "https://billing.acme.dev/entitlements",
        VITE_BILLING_ENDPOINT: "https://billing.acme.dev",
        VITE_PUBLISH_ENDPOINT: "http://localhost:8787/p",
      }),
    ).toEqual(["http://localhost:8787", "https://billing.acme.dev", "https://lumen-auth.acme.workers.dev"]);
  });

  it("ignores empty, invalid, placeholder and non-HTTP values", () => {
    expect(
      endpointOrigins({
        VITE_WORKOS_ENDPOINT: "",
        VITE_BILLING_ENDPOINT: "not a url",
        VITE_PUBLISH_ENDPOINT: "https://your-worker.workers.dev",
        VITE_AUDIT_ENDPOINT: "https://example.com/audit",
        VITE_MARKETPLACE_URL: "ftp://files.acme.dev",
      }),
    ).toEqual([]);
  });
});

describe("addConnectSrc", () => {
  it("appends to connect-src only, without duplicates", () => {
    const csp = "default-src 'self'; connect-src 'self' https://a.dev; img-src 'self'";
    expect(addConnectSrc(csp, ["https://b.dev", "https://a.dev"])).toBe(
      "default-src 'self'; connect-src 'self' https://a.dev https://b.dev; img-src 'self'",
    );
    expect(addConnectSrc(csp, [])).toBe(csp);
  });
});

describe("applied to the real policy files", () => {
  const origins = ["https://lumen-auth.acme.workers.dev"];
  it("index.html meta CSP gains the origin", () => {
    const html = extendIndexHtmlCsp(readFileSync(resolve(ROOT, "index.html"), "utf8"), origins);
    const csp = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i)![1];
    expect(csp).toMatch(/connect-src [^;]*https:\/\/lumen-auth\.acme\.workers\.dev/);
  });
  it("_headers CSP gains the origin", () => {
    const text = extendHeadersFileCsp(readFileSync(resolve(ROOT, "public/_headers"), "utf8"), origins);
    expect(text).toMatch(/Content-Security-Policy:[^\n]*connect-src [^;]*https:\/\/lumen-auth\.acme\.workers\.dev/);
  });
  it("the one image passes every endpoint variable to the build (.env* is not in the context)", () => {
    const vars = [...ENDPOINT_ENV_VARS, EXTRA_CONNECT_ENV_VAR];
    const text = readFileSync(resolve(ROOT, "Dockerfile"), "utf8");
    const build = text.slice(0, text.indexOf("RUN npm run build"));
    for (const v of vars) expect(build, `Dockerfile: ARG ${v} before the build`).toMatch(new RegExp(`^ARG ${v}$`, "m"));
    expect(readFileSync(resolve(ROOT, ".dockerignore"), "utf8")).toMatch(/^\.env\*$/m);
  });

  it("nginx.conf carries the placeholder the image build fills in", () => {
    // The eval-workers include allows the app's own origin only, so it has no placeholder.
    expect(readFileSync(resolve(ROOT, "deploy/nginx.conf"), "utf8")).toContain(NGINX_PLACEHOLDER);
    expect(readFileSync(resolve(ROOT, "Dockerfile"), "utf8")).toContain(NGINX_PLACEHOLDER);
  });
});

describe("VITE_CSP_CONNECT_EXTRA", () => {
  it("adds explicitly listed origins (http/https/ws/wss) and ignores junk", async () => {
    const { endpointOrigins } = await import("../build/cspEndpoints");
    expect(
      endpointOrigins({ VITE_CSP_CONNECT_EXTRA: "http://192.168.1.20:11434, https://market.acme.dev/api wss://collab.acme.dev javascript:x nope" }),
    ).toEqual(["http://192.168.1.20:11434", "https://market.acme.dev", "wss://collab.acme.dev"]);
  });
});
