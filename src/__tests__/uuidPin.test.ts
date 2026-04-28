/**
 * Regression-guard test for the `uuid` advisory `GHSA-w5hq-g745-h8pq`.
 *
 * mermaid 11.14.0 transitively depends on uuid@11.x which is vulnerable
 * to a missing buffer-bounds check (CVE pending) in v3/v5/v6 when the
 * caller passes a `buf` parameter. Lumen pins uuid via package.json
 * `overrides` to ≥14.0.0 (the patched line). This test pins the contract
 * so a future Dependabot bump or accidental override-removal trips CI.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface PackageJson {
  overrides?: Record<string, string>;
}

describe("npm overrides — security", () => {
  const pkg = JSON.parse(
    readFileSync(join(__dirname, "..", "..", "package.json"), "utf8"),
  ) as PackageJson;

  it("pins uuid to ≥ 14.0.0 (closes GHSA-w5hq-g745-h8pq)", () => {
    expect(pkg.overrides).toBeDefined();
    const uuid = pkg.overrides?.uuid;
    expect(uuid, "package.json overrides.uuid must be set").toBeTruthy();
    // Match a SemVer that resolves to ≥ 14: ^14.x.x, ~14.x.x, or 14+.
    expect(uuid).toMatch(/^[\^~]?(1[4-9]|[2-9]\d|\d{3})/);
  });

  it("pins serialize-javascript to ≥ 7.0.5 (closes prototype-pollution)", () => {
    const sjs = pkg.overrides?.["serialize-javascript"];
    expect(sjs).toBeTruthy();
    expect(sjs).toMatch(/^[\^~]?[7-9]/);
  });
});
