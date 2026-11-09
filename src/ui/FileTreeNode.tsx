/**
 * One row of the workspace file tree (a file or a folder with its children),
 * rendered from the tree's state and callbacks. Split out of ./FileTree.tsx
 * (plan 12.1).
 */
import { ChevronDown, ChevronRight, FilePlus2, FileText, FolderPlus, FolderOpen, Folder as FolderIcon, Pencil, Trash2 } from "lucide-react";
import type { WorkspaceNode } from "../storage/workspace";
import { t } from "../i18n";

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
}

export function renderNode(
  node: WorkspaceNode,
  depth: number,
  ctx: RenderCtx,
): React.ReactNode {
  const isFolder = node.kind === "directory";
  const isOpen = !ctx.collapsed.has(node.path);
  const isActive = node.path === ctx.activePath;
  const isEditing = ctx.editingPath === node.path;
  const isSelected = ctx.selectedPaths.has(node.path);

  return (
    <li
      key={node.path}
      role="treeitem"
      aria-expanded={isFolder ? isOpen : undefined}
      aria-selected={isActive}
    >
      <div
        className={`file-tree-item ${isActive ? "active" : ""}${isSelected ? " selected" : ""}`}
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
            aria-label={`Rename ${node.name}`}
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

      {isFolder && isOpen && node.children && (
        <ul className="file-tree-list" role="group">
          {node.children.map((child) => renderNode(child, depth + 1, ctx))}
        </ul>
      )}
    </li>
  );
}
