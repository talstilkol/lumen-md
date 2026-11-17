/**
 * Where the infobox (plan W13.G6) gets its data: the entity notes and the
 * approved relations, read from the vault once and kept for a few seconds
 * (an embed and its hover cards share one read). Two entry points:
 *
 * - `EntityInfoboxEmbed` — `![[Entity]]` in a note (the renderer turns an
 *   embed of an entity note into `<lumen-entity-infobox>`);
 * - `entityHoverCard` — pointing at `[[Entity]]` (hoverPreview.tsx).
 *
 * Loaded on demand; nothing is fetched from the network.
 */
import { useEffect, useMemo, useState, type ReactElement } from "react";
import { t } from "../../i18n";
import { infoboxModel, isEntityNotePath } from "../../entities/infobox";
import { ENTITY_ROOT, type Edge, type Entity } from "../../entities/model";
import { parseEntityNote } from "../../entities/notes";
import { EDGES_PATH, readEdges } from "../../entities/store";
import { EntityInfobox } from "./EntityInfobox";
// The infobox's strings (the entityGraph lazy chunk) load with this block, the only way the infobox is shown.
import "../entityGraphStrings";

export interface EntityContext {
  entities: Map<string, Entity>;
  /** Entity id → its note's path. */
  pathOf: Map<string, string>;
  /** Name or alias (lower case) → entity id. */
  byName: Map<string, string>;
  edges: Edge[];
}

/** The context from the entity files (path → text): entity notes and edges.jsonl. */
export function entityContext(files: ReadonlyMap<string, string>): EntityContext {
  const entities = new Map<string, Entity>();
  const pathOf = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const [path, text] of files) {
    if (!path.startsWith(`${ENTITY_ROOT}/`) || !isEntityNotePath(path)) continue;
    const e = parseEntityNote(path, text);
    if (!e) continue;
    entities.set(e.id, e);
    pathOf.set(e.id, path);
    for (const n of [e.name, ...e.aliases]) if (!byName.has(n.toLocaleLowerCase())) byName.set(n.toLocaleLowerCase(), e.id);
  }
  const edges = readEdges(files.get(EDGES_PATH) ?? "").edges;
  return { entities, pathOf, byName, edges };
}

let cached: { at: number; ctx: Promise<EntityContext> } | null = null;
const TTL = 5_000;

/** The vault's entity context, read at most every five seconds. */
export function loadEntityContext(load?: () => Promise<Map<string, string>>): Promise<EntityContext> {
  const now = Date.now();
  if (cached && now - cached.at < TTL && !load) return cached.ctx;
  const ctx = (load ? load() : import("../../entities/vaultIo").then((m) => m.loadEntityFiles())).then(entityContext);
  if (!load) cached = { at: now, ctx };
  return ctx;
}

const imageUrls = new Map<string, string>();
async function resolveImage(path: string): Promise<string | undefined> {
  if (/^(https?:)/i.test(path)) return undefined; // no network: a remote picture is not fetched
  if (/^(data:|blob:)/.test(path)) return path;
  const hit = imageUrls.get(path);
  if (hit) return hit;
  try {
    const ws = await import("../../storage/workspace");
    const all = await ws.listWorkspace({ includeHidden: false });
    const want = path.replace(/^\.?\//, "");
    const found = all.find((e) => e.path === want) ?? all.find((e) => e.path.endsWith(`/${want}`));
    if (!found) return undefined;
    const url = URL.createObjectURL(await ws.readWorkspaceBlob(found.path));
    imageUrls.set(path, url);
    return url;
  } catch {
    // why: no vault or no such file: the card shows without its picture
    return undefined;
  }
}

/** The card for the entity note at `path` (text as read now). Null when the note is not an entity. */
export function infoboxFor(ctx: EntityContext, path: string, text: string, hover = false): ReactElement | null {
  const entity = parseEntityNote(path, text);
  if (!entity) return null;
  const model = infoboxModel({
    entity,
    noteText: text,
    edges: ctx.edges,
    nameOf: (id) => ctx.entities.get(id)?.name,
    idOf: (name) => ctx.byName.get(name.toLocaleLowerCase()),
  });
  const linkOf = (id: string) => ctx.pathOf.get(id)?.replace(/\.md$/i, "");
  const dir = typeof document !== "undefined" && document.documentElement.dir === "rtl" ? "rtl" : "ltr";
  return <EntityInfobox model={model} resolveImage={resolveImage} linkOf={linkOf} hover={hover} dir={dir} />;
}

/** `![[Entity]]`: the card, once the vault's relations are read. */
export default function EntityInfoboxEmbed({ path = "", text = "" }: { path?: string; text?: string }) {
  const [ctx, setCtx] = useState<EntityContext | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let off = false;
    loadEntityContext()
      .then((c) => !off && setCtx(c))
      .catch(() => !off && setFailed(true));
    return () => {
      off = true;
    };
  }, [path]);
  const card = useMemo(() => (ctx ? infoboxFor(ctx, path, text) : null), [ctx, path, text]);
  // Before the relations are read (or without a vault), the card shows the note's own fields.
  const early = useMemo(() => (!ctx ? infoboxFor({ entities: new Map(), pathOf: new Map(), byName: new Map(), edges: [] }, path, text) : null), [ctx, path, text]);
  if (card) return card;
  if (early) return early;
  // empty-allow: an inline note in a hover card ("no facts"), not a panel
  return failed ? <span role="note">{t("entityGraph.infobox.empty")}</span> : null;
}

/** The hover card of a mention: the entity's infobox (null when the note is not an entity). */
export async function entityHoverCard(path: string, text: string): Promise<ReactElement | null> {
  const ctx = await loadEntityContext().catch(() => null);
  return infoboxFor(ctx ?? { entities: new Map(), pathOf: new Map(), byName: new Map(), edges: [] }, path, text, true);
}
