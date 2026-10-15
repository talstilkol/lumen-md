/**
 * Unit tests for the Trusted Types policies in src/lib/trustedTypes.ts.
 *
 * jsdom has no Trusted Types implementation, so we install a minimal fake
 * `trustedTypes` factory that records created policies and wraps their
 * output in a TrustedHTML-like object (with toString, like the real one).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  __resetTrustedTypesForTests,
  allowScriptUrl,
  installTrustedTypesPolicies,
  parseInertDocument,
  safeClearHtml,
  safeSetHtml,
  sanitizeForDefaultPolicy,
  setSandboxedSrcdoc,
  toTrustedHTML,
  TRUSTED_TYPES_POLICY_NAMES,
  type TrustedTypesFactory,
} from "../lib/trustedTypes";

type Opts = {
  createHTML?: (s: string, ...a: unknown[]) => string | null;
  createScript?: (s: string, ...a: unknown[]) => string | null;
  createScriptURL?: (s: string, ...a: unknown[]) => string | null;
};

class FakeTrusted {
  constructor(readonly value: string) {}
  toString() {
    return this.value;
  }
}

function fakeFactory(allowed: readonly string[] = TRUSTED_TYPES_POLICY_NAMES) {
  const policies = new Map<string, Opts>();
  let defaultPolicy: unknown = null;
  const factory: TrustedTypesFactory & { policies: Map<string, Opts> } = {
    policies,
    get defaultPolicy() {
      return defaultPolicy;
    },
    createPolicy(name: string, opts: Opts) {
      if (!allowed.includes(name)) throw new TypeError(`policy ${name} disallowed`);
      if (policies.has(name)) throw new TypeError(`duplicate ${name}`);
      policies.set(name, opts);
      const policy = {
        createHTML: (s: string, ...a: unknown[]) =>
          new FakeTrusted(opts.createHTML!(s, ...a) ?? "") as unknown as TrustedHTML,
      };
      if (name === "default") defaultPolicy = policy;
      return policy;
    },
  };
  return factory;
}

const XSS_HTML = `<p>hi</p><img src=x onerror="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)">x</a>`;
const XSS_SVG = `<svg xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="5" r="4" onload="alert(1)"/><script>alert(2)</script></svg>`;

function expectClean(out: string) {
  expect(out).not.toMatch(/onerror|onload|<script|javascript:/i);
}

describe("trustedTypes — no Trusted Types support (fallback)", () => {
  beforeEach(() => {
    __resetTrustedTypesForTests();
    delete (globalThis as { trustedTypes?: unknown }).trustedTypes;
  });

  it("installTrustedTypesPolicies() is a no-op returning false", () => {
    expect(installTrustedTypesPolicies()).toBe(false);
  });

  it("toTrustedHTML still sanitizes (never identity)", () => {
    const out = String(toTrustedHTML(XSS_HTML));
    expectClean(out);
    expect(out).toContain("<p>hi</p>");
  });

  it("safeSetHtml sanitizes before assigning innerHTML (html and svg)", () => {
    const div = document.createElement("div");
    safeSetHtml(div, XSS_HTML);
    expectClean(div.innerHTML);
    expect(div.querySelector("p")?.textContent).toBe("hi");

    const host = document.createElement("div");
    safeSetHtml(host, XSS_SVG, "svg");
    expectClean(host.innerHTML);
    expect(host.querySelector("circle")).not.toBeNull();
  });

  it("safeClearHtml empties the element", () => {
    const div = document.createElement("div");
    div.innerHTML = "<b>x</b><i>y</i>";
    safeClearHtml(div);
    expect(div.childNodes.length).toBe(0);
  });
});

describe("trustedTypes — with a Trusted Types factory", () => {
  let factory: ReturnType<typeof fakeFactory>;

  beforeEach(() => {
    __resetTrustedTypesForTests();
    factory = fakeFactory();
    (globalThis as { trustedTypes?: unknown }).trustedTypes = factory;
  });
  afterEach(() => {
    delete (globalThis as { trustedTypes?: unknown }).trustedTypes;
    __resetTrustedTypesForTests();
  });

  it("creates the `lumen` and `default` policies once (idempotent)", () => {
    expect(installTrustedTypesPolicies()).toBe(true);
    expect(installTrustedTypesPolicies()).toBe(true);
    expect([...factory.policies.keys()].sort()).toEqual(["default", "lumen"]);
  });

  it("`lumen` createHTML sanitizes with DOMPurify instead of passing through", () => {
    installTrustedTypesPolicies();
    const lumen = factory.policies.get("lumen")!;
    const html = lumen.createHTML!(XSS_HTML)!;
    expectClean(html);
    expect(html).toContain("<p>hi</p>");
    const svg = lumen.createHTML!(XSS_SVG, "svg")!;
    expectClean(svg);
    expect(svg).toContain("<circle");
  });

  it("toTrustedHTML returns a TrustedHTML from the `lumen` policy", () => {
    installTrustedTypesPolicies();
    const out = toTrustedHTML(XSS_HTML);
    expect(out).toBeInstanceOf(FakeTrusted);
    expectClean(String(out));
  });

  it("`default` policy sanitizes third-party HTML sinks (keeps SVG/MathML)", () => {
    installTrustedTypesPolicies();
    const def = factory.policies.get("default")!;
    const out = def.createHTML!(XSS_HTML + XSS_SVG, "Element innerHTML")!;
    expectClean(out);
    expect(out).toContain("<circle");
    expect(def.createHTML!("<math><mi>x</mi></math>", "Element innerHTML")).toContain("<math>");
    // Mermaid-style inline styles survive.
    expect(def.createHTML!('<span style="color:red">a</span>', "Element innerHTML")).toContain("color:red");
  });

  it("`default` policy keeps a whole document for srcdoc sinks", () => {
    const out = sanitizeForDefaultPolicy(
      "<!doctype html><html><head><title>t</title></head><body><p>x</p><script>1</script></body></html>",
      "HTMLIFrameElement srcdoc",
    );
    expect(out).toMatch(/<html/i);
    expect(out).toContain("<p>x</p>");
    expect(out).not.toContain("<script");
  });

  it("`default` createScriptURL only allows same-origin URLs", () => {
    expect(allowScriptUrl("/assets/worker.js")).toBe("/assets/worker.js");
    expect(allowScriptUrl(`${location.origin}/a.js`)).toBe(`${location.origin}/a.js`);
    expect(allowScriptUrl("https://evil.example.com/x.js")).toBeNull();
    expect(allowScriptUrl("data:text/javascript,alert(1)")).toBeNull();
  });

  it("falls back to sanitized strings when `lumen` is not allowed by the CSP", () => {
    __resetTrustedTypesForTests();
    factory = fakeFactory(["default"]);
    (globalThis as { trustedTypes?: unknown }).trustedTypes = factory;
    expect(installTrustedTypesPolicies()).toBe(true);
    const out = toTrustedHTML(XSS_HTML);
    expect(typeof out).toBe("string");
    expectClean(out as string);
  });

  it("parseInertDocument passes XML through unchanged (inert DOMParser sink)", () => {
    installTrustedTypesPolicies();
    const doc = parseInertDocument('<w:document xmlns:w="urn:x"><w:t>Hello</w:t></w:document>', "application/xml");
    expect(doc.documentElement.textContent).toBe("Hello");
  });

  it("setSandboxedSrcdoc refuses frames that are not sandboxed or allow same-origin", () => {
    installTrustedTypesPolicies();
    const plain = document.createElement("iframe");
    expect(() => setSandboxedSrcdoc(plain, "<p>x</p>")).toThrow();
    const sameOrigin = document.createElement("iframe");
    sameOrigin.setAttribute("sandbox", "allow-scripts allow-same-origin");
    expect(() => setSandboxedSrcdoc(sameOrigin, "<p>x</p>")).toThrow();

    const ok = document.createElement("iframe");
    ok.setAttribute("sandbox", "allow-scripts");
    setSandboxedSrcdoc(ok, "<p>x</p><script>1</script>");
    // Opaque-origin sandbox: user markup (incl. scripts) is passed through.
    expect(ok.srcdoc).toBe("<p>x</p><script>1</script>");
  });
});
