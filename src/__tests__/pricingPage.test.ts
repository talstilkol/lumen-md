/**
 * Plan W11.P12 — the pricing decision and its pages (English and Hebrew):
 * the app is free and MIT forever with no account; the only paid things are
 * an optional encrypted relay ($4 a month, $40 a year) and a one-time
 * supporter payment (about $25); 50% off for students and teachers, free
 * for schools, yeshivas and nonprofits. The README carries the promise that
 * the free tier never shrinks. No payment button may be active while no
 * payment provider is configured (W11.O8).
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
// @ts-expect-error — plain .mjs helpers without types
import { PLANS } from "../../scripts/cost-model.mjs";

const config = JSON.parse(readFileSync("launch/pricing.json", "utf8"));
const PAGES = { en: "docs/src/content/docs/project/pricing.md", he: "docs/src/content/docs/he/project/pricing.md" } as const;

/**
 * Why the payment controls on a page are not allowed: with no provider, every
 * `data-pay` control must be a disabled <button> and nothing may link to a
 * checkout; with one, each control links to that provider's https checkout.
 */
function payProblems(md: string, cfg: typeof config): string[] {
  const out: string[] = [];
  const controls = [...md.matchAll(/<(button|a)\b([^>]*)\bdata-pay="([^"]+)"([^>]*)>/g)];
  const knownPlans = new Set(cfg.plans.map((p: { id: string }) => p.id));
  for (const [, tag, before, plan, after] of controls) {
    const attrs = `${before} ${after}`;
    if (!knownPlans.has(plan)) out.push(`${plan}: not a plan in launch/pricing.json`);
    if (!cfg.provider) {
      if (tag !== "button") out.push(`${plan}: a link, with no payment provider configured`);
      if (!/\bdisabled\b/.test(attrs)) out.push(`${plan}: an active button, with no payment provider configured`);
      if (/\b(href|formaction|onclick)=/.test(attrs)) out.push(`${plan}: points somewhere, with no payment provider configured`);
    } else {
      const url = cfg.checkout?.[plan];
      const hosts: string[] = cfg.providerHosts?.[cfg.provider] ?? [];
      if (!url || !/^https:\/\//.test(url) || !hosts.includes(new URL(url).hostname)) out.push(`${plan}: no https checkout on ${cfg.provider}'s host`);
    }
  }
  // No checkout link anywhere else on the page while there is no provider.
  if (!cfg.provider && /https:\/\/[^\s)"']*(polar\.sh|checkout|stripe\.com|paypal\.com\/checkout|lemonsqueezy)/i.test(md)) out.push("a checkout link, with no payment provider configured");
  return out;
}

describe.each(Object.entries(PAGES) as [string, string][])("the %s pricing page", (lang: string, path: string) => {
  const md = readFileSync(path, "utf8");
  it("exists with a title and a description", () => {
    expect(existsSync(path)).toBe(true);
    expect(md).toMatch(/^---\ntitle: .+\ndescription: .+\n---\n/);
  });
  it("says the app is free, MIT and needs no account, and that the free tier never shrinks", () => {
    if (lang === "en") {
      for (const s of ["Free, with every feature", "MIT licence", "No account", "The free tier never shrinks"]) expect(md).toContain(s);
    } else {
      for (const s of ["חינם, עם כל היכולות", "רישיון MIT", "בלי חשבון", "השכבה החינמית אף פעם לא מצטמצמת"]) expect(md).toContain(s);
    }
  });
  it("quotes the prices of launch/pricing.json, and the relay's match the cost model", () => {
    const usd = (id: string) => config.plans.find((p: { id: string }) => p.id === id).usd;
    expect({ monthly: usd("relay-monthly"), yearly: usd("relay-yearly") }).toEqual(PLANS);
    expect(md).toContain(`**$${usd("relay-monthly")}**`);
    expect(md).toContain(`**$${usd("relay-yearly")}**`);
    expect(md).toContain(`**$${usd("supporter")}**`);
    expect(md).toContain("50%");
    expect(config.discounts).toEqual({ students: 0.5, teachers: 0.5 });
    expect(config.freeFor).toEqual(["schools", "yeshivas", "nonprofits"]);
  });
  it("no payment button is active while no provider is configured", () => {
    expect(config.provider).toBeNull();
    expect(md).toMatch(/data-pay="relay-monthly"/);
    expect(payProblems(md, config)).toEqual([]);
  });
});

describe("the rule itself", () => {
  const none = { ...config, provider: null, checkout: {} };
  it.each([
    ['<button type="button" data-pay="relay-monthly">Pay</button>', "an active button"],
    ['<a href="https://buy.polar.sh/x" data-pay="relay-monthly">Pay</a>', "a link"],
    ['<button type="button" disabled data-pay="relay-monthly" onclick="pay()">Pay</button>', "points somewhere"],
    ['<button type="button" disabled data-pay="gold">Pay</button>', "not a plan"],
    ["[Pay](https://buy.polar.sh/abc)", "a checkout link"],
  ] as [string, string][])("%s is refused without a provider", (md: string, why: string) => {
    expect(payProblems(md, none).join("\n")).toContain(why);
  });
  it("with a provider, a button needs that provider's https checkout", () => {
    const md = '<a href="https://buy.polar.sh/x" data-pay="relay-monthly">Pay</a>';
    expect(payProblems(md, { ...config, provider: "polar", checkout: {} })).toEqual(["relay-monthly: no https checkout on polar's host"]);
    expect(payProblems(md, { ...config, provider: "polar", checkout: { "relay-monthly": "https://evil.example/x" } })).toHaveLength(1);
    expect(payProblems(md, { ...config, provider: "polar", checkout: { "relay-monthly": "https://buy.polar.sh/x" } })).toEqual([]);
  });
});

describe("the promise in the README, and the support pages", () => {
  it("both READMEs say the free tier never shrinks and link the pricing page", () => {
    const he = readFileSync("README.md", "utf8");
    const en = readFileSync("README.en.md", "utf8");
    expect(he).toContain("השכבה החינמית אף פעם לא מצטמצמת");
    expect(he).toContain("docs/src/content/docs/he/project/pricing.md");
    expect(en).toContain("the free tier never shrinks");
    expect(en).toContain("docs/src/content/docs/project/pricing.md");
  });
  it("the support page (W5.25) links the pricing page and shows the relay at $4 / $40", () => {
    const support = readFileSync("public/support.html", "utf8");
    expect(support).toContain("project/pricing.md");
    expect(support).toContain('data-model="plans.monthly">$4<');
    expect(support).toContain('data-model="plans.yearly">$40<');
  });
  it("the pricing page is in the docs sidebar in both languages", () => {
    expect(readFileSync("docs/astro.config.mjs", "utf8")).toContain('{ label: "Pricing", slug: "project/pricing", translations: { he: "תמחור" } }');
  });
});
