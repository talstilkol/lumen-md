/**
 * W13.L2 — `minApiVersion` / `targetApiVersion` in the manifest and the
 * compatibility layer: a plugin for the previous API version (N-1) runs, in
 * compatibility mode, with a warning; a plugin below its minimum gets a clear
 * message and never starts; the registry's sample plugins (W4.32) run on
 * API N and N-1 in real QuickJS. Also the runtime side of W13.L1: a
 * deprecated call warns once with the version that removes it.
 */
import { describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createSandbox, type SandboxHost } from "../plugins/runtime/sandbox";
import { loadPlugin } from "../plugins/runtime/pluginHost";
import { grantsFrom } from "../plugins/runtime/capabilities";
import { ManifestError, parseManifest, type PluginManifest } from "../plugins/runtime/manifest";
import { checkApiCompat, methodsForTarget, PLUGIN_API_VERSION, PluginApiVersionError } from "../plugins/api/version";
import { sandboxSurface } from "../plugins/api/surface";
import { applyTextEdits, validateEdits } from "../plugins/api/edits";
import { apiCompatNote } from "../plugins/runtime/apiCompatNote";
import { fakePluginWorker } from "./helpers/pluginWorker";
import { API_VERSION as KIT_API_VERSION, DEPRECATED as KIT_DEPRECATED, loadPlugin as kitLoad } from "../../packages/create-lumen-plugin/template/tools/testkit.mjs";
import { DEPRECATIONS } from "../plugins/api/version";
import { quickjsEngine } from "./helpers/quickjsEngine";
import "../plugins/runtime/trustStrings";

const base = { schema: 1, name: "T", version: "1.0.0", description: "d", author: "a", license: "MIT", main: "main.js" } as const;
const m = (extra: Record<string, unknown> = {}, caps: string[] = ["document:read", "document:write", "notifications"]): PluginManifest =>
  parseManifest({ ...base, id: "test.api", capabilities: caps.map((id) => ({ id, reason: "r" })), ...extra });

function host(): SandboxHost & { calls: [string, unknown[]][]; logs: string[]; fatals: string[] } {
  const h = {
    calls: [] as [string, unknown[]][],
    logs: [] as string[],
    fatals: [] as string[],
    call: vi.fn(async (method: string, args: unknown[]) => {
      h.calls.push([method, args]);
      return method === "document.getText" ? "שָׁלוֹם world" : method === "document.applyEdits" ? (args[0] as unknown[]).length : null;
    }),
    log: (level: string, text: string) => void h.logs.push(`${level}:${text}`),
    fatal: (e: string) => void h.fatals.push(e),
  };
  return h;
}
const boot = async (manifest: PluginManifest, code: string) => {
  const h = host();
  const sb = await createSandbox({ manifest, code, grants: grantsFrom(manifest.capabilities.map((c) => c.id)), host: h });
  return { sb, h };
};

describe("the manifest's API versions", () => {
  it("parses minApiVersion and targetApiVersion, and rejects nonsense", () => {
    expect(m({ minApiVersion: "1.0.0", targetApiVersion: "1.1.0" })).toMatchObject({ minApiVersion: "1.0.0", targetApiVersion: "1.1.0" });
    expect(m()).not.toHaveProperty("targetApiVersion");
    expect(() => m({ minApiVersion: "one" })).toThrow(ManifestError);
    expect(() => m({ targetApiVersion: "1.1" })).toThrow(/targetApiVersion/);
    expect(() => m({ minApiVersion: "1.1.0", targetApiVersion: "1.0.0" })).toThrow(/older than "minApiVersion"/);
  });

  it("checkApiCompat: current, N-1 (compat), below the minimum, a newer major, a dropped major", () => {
    expect(checkApiCompat({ id: "a", targetApiVersion: PLUGIN_API_VERSION })).toMatchObject({ ok: true, mode: "current" });
    // N-1: a plugin for 1.0 on 1.1 runs, with a warning.
    const n1 = checkApiCompat({ id: "a", targetApiVersion: "1.0.0" }, "1.1.0");
    expect(n1).toMatchObject({ ok: true, mode: "compat", apiVersion: "1.0.0", target: "1.0.0" });
    expect(n1.ok && n1.warnings[0]).toMatch(/targets plugin API 1\.0\.0; Lumen 1\.1\.0 runs it in compatibility mode/);
    // No target at all is the first public API, so today's registry plugins are N-1.
    expect(checkApiCompat({ id: "a" }, "1.1.0")).toMatchObject({ ok: true, mode: "compat", target: "1.0.0" });
    // The previous major (N-1 across a major) still runs on the current surface plus the shims.
    expect(checkApiCompat({ id: "a", targetApiVersion: "1.4.0" }, "2.0.0")).toMatchObject({ ok: true, mode: "compat", apiVersion: "2.0.0" });
    const low = checkApiCompat({ id: "a", minApiVersion: "1.4.0" }, "1.1.0");
    expect(low).toMatchObject({ ok: false, reason: "below-min", need: "1.4.0", have: "1.1.0" });
    expect(!low.ok && low.message).toBe("plugin a needs plugin API 1.4.0 or newer; this Lumen has 1.1.0. Update Lumen to use it.");
    expect(checkApiCompat({ id: "a", targetApiVersion: "2.0.0" }, "1.1.0")).toMatchObject({ ok: false, reason: "newer-major" });
    expect(checkApiCompat({ id: "a", targetApiVersion: "1.0.0" }, "3.0.0")).toMatchObject({ ok: false, reason: "unsupported-major" });
    // A newer minor of the same major with an old minimum: it said it works on its minimum.
    expect(checkApiCompat({ id: "a", minApiVersion: "1.0.0", targetApiVersion: "1.9.0" }, "1.1.0")).toMatchObject({ ok: true, mode: "current" });
  });

  it("the surface of a target: what existed then", () => {
    const all = ["document.getText", "document.setText", "document.applyEdits"];
    expect(methodsForTarget(all, "1.0.0", "1.1.0")).toEqual(["document.getText", "document.setText"]);
    expect(methodsForTarget(all, "1.1.0", "1.1.0")).toEqual(all);
    expect(sandboxSurface(m({ targetApiVersion: "1.1.0" })).methods).toContain("document.applyEdits");
    expect(sandboxSurface(m()).methods).not.toContain("document.applyEdits");
    expect(() => sandboxSurface(m({ minApiVersion: "9.0.0" }))).toThrow(PluginApiVersionError);
  });

  it("the install screen's words, in English and Hebrew", async () => {
    expect(apiCompatNote(m({ targetApiVersion: PLUGIN_API_VERSION }))).toBeNull();
    expect(apiCompatNote(m(), "1.1.0")).toMatchObject({ tone: "info", installable: true, text: expect.stringContaining("compatibility mode") });
    const below = apiCompatNote(m({ minApiVersion: "1.4.0" }), "1.1.0");
    expect(below).toMatchObject({ tone: "error", installable: false });
    expect(below?.text).toBe("This plugin needs plugin API 1.4.0 or newer; this Lumen has 1.1.0. Update Lumen to install it.");
    const he = JSON.parse(readFileSync(resolve(__dirname, "../i18n/locales/he/common.json"), "utf8")) as Record<string, string>;
    const en = JSON.parse(readFileSync(resolve(__dirname, "../i18n/lazy/pluginTrust.json"), "utf8")) as Record<string, string>;
    for (const k of ["compat", "belowMin", "newerMajor", "unsupported", "invalid"]) {
      expect(en[`pluginTrust.api.${k}`], k).toBeTruthy();
      expect(he[`pluginTrust.api.${k}`], k).toMatch(/[א-ת]/);
    }
  });
});

describe("in the sandbox (real QuickJS)", () => {
  it("an N-1 plugin runs: it sees API 1.0.0 and the 1.0 surface", async () => {
    const { h, sb } = await boot(m(), `console.log(JSON.stringify({ v: lumen.apiVersion, edits: typeof lumen.document.applyEdits, set: typeof lumen.document.setText }));`);
    expect(h.logs).toEqual([`log:${JSON.stringify({ v: "1.0.0", edits: "undefined", set: "function" })}`]);
    sb.dispose();
  });

  it("a current plugin sees API 1.1.0 and applyEdits", async () => {
    const { h, sb } = await boot(m({ targetApiVersion: "1.1.0" }), `
      lumen.document.applyEdits([{ from: 0, to: 0, insert: "> " }]).then((n) => console.log(lumen.apiVersion + " " + n));`);
    await vi.waitFor(() => expect(h.logs).toEqual(["log:1.1.0 1"]));
    expect(h.calls).toEqual([["document.applyEdits", [[{ from: 0, to: 0, insert: "> " }]]]]);
    sb.dispose();
  });

  it("a method from a newer API than the target is refused even through the raw bridge", async () => {
    const { h, sb } = await boot(m(), `
      __lumen_call("document.applyEdits", "[[]]").then(() => console.log("allowed"), (e) => console.log(e.name + ": " + e.message));`);
    await vi.waitFor(() => expect(h.logs.length).toBe(1));
    expect(h.logs[0]).toMatch(/^log:PluginDenied: .*not in plugin API 1\.0\.0/);
    expect(h.call).not.toHaveBeenCalled();
    sb.dispose();
  });

  it("a deprecated call works, and warns once with the version that removes it (W13.L1)", async () => {
    const { h, sb } = await boot(m({ targetApiVersion: "1.1.0" }), `
      lumen.document.setText("a").then(() => lumen.document.setText("b")).then(() => console.log("done"));`);
    await vi.waitFor(() => expect(h.logs.length).toBe(2));
    expect(h.logs).toEqual(["warn:plugin test.api: lumen.document.setText is deprecated since plugin API 1.1.0 and will be removed in 2.0.0; use lumen.document.applyEdits", "log:done"]);
    expect(h.calls.map((c) => c[0])).toEqual(["document.setText", "document.setText"]);
    sb.dispose();
  });

  it("below its minimum, the plugin never starts, and the message says what to do", async () => {
    const h = host();
    await expect(createSandbox({ manifest: m({ minApiVersion: "1.9.0" }), code: `console.log("ran")`, grants: grantsFrom([]), host: h })).rejects.toThrow(/needs plugin API 1\.9\.0 or newer; this Lumen has 1\.1\.0\. Update Lumen/);
    expect(h.logs).toEqual([]);
    // The host refuses before a worker exists.
    const createWorker = vi.fn(fakePluginWorker);
    await expect(loadPlugin({ manifest: m({ minApiVersion: "1.9.0" }), code: "", grants: grantsFrom([]), services: {}, createWorker })).rejects.toBeInstanceOf(PluginApiVersionError);
    expect(createWorker).not.toHaveBeenCalled();
  });

  it("the host reports compatibility mode, and refuses a method outside the target's surface a second time", async () => {
    const inst = await loadPlugin({ manifest: m(), code: `lumen.on("go", () => __lumen_call("document.applyEdits", "[[]]").catch((e) => console.log(e.name)));`, grants: grantsFrom(["document:write"]), services: { "document.applyEdits": () => 0 }, createWorker: fakePluginWorker });
    expect(inst.api).toEqual({ version: "1.0.0", mode: "compat", warnings: [expect.stringMatching(/compatibility mode/)] });
    const cur = await loadPlugin({ manifest: m({ targetApiVersion: "1.1.0" }), code: "", grants: grantsFrom([]), services: {}, createWorker: fakePluginWorker });
    expect(cur.api).toEqual({ version: "1.1.0", mode: "current", warnings: [] });
    await inst.unload();
    await cur.unload();
  });
});

describe("applyEdits", () => {
  it("applies sorted, non-overlapping edits in the coordinates before the batch; Hebrew with niqqud and bidi marks keeps its code units", () => {
    const text = "שָׁלוֹם ‏עוֹלָם world";
    const at = text.indexOf("world");
    const edits = validateEdits([{ from: at, to: at + 5, insert: "עולם" }, { from: 0, to: 0, insert: "> " }], text.length);
    expect(edits.map((e) => e.from)).toEqual([0, at]);
    expect(applyTextEdits(text, edits)).toBe("> שָׁלוֹם ‏עוֹלָם עולם");
    // Two inserts at one point keep their order.
    expect(applyTextEdits("ab", validateEdits([{ from: 1, to: 1, insert: "x" }, { from: 1, to: 1, insert: "y" }], 2))).toBe("axyb");
  });
  it("refuses overlap, out of range, non-integers and too many edits", () => {
    expect(() => validateEdits([{ from: 0, to: 3, insert: "" }, { from: 2, to: 4, insert: "" }], 5)).toThrow(/overlap/);
    expect(() => validateEdits([{ from: 0, to: 6, insert: "" }], 5)).toThrow(/outside the note/);
    expect(() => validateEdits([{ from: 0.5, to: 1, insert: "" }], 5)).toThrow(/integers/);
    expect(() => validateEdits([{ from: 0, to: 1 }], 5)).toThrow(/insert/);
    expect(() => validateEdits("x", 5)).toThrow(/array/);
    expect(() => validateEdits(Array.from({ length: 5001 }, () => ({ from: 0, to: 0, insert: "" })), 5)).toThrow(/at most 5000/);
  });
});

describe("the registry's sample plugins (W4.32) on API N and N-1", () => {
  const DIR = resolve(__dirname, "../../public/plugins/examples");
  const names = readdirSync(DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((n) => readdirSync(join(DIR, n)).includes("lumen-plugin.json"));

  it("there are at least ten, and the test kit speaks the app's API version and deprecations", () => {
    expect(names.length).toBeGreaterThanOrEqual(10);
    expect(KIT_API_VERSION).toBe(PLUGIN_API_VERSION);
    expect(Object.entries(KIT_DEPRECATED).map(([method, d]) => ({ method, ...d }))).toEqual(DEPRECATIONS);
  });

  // The repo pins quickjs-emscripten 0.32 (top-level await, \p{…} in regexps). An older engine (this
  // environment's offline 0.23) lacks both: the probe finds out, a plugin's top-level await then runs
  // inside an async function (same calls, same order), and a plugin whose regexps need \p{…} is skipped
  // with that reason. With the pinned engine nothing is wrapped and nothing is skipped.
  const probe = async (code: string) => {
    try {
      const h = host();
      const sb = await createSandbox({ manifest: m(), code, grants: grantsFrom([]), host: h });
      sb.dispose();
      return true;
    } catch {
      return false;
    }
  };
  let engine: { tla: boolean; unicodeRegexp: boolean } | null = null;
  const caps = async () => (engine ??= { tla: await probe("await 0;"), unicodeRegexp: await probe('new RegExp("[\\\\p{L}\\\\-]", "u");') });
  const DOC = "# כותרת\n\n- [ ] task one\n- [x] done\n\nשָׁלוֹם world 2026-11-17 | a | b |\n";
  for (const target of ["1.0.0", PLUGIN_API_VERSION])
    for (const name of names)
      it(`${name} on API ${target}: loads in QuickJS and every command it registers runs`, async (ctx) => {
        const manifest = { ...JSON.parse(readFileSync(join(DIR, name, "lumen-plugin.json"), "utf8")), targetApiVersion: target };
        const source = readFileSync(join(DIR, name, manifest.main), "utf8");
        const e = await caps();
        const code = e.tla ? source : `(async () => {\n${source}\n})().catch((e) => console.error("load: " + e));`;
        const load = () => kitLoad({ manifest, code, engine: quickjsEngine, document: { text: DOC, fileName: "note.md", selection: [2, 7] }, vault: { "note.md": DOC, "daily/2026-11-17.md": "# יום\n", "templates/meeting.md": "# {{title}}\n" }, fetch: async () => ({ status: 200, headers: {}, body: '{"quote":"q"}' }) });
        let p: Awaited<ReturnType<typeof load>>;
        try {
          p = await load();
        } catch (err) {
          if (!e.unicodeRegexp && /invalid escape sequence in regular expression/.test(String(err))) return ctx.skip("this QuickJS build rejects [\\p{…}\\-] in a /u regular expression; the pinned 0.32 accepts it");
          throw err;
        }
        try {
          for (const id of p.commands.keys()) await p.run(id, { source: "palette" });
          const warns = p.logs.filter((l: { level: string }) => l.level === "warn").map((l: { text: string }) => l.text);
          const usesSetText = /lumen\.document\.setText/.test(code);
          // A deprecated call says so on either target: the removal will reach a 1.0 plugin too.
          const calledSetText = p.calls.some((c: { method: string }) => c.method === "document.setText");
          expect(calledSetText ? 1 : 0, name).toBe(warns.filter((w: string) => /setText is deprecated since plugin API 1\.1\.0 and will be removed in 2\.0\.0/.test(w)).length);
          if (!usesSetText) expect(warns.join("\n")).not.toMatch(/deprecated/);
          expect(p.calls.some((c: { outcome: string }) => c.outcome === "denied"), `${name}: nothing refused`).toBe(false);
          expect(p.logs.filter((l: { level: string }) => l.level === "error"), `${name}: no errors`).toEqual([]);
        } finally {
          p.dispose();
        }
      });
});
