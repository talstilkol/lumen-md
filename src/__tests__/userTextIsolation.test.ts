/**
 * Plan W13.H4 — every user string in the interface chrome is bidi-isolated:
 * <bdi> or dir="auto" in markup, FSI…PDI in plain text (the window title).
 * The gate inventories the surfaces; each must still exist and isolate its
 * string, and the file-tree rows are rendered for real with "פתק (2).md",
 * "README.md" and "שלום world 123" in a Hebrew and an English interface.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createElement } from "react";
import { render } from "@testing-library/react";
// @ts-expect-error — plain .mjs script without type declarations
import { checkSurface } from "../../scripts/lib/userTextIsolation.mjs";
import { FSI, PDI, isolate, windowTitle } from "../lib/isolate";
import { rowOf } from "../ui/fileTreeRows";
import type { WorkspaceNode } from "../storage/workspace";

const ROOT = resolve(__dirname, "..", "..");
const SAMPLES = ["פתק (2).md", "README.md", "שלום world 123"];

/** [surface, file, the JSX expression that prints the user's string] */
const SURFACES: [string, string, string][] = [
  ["file tree: note name", "src/ui/fileTreeRows.tsx", "node.name"],
  ["tabs: note name", "src/ui/DocTabs.tsx", "tab.name"],
  ["title bar: note name", "src/ui/Toolbar.tsx", "doc.name"],
  ["quick open: note name", "src/ui/SearchDialog.tsx", "hit.name"],
  ["search: note path", "src/ui/SearchDialog.tsx", "hit.path"],
  ["search: full-text result name", "src/ui/SearchDialog.tsx", "name"],
  ["search: snippet", "src/ui/SearchDialog.tsx", "hit.snippet"],
  ["ask the vault: source path", "src/ui/SearchDialog.tsx", "s.path"],
  ["outline: heading", "src/ui/Outline.tsx", "h.text"],
  ["backlinks panel: source note", "src/ui/BacklinksPanel.tsx", "h.fromName"],
  ["backlinks panel: snippet", "src/ui/BacklinksPanel.tsx", "h.snippet"],
  ["backlinks list: source note", "src/ui/BacklinksList.tsx", "g.fromName"],
  ["backlinks list: snippet", "src/ui/BacklinksList.tsx", "h.snippet"],
  ["related notes: name", "src/ui/RelatedPanel.tsx", "h.name"],
  ["unlinked mentions: snippet", "src/ui/UnlinkedMentions.tsx", "h.snippet"],
  ["unlinked mentions: name", "src/ui/UnlinkedMentions.tsx", "n.text"],
  ["saved searches: name", "src/ui/SavedSearches.tsx", "s.name"],
  ["named versions: name", "src/ui/NamedVersionsDialog.tsx", "v.name"],
  ["graph list: node label", "src/ui/graph/GraphListView.tsx", "n.label"],
  ["graph list: current node", "src/ui/graph/GraphListView.tsx", "node.label"],
  ["graph table: node label", "src/ui/graph/GraphTable.tsx", "r.label"],
  ["tags panel: tag", "src/ui/TagsPanel.tsx", "b.tag"],
  ["tags panel: note name", "src/ui/TagsPanel.tsx", "name"],
  ["tags panel: note path", "src/ui/TagsPanel.tsx", "p"],
  ["trash: original path", "src/ui/TrashPanel.tsx", "i.originalPath"],
  ["properties: key", "src/ui/PropertiesPanel.tsx", "p.key"],
  ["comments: author", "src/ui/CommentsPanel.tsx", "c.authorName"],
  ["comments: reply author", "src/ui/CommentsPanel.tsx", "r.authorName"],
  ["publish site: note path", "src/ui/PublishSiteDialog.tsx", "n.path"],
  ["day timeline: event", "src/ui/DayTimeline.tsx", "b.text"],
  ["share dialog: link label", "src/ui/ShareDialog.tsx", "s.label"],
];

describe("the inventory", () => {
  it("covers at least 25 surfaces", () => {
    expect(SURFACES.length).toBeGreaterThanOrEqual(25);
    expect(new Set(SURFACES.map((s) => s[0])).size).toBe(SURFACES.length);
  });

  for (const [id, file, expr] of SURFACES) {
    it(`${id}: {${expr}} is isolated in ${file}`, () => {
      const r = checkSurface(file, readFileSync(join(ROOT, file), "utf8"), expr);
      expect(r.found, "the surface still prints this expression").toBeGreaterThan(0);
      expect(r.bad).toEqual([]);
    });
  }
});

describe("the checker", () => {
  it("fails a bare span, passes bdi and dir", () => {
    expect(checkSurface("a.tsx", "const A = () => <span>{n.name}</span>;", "n.name").bad).toHaveLength(1);
    expect(checkSurface("a.tsx", "const A = () => <bdi>{n.name}</bdi>;", "n.name").bad).toEqual([]);
    expect(checkSurface("a.tsx", 'const A = () => <span dir="auto">{n.name}</span>;', "n.name").bad).toEqual([]);
    expect(checkSurface("a.tsx", "const A = () => <>{n.name}</>;", "n.name").bad).toHaveLength(1);
  });

  it("finds nothing (and so fails the surface) when the expression is gone", () => {
    expect(checkSurface("a.tsx", "const A = () => <bdi>{other}</bdi>;", "n.name").found).toBe(0);
  });

  it("does not count an attribute: a title is not the visible text", () => {
    expect(checkSurface("a.tsx", "const A = () => <span title={n.name}>x</span>;", "n.name").found).toBe(0);
  });
});

describe("plain text: FSI … PDI", () => {
  it("wraps once", () => {
    expect(isolate("README.md")).toBe(`${FSI}README.md${PDI}`);
    expect(isolate(isolate("x"))).toBe(`${FSI}x${PDI}`);
    expect(isolate("")).toBe("");
  });

  it("the window title isolates the note name, in every sample", () => {
    for (const s of SAMPLES) expect(windowTitle(s)).toBe(`${FSI}${s}${PDI} — Lumen`);
    expect(windowTitle("")).toBe("Lumen");
    expect(windowTitle(null)).toBe("Lumen");
  });

  it("the app sets it from the open note", () => {
    const app = readFileSync(join(ROOT, "src/App.tsx"), "utf8");
    expect(app).toMatch(/useWindowTitle\(doc\.name\)/);
    expect(readFileSync(join(ROOT, "src/ui/useWindowTitle.ts"), "utf8")).toMatch(/document\.title = windowTitle\(noteName\)/);
  });
});

describe("rendered: file-tree rows with the samples, Hebrew and English interface", () => {
  const ctx = {
    activePath: null,
    collapsed: new Set<string>(),
    editingPath: null,
    editValue: "",
    setEditValue: () => undefined,
    setEditingPath: () => undefined,
    inputRef: { current: null },
    toggle: () => undefined,
    open: () => undefined,
    commitRename: () => undefined,
    remove: () => undefined,
    newFile: () => undefined,
    newFolder: () => undefined,
    selectedPaths: new Set<string>(),
    toggleSelect: () => undefined,
    openContextMenu: () => undefined,
    fileLimit: null,
    shownAll: new Set<string>(),
    showAll: () => undefined,
  };

  for (const lang of ["he", "en"] as const) {
    it(`every name sits in its own <bdi> (${lang})`, () => {
      document.documentElement.lang = lang;
      document.documentElement.dir = lang === "he" ? "rtl" : "ltr";
      for (const name of SAMPLES) {
        const node = { kind: "file", name, path: `notes/${name}` } as unknown as WorkspaceNode;
        const { container, unmount } = render(createElement("ul", null, rowOf(node, 0, ctx as never)));
        const bdi = [...container.querySelectorAll("bdi")].find((b) => b.textContent === name);
        expect(bdi, name).toBeTruthy();
        // The text is the whole of the isolate: no sibling text shares its bidi paragraph.
        expect(bdi!.childNodes).toHaveLength(1);
        unmount();
      }
    });
  }
});
