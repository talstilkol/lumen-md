/**
 * "Export view" (plan W13.G12): the graph as it is on screen — the visible
 * nodes at their positions, in their colours — as SVG, PNG or GEXF (Gephi),
 * downloaded on this device. The host gives the scene (positions it has,
 * or a layout run for the export when the view is a table or a list); the
 * writers load only when an export is chosen.
 *
 * The host imports ./graphExportStrings (its English); this file does not,
 * so it can sit in the host's chunk.
 */
import { useState } from "react";
import { t } from "../../i18n";
import type { Scene } from "../../graph/exportImage";

export type ExportFormat = "svg" | "png" | "gexf";

/** A file name from the view's title: letters (Hebrew too), digits and dashes. */
export function exportFileName(title: string, format: ExportFormat): string {
  const stem = title.normalize("NFC").replace(/[֑-ׇ]/g, "").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "graph";
  return `${stem}.${format}`;
}

/** Build the file for `format` (the writers are loaded here, on use). */
export async function exportScene(scene: Scene, format: ExportFormat): Promise<Blob> {
  const m = await import("../../graph/exportImage");
  if (format === "gexf") return new Blob([m.sceneToGexf(scene)], { type: "application/gexf+xml;charset=utf-8" });
  const svg = m.sceneToSvg(scene);
  if (format === "svg") return new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  return m.svgToPng(svg, 2);
}

function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export interface GraphExportMenuProps {
  /** The scene now on screen (may lay the graph out first). */
  scene: () => Promise<Scene>;
  testId?: string;
  style?: React.CSSProperties;
  /** Tests: receive the file instead of downloading it. */
  onFile?: (blob: Blob, name: string) => void;
}

export function GraphExportMenu({ scene, testId = "graph-export-view", style, onFile }: GraphExportMenuProps) {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (format: ExportFormat) => {
    setBusy(true);
    setStatus(t("graphExport.working"));
    try {
      const s = await scene();
      if (!s.nodes.length) return setStatus(t("graphExport.empty"));
      const name = exportFileName(s.title, format);
      const blob = await exportScene(s, format);
      (onFile ?? download)(blob, name);
      setStatus(t("graphExport.saved", { file: name, nodes: s.nodes.length }));
    } catch (e) {
      setStatus(t("graphExport.failed", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
      <label style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
        {t("graphExport.label")}
        <select data-testid={testId} value="" disabled={busy} aria-busy={busy} onChange={(e) => e.target.value && void run(e.target.value as ExportFormat)} style={style}>
          <option value="">…</option>
          <option value="svg">{t("graphExport.svg")}</option>
          <option value="png">{t("graphExport.png")}</option>
          <option value="gexf">{t("graphExport.gexf")}</option>
        </select>
      </label>
      <span role="status" aria-live="polite" data-testid={`${testId}-status`} style={{ fontSize: 11, color: "hsl(var(--fg-muted))" }}>
        {status}
      </span>
    </span>
  );
}
