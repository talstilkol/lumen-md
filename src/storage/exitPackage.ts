/**
 * The exit test (plan W13.P3, Ink & Switch's "your data outlives the app"):
 * one package with everything Lumen keeps — notes, attachments, properties
 * (in the notes' frontmatter), version history, settings and AI profiles —
 * in open formats, with a manifest.json that lists every file with its
 * SHA-256, so a clean install (or anyone with `sha256sum`) can check that
 * nothing was lost; and a report of what Obsidian would not read as plain
 * Markdown.
 *
 *   vault/<path>                 every note and attachment, as is
 *   history/<doc>.json           each document's saved versions
 *   settings.json                the settings file (src/settings/io.ts)
 *   ai-profiles.json             the AI profiles and model choices
 *   manifest.json                format, counts, and { path, bytes, sha256 } per file
 *   OBSIDIAN.md                  what Obsidian shows differently, file by file
 */
import { swallowed } from "../lib/logger";

export const EXIT_FORMAT = "lumen-exit/1";

export interface ExitFile {
  path: string;
  data: Uint8Array;
}

export interface ExitSources {
  files: ExitFile[];
  history?: Record<string, Array<{ timestamp: number; content: string; reason?: string; author?: string }>>;
  settings?: unknown;
  aiProfiles?: unknown;
  created?: string;
}

export interface ManifestEntry {
  path: string;
  bytes: number;
  sha256: string;
}

export interface ExitManifest {
  format: typeof EXIT_FORMAT;
  created: string;
  counts: { vault: number; history: number; settings: number; aiProfiles: number };
  files: ManifestEntry[];
}

const enc = new TextEncoder();
const json = (v: unknown) => enc.encode(JSON.stringify(v, null, 2) + "\n");

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A history file name for a document id that may hold slashes. */
const historyName = (doc: string) => `history/${encodeURIComponent(doc)}.json`;

/** Everything Lumen keeps, as files, with the manifest and the Obsidian report. */
export async function buildExitPackage(src: ExitSources): Promise<ExitFile[]> {
  const out: ExitFile[] = src.files.map((f) => ({ path: `vault/${f.path}`, data: f.data }));
  const docs = Object.keys(src.history ?? {}).sort();
  for (const d of docs) out.push({ path: historyName(d), data: json({ document: d, versions: src.history![d] }) });
  if (src.settings !== undefined) out.push({ path: "settings.json", data: json(src.settings) });
  if (src.aiProfiles !== undefined) out.push({ path: "ai-profiles.json", data: json(src.aiProfiles) });
  out.push({ path: "OBSIDIAN.md", data: enc.encode(obsidianReportMarkdown(obsidianReport(src.files))) });
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const files: ManifestEntry[] = [];
  for (const f of out) files.push({ path: f.path, bytes: f.data.byteLength, sha256: await sha256Hex(f.data) });
  const manifest: ExitManifest = {
    format: EXIT_FORMAT,
    created: src.created ?? new Date().toISOString(),
    counts: { vault: src.files.length, history: docs.length, settings: src.settings === undefined ? 0 : 1, aiProfiles: src.aiProfiles === undefined ? 0 : 1 },
    files,
  };
  return [...out, { path: "manifest.json", data: json(manifest) }];
}

export interface VerifyResult {
  ok: boolean;
  checked: number;
  problems: string[];
  manifest: ExitManifest | null;
}

/** Checks every file against manifest.json: present, same size, same SHA-256, nothing extra. */
export async function verifyExitPackage(files: Map<string, Uint8Array> | ExitFile[]): Promise<VerifyResult> {
  const map = files instanceof Map ? files : new Map(files.map((f) => [f.path, f.data]));
  const raw = map.get("manifest.json");
  let manifest: ExitManifest | null = null;
  try {
    manifest = raw ? (JSON.parse(new TextDecoder().decode(raw)) as ExitManifest) : null;
  } catch (e) {
    swallowed("storage/exitPackage: manifest.json is not JSON; the check lists it as missing", e);
    manifest = null;
  }
  if (!manifest || manifest.format !== EXIT_FORMAT || !Array.isArray(manifest.files)) return { ok: false, checked: 0, problems: ["manifest.json missing or not a Lumen exit package"], manifest: null };
  const problems: string[] = [];
  const listed = new Set<string>();
  for (const e of manifest.files) {
    listed.add(e.path);
    const data = map.get(e.path);
    if (!data) problems.push(`missing: ${e.path}`);
    else if (data.byteLength !== e.bytes) problems.push(`size differs: ${e.path}`);
    else if ((await sha256Hex(data)) !== e.sha256) problems.push(`content differs: ${e.path}`);
  }
  for (const p of map.keys()) if (p !== "manifest.json" && !listed.has(p)) problems.push(`not in the manifest: ${p}`);
  if (!manifest.files.length) problems.push("the manifest lists no file");
  return { ok: problems.length === 0, checked: manifest.files.length, problems, manifest };
}

/** A verified package back into its parts, for a clean install. */
export function readExitPackage(files: Map<string, Uint8Array>): ExitSources {
  const dec = new TextDecoder();
  const out: ExitSources = { files: [], history: {} };
  for (const [path, data] of files) {
    if (path.startsWith("vault/")) out.files.push({ path: path.slice(6), data });
    else if (path.startsWith("history/") && path.endsWith(".json")) {
      const h = JSON.parse(dec.decode(data)) as { document: string; versions: NonNullable<ExitSources["history"]>[string] };
      out.history![h.document] = h.versions;
    } else if (path === "settings.json") out.settings = JSON.parse(dec.decode(data));
    else if (path === "ai-profiles.json") out.aiProfiles = JSON.parse(dec.decode(data));
  }
  out.files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return out;
}

export interface ObsidianItem {
  path: string;
  what: string;
}

/** Lumen blocks that Obsidian shows as a plain code block. */
const LUMEN_BLOCKS = /^```(chart|query|dataviewjs|map|timeline|kanban|database|csv|sheet|live-\w+|insights|ach|playground|plantuml|graphviz)\b/m;

/** What Obsidian would not read as plain Markdown (or not at all), file by file. */
export function obsidianReport(files: ExitFile[]): ObsidianItem[] {
  const out: ObsidianItem[] = [];
  const dec = new TextDecoder();
  for (const f of files) {
    const p = f.path.toLowerCase();
    if (p.endsWith(".base")) out.push({ path: f.path, what: "Bases view (.base): Obsidian 1.9+ opens it; older versions show it as a file" });
    else if (p.endsWith(".excalidraw") || p.endsWith(".excalidraw.md")) out.push({ path: f.path, what: "Excalidraw drawing: needs the Excalidraw plugin in Obsidian" });
    else if (p.endsWith(".canvas")) continue; // JSON Canvas: Obsidian's own format
    else if (p.endsWith(".md")) {
      const text = dec.decode(f.data);
      const m = LUMEN_BLOCKS.exec(text);
      if (m) out.push({ path: f.path, what: `a \`\`\`${m[1]} block: Obsidian shows its source as code` });
      if (/\{\+\+|\{--|\{~~/.test(text)) out.push({ path: f.path, what: "tracked changes (CriticMarkup): Obsidian shows the marks as text" });
    } else if (!/\.(png|jpe?g|gif|webp|svg|pdf|mp3|mp4|webm|wav|m4a|ogg|txt|json|csv)$/.test(p)) out.push({ path: f.path, what: "a file type Obsidian does not open (kept as an attachment)" });
  }
  return out;
}

export function obsidianReportMarkdown(items: ObsidianItem[]): string {
  const head = "# Opening this vault in Obsidian\n\nPoint Obsidian at the `vault/` folder. Notes, folders, links, tags and properties are plain Markdown and open as they are.";
  if (!items.length) return `${head}\n\nNothing in this vault needs Lumen.\n`;
  return `${head} These ${items.length} item(s) look different there:\n\n${items.map((i) => `- \`${i.path}\`: ${i.what}`).join("\n")}\n\nLumen-only data (version history, settings, AI profiles) is in \`history/\`, \`settings.json\` and \`ai-profiles.json\`: JSON, readable by any tool.\n`;
}
