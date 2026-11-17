// @vitest-environment node
/**
 * Plan W13.V5 — the public performance page: a trend per release from
 * signed receipts only. 0 numbers without a receipt; both languages;
 * Obsidian only next to a number from the same machine.
 */
import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
// @ts-expect-error — plain .mjs script without type declarations
import { build, PAGE_METRICS } from "../../scripts/perf/perf-page.mjs";
// @ts-expect-error — plain .mjs script without type declarations
import { seal } from "../../scripts/nightly/receipt.mjs";

const ROOT = resolve(__dirname, "..", "..");
const keys = () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return { priv: privateKey.export({ type: "pkcs8", format: "pem" }).toString(), pub: publicKey.export({ type: "spki", format: "pem" }).toString() };
};
const MACHINE = { cpu: "Apple M3", platform: "darwin" };
const receipt = (over: Record<string, unknown>) => ({ format: "lumen-metric", version: 1, kind: "metric", task: "W13.V5", commit: { sha: "abc1234def" }, machine: MACHINE, ...over });

function vault() {
  const k = keys();
  const other = keys();
  const dir = mkdtempSync(join(tmpdir(), "receipts-"));
  const put = (name: string, r: object) => writeFileSync(join(dir, name), JSON.stringify(r));
  put("r1.json", seal(receipt({ release: "v0.9", measuredAt: "2026-10-01", metrics: { "perf.startup-gz-bytes": 230000, "perf.inp-p75-ms": 88 } }), k.priv));
  put("r2.json", seal(receipt({ release: "v1.0", measuredAt: "2026-11-01", metrics: { "perf.startup-gz-bytes": 225877, "perf.inp-p75-ms": 72, "perf.vault100k.warm-open-ms": 1840 } }), k.priv));
  // Same machine: Obsidian's number may stand next to Lumen's.
  put("c1.json", seal(receipt({ kind: "comparison", release: "v1.0", obsidianVersion: "1.15.1", measuredAt: "2026-11-01", metrics: { "obsidian.perf.vault100k.warm-open-ms": 2900 } }), k.priv));
  // Another machine: it must not.
  put("c2.json", seal(receipt({ kind: "comparison", release: "v1.0", machine: { cpu: "Intel i5", platform: "win32" }, obsidianVersion: "1.15.1", measuredAt: "2026-11-02", metrics: { "obsidian.perf.inp-p75-ms": 150 } }), k.priv));
  // Rejected: changed after sealing, signed with another key, never sealed.
  const tampered = seal(receipt({ release: "v1.0", measuredAt: "2026-11-03", metrics: { "perf.cold-start-ms": 400 } }), k.priv) as { metrics: Record<string, number> };
  tampered.metrics["perf.cold-start-ms"] = 40;
  put("bad-tampered.json", tampered);
  put("bad-otherkey.json", seal(receipt({ release: "v1.0", measuredAt: "2026-11-04", metrics: { "perf.tap-to-paint-p95-ms": 12 } }), other.priv));
  put("bad-unsealed.json", receipt({ release: "v1.0", measuredAt: "2026-11-05", metrics: { "perf.vault100k.search-p95-ms": 99 } }));
  put("not-a-receipt.json", { hello: 1 });
  return { dir, pub: k.pub };
}

describe("built from signed receipts only", () => {
  const v = vault();
  const page = build({ dirs: [v.dir], publicKeyPem: v.pub });

  it("takes the sealed, verified numbers, per release, oldest release first", () => {
    expect(page.rows.map((r: { release: string; metric: { id: string }; value: number }) => `${r.release} ${r.metric.id} ${r.value}`)).toEqual([
      "v0.9 perf.startup-gz-bytes 230000",
      "v0.9 perf.inp-p75-ms 88",
      "v1.0 perf.startup-gz-bytes 225877",
      "v1.0 perf.inp-p75-ms 72",
      "v1.0 perf.vault100k.warm-open-ms 1840",
    ]);
  });

  it("0 numbers without a receipt: tampered, other-key and unsealed receipts are left out and listed", () => {
    expect(page.rejected.map((r: { file: string }) => r.file)).toEqual(["bad-otherkey.json", "bad-tampered.json", "bad-unsealed.json"]);
    for (const text of [page.en, page.he]) {
      expect(text).not.toMatch(/\b40 ms|400 ms|12 ms|99 ms/);
      // Every table row names the receipt its number came from.
      const rows = text.split("\n").filter((l: string) => l.startsWith("| v"));
      expect(rows).toHaveLength(5);
      for (const row of rows) expect(row).toMatch(/\| `[0-9a-f]{12}` \|/);
    }
  });

  it("Obsidian only next to a number measured on the same machine", () => {
    const warm = page.rows.find((r: { metric: { id: string } }) => r.metric.id === "perf.vault100k.warm-open-ms");
    expect(warm.obsidian).toMatchObject({ value: 2900, version: "1.15.1" });
    const inp = page.rows.find((r: { release: string; metric: { id: string } }) => r.release === "v1.0" && r.metric.id === "perf.inp-p75-ms");
    expect(inp.obsidian).toBeNull();
  });

  it("is built in English and in Hebrew", () => {
    expect(page.en).toMatch(/^---\ntitle: Performance, release by release\n---/);
    expect(page.he).toMatch(/^---\ntitle: ביצועים, גרסה אחרי גרסה\n---/);
    expect(page.he).toMatch(/כספת 100k: פתיחה חמה \| 1,840 ms/);
    expect(page.en).toMatch(/100k vault: warm open \| 1,840 ms \| `[0-9a-f]{12}` \| Apple M3, darwin \| 2,900 ms \(1.15.1/);
    for (const m of PAGE_METRICS) expect(m.he.length).toBeGreaterThan(2);
  });

  it("without a public key nothing is accepted", () => {
    const p = build({ dirs: [v.dir], publicKeyPem: null });
    expect(p.rows).toEqual([]);
    expect(p.en).toMatch(/No signed receipts yet/);
  });
});

describe("the committed page", () => {
  it("exists in both languages and matches what the generator makes from this repository's receipts", async () => {
    for (const f of ["docs/perf/index.md", "docs/perf/index.he.md"]) expect(existsSync(join(ROOT, f)), f).toBe(true);
    const pubFile = [join(ROOT, "reports/metrics/PUBLIC_KEY.pem"), join(ROOT, "reports/nightly/PUBLIC_KEY.pem")].find(existsSync);
    const p = build({ dirs: [join(ROOT, "reports/metrics"), join(ROOT, "reports/nightly")], publicKeyPem: pubFile ? readFileSync(pubFile, "utf8") : null });
    expect(readFileSync(join(ROOT, "docs/perf/index.md"), "utf8")).toBe(p.en);
    expect(readFileSync(join(ROOT, "docs/perf/index.he.md"), "utf8")).toBe(p.he);
  });
});
