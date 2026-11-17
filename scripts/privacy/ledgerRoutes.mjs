/**
 * Every route the privacy ledger can record, by the name the ledger panel
 * shows (plan W11.S13; the same extraction as src/__tests__/privacyDoc.test.ts,
 * plan W4.29). A route is a ledger rule's `reason`, or the fixed reason a
 * module records with; a template reason ("Plugin <id>") by its fixed start.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** The modules that record into the ledger, each with the reasons it records. */
export const RECORDERS = {
  "src/ai/privacyLedger.ts": (src) => [
    ...[...src.matchAll(/reason: "([^"]+)"/g)].map((m) => m[1]),
    // auditReason()'s fallback for a host no audit rule names.
    ...[...src.matchAll(/\?\? "([^"]+ \(audit mode\))"/g)].map((m) => m[1]),
    ...[...src.matchAll(/reason: `([^`$]+)\$\{/g)].map((m) => m[1]).filter((p) => !/^\s*$/.test(p)),
    /export const MONITORING_REASON = "([^"]+)"/.exec(src)[1],
  ],
  // W11.S1 / #739: the signed plugin registry's downloads (index, manifest, code).
  "src/plugins/install.ts": (src) => [/const LEDGER_REASON = "([^"]+)"/.exec(src)[1]],
  "src/research/clipper.ts": (src) => [/reason: "([^"]+)"/.exec(src)[1]],
  "src/agents/python/runner.ts": (src) => [/export const LEDGER_REASON = "([^"]+)"/.exec(src)[1]],
  "src/agents/network.ts": (src) => [/const reason = `([^`$]+)\$\{/.exec(src)[1]],
  "src/plugins/plantumlPolicy.ts": (src) => [/const REASON = "([^"]+)"/.exec(src)[1]],
  "src/ui/VoiceDictation.tsx": (src) => [...src.matchAll(/recordBrowserService\("[^"]+", "([^"]+)"\)/g)].map((m) => m[1]),
  "src/lib/sentryMonitor.ts": () => [],
  "src/desktop/updates.ts": () => [],
  "src/plugins/runtime/pluginHost.ts": () => [],
  "src/ai/tts.ts": () => [],
  "src/sources/sefaria/app.ts": () => [],
  "src/calendar/config.ts": (src) => [...src.matchAll(/\? "([^"]+)" : "([^"]+)"/g)].flatMap((m) => [m[1], m[2]]),
  "src/publish/standardSite.ts": (src) => [/export const ATPROTO_REASON = "([^"]+)"/.exec(src)[1]],
  "src/sources/open/app.ts": (src) => [...src.matchAll(/reason: "([^"]+)"/g)].map((m) => m[1]),
  "src/sources/open/gate.ts": () => [],
  // Wikidata entity linking (W12.E10): ledgerFetch with the ledger's own www.wikidata.org rule.
  "src/ui/WikidataLink.tsx": () => [],
  // W10.C2 (#728 via #978): listing a remote MCP server's tools; its tool calls go through the network gate (agents/network.ts).
  "src/agents/mcp/registry.ts": (src) => [/reason: `([^`$]+)\$\{/.exec(src)[1]],
  // R8-M1: a LaTeX-to-PDF compile that may let Tectonic download TeX packages (recordProcessCall).
  "src/latex/tectonicDesktop.ts": (src) => [/export const TECTONIC_LEDGER_REASON = "([^"]+)"/.exec(src)[1]],
};

/** A call that records into the ledger (or fetches through it). */
export const RECORDING_CALL = /\b(recordBrowserService|recordBlockedRequest|recordPluginRequest|recordAppUpdateCheck|recordSpeechVoice|recordSpeechRecognition|guardedFetch|ledgerFetch)\(/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== "__tests__" && name !== "node_modules") walk(full, out);
    } else if (/\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$|\.d\.ts$/.test(name)) out.push(full);
  }
  return out;
}

/** Modules under src/ that record into the ledger but aren't in RECORDERS (each needs adding there). */
export function unknownRecorders(root) {
  return walk(join(root, "src"))
    .filter((f) => RECORDING_CALL.test(readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")))
    .map((f) => relative(root, f))
    .filter((f) => f !== "src/ai/privacyLedger.ts" && !(f in RECORDERS));
}

/** Every route name, once each. */
export function ledgerRoutes(root) {
  return [...new Set(Object.entries(RECORDERS).flatMap(([file, get]) => get(readFileSync(join(root, file), "utf8"))))];
}
