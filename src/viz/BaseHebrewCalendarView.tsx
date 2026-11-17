/**
 * The `hebrew-calendar` view of a `.base` (plan W12.V5): the view's notes on
 * the Hebrew month grid by their date property (`date:`, default
 * `note.date`), and the year's heatmap by Hebrew month. Loaded by
 * BasesBlock with a dynamic import only.
 */

import { useMemo } from "react";
import type { BaseResult } from "../views/bases/base";
import { cellDay } from "../views/bases/viewsData";
import { readWorkspaceFile } from "../storage/workspace";
import { useAppStore } from "../store/useStore";
import { isIsrael } from "../daily/dailyNote";
import { nameLang } from "../daily/hebrewCalendarNames";
import HebrewCalendarPanel from "./HebrewCalendarPanel";
import type { DayItem } from "./HebrewMonthView";
import type { Dir } from "./bidi";

export function itemsByDay(result: BaseResult): Map<string, DayItem[]> {
  const id = result.view.date ?? "note.date";
  const out = new Map<string, DayItem[]>();
  for (const r of result.rows) {
    const day = cellDay(r.cells[id] ?? null);
    if (!day) continue;
    out.set(day, [...(out.get(day) ?? []), { path: r.file.path, name: r.file.basename }]);
  }
  return out;
}

export async function openNotePath(path: string): Promise<void> {
  const store = useAppStore.getState();
  if (store.doc.workspaceName === path) return;
  const tab = store.openTabs.find((x) => x.workspaceName === path);
  const content = tab ? tab.content : await readWorkspaceFile(path);
  store.openTab({ name: path.split("/").pop() ?? path, content, workspaceName: path });
}

export default function BaseHebrewCalendarView({ result, dir, locale }: { result: BaseResult; dir: Dir; locale: string }) {
  const items = useMemo(() => itemsByDay(result), [result]);
  const settings = useAppStore((s) => s.dailyNotes);
  const open = (it: DayItem) => void openNotePath(it.path).catch(() => undefined);
  return (
    <HebrewCalendarPanel
      items={items}
      israel={isIsrael(settings, locale)}
      lang={nameLang(locale)}
      locale={locale}
      dir={dir}
      onItem={open}
      onDay={(iso) => {
        const first = items.get(iso)?.[0];
        if (first) open(first);
      }}
    />
  );
}
