/**
 * The rows of the file tree (split out of FileTree.tsx, plan W4.11): one
 * folder or file per row, rendered recursively from a shared context.
 */
import { ChevronDown, ChevronRight, FilePlus2, FileText, FolderPlus, FolderOpen, Folder as FolderIcon, Pencil, Trash2 } from "lucide-react";
import type { WorkspaceNode } from "../storage/workspace";
import { t } from "../i18n";

/**
 * The children of one folder to render: the first `limit` rows (folders
 * first, as listed) plus the active note and its folder; `hidden` is how
 * many are left out. `limit` null: everything. A vault of 10,000 root
 * folders is as limited as one of 10,000 root notes.
 */
export function visibleChildren(
  nodes: WorkspaceNode[],
  limit: number | null,
  activePath: string | null,
): { shown: WorkspaceNode[]; hidden: number } {
  if (limit === null || nodes.length <= limit) return { shown: nodes, hidden: 0 };
  let hidden = 0;
  const shown = nodes.filter((n, i) => {
    // The active note, and the folder on its way, always stay.
    if (i < limit || n.path === activePath || (activePath?.startsWith(n.path + "/") ?? false)) return true;
    hidden++;
    return false;
  });
  return { shown, hidden };
}

interface RenderCtx {
  activePath: string | null;
  collapsed: Set<string>;
  editingPath: string | null;
  editValue: string;
  setEditValue: (s: string) => void;
  setEditingPath: (p: string | null) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  toggle: (path: string) => void;
  open: (node: WorkspaceNode) => void;
  commitRename: (oldPath: string) => void;
  remove: (node: WorkspaceNode) => void;
  newFile: (parent: string) => void;
  newFolder: (parent: string) => void;
  selectedPaths: Set<string>;
  toggleSelect: (path: string) => void;
  openContextMenu: (x: number, y: number, node: WorkspaceNode) => void;
  fileLimit: number | null;
  shownAll: Set<string>;
  showAll: (dir: string) => void;
}

/** The rows of one folder's children, with "show N more" when a large vault limits them. */
export function renderChildren(nodes: WorkspaceNode[], dir: string, depth: number, ctx: RenderCtx): React.ReactNode {
  const { shown, hidden } = visibleChildren(nodes, ctx.shownAll.has(dir) ? null : ctx.fileLimit, ctx.activePath);
  return (
    <>
      {shown.map((child) => renderNode(child, depth, ctx))}
      {hidden > 0 && (
        <li role="none">
          <button
            type="button"
            className="file-tree-item file-tree-more"
            style={{ paddingInlineStart: 6 + depth * 12 }}
            onClick={() => ctx.showAll(dir)}
          >
            {t("tree.showMore", { count: String(hidden) })}
          </button>
        </li>
      )}
    </>
  );
}

function renderNode(
  node: WorkspaceNode,
  depth: number,
  ctx: RenderCtx,
): React.ReactNode {
  const isFolder = node.kind === "directory";
  const isOpen = !ctx.collapsed.has(node.path);
  const isActive = node.path === ctx.activePath;

  return (
    <li
      key={node.path}
      role="treeitem"
      aria-expanded={isFolder ? isOpen : undefined}
      aria-selected={isActive}
    >
      {rowOf(node, depth, ctx)}
      {isFolder && isOpen && node.children && (
        <ul className="file-tree-list" role="group">
          {renderChildren(node.children, node.path, depth + 1, ctx)}
        </ul>
      )}
    </li>
  );
}

/** One row: the chevron, the icon, the name (or its rename field) and the row's buttons. */
function rowOf(node: WorkspaceNode, depth: number, ctx: RenderCtx): React.ReactNode {
  const isFolder = node.kind === "directory";
  const isOpen = !ctx.collapsed.has(node.path);
  const isActive = node.path === ctx.activePath;
  const isEditing = ctx.editingPath === node.path;
  const isSelected = ctx.selectedPaths.has(node.path);

  return (
      <div
        className={`file-tree-item ${isActive ? "active" : ""}${isSelected ? " selected" : ""}`}
        data-path={node.path}
        onContextMenu={(e) => {
          e.preventDefault();
          ctx.openContextMenu(e.clientX, e.clientY, node);
        }}
        style={{
          paddingInlineStart: 6 + depth * 12,
          background: isSelected
            ? "hsl(var(--accent) / 0.18)"
            : undefined,
        }}
      >
        {isFolder ? (
          <button
            type="button"
            className="file-tree-chevron"
            onClick={() => ctx.toggle(node.path)}
            title={isOpen ? t("tree.collapse") : t("tree.expand")}
            aria-label={isOpen ? t("tree.collapse") : t("tree.expand")}
          >
            {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        ) : (
          <span style={{ width: 14, display: "inline-block" }} />
        )}

        {isFolder ? (
          isOpen ? (
            <FolderOpen size={14} style={{ flexShrink: 0, opacity: 0.8 }} />
          ) : (
            <FolderIcon size={14} style={{ flexShrink: 0, opacity: 0.8 }} />
          )
        ) : (
          <FileText size={14} style={{ flexShrink: 0, opacity: 0.7 }} />
        )}

        {isEditing ? (
          <input
            ref={ctx.inputRef as React.RefObject<HTMLInputElement>}
            className="file-tree-input"
            aria-label={t("tree.renameItem", { name: node.name })}
            value={ctx.editValue}
            onChange={(ev) => ctx.setEditValue(ev.target.value)}
            onBlur={() => ctx.commitRename(node.path)}
            onKeyDown={(ev) => {
              if (ev.key === "Enter") ctx.commitRename(node.path);
              else if (ev.key === "Escape") ctx.setEditingPath(null);
            }}
          />
        ) : (
          <button
            type="button"
            className="file-tree-name"
            onClick={(e) => {
              // ⌘-click / Ctrl-click → toggle multi-selection rather than
              // opening the file. This lets users build up a set for bulk
              // delete / move without leaving the keyboard.
              if (e.metaKey || e.ctrlKey) {
                e.preventDefault();
                ctx.toggleSelect(node.path);
                return;
              }
              if (isFolder) ctx.toggle(node.path);
              else ctx.open(node);
            }}
            onDoubleClick={() => {
              ctx.setEditingPath(node.path);
              ctx.setEditValue(node.name);
            }}
            title={node.path}
            aria-checked={isSelected ? true : undefined}
          >
            {node.name}
          </button>
        )}

        {isFolder && (
          <>
            <button
              type="button"
              className="file-tree-action"
              title={t("tree.newFileHere")}
              aria-label={t("tree.newFileHere")}
              onClick={(e) => {
                e.stopPropagation();
                ctx.newFile(node.path);
              }}
            >
              <FilePlus2 size={13} />
            </button>
            <button
              type="button"
              className="file-tree-action"
              title={t("tree.newSubfolder")}
              aria-label={t("tree.newSubfolder")}
              onClick={(e) => {
                e.stopPropagation();
                ctx.newFolder(node.path);
              }}
            >
              <FolderPlus size={13} />
            </button>
          </>
        )}
        {!isFolder && (
          <button
            type="button"
            className="file-tree-action"
            title={t("tree.rename")}
            aria-label={t("tree.rename")}
            onClick={(e) => {
              e.stopPropagation();
              ctx.setEditingPath(node.path);
              ctx.setEditValue(node.name);
            }}
          >
            <Pencil size={13} />
          </button>
        )}
        <button
          type="button"
          className="file-tree-action"
          title={t("tree.delete")}
          aria-label={t("tree.delete")}
          onClick={(e) => {
            e.stopPropagation();
            ctx.remove(node);
          }}
        >
          <Trash2 size={13} />
        </button>
      </div>
  );
}

/* ─── The virtual tree (W10.E16, plan W2.22) ─────────────────────────── */

/** Every row has this height in the virtual tree (CSS: .file-tree-virtual .file-tree-item). */
export const ROW_HEIGHT = 26;
/** Rows rendered above and below the visible ones, so a fast scroll does not show a gap. */
export const OVERSCAN = 12;
/** The viewport assumed before the list has been measured (and where nothing is laid out). */
export const DEFAULT_VIEWPORT = 640;

export interface FlatRow {
  node: WorkspaceNode;
  depth: number;
  /** For aria-setsize / aria-posinset: the row's place among its siblings. */
  pos: number;
  size: number;
}

/** The rows a reader can scroll to: the tree in order, without the children of collapsed folders. */
export function flattenTree(nodes: readonly WorkspaceNode[], collapsed: ReadonlySet<string>): FlatRow[] {
  const out: FlatRow[] = [];
  const stack: Array<{ list: readonly WorkspaceNode[]; i: number; depth: number }> = [{ list: nodes, i: 0, depth: 0 }];
  while (stack.length) {
    const top = stack[stack.length - 1];
    if (top.i >= top.list.length) {
      stack.pop();
      continue;
    }
    const node = top.list[top.i++];
    out.push({ node, depth: top.depth, pos: top.i, size: top.list.length });
    if (node.kind === "directory" && node.children?.length && !collapsed.has(node.path)) stack.push({ list: node.children, i: 0, depth: top.depth + 1 });
  }
  return out;
}

/** The rows to render for a scroll position: [start, end) of `total`, with OVERSCAN on each side. */
export function windowOf(scrollTop: number, viewport: number, total: number, rowHeight = ROW_HEIGHT, overscan = OVERSCAN): { start: number; end: number } {
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const count = Math.ceil((viewport > 0 ? viewport : DEFAULT_VIEWPORT) / rowHeight);
  const start = Math.max(0, Math.min(first, total) - overscan);
  return { start, end: Math.min(total, first + count + overscan) };
}

/** The scrollTop that puts row `index` in the middle of the viewport. */
export function scrollTopFor(index: number, viewport: number, total: number, rowHeight = ROW_HEIGHT): number {
  const v = viewport > 0 ? viewport : DEFAULT_VIEWPORT;
  return Math.max(0, Math.min(index * rowHeight - (v - rowHeight) / 2, total * rowHeight - v));
}

export type TreeMove = "next" | "prev" | "first" | "last" | "expand" | "collapse" | "open";

/**
 * A key in the tree → a move (the WAI-ARIA tree pattern). The arrow that
 * points into the text opens a folder: Right in a left-to-right tree, Left
 * in a right-to-left one.
 */
export function treeMove(key: string, dir: "ltr" | "rtl"): TreeMove | null {
  if (key === "ArrowDown") return "next";
  if (key === "ArrowUp") return "prev";
  if (key === "Home") return "first";
  if (key === "End") return "last";
  if (key === "Enter") return "open";
  if (key === "ArrowRight") return dir === "rtl" ? "collapse" : "expand";
  if (key === "ArrowLeft") return dir === "rtl" ? "expand" : "collapse";
  return null;
}

/** One row of the virtual tree, a flat treeitem with its level (the tree's structure is in aria-level). */
export function renderFlatRow(row: FlatRow, ctx: RenderCtx, focused: boolean): React.ReactNode {
  const { node, depth } = row;
  const isFolder = node.kind === "directory";
  return (
    <li
      key={node.path}
      role="treeitem"
      aria-level={depth + 1}
      aria-setsize={row.size}
      aria-posinset={row.pos}
      aria-expanded={isFolder ? !ctx.collapsed.has(node.path) : undefined}
      aria-selected={node.path === ctx.activePath}
      data-focused={focused ? "" : undefined}
    >
      {rowOf(node, depth, ctx)}
    </li>
  );
}

export type { RenderCtx };
