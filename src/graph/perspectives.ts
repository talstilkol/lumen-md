/**
 * Saved graph views — perspectives (plan W13.G9), as Neo4j Bloom and Kumu
 * keep them: a name, a style rule per node kind (entity type, a Base row's
 * `type:`) — colour, and size fixed or by number of links — and the view's
 * filters (kinds shown, relations, source folder or tag, confidence, the
 * neighbourhood, the view mode). Opening a perspective puts the view back
 * exactly as it was saved.
 *
 * Stored in the vault, `.lumen/graph/perspectives.json`, so it syncs and is
 * plain JSON a person can read and edit. Reading is tolerant: an entry that
 * does not parse is skipped and reported, never fatal (a hand edit must not
 * lose the rest). Writing is stable: keys and lists in one order, so the
 * same perspectives give the same bytes (save → reopen is identical).
 *
 * Pure apart from `loadPerspectives` / `savePerspectives` (the workspace, or
 * the vault a test passes).
 */

export const PERSPECTIVES_PATH = ".lumen/graph/perspectives.json";

export type PerspectiveScope = "entities" | "notes" | "base";
export type SizeMode = "fixed" | "degree";

export interface KindRule {
  /** `#rrggbb`. */
  color?: string;
  size?: SizeMode;
  /** Size multiplier, 0.25–4. */
  scale?: number;
}

export interface PerspectiveFilter {
  /** Kinds shown; absent = all. */
  kinds?: string[];
  /** Relations shown; absent = all. */
  predicates?: string[];
  folder?: string;
  tag?: string;
  minConfidence?: number;
  center?: string;
  depth?: 1 | 2 | 3;
  mode?: string;
}

export interface Perspective {
  id: string;
  name: string;
  scope: PerspectiveScope;
  rules: Record<string, KindRule>;
  filter: PerspectiveFilter;
}

export interface PerspectiveFile {
  version: 1;
  perspectives: Perspective[];
}

export const emptyPerspectives = (): PerspectiveFile => ({ version: 1, perspectives: [] });

const HEX = /^#[0-9a-f]{6}$/i;
const SCOPES: readonly PerspectiveScope[] = ["entities", "notes", "base"];
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const strList = (v: unknown): string[] | undefined => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string"))].sort() : undefined);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function parseRule(v: unknown): KindRule | null {
  if (!isObj(v)) return null;
  const r: KindRule = {};
  if (typeof v.color === "string" && HEX.test(v.color)) r.color = v.color.toLowerCase();
  if (v.size === "fixed" || v.size === "degree") r.size = v.size;
  if (typeof v.scale === "number" && Number.isFinite(v.scale)) r.scale = clamp(v.scale, 0.25, 4);
  return r;
}

function parseFilter(v: unknown): PerspectiveFilter {
  if (!isObj(v)) return {};
  const f: PerspectiveFilter = {};
  const kinds = strList(v.kinds);
  if (kinds) f.kinds = kinds;
  const preds = strList(v.predicates);
  if (preds) f.predicates = preds;
  for (const k of ["folder", "tag", "center", "mode"] as const) if (typeof v[k] === "string" && (v[k] as string).trim()) f[k] = (v[k] as string).trim();
  if (typeof v.minConfidence === "number" && v.minConfidence > 0) f.minConfidence = clamp(v.minConfidence, 0, 1);
  if (v.depth === 1 || v.depth === 2 || v.depth === 3) f.depth = v.depth;
  return f;
}

/** The perspectives in `text`, and one line per entry that was skipped. */
export function parsePerspectives(text: string): { file: PerspectiveFile; problems: string[] } {
  const file = emptyPerspectives();
  const problems: string[] = [];
  if (!text.trim()) return { file, problems };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { file, problems: [`not JSON: ${e instanceof Error ? e.message : String(e)}`] };
  }
  const list = isObj(data) && Array.isArray(data.perspectives) ? data.perspectives : [];
  const seen = new Set<string>();
  list.forEach((p: unknown, i: number) => {
    if (!isObj(p) || typeof p.id !== "string" || !p.id || typeof p.name !== "string" || !p.name.trim()) return problems.push(`#${i + 1}: needs an id and a name`);
    if (!SCOPES.includes(p.scope as PerspectiveScope)) return problems.push(`#${i + 1} (${p.name}): unknown scope`);
    if (seen.has(p.id)) return problems.push(`#${i + 1} (${p.name}): duplicate id`);
    seen.add(p.id);
    const rules: Record<string, KindRule> = {};
    if (isObj(p.rules)) for (const [k, v] of Object.entries(p.rules)) {
      const r = parseRule(v);
      if (r && Object.keys(r).length) rules[k] = r;
    }
    file.perspectives.push({ id: p.id, name: p.name.trim(), scope: p.scope as PerspectiveScope, rules, filter: parseFilter(p.filter) });
  });
  return { file, problems };
}

const sortKeys = (o: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));

/** Stable JSON: the same perspectives give the same bytes. */
export function serializePerspectives(file: PerspectiveFile): string {
  const out = {
    version: 1,
    perspectives: file.perspectives.map((p) => ({
      id: p.id,
      name: p.name,
      scope: p.scope,
      rules: sortKeys(Object.fromEntries(Object.entries(p.rules).map(([k, r]) => [k, sortKeys({ ...parseRule(r) })]).filter(([, r]) => Object.keys(r as object).length))),
      filter: sortKeys(parseFilter(p.filter) as Record<string, unknown>),
    })),
  };
  return JSON.stringify(out, null, 2) + "\n";
}

/** A new id that is not in `file`. */
export function newPerspectiveId(file: PerspectiveFile, name: string): string {
  const base = name.normalize("NFC").toLowerCase().replace(/[֑-ׇ]/g, "").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "view";
  let id = base;
  for (let i = 2; file.perspectives.some((p) => p.id === id); i++) id = `${base}-${i}`;
  return id;
}

/** `file` with `p` added, or replacing the one with its id. */
export function upsertPerspective(file: PerspectiveFile, p: Perspective): PerspectiveFile {
  const at = file.perspectives.findIndex((x) => x.id === p.id);
  const perspectives = [...file.perspectives];
  if (at >= 0) perspectives[at] = p;
  else perspectives.push(p);
  return { version: 1, perspectives };
}

export const removePerspective = (file: PerspectiveFile, id: string): PerspectiveFile => ({ version: 1, perspectives: file.perspectives.filter((p) => p.id !== id) });

/** `#rrggbb` → 0..1 floats. */
export function hexToRgba(hex: string, alpha = 1): [number, number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, alpha];
}

/** 0..1 floats → `#rrggbb` (the colour input's value). */
export const rgbaToHex = (c: ArrayLike<number>, at = 0): string =>
  "#" + [0, 1, 2].map((i) => Math.round(Math.max(0, Math.min(1, c[at + i])) * 255).toString(16).padStart(2, "0")).join("");

export interface StyledNode {
  kind: string;
  /** Number of links shown. */
  degree: number;
}

/**
 * Colours and sizes for `nodes` under `rules`: a kind without a rule (or a
 * rule without a colour) keeps `fallback(kind)`; size "degree" grows with
 * the square root of the links (4 → 4 + 2·√degree), times `scale`.
 */
export function styleNodes(nodes: readonly StyledNode[], rules: Readonly<Record<string, KindRule>>, fallback: (kind: string) => [number, number, number, number], base = 4): { colors: Float32Array; sizes: Float32Array } {
  const colors = new Float32Array(nodes.length * 4);
  const sizes = new Float32Array(nodes.length);
  const cache = new Map<string, [number, number, number, number]>();
  nodes.forEach((n, i) => {
    const r = rules[n.kind];
    let c = cache.get(n.kind);
    if (!c) cache.set(n.kind, (c = r?.color ? hexToRgba(r.color) : fallback(n.kind)));
    colors.set(c, i * 4);
    const s = r?.size === "degree" ? base + 2 * Math.sqrt(n.degree) : base;
    sizes[i] = s * (r?.scale ?? 1);
  });
  return { colors, sizes };
}

export interface PerspectiveVault {
  readWorkspaceFile(path: string): Promise<string>;
  writeWorkspaceFile(path: string, content: string): Promise<unknown>;
}

const workspace = async (v?: PerspectiveVault): Promise<PerspectiveVault> => v ?? ((await import("../storage/workspace")) as unknown as PerspectiveVault);

/** The vault's perspectives (none when the file is missing). */
export async function loadPerspectives(vault?: PerspectiveVault): Promise<{ file: PerspectiveFile; problems: string[] }> {
  const ws = await workspace(vault);
  const text = await ws.readWorkspaceFile(PERSPECTIVES_PATH).catch(() => "");
  return parsePerspectives(text);
}

export async function savePerspectives(file: PerspectiveFile, vault?: PerspectiveVault): Promise<void> {
  const ws = await workspace(vault);
  await ws.writeWorkspaceFile(PERSPECTIVES_PATH, serializePerspectives(file));
}
