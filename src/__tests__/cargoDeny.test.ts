// @vitest-environment node
/**
 * src-tauri/deny.toml (R8b-L8, plan W6.14 / W10.M3): its licence allow-list is
 * the licence gate's, with nothing looser, and it names no exceptions because
 * licenses.allow.json has no cargo entries.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { OK_LICENCE_IDS, classifyId } from "../../scripts/lib/licenses.mjs";

const deny = readFileSync("src-tauri/deny.toml", "utf8");
const section = (name: string) => {
  const start = deny.indexOf(`\n[${name}]\n`);
  if (start < 0) return "";
  const rest = deny.slice(start + name.length + 4);
  const next = rest.search(/\n\[/);
  return next < 0 ? rest : rest.slice(0, next);
};
const licences = section("licenses");
const allow = [...(licences.match(/allow\s*=\s*\[([\s\S]*?)\]/)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);

describe("cargo-deny licences mirror the licence gate", () => {
  it("allows exactly the gate's ok ids (the non-SPDX 'Public Domain' aside)", () => {
    const want = OK_LICENCE_IDS.filter((id: string) => id !== "Public Domain");
    expect([...allow].sort()).toEqual([...want].sort());
    expect(new Set(allow).size).toBe(allow.length);
  });

  it("allows nothing the gate would not pass as ok", () => {
    for (const id of allow) expect(classifyId(id).level, id).toBe("ok");
  });

  it("has no exceptions, because licenses.allow.json has no cargo entries", () => {
    const file = JSON.parse(readFileSync("licenses.allow.json", "utf8")) as { exceptions: { area: string }[] };
    expect(file.exceptions.filter((e) => e.area === "cargo")).toEqual([]);
    expect(licences).toMatch(/\nexceptions = \[\]\n/);
  });

  it("does not loosen cargo-deny's defaults", () => {
    expect(section("licenses.private").trim()).toBe("ignore = false");
    expect(deny).not.toMatch(/confidence-threshold|ignore\s*=\s*\[|allow-git|unknown-registry\s*=\s*"allow"|unknown-git\s*=\s*"allow"|skip\s*=|skip-tree/);
    expect(deny).not.toMatch(/^\s*(vulnerability|unmaintained|unsound|yanked|notice)\s*=/m);
  });

  it("every crate of ours declares a licence the list allows", () => {
    for (const f of ["src-tauri/Cargo.toml", "src-tauri/keychain/Cargo.toml", "src-tauri/desktop/Cargo.toml", "src-tauri/lan-mdns/Cargo.toml", "src-tauri/mcp-stdio/Cargo.toml", "src-tauri/vault/Cargo.toml"]) {
      const lic = readFileSync(f, "utf8").match(/^license\s*=\s*"([^"]+)"/m)?.[1];
      expect(lic, f).toBeDefined();
      expect(allow, f).toContain(lic);
    }
  });
});
