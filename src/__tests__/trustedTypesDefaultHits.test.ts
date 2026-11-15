/**
 * Plan W11.S17 (research R3.12): the `default` Trusted Types policy is to
 * go. First, every sink that reaches it is recorded (sink, where from, how
 * often) so a full e2e run can list them, and `safeSetHtml` uses the HTML
 * Sanitizer API's `setHTML` where the browser has it.
 * The `trustedTypes` factory is a small fake (jsdom and happy-dom have no
 * Trusted Types), as in trustedTypes.test.ts; the policies are the real ones.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetTrustedTypesForTests, defaultPolicyHits, installTrustedTypesPolicies, safeSetHtml, TRUSTED_TYPES_POLICY_NAMES, type TrustedTypesFactory } from "../lib/trustedTypes";

type Opts = { createHTML?: (s: string, ...a: unknown[]) => string | null; createScriptURL?: (s: string, ...a: unknown[]) => string | null; createScript?: (s: string, ...a: unknown[]) => string | null };

function fakeFactory() {
  const policies = new Map<string, Opts>();
  const factory: TrustedTypesFactory & { policies: Map<string, Opts> } = {
    policies,
    defaultPolicy: undefined,
    createPolicy(name: string, opts: Opts) {
      if (!TRUSTED_TYPES_POLICY_NAMES.includes(name as never)) throw new TypeError(`policy ${name} disallowed`);
      policies.set(name, opts);
      return { createHTML: (s: string, ...a: unknown[]) => opts.createHTML!(s, ...a) as unknown as TrustedHTML };
    },
  };
  return factory;
}

describe("default-policy hits are recorded (W11.S17 step 1)", () => {
  let factory: ReturnType<typeof fakeFactory>;
  // A real browser has a read-only `trustedTypes`: shadow it on the global object, then restore it.
  const own = Object.getOwnPropertyDescriptor(globalThis, "trustedTypes");
  beforeEach(() => {
    __resetTrustedTypesForTests();
    factory = fakeFactory();
    Object.defineProperty(globalThis, "trustedTypes", { value: factory, configurable: true, writable: true });
    installTrustedTypesPolicies();
  });
  afterEach(() => {
    if (own) Object.defineProperty(globalThis, "trustedTypes", own);
    else delete (globalThis as { trustedTypes?: unknown }).trustedTypes;
    __resetTrustedTypesForTests();
  });

  it("each sink, with its count, as the browser calls the policy (value, type name, sink)", () => {
    const def = factory.policies.get("default")!;
    def.createHTML!("<b>a</b>", "TrustedHTML", "Element innerHTML");
    def.createHTML!("<b>b</b>", "TrustedHTML", "Element innerHTML");
    def.createScriptURL!("/assets/w.js", "TrustedScriptURL", "Worker constructor");
    const hits = defaultPolicyHits();
    expect(hits.map((h) => [h.kind, h.sink, h.count])).toEqual([
      ["html", "Element innerHTML", 2],
      ["script-url", "Worker constructor", 1],
    ]);
    expect(hits[0].from).not.toMatch(/trustedTypes/);
    expect((window as unknown as { __lumenTrustedTypesDefaultHits?: unknown[] }).__lumenTrustedTypesDefaultHits).toHaveLength(2);
  });

  it("a srcdoc sink named after the type name keeps its whole document (the sink is read from the right argument)", () => {
    const def = factory.policies.get("default")!;
    const out = def.createHTML!("<!doctype html><html><head><title>t</title></head><body><p>x</p><script>1</script></body></html>", "TrustedHTML", "HTMLIFrameElement srcdoc")!;
    expect(String(out)).toMatch(/<html/i);
    expect(String(out)).not.toContain("<script");
  });

  it("the explicit `lumen` path records nothing", () => {
    const el = document.createElement("div");
    safeSetHtml(el, "<p>ok</p>");
    expect(defaultPolicyHits()).toEqual([]);
  });
});

describe("setHTML where the browser has it (W11.S17 step 2)", () => {
  afterEach(() => __resetTrustedTypesForTests());

  it("HTML goes through setHTML, after DOMPurify, and never through innerHTML", () => {
    const el = document.createElement("div");
    const calls: string[] = [];
    Object.defineProperty(el, "setHTML", { value: (m: string) => calls.push(m) });
    Object.defineProperty(el, "innerHTML", { set: () => calls.push("innerHTML!"), get: () => "" });
    safeSetHtml(el, `<p>hi</p><img src=x onerror="alert(1)">`);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("<p>hi</p>");
    expect(calls[0]).not.toMatch(/onerror/);
  });

  it("SVG, and browsers without setHTML, keep the lumen policy and innerHTML", () => {
    const el = document.createElement("div");
    safeSetHtml(el, "<p>a</p>");
    expect(el.innerHTML).toBe("<p>a</p>");
    const svg = document.createElement("div");
    let used = false;
    Object.defineProperty(svg, "setHTML", { value: () => (used = true) });
    safeSetHtml(svg, '<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>', "svg");
    expect(used).toBe(false);
    expect(svg.innerHTML).toContain("<circle");
  });
});
