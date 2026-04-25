import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FilePlus2,
  FileText,
  FolderPlus,
  FolderOpen,
  Folder as FolderIcon,
  Pencil,
  Trash2,
  RefreshCcw,
} from "lucide-react";
import {
  basename,
  createWorkspaceFolder,
  deleteWorkspaceFile,
  dirname,
  isOPFSAvailable,
  joinPath,
  listWorkspaceTree,
  readWorkspaceFile,
  renameWorkspaceFile,
  uniqueWorkspaceName,
  writeWorkspaceFile,
} from "../storage/workspace";
import type { WorkspaceNode } from "../storage/workspace";
import { t } from "../i18n";
import { uiAlert, uiConfirm, uiPrompt } from "./PromptDialog";

interface Props {
  /** Currently active workspace path (if any). */
  activePath: string | null;
  /** Called when a file is selected for opening. */
  onOpenFile: (path: string, content: string) => void;
  /** Called after the active file is renamed. */
  onActiveRenamed: (newPath: string) => void;
  /** Called after the active file is deleted. */
  onActiveDeleted: () => void;
}

export function FileTree({
  activePath,
  onOpenFile,
  onActiveRenamed,
  onActiveDeleted,
}: Props) {
  const [tree, setTree] = useState<WorkspaceNode[]>([]);
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement | null>(null);

  const available = isOPFSAvailable();

  const refresh = useMemo(
    () => async () => {
      if (!available) return;
      try {
        const list = await listWorkspaceTree();
        setTree(list);
      } catch {
        setTree([]);
      }
    },
    [available],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const onChange = () => refresh();
    window.addEventListener("lumen-workspace-changed", onChange);
    return () =>
      window.removeEventListener("lumen-workspace-changed", onChange);
  }, [refresh]);

  // Auto-expand all ancestors of the active file.
  useEffect(() => {
    if (!activePath) return;
    setCollapsed((prev) => {
      const next = new Set(prev);
      let p = dirname(activePath);
      while (p) {
        next.delete(p);
        const up = dirname(p);
        if (up === p) break;
        p = up;
      }
      return next;
    });
  }, [activePath]);

  useEffect(() => {
    if (editingPath) {
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
    }
  }, [editingPath]);

  function toggle(path: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  async function newFile(parentPath: string) {
    const candidate = joinPath(parentPath, "Untitled.md");
    const path = await uniqueWorkspaceName(candidate);
    await writeWorkspaceFile(
      path,
      `# ${basename(path).replace(/\.md$/, "")}\n\n`,
    );
    await refresh();
    const text = await readWorkspaceFile(path);
    onOpenFile(path, text);
  }

  async function newFolder(parentPath: string) {
    const name = (await uiPrompt({ message: t("tree.prompt.folderName") }))?.trim();
    if (!name) return;
    if (/[/\\]/.test(name)) {
      await uiAlert({ message: t("tree.alert.noSlashes") });
      return;
    }
    try {
      await createWorkspaceFolder(joinPath(parentPath, name));
    } catch (e) {
      await uiAlert({
        message: t("tree.alert.folderFailed", { error: (e as Error).message }),
      });
      return;
    }
    await refresh();
  }

  async function open(node: WorkspaceNode) {
    if (node.kind !== "file") return;
    try {
      const text = await readWorkspaceFile(node.path);
      onOpenFile(node.path, text);
    } catch (e) {
      await uiAlert({ message: t("tree.alert.openFailed", { error: (e as Error).message }) });
    }
  }

  async function commitRename(oldPath: string) {
    const next = (editValue || basename(oldPath)).trim();
    setEditingPath(null);
    if (!next || next === basename(oldPath)) return;
    if (next.includes("/")) {
      await uiAlert({ message: t("tree.alert.renameNoSlashes") });
      return;
    }
    const ext = next.match(/\.[^./]+$/) ? "" : ".md";
    const target = joinPath(dirname(oldPath), next + ext);
    try {
      await renameWorkspaceFile(oldPath, target);
      if (oldPath === activePath) onActiveRenamed(target);
      await refresh();
    } catch (e) {
      await uiAlert({
        message: t("tree.alert.renameFailed", { error: (e as Error).message }),
      });
    }
  }

  async function remove(node: WorkspaceNode) {
    const msg =
      node.kind === "directory"
        ? t("tree.confirm.deleteFolder", { path: node.path })
        : t("tree.confirm.deleteFile", { path: node.path });
    if (!(await uiConfirm({ message: msg }))) return;
    try {
      await deleteWorkspaceFile(node.path);
      if (
        activePath &&
        (activePath === node.path || activePath.startsWith(node.path + "/"))
      ) {
        onActiveDeleted();
      }
      await refresh();
    } catch (e) {
      await uiAlert({
        message: t("tree.alert.deleteFailed", { error: (e as Error).message }),
      });
    }
  }

  if (!available) {
    return (
      <aside className="file-tree" aria-label={t("tree.title")}>
        <div className="file-tree-header">{t("tree.title")}</div>
        <div
          style={{
            padding: "1rem",
            fontSize: 12,
            color: "hsl(var(--fg-muted))",
          }}
        >
          {t("tree.opfsUnavailable")}
        </div>
      </aside>
    );
  }

  return (
    <aside className="file-tree" aria-label={t("tree.title")}>
      <div className="file-tree-header">
        <span>{t("tree.title")}</span>
        <div style={{ display: "flex", gap: 4 }}>
          <button
            className="icon-btn"
            title={t("tree.newFileRoot")}
            aria-label={t("tree.newFileRoot")}
            onClick={() => newFile("")}
            style={{ width: 22, height: 22 }}
          >
            <FilePlus2 size={13} />
          </button>
          <button
            className="icon-btn"
            title={t("tree.newFolderRoot")}
            aria-label={t("tree.newFolderRoot")}
            onClick={() => newFolder("")}
            style={{ width: 22, height: 22 }}
          >
            <FolderPlus size={13} />
          </button>
          <button
            className="icon-btn"
            title={t("tree.refresh")}
            aria-label={t("tree.refresh")}
            onClick={refresh}
            style={{ width: 22, height: 22 }}
          >
            <RefreshCcw size={12} />
          </button>
        </div>
      </div>
      {tree.length === 0 ? (
        <div
          style={{
            padding: "1rem 0.85rem",
            color: "hsl(var(--fg-muted))",
            fontSize: 12,
          }}
        >
          {t("tree.emptyHint")}
        </div>
      ) : (
        <ul className="file-tree-list" role="tree">
          {tree.map((node) =>
            renderNode(node, 0, {
              activePath,
              collapsed,
              editingPath,
              editValue,
              setEditValue,
              setEditingPath,
              inputRef,
              toggle,
              open,
              commitRename,
              remove,
              newFile,
              newFolder,
            }),
          )}
        </ul>
      )}
    </aside>
  );
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
}

function renderNode(
  node: WorkspaceNode,
  depth: number,
  ctx: RenderCtx,
): React.ReactNode {
  const isFolder = node.kind === "directory";
  const isOpen = !ctx.collapsed.has(node.path);
  const isActive = node.path === ctx.activePath;
  const isEditing = ctx.editingPath === node.path;

  return (
    <li
      key={node.path}
      role="treeitem"
      aria-expanded={isFolder ? isOpen : undefined}
      aria-selected={isActive}
    >
      <div
        className={`file-tree-item ${isActive ? "active" : ""}`}
        style={{ paddingInlineStart: 6 + depth * 12 }}
      >
        {isFolder ? (
          <button
            type="button"
            className="file-tree-chevron"
            onClick={() => ctx.toggle(node.path)}
            title={isOpen ? t("tree.collapse") : t("tree.expand")}
            aria-label={isOpen ? t("tree.collapse") : t("tree.expand")}
          >
            {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </button>
        ) : (
          <span style={{ width: 14, display: "inline-block" }} />
        )}

        {isFolder ? (
          isOpen ? (
            <FolderOpen size={12} style={{ flexShrink: 0, opacity: 0.8 }} />
          ) : (
            <FolderIcon size={12} style={{ flexShrink: 0, opacity: 0.8 }} />
          )
        ) : (
          <FileText size={12} style={{ flexShrink: 0, opacity: 0.7 }} />
        )}

        {isEditing ? (
          <input
            ref={ctx.inputRef as React.RefObject<HTMLInputElement>}
            className="file-tree-input"
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
            onClick={() => (isFolder ? ctx.toggle(node.path) : ctx.open(node))}
            onDoubleClick={() => {
              ctx.setEditingPath(node.path);
              ctx.setEditValue(node.name);
            }}
            title={node.path}
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
              <FilePlus2 size={11} />
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
              <FolderPlus size={11} />
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
            <Pencil size={11} />
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
          <Trash2 size={11} />
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
