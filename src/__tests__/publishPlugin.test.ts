/**
 * Tests for the pure helpers used by `scripts/publish-plugin.mjs`
 * (γ.6 + ε.5 plumbing). The CLI itself spawns child processes, hits
 * the network, and reads PEM key material — too much to drive from
 * vitest. We extracted the parser + builder + sha256 into
 * `scripts/lib/plugin-entry.mjs` so the contract can be tested in
 * isolation.
 */

import { describe, it, expect } from "vitest";

// @ts-expect-error - .mjs without TS defs; intentional.
import { parseArgs, sha256Hex, buildRegistryEntry } from "../../scripts/lib/plugin-entry.mjs";

describe("parseArgs", () => {
  it("handles --key=value form", () => {
    expect(parseArgs(["--dir=./plugin"])).toEqual({ dir: "./plugin" });
  });
  it("handles --key value form", () => {
    expect(parseArgs(["--dir", "./plugin"])).toEqual({ dir: "./plugin" });
  });
  it("handles --flag with no value", () => {
    expect(parseArgs(["--force"])).toEqual({ force: true });
  });
  it("ignores positional args", () => {
    expect(parseArgs(["positional", "--key=v"])).toEqual({ key: "v" });
  });
  it("repeated keys: last wins", () => {
    expect(parseArgs(["--k=a", "--k=b"])).toEqual({ k: "b" });
  });
  it("doesn't slurp the next --flag as a value", () => {
    expect(parseArgs(["--a", "--b=2"])).toEqual({ a: true, b: "2" });
  });
});

describe("sha256Hex", () => {
  it("matches the known SHA-256 of an empty buffer", () => {
    const empty = Buffer.alloc(0);
    expect(sha256Hex(empty)).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
  it("is deterministic + length 64 chars", () => {
    const a = sha256Hex(Buffer.from("hello"));
    const b = sha256Hex(Buffer.from("hello"));
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });
  it("differs on different inputs (collision sanity)", () => {
    expect(sha256Hex(Buffer.from("a"))).not.toBe(sha256Hex(Buffer.from("b")));
  });
});

describe("buildRegistryEntry", () => {
  const pkg = {
    name: "@author/my-plugin",
    version: "1.0.0",
    description: "Does a thing",
    author: "Author Name",
    keywords: ["demo", "test"],
    homepage: "https://example.com/my-plugin",
    repository: { url: "https://github.com/x/y" },
    lumen: { displayName: "My Plugin", permissions: ["network"] },
  };
  const opts = {
    bundleUrl: "https://cdn.example.com/p/1.0.0/index.js",
    sha256: "deadbeef".repeat(8),
    signature: "abcd",
  };
  const entry = buildRegistryEntry(pkg, opts);

  it("strips the npm scope from the id", () => {
    expect(entry.id).toBe("my-plugin");
  });
  it("uses lumen.displayName when set", () => {
    expect(entry.name).toBe("My Plugin");
  });
  it("falls back to package.name when displayName isn't set", () => {
    const noDisplay = buildRegistryEntry({ ...pkg, lumen: undefined }, opts);
    expect(noDisplay.name).toBe("@author/my-plugin");
  });
  it("preserves bundle url + sha + signature", () => {
    expect(entry.bundle).toBe(opts.bundleUrl);
    expect(entry.sha256).toBe(opts.sha256);
    expect(entry.signature).toBe(opts.signature);
  });
  it("normalises repository to a string", () => {
    expect(entry.repository).toBe("https://github.com/x/y");
    const flat = buildRegistryEntry(
      { ...pkg, repository: "https://github.com/x/y" },
      opts,
    );
    expect(flat.repository).toBe("https://github.com/x/y");
  });
  it("defaults permissions to [] when lumen.permissions is missing", () => {
    const e = buildRegistryEntry({ ...pkg, lumen: undefined }, opts);
    expect(e.permissions).toEqual([]);
  });
});
