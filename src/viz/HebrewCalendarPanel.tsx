/**
 * The Hebrew-calendar view (plan W12.V5): the month grid
 * (./HebrewMonthView.tsx) and, under it, the year's activity by Hebrew
 * month × day (./hebrewMonthModel.ts `hebrewActivity`) as a heatmap with its
 * data table — the same figure as every chart (./ChartFigure.tsx), so day 1
 * is on the right in RTL and the table holds exactly the drawn numbers.
 */

import { useMemo, useState } from "react";
import { t } from "../i18n";
import ChartFigure from "./ChartFigure";
import HebrewMonthView, { type DayItem } from "./HebrewMonthView";
import { hebrewActivity, hebrewMonthOf, hebrewYearLabel } from "./hebrewMonthModel";
import type { NameLang } from "../daily/hebrewCalendarNames";
import type { Dir } from "./bidi";

interface Props {
  items: ReadonlyMap<string, readonly DayItem[]>;
  /** The count per ISO day for the heatmap (default: the number of items). */
  activity?: ReadonlyMap<string, number>;
  israel: boolean;
  lang: NameLang;
  locale: string;
  dir: Dir;
  /** The day to open on (default today). */
  today?: string;
  heatmap?: boolean;
  onDay?: (iso: string) => void;
  onItem?: (item: DayItem) => void;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

export default function HebrewCalendarPanel({ items, activity, israel, lang, locale, dir, today = todayIso(), heatmap = true, onDay, onItem }: Props) {
  const start = useMemo(() => hebrewMonthOf(today), [today]);
  const [year, setYear] = useState(start.year);
  const byDay = useMemo(() => activity ?? new Map([...items].map(([iso, list]) => [iso, list.length])), [activity, items]);
  const data = useMemo(() => hebrewActivity(byDay, year, lang), [byDay, year, lang]);
  const title = t("viz.hcal.activity", { year: hebrewYearLabel(year, lang) });
  return (
    <div className="lumen-viz-hcal-panel">
      <HebrewMonthView year={start.year} month={start.month} israel={israel} lang={lang} locale={locale} dir={dir} items={items} onDay={onDay} onItem={onItem} focusIso={today} />
      {heatmap && (
        <>
          <div className="lumen-viz-bar">
            <button type="button" onClick={() => setYear((y) => y - 1)} data-hcal-year-prev="">
              {t("viz.hcal.prevYear")}
            </button>
            <button type="button" onClick={() => setYear((y) => y + 1)} data-hcal-year-next="">
              {t("viz.hcal.nextYear")}
            </button>
          </div>
          <ChartFigure
            rows={[]}
            data={data}
            spec={{ kind: "heatmap", x: "day", series: "month" }}
            title={title}
            labels={{ x: t("viz.hcal.dayOfMonth"), y: t("viz.count"), series: t("viz.hcal.month") }}
            dir={dir}
            locale={locale}
            height={Math.max(260, data.ys.length * 26 + 80)}
          />
        </>
      )}
    </div>
  );
}
