/**
 * An ```argument-map block (plan W12.V4): the vault's claims and sources
 * (src/argument/argumentMap.ts) as a layered map, sources → claims →
 * conclusions, in the frame of ./VizFrame.tsx.
 *
 *     ```argument-map
 *     folder: מחקר/שכר     # optional: only notes under this folder
 *     ```
 *
 * The picture is SVG (no chart library): green "supports", red dashed
 * "contradicts", yellow dotted "qualifies". In Hebrew the sources are on the
 * right. The arrow keys walk the notes layer by layer and Enter opens one;
 * the alternative is a nested list, claim ← its sources. A claim no source
 * reaches is marked "no source". "Save as a canvas" writes a JSON Canvas
 * and an Excalidraw file of the same map. Loaded with a dynamic import only.
 */

import { useEffect, useMemo, useState } from "react";
import YAML from "yaml";
import { getLocale, isRTL, t } from "../i18n";
import { ensureIndex, indexedNotes } from "../storage/workspaceIndex";
import { onWorkspaceChanged } from "../storage/workspaceEvents";
import { readWorkspaceFile, writeWorkspaceFile } from "../storage/workspace";
import { useAppStore } from "../store/useStore";
import { serializeJsonCanvas, jsonCanvasToExcalidraw } from "../canvas/jsonCanvas";
import { serializeExcalidrawFile } from "../canvas/excalidrawFile";
import { VizFrame } from "./VizFrame";
import { isolate, type Dir } from "./bidi";
import {
  ARGUMENT_RELATIONS,
  argumentBoxes,
  argumentGraph,
  argumentToJsonCanvas,
  layoutArgument,
  NODE_H,
  NODE_W,
  readingOrder,
  unsupportedClaims,
  type ArgNoteInput,
  type ArgumentGraph,
  type ArgumentRelation,
} from "../argument/argumentMap";
import { EmptyState, learnHow } from "../ui/EmptyState";

const FM = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/;

export function frontmatterOf(text: string): Record<string, unknown> {
  const m = FM.exec(text);
  if (!m) return {};
  try {
    const v = YAML.parse(m[1]);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function parseArgumentBlock(src: string): { folder: string } {
  const m = /^\s*folder\s*:\s*(.*?)\s*$/im.exec(src);
  return { folder: (m?.[1] ?? "").replace(/^\/+|\/+$/g, "") };
}

const STROKE: Record<ArgumentRelation, { color: string; dash?: string }> = {
  supports: { color: "hsl(142 60% 38%)" },
  contradicts: { color: "hsl(0 70% 50%)", dash: "6 4" },
  qualifies: { color: "hsl(40 85% 45%)", dash: "2 4" },
};

export function relationLabels(): Record<ArgumentRelation, string> {
  return { supports: t("viz.arg.supports"), contradicts: t("viz.arg.contradicts"), qualifies: t("viz.arg.qualifies") };
}

/** The map's picture: SVG boxes and edges (decorative: the frame's keyboard and the list carry the content). */
/** W13.W8: the argument checker's findings per claim note, for a badge on the map and a line in the list. */
export type MapFindings = ReadonlyMap<string, { count: number; kinds: string[] }>;

function MapPicture({ g, dir, unsupported, findings }: { g: ArgumentGraph; dir: Dir; unsupported: ReadonlySet<string>; findings?: MapFindings }) {
  const lo = useMemo(() => layoutArgument(g), [g]);
  const boxes = useMemo(() => argumentBoxes(lo, dir), [lo, dir]);
  const width = Math.max(NODE_W, ...[...boxes.values()].map((b) => b.x + NODE_W));
  const height = Math.max(NODE_H, ...[...boxes.values()].map((b) => b.y + NODE_H));
  const kindOf = new Map(g.nodes.map((n) => [n.id, n.kind]));
  return (
    <svg viewBox={`-8 -8 ${width + 16} ${height + 16}`} width="100%" height={Math.min(560, height + 16)} aria-hidden="true" focusable="false" data-argument-svg="">
      <defs>
        {ARGUMENT_RELATIONS.map((r) => (
          <marker key={r} id={`arg-${r}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill={STROKE[r].color} />
          </marker>
        ))}
      </defs>
      {g.edges.map((e, i) => {
        const a = boxes.get(e.from)!;
        const b = boxes.get(e.to)!;
        const leftToRight = a.x <= b.x;
        const x1 = leftToRight ? a.x + NODE_W : a.x;
        const x2 = leftToRight ? b.x : b.x + NODE_W;
        const y1 = a.y + NODE_H / 2;
        const y2 = b.y + NODE_H / 2;
        const mid = (x1 + x2) / 2;
        return <path key={i} d={`M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`} fill="none" stroke={STROKE[e.relation].color} strokeWidth={2} strokeDasharray={STROKE[e.relation].dash} markerEnd={`url(#arg-${e.relation})`} data-relation={e.relation} />;
      })}
      {g.nodes.map((n) => {
        const b = boxes.get(n.id)!;
        const flagged = unsupported.has(n.id);
        return (
          <g key={n.id} transform={`translate(${b.x},${b.y})`} data-node={n.id} data-kind={kindOf.get(n.id)}>
            <rect width={NODE_W} height={NODE_H} rx={8} fill="hsl(var(--bg))" stroke={flagged ? "hsl(0 70% 50%)" : "hsl(var(--border))"} strokeWidth={flagged ? 3 : 1} strokeDasharray={n.kind === "source" ? "4 3" : undefined} />
            <text x={NODE_W / 2} y={NODE_H / 2} textAnchor="middle" dominantBaseline="middle" fontSize={13} fill="hsl(var(--fg))" direction={dir}>
              {isolate(n.label.length > 28 ? `${n.label.slice(0, 27)}…` : n.label)}
            </text>
            {flagged && (
              <text x={NODE_W / 2} y={NODE_H - 8} textAnchor="middle" fontSize={10} fill="hsl(0 70% 45%)" direction={dir}>
                {t("viz.arg.noSource")}
              </text>
            )}
            {findings?.get(n.id) && (
              <g data-findings={findings.get(n.id)!.count} transform={`translate(${dir === "rtl" ? 4 : NODE_W - 26},4)`}>
                <rect width={22} height={16} rx={8} fill="hsl(35 90% 45%)" />
                <text x={11} y={12} textAnchor="middle" fontSize={11} fill="#fff">
                  {findings.get(n.id)!.count}
                </text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** The alternative: each claim with the notes that support, contradict or qualify it. */
function MapList({ g, unsupported, findings, onOpen, id, hidden }: { g: ArgumentGraph; unsupported: ReadonlySet<string>; findings?: MapFindings; onOpen: (path: string) => void; id: string; hidden: boolean }) {
  const label = new Map(g.nodes.map((n) => [n.id, n.label]));
  const claims = g.nodes.filter((n) => n.kind !== "source");
  const sourcesOnly = g.nodes.filter((n) => n.kind === "source" && !g.edges.some((e) => e.from === n.id));
  return (
    <div id={id} hidden={hidden} className="lumen-viz-arg-list" data-viz-table="">
      <ul>
        {claims.map((c) => (
          <li key={c.id} data-claim={c.id}>
            <button type="button" className="lumen-viz-arg-link" onClick={() => onOpen(c.id)} dir="auto">
              {c.label}
            </button>{" "}
            <span className="lumen-viz-note">{c.kind === "conclusion" ? t("viz.arg.conclusion") : t("viz.arg.claim")}</span>
            {unsupported.has(c.id) && <strong className="lumen-viz-claim-missing"> · {t("viz.arg.noSource")}</strong>}
            {findings?.get(c.id) && <span className="lumen-viz-note" data-findings={findings.get(c.id)!.count}> · {t("viz.arg.findings", { n: findings.get(c.id)!.count })}</span>}
            <ul>
              {g.edges
                .filter((e) => e.to === c.id)
                .map((e) => (
                  <li key={`${e.from}-${e.relation}`} data-relation={e.relation}>
                    {t(`viz.arg.by.${e.relation}`)}:{" "}
                    <button type="button" className="lumen-viz-arg-link" onClick={() => onOpen(e.from)} dir="auto">
                      {label.get(e.from)}
                    </button>
                  </li>
                ))}
            </ul>
          </li>
        ))}
      </ul>
      {sourcesOnly.length > 0 && <p className="lumen-viz-note">{t("viz.arg.unused", { names: sourcesOnly.map((s) => s.label).join(", ") })}</p>}
    </div>
  );
}

async function openNote(path: string) {
  const store = useAppStore.getState();
  if (store.doc.workspaceName === path) return;
  const tab = store.openTabs.find((x) => x.workspaceName === path);
  const content = tab ? tab.content : await readWorkspaceFile(path);
  store.openTab({ name: path.split("/").pop() ?? path, content, workspaceName: path });
}

export function ArgumentMapView({ g, dir, title, onOpen, onSave, findings }: { g: ArgumentGraph; dir: Dir; title: string; onOpen: (path: string) => void; onSave?: () => void; findings?: MapFindings }) {
  const unsupported = useMemo(() => unsupportedClaims(g), [g]);
  const order = useMemo(() => readingOrder(layoutArgument(g)), [g]);
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const points = order.map((id) => {
    const n = byId.get(id)!;
    const kind = n.kind === "source" ? t("viz.arg.source") : n.kind === "conclusion" ? t("viz.arg.conclusion") : t("viz.arg.claim");
    const f = findings?.get(id);
    const value = unsupported.has(id) ? `${kind} · ${t("viz.arg.noSource")}` : kind;
    return { label: n.label, value: f ? `${value} · ${t("viz.arg.findings", { n: f.count })}` : value };
  });
  return (
    <div className="lumen-viz-arg">
      {onSave && (
        <div className="lumen-viz-bar">
          <button type="button" onClick={onSave} data-arg-save="">
            {t("viz.arg.save")}
          </button>
        </div>
      )}
      <VizFrame
        title={title}
        summary={t("viz.arg.summary", { claims: g.nodes.filter((n) => n.kind !== "source").length, sources: g.nodes.filter((n) => n.kind === "source").length, unsupported: unsupported.size })}
        dir={dir}
        kind="argument-map"
        points={points}
        onActivate={(i) => onOpen(order[i])}
        showAlternativeLabel={t("viz.arg.showList")}
        showPictureLabel={t("viz.arg.showMap")}
        picture={<MapPicture g={g} dir={dir} unsupported={unsupported} findings={findings} />}
        alternative={(id, hidden) => <MapList g={g} unsupported={unsupported} findings={findings} onOpen={onOpen} id={id} hidden={hidden} />}
      />
    </div>
  );
}

export default function ArgumentMapBlock({ source }: { source: string }) {
  const opts = useMemo(() => parseArgumentBlock(source), [source]);
  const [notes, setNotes] = useState<ArgNoteInput[] | null>(null);
  const [findings, setFindings] = useState<MapFindings | undefined>(undefined);
  const [saved, setSaved] = useState<string | null>(null);
  const dir: Dir = isRTL() ? "rtl" : "ltr";
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      await ensureIndex();
      const list = (await indexedNotes())
        .filter((n) => !opts.folder || n.path.startsWith(`${opts.folder}/`))
        .map((n) => ({ path: n.path, fm: frontmatterOf(n.content), content: n.content }));
      if (cancelled) return;
      setNotes(list.map(({ path, fm }) => ({ path, fm })));
      // W13.W8: the argument checker's findings on each claim, in their own chunk, after the map is up.
      const { mapFindings } = await import("../agents/writing/argument/argumentChecker");
      const sources = list.filter((n) => /^(?:evidence|source|מקור)$/i.test(String(n.fm.type ?? ""))).map((n) => ({ path: n.path, text: n.content }));
      const f = mapFindings(list.map((n) => ({ path: n.path, text: n.content })), list, sources);
      if (!cancelled) setFindings(f);
    };
    void run();
    const off = onWorkspaceChanged(() => void run(), { debounceMs: 300 });
    return () => {
      cancelled = true;
      off();
    };
  }, [opts.folder]);
  const g = useMemo(() => (notes ? argumentGraph(notes) : null), [notes]);
  const title = opts.folder ? t("viz.arg.titleIn", { folder: opts.folder }) : t("viz.arg.title");
  const save = async () => {
    if (!g) return;
    const canvas = argumentToJsonCanvas(g, layoutArgument(g), dir, relationLabels());
    const base = `canvases/${(opts.folder || "argument-map").replace(/\//g, "-")}`;
    await writeWorkspaceFile(`${base}.canvas`, serializeJsonCanvas(canvas));
    await writeWorkspaceFile(`${base}.excalidraw`, serializeExcalidrawFile(jsonCanvasToExcalidraw(canvas, { updated: Date.now() }).file));
    setSaved(base);
  };
  return (
    <div className="chart-block lumen-argument-map-block" lang={getLocale()}>
      {!g && <p className="lumen-viz-note">{t("viz.loading")}</p>}
      {g && g.nodes.length === 0 && <EmptyState message={t("viz.arg.empty")} action={learnHow("workspace/literature-review")} />}
      {g && g.nodes.length > 0 && <ArgumentMapView g={g} dir={dir} title={title} findings={findings} onOpen={(p) => void openNote(p).catch(() => undefined)} onSave={() => void save().catch(() => undefined)} />}
      {saved && (
        <p className="lumen-viz-note" role="status">
          {t("viz.arg.saved", { path: saved })}
        </p>
      )}
    </div>
  );
}
