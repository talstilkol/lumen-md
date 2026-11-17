/**
 * The W13.L3 spike runner: one Obsidian plugin bundle in Lumen's real
 * QuickJS sandbox, over the compatibility layer, against an in-memory note
 * and vault. Returns the verdict (works / loads / fails), why, the
 * Obsidian APIs it reached that the layer lacks, and each command's outcome.
 */
import { createSandbox, type Sandbox } from "../../plugins/runtime/sandbox";
import { grantsFrom } from "../../plugins/runtime/capabilities";
import { parseManifest } from "../../plugins/runtime/manifest";
import type { SandboxLimits } from "../../plugins/runtime/protocol";
// @ts-expect-error — a .mjs module without types
import { lumenManifestFor, readReport, verdict, wrapObsidianPlugin } from "../../../packages/lumen-obsidian-shim/wrap.mjs";

export interface SpikeEvent {
  kind: string;
  phase?: string;
  message?: string;
  id?: string;
  ok?: boolean;
  error?: string;
  missing?: string[];
  commands?: string[];
  codeBlocks?: string[];
  postProcessors?: number;
  views?: string[];
  editorExtensions?: number;
  settingTabs?: number;
}
export interface SpikeResult {
  status: "works" | "loads" | "fails";
  reason: string;
  missing: string[];
  commands: { id: string; ok: boolean; error?: string }[];
  events: SpikeEvent[];
  doc: string;
  vault: Record<string, string>;
  notifications: string[];
  ms: number;
}

export interface SpikeInput {
  manifest: { id: string; name?: string; version?: string; [k: string]: unknown };
  main: string;
  limits?: Partial<SandboxLimits>;
  doc?: string;
  selection?: [number, number];
  vault?: Record<string, string>;
  /** How long to wait for the plugin to settle, ms. */
  timeoutMs?: number;
}

export const SPIKE_DOC = "---\ntags: [demo]\n---\n# כותרת\n\nשָׁלוֹם world, a [[link]] and #tag.\n\n- [ ] task one\n- [x] done\n\n| a | b |\n|---|---|\n| 1 | 2 |\n";
export const SPIKE_VAULT: Record<string, string> = { "note.md": SPIKE_DOC, "link.md": "# Link\n", "daily/2026-11-17.md": "# יום\n#daily\n", "templates/meeting.md": "# {{title}}\n" };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runObsidianPlugin(input: SpikeInput): Promise<SpikeResult> {
  const t0 = Date.now();
  const doc = { text: input.doc ?? SPIKE_DOC, sel: input.selection ?? [0, 0] };
  const vault = new Map(Object.entries(input.vault ?? SPIKE_VAULT));
  const storage = new Map<string, unknown>();
  const notifications: string[] = [];
  const logs: string[] = [];
  const fatals: string[] = [];
  const commandIds = new Map<string, string>();
  const services: Record<string, (...a: unknown[]) => unknown> = {
    "document.getText": () => doc.text,
    "document.getFileName": () => "note.md",
    "document.getSelection": () => ({ from: doc.sel[0], to: doc.sel[1], text: doc.text.slice(doc.sel[0], doc.sel[1]) }),
    "document.setText": (t) => void (doc.text = String(t)),
    "document.insertText": (t) => void (doc.text = doc.text.slice(0, doc.sel[1]) + String(t) + doc.text.slice(doc.sel[1])),
    "document.replaceSelection": (t) => void (doc.text = doc.text.slice(0, doc.sel[0]) + String(t) + doc.text.slice(doc.sel[1])),
    "document.applyEdits": (edits) => {
      const list = [...(edits as { from: number; to: number; insert: string }[])].sort((a, b) => a.from - b.from);
      let out = "";
      let at = 0;
      for (const e of list) (out += doc.text.slice(at, e.from) + e.insert), (at = e.to);
      doc.text = out + doc.text.slice(at);
      return list.length;
    },
    "vault.list": (dir) => {
      const base = dir ? `${String(dir)}/` : "";
      const seen = new Map<string, { name: string; path: string; kind: string }>();
      for (const p of [...vault.keys()].sort()) {
        if (!p.startsWith(base)) continue;
        const [name, ...rest] = p.slice(base.length).split("/");
        seen.set(name, { name, path: base + name, kind: rest.length ? "dir" : "file" });
      }
      return [...seen.values()];
    },
    "vault.read": (p) => {
      if (!vault.has(String(p))) throw new Error(`no such note: ${String(p)}`);
      return vault.get(String(p));
    },
    "vault.write": (p, t) => void vault.set(String(p), String(t)),
    "commands.register": (cmd) => void commandIds.set((cmd as { id: string }).id, (cmd as { label: string }).label),
    "commands.unregister": (id) => void commandIds.delete(String(id)),
    "notifications.show": (t) => void notifications.push(String(t)),
    "storage.get": (k) => storage.get(String(k)) ?? null,
    "storage.set": (k, v) => void storage.set(String(k), v),
    "storage.delete": (k) => void storage.delete(String(k)),
    "clipboard.writeText": () => undefined,
  };
  let inFlight = 0;
  const manifest = parseManifest(lumenManifestFor(input.manifest));
  let sandbox: Sandbox | null = null;
  const result = (status: SpikeResult["status"], reason: string, missing: string[], commands: SpikeResult["commands"], events: SpikeEvent[]): SpikeResult => ({ status, reason, missing, commands, events, doc: doc.text, vault: Object.fromEntries(vault), notifications, ms: Date.now() - t0 });
  try {
    sandbox = await createSandbox({
      manifest,
      code: wrapObsidianPlugin(input.main, input.manifest),
      grants: grantsFrom(manifest.capabilities.map((c) => c.id)),
      limits: { logLinesPerMinute: 10_000, ...input.limits },
      host: {
        call: async (method, args) => {
          inFlight++;
          try {
            const f = services[method];
            if (!f) throw new Error(`${method} is not available`);
            return await f(...args);
          } finally {
            inFlight--;
          }
        },
        log: (level, text) => void logs.push(`${level}:${text}`),
        fatal: (e) => void fatals.push(e),
      },
    });
  } catch (e) {
    const events = readReport(logs) as SpikeEvent[];
    return result("fails", `load: ${(e as Error).message}`.slice(0, 300), [...new Set(events.flatMap((x) => x.missing ?? []))].sort(), [], events);
  }
  const deadline = Date.now() + (input.timeoutMs ?? 15_000);
  const settled = () => (readReport(logs) as SpikeEvent[]).some((e) => e.kind === "settings" || e.kind === "error");
  while (!settled() && !fatals.length && Date.now() < deadline) await sleep(2);
  const commands: SpikeResult["commands"] = [];
  const onload = (readReport(logs) as SpikeEvent[]).find((e) => e.kind === "onload");
  for (const id of onload?.commands ?? []) {
    if (fatals.length) break;
    const before = (readReport(logs) as SpikeEvent[]).filter((e) => e.kind === "command").length;
    const lumenId = String(id).replace(/[^A-Za-z0-9_.-]/g, "-").slice(0, 64) || "command";
    await sandbox.dispatch(`command:${lumenId}`, { source: "palette" });
    const end = Date.now() + 5000;
    while ((readReport(logs) as SpikeEvent[]).filter((e) => e.kind === "command").length === before && !fatals.length && Date.now() < end) await sleep(2);
    const ev = (readReport(logs) as SpikeEvent[]).filter((e) => e.kind === "command")[before];
    commands.push(ev ? { id, ok: !!ev.ok, ...(ev.error ? { error: ev.error } : {}) } : { id, ok: false, error: fatals[0] ?? "no answer within 5 s" });
  }
  while (inFlight > 0 && Date.now() < deadline) await sleep(2);
  const events = readReport(logs) as SpikeEvent[];
  sandbox.dispose();
  if (fatals.length && !events.some((e) => e.kind === "onload")) return result("fails", `fatal: ${fatals[0]}`.slice(0, 300), [...new Set(events.flatMap((x) => x.missing ?? []))].sort(), commands, events);
  if (!settled() && !fatals.length && !events.some((e) => e.kind === "onload")) return result("fails", "timed out while loading", [], commands, events);
  const v = verdict(events, commands) as { status: SpikeResult["status"]; reason: string; missing: string[] };
  return result(v.status, v.reason, v.missing, commands, events);
}
