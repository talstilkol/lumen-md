/**
 * Plan W10.D21 (W4.16, W1.27): source maps that two builds write the same.
 * The maps here are synthetic: what two machines would write for one bundle
 * (other checkout path, other temporary folder, sources in another order).
 * A real two-build repro run is owed to the Mac (`npm run repro -- --sourcemap`).
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeMappings, decodeVlq, encodeMappings, encodeVlq, normalizeMap, normalizeMapsIn, normalizeSource } from "../../scripts/supply-chain/normalize-maps.mjs";
import { deterministicMapsPlugin } from "../build/deterministicMaps";

/** What each generated position points at: [genLine, genCol, source path, line, col, name]. */
function resolved(map: { sources: string[]; names: string[]; mappings: string }) {
  return decodeMappings(map.mappings).flatMap((segs, line) => segs.map((s) => [line, s[0], s.length > 1 ? map.sources[s[1]] : null, s[2] ?? null, s[3] ?? null, s.length > 4 ? map.names[s[4]] : null]));
}

describe("base64 VLQ", () => {
  it("decodes the spec's values and round-trips", () => {
    expect(decodeVlq("AAAA")).toEqual([0, 0, 0, 0]);
    expect(decodeVlq("C")).toEqual([1]);
    expect(decodeVlq("D")).toEqual([-1]);
    expect(decodeVlq("gB")).toEqual([16]);
    for (const v of [[0], [1, -1, 15, -16, 16, 1023, -1024, 123456]]) expect(decodeVlq(encodeVlq(v))).toEqual(v);
    expect(() => decodeVlq("g")).toThrow("truncated");
  });

  it("mappings round-trip with empty lines and 1-, 4- and 5-field segments", () => {
    const m = "AAAA,CAAC;;IAEE,KAAKA,MACN;C";
    expect(encodeMappings(decodeMappings(m))).toBe(m);
  });
});

const ROOT_A = "/home/build-a/lumen-md";
const ROOT_B = "/Users/tal/src/lumen-md";

/** One bundle's map as a machine with `root` and `tmp` would write it, with the sources in `order`. */
function mapFrom(root: string, tmp: string, order: number[]) {
  const all = [
    { path: `${root}/src/app/main.ts`, content: "export const a = 1;\n" },
    { path: `${root}/node_modules/sql.js/dist/sql-wasm.js`, content: "var initSqlJs;\n" },
    { path: `${tmp}/vite-worker-entry.js`, content: "self.onmessage = () => {};\n" },
  ];
  const sources = order.map((i) => all[i]);
  const names = order.includes(0) ? ["a", "initSqlJs"] : [];
  // Generated line 0: col 0 → main.ts 0:13 name a; col 20 → sql-wasm.js 0:4 name initSqlJs. Line 1: col 0 → worker 0:0.
  const at = (p: string) => sources.findIndex((s) => s.path === p);
  const nm = (n: string) => names.indexOf(n);
  const lines = [
    [[0, at(all[0].path), 0, 13, nm("a")], [20, at(all[1].path), 0, 4, nm("initSqlJs")]],
    [[0, at(all[2].path), 0, 0]],
  ];
  return { version: 3, file: `${root}/dist/assets/app-x.js`, sourceRoot: "", sources: sources.map((s) => s.path), sourcesContent: sources.map((s) => s.content), names, mappings: encodeMappings(lines) };
}

describe("normalizeMap", () => {
  it("two machines, two temporary folders, two source orders: the same bytes", () => {
    const a = normalizeMap(mapFrom(ROOT_A, "/tmp/vite-123", [0, 1, 2]), { mapPath: `${ROOT_A}/dist/assets/app-x.js.map`, root: ROOT_A });
    const bMap = mapFrom(ROOT_B, "/var/folders/xy/T/vite-987", [2, 0, 1]);
    bMap.names = ["initSqlJs", "a"];
    bMap.mappings = encodeMappings([
      [[0, 1, 0, 13, 1], [20, 2, 0, 4, 0]],
      [[0, 0, 0, 0]],
    ]);
    const b = normalizeMap(bMap, { mapPath: `${ROOT_B}/dist/assets/app-x.js.map`, root: ROOT_B });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.sources).toEqual(["../../node_modules/sql.js/dist/sql-wasm.js", "../../src/app/main.ts", "<external>/vite-worker-entry.js"]);
    expect(a.file).toBe("app-x.js");
    expect(Object.keys(a)).toEqual(["version", "file", "sources", "sourcesContent", "names", "mappings"]);
  });

  it("every generated position still points at the same source, line, column and name", () => {
    const raw = mapFrom(ROOT_A, "/tmp/vite-1", [2, 0, 1]);
    const n = normalizeMap(raw, { mapPath: `${ROOT_A}/dist/assets/app-x.js.map`, root: ROOT_A });
    const before = resolved({ ...raw, sources: raw.sources.map((s) => normalizeSource(s, { mapDir: `${ROOT_A}/dist/assets`, root: ROOT_A })) });
    expect(resolved(n)).toEqual(before);
    // sourcesContent follows its source.
    expect(n.sourcesContent![n.sources.indexOf("../../src/app/main.ts")]).toBe("export const a = 1;\n");
  });

  it("is idempotent", () => {
    const once = normalizeMap(mapFrom(ROOT_A, "/tmp/x", [1, 2, 0]), { mapPath: `${ROOT_A}/dist/a.js.map`, root: ROOT_A });
    expect(normalizeMap(once, { mapPath: `${ROOT_A}/dist/a.js.map`, root: ROOT_A })).toEqual(once);
  });

  it("paths: sourceRoot folded in, Windows separators, a package cache elsewhere, URLs untouched", () => {
    const o = { mapDir: `${ROOT_A}/dist/assets`, root: ROOT_A };
    expect(normalizeSource("main.ts", { ...o, sourceRoot: "../../src" })).toBe("../../src/main.ts");
    expect(normalizeSource("..\\..\\src\\main.ts", o)).toBe("../../src/main.ts");
    expect(normalizeSource("/opt/cache/npm/node_modules/pdfjs-dist/build/pdf.worker.mjs", o)).toBe("node_modules/pdfjs-dist/build/pdf.worker.mjs");
    expect(normalizeSource("webpack://lib/x.js", o)).toBe("webpack://lib/x.js");
    expect(normalizeSource(`file://${ROOT_A}/src/x.ts`, o)).toBe("../../src/x.ts");
  });
});

describe("in a build folder", () => {
  it("normalizeMapsIn rewrites every .map, leaves other files and non-JSON maps alone", () => {
    const dir = mkdtempSync(join(tmpdir(), "d21-"));
    try {
      mkdirSync(join(dir, "assets"));
      writeFileSync(join(dir, "assets", "app-x.js.map"), JSON.stringify(mapFrom(dir, "/tmp/vite-5", [2, 1, 0])));
      writeFileSync(join(dir, "assets", "app-x.js"), "console.log(1)\n//# sourceMappingURL=app-x.js.map\n");
      writeFileSync(join(dir, "broken.js.map"), "not json");
      expect(normalizeMapsIn(dir, dir)).toEqual(["assets/app-x.js.map"]);
      expect(normalizeMapsIn(dir, dir)).toEqual([]); // the second pass changes nothing
      expect(JSON.parse(readFileSync(join(dir, "assets", "app-x.js.map"), "utf8")).sources[0]).toBe("../node_modules/sql.js/dist/sql-wasm.js");
      expect(readFileSync(join(dir, "broken.js.map"), "utf8")).toBe("not json");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the Vite plugin runs after the bundle is written, and only with LUMEN_SOURCEMAP=1", async () => {
    const dir = mkdtempSync(join(tmpdir(), "d21p-"));
    try {
      mkdirSync(join(dir, "dist"));
      const file = join(dir, "dist", "a.js.map");
      const raw = JSON.stringify(mapFrom(dir, "/tmp/v", [1, 0, 2]));
      writeFileSync(file, raw);
      const run = async (enabled: boolean) => {
        const p = deterministicMapsPlugin(enabled, dir);
        (p.configResolved as (c: unknown) => void)({ root: dir, build: { outDir: "dist" } });
        const hook = p.closeBundle as { order: string; handler: (this: unknown) => void };
        expect(hook.order).toBe("post");
        await hook.handler.call({});
      };
      await run(false);
      expect(readFileSync(file, "utf8")).toBe(raw);
      await run(true);
      expect(readFileSync(file, "utf8")).not.toBe(raw);
      expect(JSON.parse(readFileSync(file, "utf8")).sources).toEqual(["../node_modules/sql.js/dist/sql-wasm.js", "../src/app/main.ts", "<external>/vite-worker-entry.js"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("repro-check normalises maps in --sourcemap mode and compares them like every file", () => {
    const src = readFileSync(join(__dirname, "../../scripts/supply-chain/repro-check.mjs"), "utf8");
    expect(src).toContain('import { normalizeMapsIn } from "./normalize-maps.mjs"');
    expect(src).toMatch(/if \(withMaps\) console\.log\(`  normalised \$\{normalizeMapsIn\(join\(root, "dist"\), root\)\.length\}/);
    const vite = readFileSync(join(__dirname, "../../vite.config.ts"), "utf8");
    expect(vite).toContain('deterministicMapsPlugin(process.env.LUMEN_SOURCEMAP === "1", __dirname)');
  });
});
