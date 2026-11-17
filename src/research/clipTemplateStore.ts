/**
 * The user's clip templates (plan 4.15, W10.E67): kept in the vault at
 * .lumen/clip-templates.json, so they sync with the notes. buildClip reads
 * them before the built-in site templates (clipTemplates.pickTemplate), and
 * the editor (ClipTemplatesEditor.tsx) writes them.
 *
 * Templates exported from the Obsidian Web Clipper (its "Export" JSON,
 * schemaVersion 0.1.0) import as they are: name, path, noteNameFormat,
 * properties, triggers and noteContentFormat map one to one. Its
 * filters beyond lower/upper/trim/slug/safe are kept as written and left
 * empty by fill().
 */
import { triggerMatches, type ClipTemplate } from "./clipTemplates";
import { wordSlug } from "../lib/slug";

export const CLIP_TEMPLATES_PATH = ".lumen/clip-templates.json";

/** What is wrong with a template, or [] when it can be saved. Keys are i18n message ids. */
export function templateProblems(t: ClipTemplate, all: readonly ClipTemplate[] = []): Array<{ key: string; detail?: string }> {
  const out: Array<{ key: string; detail?: string }> = [];
  if (!t.name.trim()) out.push({ key: "clipTemplates.problem.name" });
  if (!t.noteName.trim()) out.push({ key: "clipTemplates.problem.noteName" });
  if (all.some((o) => o !== t && o.id === t.id)) out.push({ key: "clipTemplates.problem.duplicate", detail: t.id });
  for (const tr of t.triggers ?? []) {
    if (tr.startsWith("schema:")) {
      if (!/^schema:@?\w+$/.test(tr)) out.push({ key: "clipTemplates.problem.trigger", detail: tr });
    } else if (tr.length > 2 && tr.startsWith("/") && tr.endsWith("/")) {
      try {
        new RegExp(tr.slice(1, -1));
      } catch {
        out.push({ key: "clipTemplates.problem.regex", detail: tr });
      }
    } else if (!/^https?:\/\//.test(tr)) out.push({ key: "clipTemplates.problem.trigger", detail: tr });
  }
  for (const p of t.properties) if (!/^[\p{L}\p{N}_-]+$/u.test(p.name)) out.push({ key: "clipTemplates.problem.property", detail: p.name });
  return out;
}

/** Templates from the file's text: ill-formed entries are dropped, never thrown on (a broken file must not stop clipping). */
export function parseTemplates(text: string): ClipTemplate[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  const list = Array.isArray(raw) ? raw : (raw as { templates?: unknown })?.templates;
  if (!Array.isArray(list)) return [];
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  return list
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((x) => ({
      id: str(x.id) || templateId(str(x.name)),
      name: str(x.name),
      path: str(x.path) || "{{library}}",
      noteName: str(x.noteName) || "{{title}}",
      properties: Array.isArray(x.properties) ? x.properties.filter((p) => p && typeof p.name === "string").map((p) => ({ name: p.name as string, value: str(p.value) })) : [],
      content: str(x.content),
      triggers: Array.isArray(x.triggers) ? x.triggers.filter((tr): tr is string => typeof tr === "string" && tr.trim() !== "").map((tr) => tr.trim()) : [],
      ...(typeof x.context === "string" && x.context ? { context: x.context } : {}),
    }))
    .filter((t) => t.name);
}

export const serializeTemplates = (list: readonly ClipTemplate[]): string => JSON.stringify({ version: 1, templates: list }, null, 2) + "\n";

/** A template's id from its name (lib/slug.ts wordSlug, lowercase), "template" when nothing is left. */
export function templateId(name: string): string {
  return wordSlug(name, { lower: true }) || "template";
}

/** An Obsidian Web Clipper template export (one template, or a list) as ours. */
export function importObsidianTemplate(text: string): ClipTemplate[] {
  const raw = JSON.parse(text) as unknown;
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((o) => {
    const x = o as Record<string, unknown>;
    if (typeof x.name !== "string" || typeof x.noteContentFormat !== "string") throw new Error("not an Obsidian Web Clipper template export (name, noteContentFormat)");
    const props = Array.isArray(x.properties) ? (x.properties as Array<{ name?: unknown; value?: unknown }>) : [];
    return {
      id: templateId(x.name),
      name: x.name,
      path: typeof x.path === "string" && x.path ? x.path : "{{library}}",
      noteName: typeof x.noteNameFormat === "string" && x.noteNameFormat ? x.noteNameFormat : "{{title}}",
      properties: props.filter((p) => typeof p.name === "string").map((p) => ({ name: p.name as string, value: typeof p.value === "string" ? p.value : "" })),
      content: x.noteContentFormat,
      triggers: Array.isArray(x.triggers) ? (x.triggers as unknown[]).filter((tr): tr is string => typeof tr === "string") : [],
    };
  });
}

/** Which of `list` would a page at `url` get, and by which trigger (for the editor's "test an address"). */
export function whichTemplate(url: string, list: readonly ClipTemplate[], schema?: unknown): { template: ClipTemplate; trigger: string } | null {
  for (const t of list) for (const tr of t.triggers ?? []) if (triggerMatches(tr, url, schema)) return { template: t, trigger: tr };
  return null;
}

export interface TemplateIo {
  read(path: string): Promise<string | null>;
  write(path: string, text: string): Promise<void>;
}

/** The vault's file, through the workspace (OPFS / the folder). No vault: no user templates. */
async function vaultIo(): Promise<TemplateIo | null> {
  const ws = await import("../storage/workspace");
  if (!ws.isOPFSAvailable()) return null;
  return {
    read: async (p) => ((await ws.workspaceHasFile(p).catch(() => false)) ? await ws.readWorkspaceFile(p).catch(() => null) : null),
    write: (p, text) => ws.writeWorkspaceFile(p, text),
  };
}

export async function loadUserTemplates(io?: TemplateIo | null): Promise<ClipTemplate[]> {
  const f = io === undefined ? await vaultIo() : io;
  return f ? parseTemplates((await f.read(CLIP_TEMPLATES_PATH)) ?? "[]") : [];
}

export async function saveUserTemplates(list: readonly ClipTemplate[], io?: TemplateIo | null): Promise<void> {
  const bad = list.flatMap((t) => templateProblems(t, list).map((p) => `${t.name || t.id}: ${p.key}${p.detail ? ` (${p.detail})` : ""}`));
  if (bad.length) throw new Error(`clip templates not saved: ${bad.join("; ")}`);
  const f = io === undefined ? await vaultIo() : io;
  if (!f) throw new Error("clip templates need a vault (the workspace is not available)");
  await f.write(CLIP_TEMPLATES_PATH, serializeTemplates(list));
}
