/**
 * W11.Q7: the accessibility statement and the conformance report are one
 * click away in the app (the status bar, Settings' About line) and on the
 * site (the docs sidebar), in Hebrew and English.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { StatusBar } from "../ui/StatusBar";
import { SettingsAbout, acrUrl, statementUrl } from "../ui/AccessibilityLinks";
import { applyLocale, loadLocale } from "../i18n";
import { version } from "../../package.json";

afterEach(() => {
  cleanup();
  applyLocale("en");
});

describe("one click to the accessibility statement and report (W11.Q7)", () => {
  it("the status bar links to the statement", () => {
    render(<StatusBar text="hello" dirty={false} filename="x.md" />);
    const a = screen.getByTestId("status-a11y-statement") as HTMLAnchorElement;
    expect(a.textContent).toBe("Accessibility statement");
    expect(a.getAttribute("href")).toMatch(/\/editor\/accessibility-statement\/$/);
    expect(a.getAttribute("href")).not.toMatch(/\/he\//);
    expect(a.getAttribute("rel")).toContain("noopener");
  });

  it("Settings' About line has the version, the statement and the report", () => {
    render(<SettingsAbout />);
    const about = screen.getByTestId("settings-about");
    expect(about.textContent).toContain(`Lumen version ${version}`);
    const links = [...about.querySelectorAll("a")].map((x) => [x.textContent, x.getAttribute("href")]);
    expect(links).toEqual([
      ["Accessibility statement", statementUrl()],
      ["Accessibility conformance report", acrUrl()],
    ]);
    expect(acrUrl()).toMatch(/\/editor\/acr\/$/);
  });

  it("in Hebrew the links are the Hebrew pages", async () => {
    await loadLocale("he");
    applyLocale("he");
    render(<SettingsAbout />);
    const links = [...screen.getByTestId("settings-about").querySelectorAll("a")].map((x) => [x.textContent, x.getAttribute("href")]);
    expect(links[0][0]).toBe("הצהרת נגישות");
    expect(links[0][1]).toMatch(/\/he\/editor\/accessibility-statement\/$/);
    expect(links[1][1]).toMatch(/\/he\/editor\/acr\/$/);
  });

  it("Settings renders the About line, and the site's sidebar has both pages", () => {
    expect(readFileSync("src/ui/SettingsScreen.tsx", "utf8")).toContain("<SettingsAbout />");
    const astro = readFileSync("docs/astro.config.mjs", "utf8");
    expect(astro).toContain('slug: "editor/accessibility-statement"');
    expect(astro).toContain('slug: "editor/acr"');
  });
});
