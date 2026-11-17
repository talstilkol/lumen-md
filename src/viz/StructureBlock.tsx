/**
 * A ```structure block (plan W12.V3): the vault's folders, its nested tags,
 * or this note's headings, as a tree or a sunburst.
 *
 *     ```structure
 *     source: folders      # folders | tags | headings
 *     view: sunburst       # tree | sunburst
 *     root: projects       # folders: only under this folder; tags: only under this tag
 *     ```
 *
 * Enter (or a click) on an item opens it: a note, the first note of a
 * folder or tag in the search, or the heading in this note — through the
 * preview's own wiki-link handling, so it opens the way a link does.
 * Loaded by the preview with a dynamic import only.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { getLocale, isRTL, t } from "../i18n";
import { ensureIndex, indexedNotes } from "../storage/workspaceIndex";
import { onWorkspaceChanged } from "../storage/workspaceEvents";
import { useAppStore } from "../store/useStore";
import { noteMeta } from "../graph/graphModel";
import TreeFigure from "./TreeFigure";
import { folderTree, headingTree, tagTree, type TreeChartKind, type VizTreeNode } from "./treeModel";

export type StructureSource = "folders" | "tags" | "headings";

export interface StructureSpec {
  source: StructureSource;
  view: TreeChartKind;
  root: string;
  problems: string[];
}

export function parseStructure(src: string): StructureSpec {
  const spec: StructureSpec = { source: "folders", view: "tree", root: "", problems: [] };
  for (const line of src.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const m = /^\s*(source|view|root)\s*:\s*(.*?)\s*$/i.exec(line);
    if (!m) {
      spec.problems.push(line.trim());
      continue;
    }
    const v = m[2].replace(/\s+#.*$/, "");
    const key = m[1].toLowerCase();
    if (key === "source" && (v === "folders" || v === "tags" || v === "headings")) spec.source = v;
    else if (key === "view" && (v === "tree" || v === "sunburst")) spec.view = v;
    else if (key === "root") spec.root = v.replace(/^#/, "").replace(/^\/+|\/+$/g, "");
    else spec.problems.push(line.trim());
  }
  return spec;
}

/** The part of a tree under `root` (a folder path or a tag path), or the whole tree. */
export function subtree(tree: VizTreeNode, root: string): VizTreeNode {
  if (!root) return tree;
  const want = [tree.id.startsWith("#") ? `#${root}` : root].map((s) => s.toLocaleLowerCase());
  const find = (n: VizTreeNode): VizTreeNode | null => (want.includes(n.id.toLocaleLowerCase()) ? n : n.children.map(find).find(Boolean) ?? null);
  return find(tree) ?? { ...tree, children: [], value: 0 };
}

function openTarget(host: HTMLElement | null, target: string) {
  if (!host) return;
  const a = document.createElement("a");
  a.className = "wiki-link";
  a.href = "#";
  a.setAttribute("data-wiki-target", target);
  a.hidden = true;
  host.appendChild(a);
  a.click();
  a.remove();
}

export default function StructureBlock({ source }: { source: string }) {
  const spec = useMemo(() => parseStructure(source), [source]);
  const [notes, setNotes] = useState<Array<{ path: string; content: string }> | null>(null);
  const content = useAppStore((s) => s.doc.content);
  const host = useRef<HTMLDivElement | null>(null);
  const locale = getLocale();

  useEffect(() => {
    if (spec.source === "headings") return;
    let cancelled = false;
    const run = async () => {
      await ensureIndex();
      const list = (await indexedNotes()).map((n) => ({ path: n.path, content: n.content }));
      if (!cancelled) setNotes(list);
    };
    void run();
    const off = onWorkspaceChanged(() => void run(), { debounceMs: 200 });
    return () => {
      cancelled = true;
      off();
    };
  }, [spec.source]);

  const tree = useMemo(() => {
    if (spec.source === "headings") return headingTree(content ?? "", t("viz.structure.thisNote"));
    if (!notes) return null;
    if (spec.source === "tags") return subtree(tagTree(notes.map((n) => ({ path: n.path, tags: noteMeta(n.content).tags })), t("viz.structure.tags"), locale), spec.root);
    return subtree(folderTree(notes.map((n) => n.path), t("viz.structure.vault"), { withNotes: true, locale }), spec.root);
  }, [spec, notes, content, locale]);

  const activate = (n: VizTreeNode) => {
    if (n.path) openTarget(host.current, n.path.replace(/\.md$/i, ""));
    else if (n.line !== undefined) openTarget(host.current, `#${n.name}`);
  };

  return (
    <div className="chart-block lumen-structure-block" ref={host} data-structure-source={spec.source}>
      {spec.problems.length > 0 && <p className="lumen-viz-note">{t("viz.structure.badOptions", { options: spec.problems.join(", ") })}</p>}
      {!tree && <p className="lumen-viz-note">{t("viz.loading")}</p>}
      {tree && (
        <TreeFigure root={tree} kind={spec.view} title={t(`viz.structure.title.${spec.source}`)} dir={isRTL() ? "rtl" : "ltr"} locale={locale} onActivate={activate} />
      )}
    </div>
  );
}
