/**
 * Trees of a vault (plan W12.V3): its folders, its nested tags
 * (`#project/lumen/ui`) and the headings of a note — one shape, drawn as an
 * ECharts tree or sunburst, and walked as an ARIA tree (./AriaTree.tsx).
 *
 * Pure: the host gives paths, tags and text.
 */

import { isolate, type Dir } from "./bidi";

export interface VizTreeNode {
  /** Unique in the tree: the folder path, the tag path, or the heading's line. */
  id: string;
  name: string;
  /** Notes under it (folders, tags) or 1 per heading; a parent's value includes its children's. */
  value: number;
  children: VizTreeNode[];
  /** A note to open on Enter, when there is one. */
  path?: string;
  /** Headings: the line (0-based) to jump to. */
  line?: number;
}

const collator = (locale: string) => new Intl.Collator(locale, { numeric: true, sensitivity: "base" });

function sortTree(n: VizTreeNode, cmp: (a: string, b: string) => number): VizTreeNode {
  n.children.sort((a, b) => cmp(a.name, b.name));
  n.children.forEach((c) => sortTree(c, cmp));
  return n;
}

/** Folders → notes: every folder with the number of notes in it and under it. Notes themselves are leaves when `withNotes`. */
export function folderTree(paths: readonly string[], rootName: string, opts: { withNotes?: boolean; locale?: string } = {}): VizTreeNode {
  const root: VizTreeNode = { id: "", name: rootName, value: 0, children: [] };
  const index = new Map<string, VizTreeNode>([["", root]]);
  for (const p of paths) {
    if (!/\.(md|markdown)$/i.test(p)) continue;
    const parts = p.split("/");
    const file = parts.pop()!;
    let at = root;
    at.value++;
    let acc = "";
    for (const seg of parts) {
      acc = acc ? `${acc}/${seg}` : seg;
      let next = index.get(acc);
      if (!next) {
        next = { id: acc, name: seg, value: 0, children: [] };
        index.set(acc, next);
        at.children.push(next);
      }
      next.value++;
      at = next;
    }
    if (opts.withNotes) at.children.push({ id: p, name: file.replace(/\.(md|markdown)$/i, ""), value: 1, children: [], path: p });
  }
  return sortTree(root, collator(opts.locale ?? "he").compare);
}

/** Nested tags: `a/b/c` is under `a/b` under `a`. A note with `#a/b` counts once in `a` and once in `a/b`. */
export function tagTree(notes: ReadonlyArray<{ path: string; tags: readonly string[] }>, rootName: string, locale = "he"): VizTreeNode {
  const root: VizTreeNode = { id: "#", name: rootName, value: 0, children: [] };
  const index = new Map<string, VizTreeNode>();
  const counted = new Map<string, Set<string>>();
  for (const n of notes) {
    if (n.tags.length) root.value++;
    for (const raw of n.tags) {
      const parts = raw.replace(/^#/, "").split("/").filter(Boolean);
      let at = root;
      let acc = "";
      for (const seg of parts) {
        acc = acc ? `${acc}/${seg}` : seg;
        const key = acc.toLocaleLowerCase(locale);
        let next = index.get(key);
        if (!next) {
          next = { id: `#${acc}`, name: seg, value: 0, children: [] };
          index.set(key, next);
          at.children.push(next);
        }
        const seen = counted.get(key) ?? new Set<string>();
        if (!seen.has(n.path)) {
          seen.add(n.path);
          counted.set(key, seen);
          next.value++;
        }
        at = next;
      }
    }
  }
  return sortTree(root, collator(locale).compare);
}

/**
 * The headings of a note (ATX `#`…`######`, outside fenced code and
 * frontmatter), nested by level. A skipped level (## then ####) nests
 * under the nearest shallower heading.
 */
export function headingTree(text: string, rootName: string): VizTreeNode {
  const root: VizTreeNode = { id: "h", name: rootName, value: 0, children: [] };
  const stack: Array<{ level: number; node: VizTreeNode }> = [{ level: 0, node: root }];
  const lines = text.split(/\r?\n/);
  let fence: string | null = null;
  let i = 0;
  if (lines[0] === "---") {
    const end = lines.indexOf("---", 1);
    if (end > 0) i = end + 1;
  }
  for (; i < lines.length; i++) {
    const line = lines[i];
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (!fence) fence = f[1][0].repeat(f[1].length);
      else if (line.trim().startsWith(fence)) fence = null;
      continue;
    }
    if (fence) continue;
    const h = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (!h || !h[2]) continue;
    const level = h[1].length;
    while (stack[stack.length - 1].level >= level) stack.pop();
    const node: VizTreeNode = { id: `h${i}`, name: h[2], value: 1, children: [], line: i };
    stack[stack.length - 1].node.children.push(node);
    stack.push({ level, node });
  }
  const total = (n: VizTreeNode): number => (n.value = (n === root ? 0 : 1) + n.children.reduce((s, c) => s + total(c), 0));
  total(root);
  return root;
}

/** Depth-first order with depth — the order the ARIA tree and the keyboard on the picture walk. */
export function flatten(root: VizTreeNode, includeRoot = true): Array<{ node: VizTreeNode; depth: number; parent: VizTreeNode | null }> {
  const out: Array<{ node: VizTreeNode; depth: number; parent: VizTreeNode | null }> = [];
  const walk = (n: VizTreeNode, depth: number, parent: VizTreeNode | null) => {
    out.push({ node: n, depth, parent });
    for (const c of n.children) walk(c, depth + 1, n);
  };
  if (includeRoot) walk(root, 0, null);
  else for (const c of root.children) walk(c, 0, null);
  return out;
}

/** The deepest level of a tree (the root is 0). */
export function depthOf(n: VizTreeNode): number {
  return n.children.length ? 1 + Math.max(...n.children.map(depthOf)) : 0;
}

export type TreeChartKind = "tree" | "sunburst";

interface EcTree {
  name: string;
  value: number;
  children?: EcTree[];
}
const toEc = (n: VizTreeNode): EcTree => ({ name: isolate(n.name), value: n.value, ...(n.children.length ? { children: n.children.map(toEc) } : {}) });

/**
 * The ECharts option. Tree: grows from the right in RTL (`orient: "RL"`),
 * labels on the reading side. Sunburst: in RTL the rings run
 * counter-clockwise from 12 o'clock, the mirror of LTR.
 */
export function treeOption(root: VizTreeNode, kind: TreeChartKind, dir: Dir, description: string): Record<string, unknown> {
  const rtl = dir === "rtl";
  const base = { animation: false, aria: { enabled: true, label: { enabled: true, description } }, tooltip: { trigger: "item", confine: true, extraCssText: rtl ? "direction: rtl;" : "" } };
  if (kind === "sunburst")
    return { ...base, series: [{ type: "sunburst", data: [toEc(root)], radius: ["0%", "92%"], clockwise: !rtl, startAngle: 90, label: { rotate: "radial", minAngle: 8 }, emphasis: { focus: "ancestor" } }] };
  return {
    ...base,
    series: [
      {
        type: "tree",
        data: [toEc(root)],
        orient: rtl ? "RL" : "LR",
        top: 12,
        bottom: 12,
        left: rtl ? "22%" : "8%",
        right: rtl ? "8%" : "22%",
        initialTreeDepth: 3,
        expandAndCollapse: true,
        symbolSize: 8,
        // The label is before the node in reading order, the leaves' after it.
        label: { position: rtl ? "right" : "left", verticalAlign: "middle", align: rtl ? "left" : "right" },
        leaves: { label: { position: rtl ? "left" : "right", verticalAlign: "middle", align: rtl ? "right" : "left" } },
      },
    ],
  };
}

/** The values an option draws, depth first (the test that the ARIA tree holds the picture's data). */
export function optionTreeValues(option: Record<string, unknown>): Array<[string, number]> {
  const out: Array<[string, number]> = [];
  const walk = (n: EcTree) => {
    out.push([n.name, n.value]);
    n.children?.forEach(walk);
  };
  for (const s of option.series as Array<{ data: EcTree[] }>) s.data.forEach(walk);
  return out;
}
