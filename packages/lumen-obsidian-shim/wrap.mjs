/**
 * Wrap an Obsidian plugin's CommonJS bundle (main.js) to run in Lumen's
 * QuickJS sandbox on top of shim.js (plan W13.L3). MIT.
 *
 * The result is one script: the shim, then the plugin's bundle inside a
 * function that gets `module`, `exports` and a `require` that knows only
 * `obsidian`, then the lifecycle (index the vault, `new Plugin(app,
 * manifest)`, `load()`). Each phase reports a `__obs {…}` line on the
 * console; `readReport` turns the log into a verdict.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
/** The layer's parts, in the order they run (each under 800 lines). */
export const SHIM_PARTS = ["shim-dom.js", "shim-vault.js", "shim.js"].map((f) => join(HERE, f));

/** The capabilities an Obsidian plugin gets in the spike: the open note, the vault, commands, toasts, storage, clipboard. No network. */
export const OBSIDIAN_CAPABILITIES = ["document:read", "document:write", "vault:read", "vault:write", "commands", "notifications", "storage", "clipboard:write"];

/** The Lumen manifest an Obsidian manifest runs under. */
export function lumenManifestFor(obsidianManifest) {
  const id = `obsidian.${String(obsidianManifest.id ?? "plugin").toLowerCase().replace(/[^a-z0-9.-]/g, "-")}`.slice(0, 64);
  return {
    schema: 1,
    id: id.length >= 3 ? id : `${id}-plugin`,
    name: String(obsidianManifest.name ?? obsidianManifest.id ?? "Obsidian plugin").slice(0, 80),
    version: /^\d+\.\d+\.\d+/.test(String(obsidianManifest.version)) ? String(obsidianManifest.version).match(/^\d+\.\d+\.\d+/)[0] : "0.0.0",
    description: String(obsidianManifest.description ?? "An Obsidian plugin").slice(0, 500) || "An Obsidian plugin",
    author: String(obsidianManifest.author ?? "unknown").slice(0, 120) || "unknown",
    license: "NOASSERTION",
    main: "main.js",
    targetApiVersion: "1.1.0",
    capabilities: OBSIDIAN_CAPABILITIES.map((c) => ({ id: c, reason: "Obsidian compatibility layer" })),
  };
}

export function wrapObsidianPlugin(mainJs, obsidianManifest, { activeNote = "note.md", shim = SHIM_PARTS.map((p) => readFileSync(p, "utf8")).join("\n") } = {}) {
  const manifest = JSON.stringify(obsidianManifest);
  return `${shim}
;(async () => {
  let phase = "index";
  try {
    await __obsBoot(${JSON.stringify(activeNote)});
    phase = "evaluate";
    const module = { exports: {} };
    (function (module, exports, require, global) {
${mainJs}
    }).call(module.exports, module, module.exports, __obsRequire, globalThis);
    __obsReport("evaluated", {});
    phase = "construct";
    const P = module.exports && (module.exports.default ?? module.exports);
    if (typeof P !== "function") throw new Error("the bundle exports no plugin class");
    const plugin = new P(__obsApp, ${manifest});
    phase = "onload";
    await plugin.load();
    globalThis.__obsPlugin = plugin;
    const s = __obsState;
    __obsReport("onload", { commands: [...s.commands.keys()], settingTabs: s.settingTabs.length, ribbon: s.ribbon, statusBar: s.statusBar, views: s.views, postProcessors: s.postProcessors, codeBlocks: s.codeBlocks.map((c) => c.lang), editorExtensions: s.editorExtensions, missing: [...__obsMissing] });
    phase = "settings";
    for (const tab of s.settingTabs) await tab.display();
    __obsReport("settings", { missing: [...__obsMissing] });
  } catch (e) {
    __obsReport("error", { phase, message: String(e && e.message ? e.name + ": " + e.message : e).slice(0, 300), missing: [...__obsMissing] });
  }
})();
`;
}

/** The `__obs` lines of a plugin's log, parsed. */
export function readReport(logs) {
  const out = [];
  for (const l of logs) {
    const text = typeof l === "string" ? l.replace(/^(log|warn|error):/, "") : l.text;
    if (typeof text === "string" && text.startsWith("__obs ")) {
      try {
        out.push(JSON.parse(text.slice(6)));
      } catch {
        // why: a truncated line (the log cap is 2000 characters): kept as a note
        out.push({ kind: "note", message: "truncated report line" });
      }
    }
  }
  return out;
}

/**
 * The verdict for one plugin:
 *   works  — loaded, `onload` finished, it added something Lumen can run (a command, a code-block or
 *            post processor), every command ran on a test note without an error, and its settings tab drew;
 *   loads  — `onload` finished, but nothing it added can run here (views, editor extensions only), or a command failed;
 *   fails  — the bundle or `onload` threw (the reason and the missing APIs say why).
 */
export function verdict(events, commandResults = []) {
  const err = events.find((e) => e.kind === "error");
  const onload = events.find((e) => e.kind === "onload");
  const missing = [...new Set(events.flatMap((e) => e.missing ?? []))].sort();
  if (!onload) return { status: "fails", reason: err ? `${err.phase}: ${err.message}` : "never finished loading", missing };
  const runnable = onload.commands.length + onload.codeBlocks.length + onload.postProcessors;
  const failed = commandResults.filter((c) => !c.ok);
  if (err && err.phase === "settings") return { status: "loads", reason: `settings tab: ${err.message}`, missing, onload };
  if (!runnable) return { status: "loads", reason: onload.views.length || onload.editorExtensions ? "adds only views or editor extensions (not supported)" : "adds nothing runnable", missing, onload };
  if (failed.length) return { status: "loads", reason: `${failed.length}/${commandResults.length} commands failed: ${failed[0].id}: ${failed[0].error}`.slice(0, 300), missing, onload };
  return { status: "works", reason: "", missing, onload };
}
