/**
 * "Export view" (plan W13.G12): the graph as it is on screen — the visible
 * nodes at their positions, in their colours — as SVG, PNG or GEXF (Gephi),
 * downloaded on this device. The host gives the scene (positions it has,
 * or a layout run for the export when the view is a table or a list); the
 * writers load only when an export is chosen.
 *
 * A menu button (WAI-ARIA APG "menu button"), not a <select>: a select
 * that acted on change downloaded a file on ArrowDown (WCAG 3.2.2, audit r4
 * A3 #3). Enter, Space or ArrowDown opens it on the first format, ArrowUp
 * on the last; ArrowDown / ArrowUp / Home / End move; Enter or a click
 * exports; Escape or Tab closes; focus goes back to the button.
 *
 * The host imports ./graphExportStrings (its English); this file does not,
 * so it can sit in the host's chunk.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
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

const FORMATS: readonly ExportFormat[] = ["svg", "png", "gexf"];

export function GraphExportMenu({ scene, testId = "graph-export-view", style, onFile }: GraphExportMenuProps) {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const button = useRef<HTMLButtonElement>(null);
  const items = useRef<Array<HTMLButtonElement | null>>([]);
  const wrap = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (open) items.current[active]?.focus();
  }, [open, active]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  const show = (at: number) => {
    setActive(at);
    setOpen(true);
  };
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };
  const run = async (format: ExportFormat) => {
    close(true);
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
  const onButtonKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      show(e.key === "ArrowDown" ? 0 : FORMATS.length - 1);
    }
  };
  const onMenuKey = (e: KeyboardEvent) => {
    const n = FORMATS.length;
    const next: Record<string, number> = { ArrowDown: (active + 1) % n, ArrowUp: (active - 1 + n) % n, Home: 0, End: n - 1 };
    if (e.key in next) {
      e.preventDefault();
      setActive(next[e.key]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === "Tab") close(false);
  };
  const menuId = `${testId}-menu`;
  return (
    <span ref={wrap} style={{ position: "relative", display: "inline-flex", gap: 4, alignItems: "center" }}>
      <button
        ref={button}
        type="button"
        data-testid={testId}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={busy}
        aria-busy={busy}
        onClick={() => (open ? close(false) : show(0))}
        onKeyDown={onButtonKey}
        style={style}
      >
        {t("graphExport.label")} ▾
      </button>
      {open && (
        <span
          id={menuId}
          role="menu"
          aria-label={t("graphExport.label")}
          data-testid={`${testId}-menu`}
          onKeyDown={onMenuKey}
          style={{ position: "absolute", insetBlockStart: "100%", insetInlineStart: 0, zIndex: 20, display: "flex", flexDirection: "column", minInlineSize: 160, padding: 4, marginBlockStart: 2, borderRadius: 6, border: "1px solid hsl(var(--border))", background: "hsl(var(--bg))", boxShadow: "0 4px 16px rgb(0 0 0 / 0.15)" }}
        >
          {FORMATS.map((f, i) => (
            <button
              key={f}
              ref={(el) => {
                items.current[i] = el;
              }}
              type="button"
              role="menuitem"
              tabIndex={i === active ? 0 : -1}
              data-format={f}
              onClick={() => void run(f)}
              style={{ textAlign: "start", padding: "4px 8px", border: 0, borderRadius: 4, background: i === active ? "hsl(var(--bg-muted))" : "transparent", color: "hsl(var(--fg))", font: "inherit", fontSize: 12, cursor: "pointer" }}
            >
              {f === "svg" ? t("graphExport.svg") : f === "png" ? t("graphExport.png") : t("graphExport.gexf")}
            </button>
          ))}
        </span>
      )}
      <span role="status" aria-live="polite" data-testid={`${testId}-status`} style={{ fontSize: 11, color: "hsl(var(--fg-muted))" }}>
        {status}
      </span>
    </span>
  );
}
