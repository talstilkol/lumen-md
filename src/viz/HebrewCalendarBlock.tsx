/**
 * A ```hebrew-calendar block (plan W12.V5): the daily notes on the Hebrew
 * month grid — Enter or a click opens (or creates) the day's note — and the
 * year's writing activity (notes saved per day) by Hebrew month.
 *
 *     ```hebrew-calendar
 *     heatmap: true        # false: the month grid only
 *     ```
 *
 * Loaded by the preview with a dynamic import only.
 */

import { useEffect, useMemo, useState } from "react";
import { getLocale, isRTL } from "../i18n";
import { useAppStore } from "../store/useStore";
import { onWorkspaceChanged } from "../storage/workspaceEvents";
import { dayOfPath, isIsrael, isoOf, openDailyNote, parseIso } from "../daily/dailyNote";
import { nameLang } from "../daily/hebrewCalendarNames";
import HebrewCalendarPanel from "./HebrewCalendarPanel";
import { openNotePath } from "./BaseHebrewCalendarView";
import type { DayItem } from "./HebrewMonthView";

export function parseHebrewCalendarBlock(src: string): { heatmap: boolean } {
  const m = /^\s*heatmap\s*:\s*(true|false|yes|no)\s*$/im.exec(src);
  return { heatmap: m ? m[1] === "true" || m[1] === "yes" : true };
}

export default function HebrewCalendarBlock({ source }: { source: string }) {
  const opts = useMemo(() => parseHebrewCalendarBlock(source), [source]);
  const settings = useAppStore((s) => s.dailyNotes);
  const locale = getLocale();
  const [items, setItems] = useState<Map<string, DayItem[]>>(new Map());
  const [activity, setActivity] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const ws = await import("../storage/workspace");
      if (!ws.isOPFSAvailable()) return;
      const files = await ws.listWorkspace();
      const next = new Map<string, DayItem[]>();
      const act = new Map<string, number>();
      for (const f of files) {
        const d = dayOfPath(f.path, settings);
        if (d) next.set(isoOf(d), [{ path: f.path, name: f.path.split("/").pop()!.replace(/\.md$/i, "") }]);
        if (f.modified && /\.(md|markdown)$/i.test(f.path)) {
          const iso = new Date(f.modified).toISOString().slice(0, 10);
          act.set(iso, (act.get(iso) ?? 0) + 1);
        }
      }
      if (!cancelled) {
        setItems(next);
        setActivity(act);
      }
    };
    void run();
    const off = onWorkspaceChanged(() => void run(), { debounceMs: 300 });
    return () => {
      cancelled = true;
      off();
    };
  }, [settings]);

  return (
    <div className="chart-block lumen-hebrew-calendar-block">
      <HebrewCalendarPanel
        items={items}
        activity={activity}
        heatmap={opts.heatmap}
        israel={isIsrael(settings, locale)}
        lang={nameLang(locale)}
        locale={locale}
        dir={isRTL() ? "rtl" : "ltr"}
        onDay={(iso) => {
          const day = parseIso(iso);
          if (day) void openDailyNote(day, settings, locale).catch(() => undefined);
        }}
        onItem={(it) => void openNotePath(it.path).catch(() => undefined)}
      />
    </div>
  );
}
