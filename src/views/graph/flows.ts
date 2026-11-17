/**
 * Sankey views of relations (plans W12.V2 and R12.8).
 *
 * Two kinds of band:
 *   - **counted** (`countedSankey`): how many relations run from one group
 *     to another — entity type → entity type, or a Base field's value →
 *     another field's value. The band's width is the count.
 *   - **flows** (`flowSankey`, the money-map rules of R12.8): one band per
 *     documented relation, every band the SAME width — never sized by an
 *     amount, so nothing is totalled, compared or estimated. An amount is
 *     shown only as its record states it ("no amount stated" otherwise).
 *     Time: a year keeps the flows dated up to it; flows with no date are a
 *     separate group that is always shown, never given a date.
 *
 * The two sides are separate nodes (a source "אדם" and a target "אדם" are
 * not the same node), so a relation inside one group draws as a band and
 * not as a cycle, which a Sankey can't draw. Right to left, the sources sit
 * on the right: ECharts lays a Sankey out left to right only, so in RTL the
 * band is handed to it target → source, and the tooltip and the table keep
 * the real direction. Every band keeps the ids of the relations in it, so a
 * band opens its claims.
 *
 * Pure.
 */

import { isolate, type Dir } from "../../viz/bidi";

export interface SankeyBand {
  from: string;
  to: string;
  /** The width: a count (counted) or 1 (flows). */
  value: number;
  /** The relations (edge ids, row paths) in the band. */
  ids: string[];
  /** Flows: the amount as written, or null (not stated). */
  amount?: string | null;
  /** Flows: the ISO day, or null (not dated). */
  day?: string | null;
  /** Flows: what the band is ("paid to", "member of"). */
  label?: string;
}

export interface SankeyData {
  kind: "counted" | "flows";
  bands: SankeyBand[];
  /** Flows: how many are undated (shown as their own group). */
  undated: number;
}

/** Counted bands from (from, to, id) triples; empty values are "—". */
export function countedSankey(pairs: Iterable<{ from: string; to: string; id: string }>): SankeyData {
  const acc = new Map<string, SankeyBand>();
  for (const p of pairs) {
    const from = p.from || "—";
    const to = p.to || "—";
    const k = `${from}\u0000${to}`;
    const b = acc.get(k) ?? { from, to, value: 0, ids: [] };
    b.value++;
    b.ids.push(p.id);
    acc.set(k, b);
  }
  const bands = [...acc.values()].sort((a, b) => b.value - a.value || (a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : 1));
  return { kind: "counted", bands, undated: 0 };
}

export interface FlowInput {
  id: string;
  from: string;
  to: string;
  label?: string;
  /** As the record states it; null / absent: no amount stated. */
  amount?: string | null;
  day?: string | null;
}

/** One band per flow, all the same width; `year` keeps the dated flows up to it, the undated always. Sorted by id. */
export function flowSankey(flows: readonly FlowInput[], opts: { year?: number } = {}): SankeyData {
  const kept = flows.filter((f) => !f.day || opts.year === undefined || Number(f.day.slice(0, 4)) <= opts.year);
  const bands = [...kept]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((f) => ({ from: f.from, to: f.to, value: 1, ids: [f.id], amount: f.amount ?? null, day: f.day ?? null, label: f.label }));
  return { kind: "flows", bands, undated: bands.filter((b) => !b.day).length };
}

const SRC = "\u0001s:";
const DST = "\u0001t:";
const nodeName = (n: string) => n.replace(/^\u0001[st]:/, "");

/** The ECharts option. `labels.noAmount` is the text for a flow with no amount stated. */
export function sankeyOption(data: SankeyData, dir: Dir, labels: { description: string; noAmount: string; undated: string }): Record<string, unknown> {
  const rtl = dir === "rtl";
  const names = new Set<string>();
  const links = data.bands.map((b, i) => {
    const s = SRC + b.from;
    const t = DST + b.to;
    names.add(s).add(t);
    const shown = data.kind === "flows" ? `${b.label ? `${b.label} · ` : ""}${b.amount ?? labels.noAmount}${b.day ? ` · ${b.day}` : ` · ${labels.undated}`}` : String(b.value);
    // ECharts draws left → right; in RTL hand it the band reversed so the source is on the right.
    return { source: rtl ? t : s, target: rtl ? s : t, value: b.value, band: i, tip: isolate(`${b.from} ${rtl ? "←" : "→"} ${b.to}: ${shown}`) };
  });
  return {
    animation: false,
    aria: { enabled: true, label: { enabled: true, description: labels.description } },
    tooltip: { trigger: "item", confine: true, extraCssText: rtl ? "direction: rtl;" : "", formatter: (p: { data?: { tip?: string; name?: string } }) => p.data?.tip ?? isolate(nodeName(p.data?.name ?? "")) },
    series: [
      {
        type: "sankey",
        orient: "horizontal",
        nodeAlign: rtl ? "right" : "left",
        emphasis: { focus: "adjacency" },
        label: { formatter: (p: { name: string }) => isolate(nodeName(p.name)), position: rtl ? "left" : "right" },
        lineStyle: { color: "gradient", curveness: 0.5, opacity: 0.4 },
        data: [...names].map((name) => ({ name, depth: name.startsWith(SRC) ? (rtl ? 1 : 0) : rtl ? 0 : 1 })),
        links,
      },
    ],
  };
}

/** The bands as the option draws them, in the real direction (the test of the RTL reversal). */
export function optionBands(option: Record<string, unknown>, dir: Dir): Array<{ from: string; to: string; value: number }> {
  const s = (option.series as Array<{ links: Array<{ source: string; target: string; value: number }> }>)[0];
  return s.links.map((l) => {
    const [a, b] = dir === "rtl" ? [l.target, l.source] : [l.source, l.target];
    return { from: nodeName(a), to: nodeName(b), value: l.value };
  });
}
