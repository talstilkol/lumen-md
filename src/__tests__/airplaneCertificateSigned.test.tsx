/**
 * Audit r3, W10.C11: the network monitor still said "Not signed yet: the
 * certificate carries its SHA-256 only" (`airplane.certificate.unsigned`)
 * while every certificate it downloads is signed with the device's minisign
 * key (NetworkMonitor.tsx certificate(), signedCertificateFile). The note now
 * says what is true, in every language, and the old claim is gone.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { enableAirplaneMode, disableAirplaneMode } from "../privacy/airplane";
import { NetworkMonitor } from "../privacy/NetworkMonitor";

const ROOT = process.cwd();
const LOCALES = join(ROOT, "src/i18n/locales");
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8")) as Record<string, string>;

afterEach(() => {
  cleanup();
  disableAirplaneMode(() => {});
});

describe("the airplane certificate note matches what the download does (W10.C11)", () => {
  it("with airplane mode on, the monitor says the certificate is signed, never that it is not", () => {
    enableAirplaneMode();
    render(<NetworkMonitor onClose={() => {}} />);
    const dialog = screen.getByTestId("network-monitor");
    expect(dialog.textContent).toContain("Signed with this device's key");
    expect(dialog.textContent).not.toMatch(/not signed/i);
    expect(screen.getByTestId("airplane-certificate")).toBeTruthy();
  });

  it("no language keeps the old 'not signed' string; every one has the signed note, naming minisign", () => {
    const en = readJson(join(ROOT, "src/i18n/lazy/airplane.json"));
    expect(en["airplane.certificate.unsigned"]).toBeUndefined();
    expect(en["airplane.certificate.signed"]).toMatch(/minisign/);
    const langs = readdirSync(LOCALES, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== "en").map((d) => d.name);
    expect(langs.length).toBe(7);
    for (const l of langs) {
      const strings = readJson(join(LOCALES, l, "common.json"));
      expect(strings["airplane.certificate.unsigned"], l).toBeUndefined();
      expect(strings["airplane.certificate.signed"], l).toMatch(/minisign/);
    }
    const src = readFileSync(resolve(ROOT, "src/privacy/NetworkMonitor.tsx"), "utf8");
    expect(src).not.toContain("airplane.certificate.unsigned");
  });
});
