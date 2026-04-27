/**
 * Persistence layer for the Whiteboard / Canvas (P3-04). Each canvas is
 * stored under `canvases/` in the OPFS workspace as `<name>.canvas.json`,
 * a small JSON document with nodes + edges + viewport state.
 *
 * Auto-save is debounced — every edit hits this module 200ms after the
 * user stops dragging / typing. Switching canvases or closing the modal
 * forces a synchronous flush so nothing is lost on a reload.
 */

import {
  isOPFSAvailable,
  listWorkspace,
  readWorkspaceFile,
  writeWorkspaceFile,
} from "../storage/workspace";
import { log } from "../lib/logger";

export interface CanvasNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  content: string;
  color: string;
}

export interface CanvasEdge {
  from: string;
  to: string;
}

export interface CanvasDoc {
  /** Schema version — bump when the file format changes. */
  version: 1;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  viewport: { pan: { x: number; y: number }; zoom: number };
  /** ISO date when the canvas was last touched (informational). */
  modified?: string;
}

const DIR = "canvases";
const EXT = ".canvas.json";

export function canvasPath(name: string): string {
  const safe = name.replace(/[^\w.\- ]/g, "_").trim() || "untitled";
  const base = safe.endsWith(EXT) ? safe : safe + EXT;
  return `${DIR}/${base}`;
}

/** List every saved canvas — basenames without the extension. */
export async function listCanvases(): Promise<string[]> {
  if (!isOPFSAvailable()) return [];
  try {
    const all = await listWorkspace({ includeAssets: false });
    return all
      .filter((f) => f.path.startsWith(`${DIR}/`) && f.path.endsWith(EXT))
      .map((f) => f.name.replace(/\.canvas\.json$/i, ""))
      .sort((a, b) => a.localeCompare(b));
  } catch (err) {
    log.warn("listCanvases failed", err);
    return [];
  }
}

export async function loadCanvas(name: string): Promise<CanvasDoc | null> {
  if (!isOPFSAvailable()) return null;
  try {
    const body = await readWorkspaceFile(canvasPath(name));
    const parsed = JSON.parse(body) as Partial<CanvasDoc>;
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.nodes)) {
      return {
        version: 1,
        nodes: parsed.nodes ?? [],
        edges: parsed.edges ?? [],
        viewport: parsed.viewport ?? { pan: { x: 0, y: 0 }, zoom: 1 },
        modified: parsed.modified,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export async function saveCanvas(name: string, doc: Omit<CanvasDoc, "version" | "modified">): Promise<void> {
  if (!isOPFSAvailable()) return;
  const payload: CanvasDoc = {
    version: 1,
    nodes: doc.nodes,
    edges: doc.edges,
    viewport: doc.viewport,
    modified: new Date().toISOString(),
  };
  try {
    await writeWorkspaceFile(canvasPath(name), JSON.stringify(payload, null, 2));
  } catch (err) {
    log.warn("saveCanvas failed", err);
  }
}

/* ─── Debounced auto-save helper ─────────────────────────────────────── */

const pending = new Map<string, ReturnType<typeof setTimeout>>();

export function autoSaveCanvas(
  name: string,
  doc: Omit<CanvasDoc, "version" | "modified">,
  delayMs = 250,
): void {
  const existing = pending.get(name);
  if (existing) clearTimeout(existing);
  pending.set(
    name,
    setTimeout(() => {
      pending.delete(name);
      void saveCanvas(name, doc);
    }, delayMs),
  );
}

/** Force-flush any in-flight auto-save for `name` (or all when omitted). */
export async function flushCanvas(name?: string): Promise<void> {
  if (name) {
    const t = pending.get(name);
    if (t) {
      clearTimeout(t);
      pending.delete(name);
    }
    return;
  }
  for (const [, t] of pending) clearTimeout(t);
  pending.clear();
}
