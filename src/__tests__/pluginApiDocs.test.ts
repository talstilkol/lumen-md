/**
 * W13.D3 — the plugin API reference, generated from the types
 * (src/plugins/runtime/lumenApi.ts, read with tsc's parser): 100% of the
 * host methods documented, the build fails on one that is not, a page per
 * apiVersion with deprecations, and every method's example runs.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error — plain .mjs tooling, no types
import { SOURCE, pagePath, problems, readApi, renderVersion } from "../../scripts/plugin-api-docs.mjs";
import { METHOD_CAPABILITY } from "../plugins/runtime/capabilities";

const ROOT = join(__dirname, "../..");
const api = readApi(readFileSync(join(ROOT, SOURCE), "utf8"));
type Member = { path: string; capability: string; example: string; since: number; deprecated: string | null; removedIn: number | null };
const members: Member[] = api.members;

describe("coverage", () => {
  it("documents exactly the host methods a plugin can call, with their capability", () => {
    const host = Object.keys(METHOD_CAPABILITY).sort();
    const documented = members.map((m) => m.path).filter((p) => p.includes(".")).sort();
    expect(documented).toEqual(host);
    for (const m of members.filter((x) => x.path.includes("."))) {
      const cap = METHOD_CAPABILITY[m.path];
      expect(m.capability, m.path).toBe(cap === "network" ? "network:<origin>" : cap);
    }
  });

  it("has no undocumented member (doc, @capability, @since, @example)", () => {
    expect(problems(api)).toEqual([]);
  });

  it("the build fails on a method without docs or without an example", () => {
    const src = `export const PLUGIN_API_VERSIONS = [1] as const;
      export interface LumenX {
        /** Documented.
         * @capability x
         * @since 1
         * @example
         * await lumen.x.a();
         */
        a(): Promise<void>;
        b(): Promise<void>;
        /** No example.
         * @capability x
         * @since 1
         */
        c(): Promise<void>;
      }
      export interface LumenApi { x: LumenX; }`;
    expect(problems(readApi(src))).toEqual(["x.b: no doc comment", "x.b: no @capability", "x.b: no @since <apiVersion>", "x.b: no @example", "x.c: no @example"]);
  });
});

describe("a page per apiVersion", () => {
  const src = `export const PLUGIN_API_VERSIONS = [1, 2] as const;
    export interface LumenX {
      /** Old.
       * @capability x
       * @since 1
       * @deprecated use b() — removed in apiVersion 2
       * @example
       * await lumen.x.a();
       */
      a(): Promise<void>;
      /** New.
       * @capability x
       * @since 2
       * @example
       * await lumen.x.b();
       */
      b(): Promise<void>;
    }
    export interface LumenApi { x: LumenX; }`;
  const two = readApi(src);
  it("a deprecated method is marked with the version that removes it, and leaves that version's page", () => {
    const v1 = renderVersion(two, 1, "en");
    const v2 = renderVersion(two, 2, "en");
    expect(v1).toContain("`lumen.x.a`");
    expect(v1).toContain("**Deprecated:** use b() — removed in apiVersion 2");
    expect(v1).not.toContain("`lumen.x.b`");
    expect(v2).not.toContain("`lumen.x.a`");
    expect(v2).toContain("`lumen.x.b`");
  });
  it("a deprecation must name the removing version", () => {
    expect(problems(readApi(src.replace(" — removed in apiVersion 2", "")))).toContain('x.a: @deprecated must say "removed in apiVersion <N>"');
  });
  it("the committed pages are current, in English and Hebrew", () => {
    for (const v of api.versions as number[]) {
      for (const lang of ["en", "he"]) expect(readFileSync(join(ROOT, pagePath(v, lang)), "utf8")).toBe(renderVersion(api, v, lang));
    }
  });
});

/** A stand-in `lumen`: every method answers with a plausible value and records the call. */
function fakeLumen(calls: string[]) {
  const answers: Record<string, unknown> = {
    "document.getText": "# שלום\nhello world",
    "document.getFileName": "notes/plan.md",
    "document.getSelection": { from: 0, to: 5, text: "hello" },
    "vault.list": [{ name: "a.md", path: "notes/a.md", kind: "file" }],
    "vault.read": "# Plan",
    "settings.get": { goal: 500 },
    "storage.get": 2,
    "network.fetch": { status: 200, headers: {}, body: "{\"ok\":true}" },
    "bases.query": { view: "Table", columns: ["title"], rows: [{ path: "books/dune.md", cells: {} }], total: 1, errors: [] },
    "bases.update": { written: 1, unchanged: 0, declined: false },
  };
  const ns = (name: string) =>
    new Proxy({}, { get: (_t, m: string) => async (..._a: unknown[]) => { calls.push(`${name}.${m}`); return answers[`${name}.${m}`]; } });
  return new Proxy({} as Record<string, unknown>, {
    get: (_t, k: string) => {
      // Events fire at once with a sample payload, so a handler's calls are part of the example.
      if (k === "on") return (ev: string, fn: (p: unknown) => unknown) => { calls.push("on"); void fn(ev.startsWith("render:") ? { requestId: "r1", source: "x" } : { source: "palette" }); return () => calls.push("off"); };
      if (k === "manifest") { calls.push("manifest"); return { id: "acme.words", name: "Words", version: "1.0.0" }; }
      return ns(k);
    },
  });
}

describe("every example runs", () => {
  it.each(members.map((m) => [m.path, m] as const))("%s", async (_p, m) => {
    const calls: string[] = [];
    const logs: unknown[] = [];
    const run = new Function("lumen", "console", `return (async () => {\n${m.example}\n})();`);
    await run(fakeLumen(calls), { log: (...a: unknown[]) => logs.push(a) });
    expect(calls).toContain(m.path);
  });
});
