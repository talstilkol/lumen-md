/**
 * W11.P13: the origin-trial token check (scripts/pwa/origin-trial-token.mjs).
 * The tokens here are SYNTHETIC: Chrome's layout with a zero signature.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error — a plain .mjs tool
import { checkToken, decodeToken } from "../../scripts/pwa/origin-trial-token.mjs";

function token(payload: object, version = 3): string {
  const json = Buffer.from(JSON.stringify(payload));
  const len = Buffer.alloc(4);
  len.writeUInt32BE(json.length);
  return Buffer.concat([Buffer.from([version]), Buffer.alloc(64), len, json]).toString("base64");
}
const NOW = Date.UTC(2026, 10, 17);
const day = 86_400;

describe("origin-trial tokens", () => {
  it("decodes Chrome's layout: version, signature, length, payload", () => {
    const t = decodeToken(token({ origin: "https://lumen-md.vercel.app:443", feature: "InstallElement", expiry: NOW / 1000 + 90 * day }));
    expect(t).toMatchObject({ version: 3, feature: "InstallElement", origin: "https://lumen-md.vercel.app:443" });
    expect(() => decodeToken("AAAA")).toThrow(/too short/);
    expect(() => decodeToken(token({ origin: "x" }, 9))).toThrow(/version 9/);
  });

  it("fits only Lumen's origin, first-party, and not near its end", () => {
    const fresh = { origin: "https://lumen-md.vercel.app:443", feature: "WebAppInstallation", expiry: NOW / 1000 + 90 * day };
    expect(checkToken(fresh, "https://lumen-md.vercel.app", NOW)).toMatchObject({ ok: true, days: 90 });
    expect(checkToken({ ...fresh, origin: "https://preview-123.vercel.app" }, "https://lumen-md.vercel.app", NOW).problems[0]).toMatch(/not https:\/\/lumen-md/);
    expect(checkToken({ ...fresh, expiry: NOW / 1000 + 10 * day }, "https://lumen-md.vercel.app", NOW).problems).toEqual(["expires in 10 day(s)"]);
    expect(checkToken({ ...fresh, expiry: NOW / 1000 - day }, "https://lumen-md.vercel.app", NOW).problems).toContain("expired");
    expect(checkToken({ ...fresh, isThirdParty: true }, "https://lumen-md.vercel.app", NOW).ok).toBe(false);
  });
});
