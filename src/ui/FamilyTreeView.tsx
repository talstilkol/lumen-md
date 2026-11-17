/**
 * The family tree (plan W13.G7): ancestors, descendants or the hourglass
 * around one person, drawn from the person entities and their `child` and
 * `spouse` relations — boxes with the name and life years, elbow lines to
 * parents and children, a double line between spouses. Right to left the
 * chart is mirrored (../entities/family.ts).
 *
 * Every box is a button: Enter centres the tree on that person, the
 * Open button opens the person's page. Keys inside the tree: ↑ to a parent,
 * ↓ to a child, ←/→ along the generation (in reading order), Home to the
 * centre person.
 */
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { isRTL, t } from "../i18n";
import { buildFamily, layoutChart, lifeYears, type ChartMode } from "../entities/family";
import type { ExportPerson } from "../entities/gedcom";
import type { Edge } from "../entities/model";

export interface FamilyTreeViewProps {
  people: readonly ExportPerson[];
  edges: readonly Edge[];
  start?: string;
  onOpen?: (id: string) => void;
}

const BW = 150;
const BH = 52;
const GX = 24;
const GY = 44;
const field: React.CSSProperties = { fontSize: 12, padding: "2px 6px", borderRadius: 4, border: "1px solid hsl(var(--border))", background: "hsl(var(--bg))", color: "hsl(var(--fg))" };

export function FamilyTreeView({ people, edges, start, onOpen }: FamilyTreeViewProps) {
  const fam = useMemo(() => buildFamily(people, edges), [people, edges]);
  const linked = useMemo(() => [...fam.persons.keys()].filter((id) => fam.parents.has(id) || fam.children.has(id) || fam.spouses.has(id)), [fam]);
  const first = start && fam.persons.has(start) ? start : ([...linked].sort((a, b) => (fam.children.get(b)?.length ?? 0) + (fam.parents.get(b)?.length ?? 0) - ((fam.children.get(a)?.length ?? 0) + (fam.parents.get(a)?.length ?? 0)))[0] ?? [...fam.persons.keys()][0] ?? "");
  const [focus, setFocus] = useState(first);
  const [mode, setMode] = useState<ChartMode>("hourglass");
  const [depth, setDepth] = useState(3);
  const rtl = isRTL();
  const chart = useMemo(() => layoutChart(fam, focus, mode, depth), [fam, focus, mode, depth]);
  const wrap = useRef<HTMLDivElement>(null);
  const width = chart.cols * (BW + GX) + GX;
  const height = (chart.maxGen - chart.minGen + 1) * (BH + GY) + GY;
  const xOf = (col: number) => (rtl ? width - GX - BW - col * (BW + GX) : GX + col * (BW + GX));
  const yOf = (gen: number) => GY / 2 + (gen - chart.minGen) * (BH + GY);
  const at = new Map(chart.boxes.map((b) => [b.id, b]));

  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    const cur = (document.activeElement as HTMLElement | null)?.dataset?.person;
    if (!cur || !at.has(cur)) return;
    const b = at.get(cur)!;
    let next: string | undefined;
    const row = chart.boxes.filter((x) => x.gen === b.gen).sort((p, q) => p.col - q.col);
    const i = row.findIndex((x) => x.id === cur);
    if (e.key === "ArrowUp") next = (fam.parents.get(cur) ?? []).find((p) => at.has(p));
    else if (e.key === "ArrowDown") next = (fam.children.get(cur) ?? []).find((c) => at.has(c));
    else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      const forward = (e.key === "ArrowLeft") === rtl;
      next = row[i + (forward ? 1 : -1)]?.id;
    } else if (e.key === "Home") next = focus;
    if (!next) return;
    e.preventDefault();
    wrap.current?.querySelector<HTMLElement>(`[data-person="${CSS.escape(next)}"]`)?.focus();
  };

  if (!fam.persons.size) return <p style={{ padding: 16 }} data-testid="family-empty">{t("family.empty")}</p>;
  const me = fam.persons.get(focus);
  return (
    <section aria-label={t("family.label")} data-testid="family-tree" style={{ display: "flex", flexDirection: "column", blockSize: "100%" }}>
      <div role="toolbar" aria-label={t("family.controls")} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", padding: "6px 12px", fontSize: 12 }}>
        <label>
          {t("family.person")}{" "}
          <select style={field} value={focus} onChange={(e) => setFocus(e.target.value)} data-testid="family-focus">
            {[...fam.persons.values()].sort((a, b) => a.name.localeCompare(b.name)).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("family.chart")}{" "}
          <select style={field} value={mode} onChange={(e) => setMode(e.target.value as ChartMode)} data-testid="family-mode">
            <option value="hourglass">{t("family.mode.hourglass")}</option>
            <option value="ancestors">{t("family.mode.ancestors")}</option>
            <option value="descendants">{t("family.mode.descendants")}</option>
          </select>
        </label>
        <label>
          {t("family.depth")}{" "}
          <select style={field} value={depth} onChange={(e) => setDepth(Number(e.target.value))}>
            {[1, 2, 3, 4, 5, 6].map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <span role="status" aria-live="polite" data-testid="family-status" style={{ color: "hsl(var(--fg-muted))" }}>
          {me ? t("family.status", { name: me.name, shown: chart.boxes.length }) : ""}
        </span>
      </div>
      <div ref={wrap} onKeyDown={move} style={{ flex: 1, overflow: "auto", position: "relative" }} data-testid="family-chart">
        <div style={{ position: "relative", inlineSize: width, blockSize: height, minInlineSize: "100%" }}>
          <svg aria-hidden width={width} height={height} style={{ position: "absolute", insetBlockStart: 0, left: 0 }}>
            {chart.links.map((l) => {
              const a = at.get(l.from)!, b = at.get(l.to)!;
              if (l.kind === "spouse") {
                const y = yOf(a.gen) + BH / 2;
                const [x1, x2] = [xOf(a.col), xOf(b.col)].sort((p, q) => p - q);
                return (
                  <g key={`${l.from}=${l.to}`} stroke="hsl(var(--fg-muted))" strokeWidth={1.5}>
                    <line x1={x1 + BW} y1={y - 3} x2={x2} y2={y - 3} />
                    <line x1={x1 + BW} y1={y + 3} x2={x2} y2={y + 3} />
                  </g>
                );
              }
              const px = xOf(a.col) + BW / 2, py = yOf(a.gen) + BH;
              const cx = xOf(b.col) + BW / 2, cy = yOf(b.gen);
              const mid = (py + cy) / 2;
              return <path key={`${l.from}>${l.to}`} d={`M${px},${py} V${mid} H${cx} V${cy}`} fill="none" stroke="hsl(var(--fg-muted))" strokeWidth={1.5} />;
            })}
          </svg>
          {chart.boxes.map((b) => {
            const p = fam.persons.get(b.id)!;
            const years = lifeYears(p);
            const kids = fam.children.get(b.id)?.length ?? 0;
            const isFocus = b.id === focus;
            return (
              <div key={b.id} style={{ position: "absolute", left: xOf(b.col), top: yOf(b.gen), inlineSize: BW, blockSize: BH, display: "flex" }}>
                <button
                  type="button"
                  data-person={b.id}
                  aria-current={isFocus ? "true" : undefined}
                  aria-label={t("family.box", { name: p.name, years: years || t("family.noYears"), children: kids })}
                  onClick={() => setFocus(b.id)}
                  onDoubleClick={() => onOpen?.(b.id)}
                  style={{
                    flex: 1,
                    textAlign: "center",
                    borderRadius: 8,
                    border: `${isFocus ? 2 : 1}px solid ${isFocus ? "hsl(var(--accent))" : "hsl(var(--border))"}`,
                    background: p.sex === "F" ? "hsl(330 60% 96%)" : p.sex === "M" ? "hsl(210 60% 96%)" : "hsl(var(--bg))",
                    color: "hsl(222 47% 11%)",
                    fontSize: 12,
                    lineHeight: 1.3,
                    padding: 4,
                    cursor: "pointer",
                    overflow: "hidden",
                  }}
                >
                  <bdi style={{ display: "block", fontWeight: isFocus ? 700 : 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</bdi>
                  <span style={{ display: "block", color: "hsl(215 16% 35%)", fontSize: 11 }} dir="ltr">
                    {years}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      </div>
      <p style={{ margin: 0, padding: "4px 12px", fontSize: 11, color: "hsl(var(--fg-muted))" }}>
        {t("family.keys")}{" "}
        {onOpen && me && (
          <button type="button" onClick={() => onOpen(focus)} data-testid="family-open">
            {t("family.open", { name: me.name })}
          </button>
        )}
      </p>
    </section>
  );
}

export default FamilyTreeView;
