// @vitest-environment node
/**
 * #469 port (W10, train 6), coordinator decision: the train's
 * edge-workers/vault-relay (W6.23) is the single encrypted vault relay, so
 * #469's second copy of its routes inside the public collab Worker
 * (edge-workers/collab/vaultRelay.mjs, decision 5.16) is dropped. This pins
 * that, and the three things decision 2.46 says the public collab server
 * does (PRIVACY.he.md, "הערכת השפעה"): rooms deleted 90 days after the last
 * change, no IP addresses in logs, encrypted rooms only.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("one vault relay, and the collab server's three promises (#469, decision 2.46)", () => {
  it("the collab Worker serves no vault routes and binds no vault objects", () => {
    expect(existsSync("edge-workers/collab/vaultRelay.mjs")).toBe(false);
    const worker = read("edge-workers/collab/worker.mjs");
    expect(worker).not.toMatch(/\/v1\/vault|vaultRelay|VaultSpace|VaultQuota/);
    const toml = read("edge-workers/collab/wrangler.toml");
    expect(toml).not.toMatch(/VAULT|VaultSpace|VaultQuota/);
  });

  it("the vault relay is its own Worker, with request logs off", () => {
    const toml = read("edge-workers/vault-relay/wrangler.toml");
    expect(toml).toMatch(/^name = "lumen-vault-relay"$/m);
    expect(toml).toMatch(/\[observability\]\s*\nenabled = false/);
    expect(read("edge-workers/vault-relay/worker.mjs")).toMatch(/\/v1\/vault\/o\//);
  });

  it("collab: 90-day retention, no request logs, encrypted rooms only (4403)", () => {
    const toml = read("edge-workers/collab/wrangler.toml");
    expect(/^RETENTION_DAYS = "(\d+)"$/m.exec(toml)?.[1]).toBe("90");
    expect(toml).toMatch(/\[observability\]\s*\nenabled = false/);
    const worker = read("edge-workers/collab/worker.mjs");
    expect(worker).toMatch(/createRelayRoom\(\{[\s\S]{0,80}e2eeOnly: true/);
    expect(worker).not.toMatch(/console\.(log|info|warn|error)\([^)]*(cf-connecting-ip|remoteAddress)/i);
    expect(read("sync-server/collab/relay.mjs")).toMatch(/Forbidden: \{ code: 4403/);
  });
});
