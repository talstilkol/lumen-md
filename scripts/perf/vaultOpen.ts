/**
 * W2.22 / W10.E17 — "open < 2 s": the time from a stored index snapshot to
 * a vault that is open, measured apart from the build that made it.
 *
 * Open is what the app does before the user can work (vaultIndexLocal.ts
 * restoreInto with `defer`): the stored record read back (structuredClone
 * stands in for IndexedDB's), decoded and checked (decodeSnapshot), every
 * note's summary for the main thread (summarize: tags, links, title), and
 * the file tree's rows (the virtual tree's flattenTree, large-vault view:
 * folders collapsed, the active note's open). The index's own upserts are
 * deferred by the app until after the vault is shown, so they are measured
 * separately (`indexMs`), not as part of opening.
 */
import { decodeSnapshot, encodeSnapshot, type SnapshotFile } from "../../src/storage/indexSnapshot";
import { summarize } from "../../src/storage/noteSummary";
import { VaultIndex } from "../../src/storage/vaultIndexCore";
import type { WorkspaceNode } from "../../src/storage/workspace";
import { flattenTree } from "../../src/ui/fileTreeRows";

export const OPEN_LIMIT_MS = 2000;

/** The tree a listing of these paths gives: folders first, then files, by name. */
export function treeOf(paths: readonly string[]): WorkspaceNode[] {
  const root: WorkspaceNode = { path: "", name: "", kind: "directory", children: [] };
  const dirs = new Map<string, WorkspaceNode>([["", root]]);
  const dirOf = (path: string): WorkspaceNode => {
    let d = dirs.get(path);
    if (d) return d;
    const i = path.lastIndexOf("/");
    const parent = dirOf(i < 0 ? "" : path.slice(0, i));
    d = { path, name: path.slice(i + 1), kind: "directory", children: [] };
    parent.children!.push(d);
    dirs.set(path, d);
    return d;
  };
  for (const p of paths) {
    const i = p.lastIndexOf("/");
    dirOf(i < 0 ? "" : p.slice(0, i)).children!.push({ path: p, name: p.slice(i + 1), kind: "file" });
  }
  const sort = (n: WorkspaceNode) => {
    n.children?.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "directory" ? -1 : 1));
    n.children?.forEach(sort);
  };
  sort(root);
  return root.children!;
}

export interface OpenResult {
  notes: number;
  /** Snapshot → open vault (read, decode, summaries, tree rows). The acceptance number. */
  openMs: number;
  /** The deferred index fill, after the vault is open. */
  indexMs: number;
  rows: number;
  phases: { readMs: number; decodeMs: number; summariesMs: number; treeMs: number };
}

/** Store `files` as the app's snapshot (not timed), then open the vault from it (timed). */
export function measureOpen(files: readonly SnapshotFile[], activePath: string | null = null, now = () => performance.now()): OpenResult {
  const stored = encodeSnapshot("vault", files);
  const t0 = now();
  const raw = structuredClone(stored);
  const t1 = now();
  const snap = decodeSnapshot(raw, "vault");
  if (!snap) throw new Error("the snapshot did not decode");
  const t2 = now();
  // The main thread keeps a summary per note (tags, links, aliases, frontmatter).
  const summaries = new Map<string, ReturnType<typeof summarize>>();
  for (const f of snap.values()) summaries.set(f.path, summarize(f.content));
  const t3 = now();
  const tree = treeOf([...snap.keys()]);
  const collapsed = new Set<string>();
  const keep = new Set<string>();
  for (let p = activePath ?? ""; p.includes("/"); ) keep.add((p = p.slice(0, p.lastIndexOf("/"))));
  const walk = (ns: WorkspaceNode[]) => ns.forEach((n) => n.kind === "directory" && (keep.has(n.path) || collapsed.add(n.path), walk(n.children ?? [])));
  walk(tree);
  const rows = flattenTree(tree, collapsed).length;
  const t4 = now();
  const index = new VaultIndex();
  for (const f of snap.values()) index.upsert({ path: f.path, name: f.name, content: f.content, modified: f.modified });
  const t5 = now();
  return { notes: summaries.size, openMs: t4 - t0, indexMs: t5 - t4, rows, phases: { readMs: t1 - t0, decodeMs: t2 - t1, summariesMs: t3 - t2, treeMs: t4 - t3 } };
}
