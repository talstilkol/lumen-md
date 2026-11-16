/**
 * W10.D15 (plan W6.12): SECURITY.md sends reporters only to a channel that
 * works today. security/channels.json records each channel and its state
 * (checked through the GitHub REST API); a channel that is "off", or still
 * the owner's to create, may be mentioned but never linked as a way to report.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

type Channel = { id: string; status: "on" | "off" | "owner"; url?: string };
const channels = (JSON.parse(readFileSync("security/channels.json", "utf8")) as { channels: Channel[] }).channels;
const security = readFileSync("SECURITY.md", "utf8");
const links = (text: string) => [...text.matchAll(/\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s)>"]+)/g)].map((m) => m[1] ?? m[2]);

/** The links of SECURITY.md that a reporter is sent to: the reporting part, English and Hebrew. */
function reportingLinks(): string[] {
  const en = security.slice(security.indexOf("## Reporting a vulnerability"), security.indexOf("### What happens next"));
  const he = security.slice(security.indexOf("### בעברית"), security.indexOf("## Maintainers and keys"));
  return [...links(en), ...links(he)];
}

/** Every reporting link in the docs a reporter may be handed (outreach pages included). */
const OTHER_DOCS = ["launch/second-maintainer/outreach.he.md"];

describe("vulnerability-reporting channels", () => {
  it("at least one channel works today, and it is the one SECURITY.md links", () => {
    const on = channels.filter((c) => c.status === "on");
    expect(on.length).toBeGreaterThan(0);
    const urls = reportingLinks();
    expect(urls.length).toBeGreaterThan(0);
    for (const c of on) expect(urls).toContain(c.url);
  });

  it("no link in SECURITY.md or the outreach pages points to a channel that is off or not created", () => {
    const dead = channels.filter((c) => c.status !== "on" && c.url).map((c) => c.url!);
    for (const doc of ["SECURITY.md", ...OTHER_DOCS]) {
      for (const u of links(readFileSync(doc, "utf8"))) expect(dead, `${doc}: ${u}`).not.toContain(u);
    }
  });

  it("every reporting link is a recorded channel that is on", () => {
    const on = new Set(channels.filter((c) => c.status === "on").map((c) => c.url));
    for (const u of reportingLinks()) expect(on.has(u), u).toBe(true);
  });

  it("GitHub private reporting is on and is the first channel, in English and Hebrew (W10.D15, owner turned it on)", () => {
    const pvr = channels.find((c) => c.id === "github-private-reporting")!;
    expect(pvr.status).toBe("on");
    const urls = reportingLinks();
    expect(urls[0]).toBe(pvr.url);
    expect(security).toMatch(/private vulnerability reporting is \*\*turned on\*\*/);
    expect(security).toContain("**מופעל**");
    expect(security).not.toMatch(/not turned on yet/);
  });

  it("each channel that is off or the owner's names the owner's step", () => {
    for (const c of channels.filter((x) => x.status !== "on")) expect((c as { owner?: string }).owner, c.id).toBeTruthy();
  });
});
