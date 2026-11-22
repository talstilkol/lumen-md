/**
 * Plan W10.B21 (audit W5.25): the support page linked to GitHub Sponsors
 * and Open Collective accounts that don't exist yet. One switch controls
 * both: a funding link is a live <a> on public/support.html exactly when
 * its key is uncommented in .github/FUNDING.yml.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const html = readFileSync("public/support.html", "utf8");
const funding = readFileSync(".github/FUNDING.yml", "utf8");
/** Live links only: HTML comments are not links. */
const liveHrefs = [...html.replace(/<!--[\s\S]*?-->/g, "").matchAll(/<a\s[^>]*href="([^"]+)"/g)].map((m) => m[1]);
const active = (key: string) => new RegExp(`^${key}:`, "m").test(funding);

const ACCOUNTS = [
  { key: "github", href: "https://github.com/sponsors/talstilkol" },
  { key: "open_collective", href: "https://opencollective.com/lumen-md" },
];

describe("support page and FUNDING.yml agree (W10.B21)", () => {
  for (const a of ACCOUNTS) {
    it(`${a.key}: linked on the page exactly when FUNDING.yml turns it on`, () => {
      const onPage = liveHrefs.filter((h) => h === a.href).length;
      if (active(a.key)) expect(onPage, a.href).toBe(2); // Hebrew and English sections
      else expect(onPage, a.href).toBe(0);
      // The link is kept, commented, for the day the account opens.
      expect(html).toContain(`funding:${a.key}`);
    });
  }

  it("GitHub Sponsors is open (owner decision W11.O8); Open Collective not yet; no 'may lead to an empty page'", () => {
    expect(active("github")).toBe(true);
    expect(active("open_collective")).toBe(false);
    expect(html).not.toMatch(/may lead to an empty page|יכולים להוביל לדף ריק/);
    expect(liveHrefs).toContain("https://github.com/talstilkol/lumen-md");
  });
});
