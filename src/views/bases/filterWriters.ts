/**
 * Writers for the filter editor of a base (Obsidian 1.15), out of ./base.ts
 * to keep it under 800 lines; ./base re-exports them.
 */
import { isMap, isScalar, isSeq, YAMLMap, YAMLSeq } from "yaml";
import { updateBase } from "./base";

/**
 * A text literal for a filter: double quotes, with `\` and `"` escaped.
 * Obsidian 1.15 fixed filters whose value holds a quote or a backslash
 * (they were saved broken); this writes them the way the parser reads them.
 */
export function basesTextLiteral(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t")}"`;
}

/** Where a filter lives: the base's own (`All views`) or one view's (`This view`). */
export type FilterScope = { view: null } | { view: number };

function filterPath(scope: FilterScope): (string | number)[] {
  return scope.view === null ? ["filters"] : ["views", scope.view, "filters"];
}

/**
 * Move one filter statement (Obsidian 1.15: drag to reorder, and a filter
 * row's menu that moves it between All views and This view). Both ends are
 * top-level `and:` lists; a single statement or a missing `filters:` becomes
 * one. Everything else in the file stays as written.
 */
export function moveFilter(text: string, from: FilterScope & { index: number }, to: FilterScope & { index: number }): { ok: true; text: string } | { ok: false; error: string } {
  return updateBase(text, (doc) => {
    /** The `and:` list at a scope, made into one when it is a single statement or a group of another kind. */
    const andList = (scope: FilterScope, create: boolean): YAMLSeq => {
      if (scope.view !== null && !isMap(doc.getIn(["views", scope.view]))) throw new Error(`no view ${scope.view + 1}`);
      const path = filterPath(scope);
      const cur = doc.getIn(path, true);
      if (isMap(cur) && cur.items.length === 1) {
        const and = cur.get("and", true);
        if (isSeq(and)) return and;
      }
      const empty = cur === undefined || cur === null || (isScalar(cur) && (cur.value === null || cur.value === ""));
      if (empty && !create) throw new Error("no filters there");
      const seq = new YAMLSeq();
      if (!empty) seq.items.push(cur);
      const map = new YAMLMap();
      map.set("and", seq);
      doc.setIn(path, map);
      return seq;
    };
    const src = andList(from, false);
    if (from.index < 0 || from.index >= src.items.length) throw new Error(`no filter ${from.index + 1}`);
    const [item] = src.items.splice(from.index, 1);
    const dst = andList(to, true);
    dst.items.splice(Math.max(0, Math.min(to.index, dst.items.length)), 0, item);
  });
}
