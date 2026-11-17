// @vitest-environment node
/**
 * src-tauri/deny.toml (R8b-L8, plan W6.14 / W10.M3): its licence allow-list is
 * the licence gate's, with nothing looser, and it names no exceptions because
 * licenses.allow.json has no cargo entries.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error — plain .mjs module without type declarations (#1304)
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

/**
 * Review 9, L5: what deny.toml may say, per table: only these keys, with these values
 * (`allow` is checked against the gate above). Anything else — another table, an array
 * of tables such as [[licenses.clarify]], [graph] exclude/targets, an ignore list — is a
 * problem, so a loosening the old deny-list regex missed can't slip in.
 */
const KNOWN: Record<string, Record<string, string | null>> = {
  graph: { "all-features": "false" },
  advisories: { version: "2" },
  licenses: { version: "2", allow: null, exceptions: "[]" },
  "licenses.private": { ignore: "false" },
  bans: {},
  sources: {},
};
function denyProblems(text: string): string[] {
  const out: string[] = [];
  let table: string | null = null;
  let key: string | null = null;
  let value = "";
  let depth = 0;
  const seen = new Map<string, Set<string>>();
  const done = () => {
    if (key === null || table === null) return;
    const want = KNOWN[table]?.[key];
    if (seen.get(table)!.has(key)) out.push(`[${table}] ${key} twice`);
    seen.get(table)!.add(key);
    if (want === undefined) out.push(`[${table}] ${key}: not a key this file may set`);
    else if (want !== null && value.trim() !== want) out.push(`[${table}] ${key} = ${value.trim()}, expected ${want}`);
    key = null;
    value = "";
  };
  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    if (depth > 0) {
      value += ` ${line}`;
      depth += (line.match(/[[{]/g) ?? []).length - (line.match(/[\]}]/g) ?? []).length;
      if (depth <= 0) done();
      continue;
    }
    const arr = /^\[\[\s*([^\]]+?)\s*\]\]$/.exec(line);
    if (arr) {
      out.push(`[[${arr[1]}]]: an array of tables this file may not have`);
      table = `[[${arr[1]}]]`;
      seen.set(table, new Set());
      continue;
    }
    const t = /^\[\s*([^\]]+?)\s*\]$/.exec(line);
    if (t) {
      table = t[1];
      if (!(table in KNOWN)) out.push(`[${table}]: a table this file may not have`);
      if (seen.has(table)) out.push(`[${table}] twice`);
      seen.set(table, seen.get(table) ?? new Set());
      continue;
    }
    const kv = /^("?)([A-Za-z0-9_.-]+)\1\s*=\s*(.*)$/.exec(line);
    if (!kv || table === null) {
      out.push(`not understood: ${line}`);
      continue;
    }
    key = kv[2];
    value = kv[3];
    depth = (value.match(/[[{]/g) ?? []).length - (value.match(/[\]}]/g) ?? []).length;
    if (depth <= 0) done();
  }
  for (const [name, keys] of Object.entries(KNOWN)) {
    if (!seen.has(name)) out.push(`[${name}] is missing`);
    else for (const k of Object.keys(keys)) if (!seen.get(name)!.has(k)) out.push(`[${name}] ${k} is missing`);
  }
  return out;
}
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

  it("does not loosen cargo-deny's defaults: only known sections and keys, with these values (review 9, L5)", () => {
    expect(section("licenses.private").trim()).toBe("ignore = false");
    expect(denyProblems(deny)).toEqual([]);
  });

  it("refuses every key or table it does not know, the ones a deny-list missed too", () => {
    for (const plant of [
      '[[licenses.clarify]]\nname = "ring"\nexpression = "MIT"',
      '[graph]\nexclude = ["openssl"]',
      'targets = ["x86_64-unknown-linux-gnu"]',
      '[licenses]\nconfidence-threshold = 0.5',
      '[advisories]\nignore = ["RUSTSEC-2020-0001"]',
      '[bans]\nskip-tree = [{ name = "x" }]',
      '[sources]\nunknown-git = "allow"',
      '[licenses.private]\nignore = true',
      '[output]\nfeature-depth = 1',
    ]) {
      const planted = plant.startsWith("[") ? `${deny}\n${plant}\n` : deny.replace("all-features = false", `all-features = false\n${plant}`);
      expect(denyProblems(planted), plant).not.toEqual([]);
    }
    expect(denyProblems(deny.replace("all-features = false", "all-features = true"))).toEqual(["[graph] all-features = true, expected false"]);
    expect(denyProblems(deny.replace("exceptions = []", 'exceptions = [{ allow = ["GPL-3.0"], crate = "x" }]'))).toEqual([expect.stringMatching(/exceptions = \[\{/)]);
  });

  it("every crate of ours declares a licence the list allows", () => {
    for (const f of ["src-tauri/Cargo.toml", "src-tauri/keychain/Cargo.toml", "src-tauri/desktop/Cargo.toml", "src-tauri/lan-mdns/Cargo.toml", "src-tauri/mcp-stdio/Cargo.toml", "src-tauri/vault/Cargo.toml"]) {
      const lic = readFileSync(f, "utf8").match(/^license\s*=\s*"([^"]+)"/m)?.[1];
      expect(lic, f).toBeDefined();
      expect(allow, f).toContain(lic);
    }
  });
});
