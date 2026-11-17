/**
 * Focus mode's controls (plan W13.R2): what stays bright — the line, the
 * sentence or the paragraph (iA Writer) — and readability highlights
 * (Hemingway), with a legend that counts each kind. The legend sits on the
 * side where reading starts: the left in English, the right in Hebrew.
 *
 * The first values come from the note's reading profile (W13.R1): its
 * `focusUnit` when the profile's mode is focus, and `hemingway`. A change
 * here is for this session; "Reading mode…" saves it for the note.
 *
 * The layer is drawn by src/editor/focusLayer.ts in the source editor.
 * In the rich-text editor or the preview the bar offers to switch to it.
 */
import { useEffect, useState, type CSSProperties, type RefObject } from "react";
import { createPortal } from "react-dom";
import "../reading/focusLayerStrings";
import { t } from "../i18n";
import { useAppStore } from "../store/useStore";
import { HEMINGWAY_KINDS, countByKind, swatchStyle, type HemingwayFinding } from "../reading/hemingway";
import type { FocusUnit } from "../reading/focusUnits";

type Unit = FocusUnit | "off";
const UNITS: Unit[] = ["off", "line", "sentence", "paragraph"];

const control: CSSProperties = { border: "1px solid hsl(var(--border))", borderRadius: 6, padding: "2px 6px", background: "hsl(var(--bg))", color: "hsl(var(--fg))", font: "inherit", fontSize: 12 };

/** The source editor's view inside `area`, if there is one. */
async function viewIn(area: HTMLElement | null) {
  const el = area?.querySelector<HTMLElement>(".cm-editor");
  if (!el) return null;
  const { EditorView } = await import("@codemirror/view");
  return EditorView.findFromDOM(el);
}

export function FocusLayerBar({ area }: { area: RefObject<HTMLElement | null> }) {
  const path = useAppStore((s) => s.doc.workspaceName ?? null);
  const mode = useAppStore((s) => s.mode);
  const [unit, setUnit] = useState<Unit | null>(null);
  const [hemingway, setHemingway] = useState(false);
  const [findings, setFindings] = useState<HemingwayFinding[]>([]);
  const [hasEditor, setHasEditor] = useState(true);

  // First values: the note's reading profile.
  useEffect(() => {
    let live = true;
    void import("../reading/profileStore").then((m) => {
      if (!live) return;
      const p = m.noteProfile(path, useAppStore.getState().doc.content).profile;
      setUnit(p.mode === "focus" ? p.focusUnit : "off");
      setHemingway(p.hemingway);
    });
    return () => {
      live = false;
    };
  }, [path]);

  // Draw the layer in the editor (and again when the editor is re-created).
  useEffect(() => {
    if (unit === null) return;
    let live = true;
    let off: (() => void) | undefined;
    const apply = async () => {
      const view = await viewIn(area.current);
      if (!live) return;
      setHasEditor(!!view);
      if (!view) return;
      const layer = await import("../editor/focusLayer");
      if (!live) return;
      off?.();
      off = layer.onFindings(view, (f) => live && setFindings(f));
      layer.setFocusLayer(view, { unit: unit === "off" ? null : unit, hemingway });
      if (!hemingway) setFindings([]);
    };
    void apply();
    // The editor mounts (or is re-created) after this: apply again when a new one appears, not on every edit.
    let seen = area.current?.querySelector(".cm-editor") ?? null;
    const mo = area.current
      ? new MutationObserver(() => {
          const now = area.current?.querySelector(".cm-editor") ?? null;
          if (now !== seen) {
            seen = now;
            void apply();
          }
        })
      : null;
    if (mo && area.current) mo.observe(area.current, { childList: true, subtree: true });
    return () => {
      live = false;
      off?.();
      mo?.disconnect();
    };
  }, [unit, hemingway, area, mode]);

  // Leaving focus mode: the editor outside it has no layer.
  useEffect(
    () => () => {
      void viewIn(area.current).then(async (view) => {
        if (view) (await import("../editor/focusLayer")).setFocusLayer(view, { unit: null, hemingway: false });
      });
    },
    [area],
  );

  const counts = countByKind(findings);
  const dark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  const total = findings.length;
  return (
    <>
      <div role="group" aria-label={t("focusLayer.controls")} data-reading-mode="focus-layer" style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12, color: "hsl(var(--fg))" }}>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {t("focusLayer.unit")}
          <select style={control} value={unit ?? "off"} onChange={(e) => setUnit(e.currentTarget.value as Unit)} data-testid="focus-unit">
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {t(`focusLayer.unit.${u}`)}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={hemingway} onChange={(e) => setHemingway(e.currentTarget.checked)} data-testid="focus-hemingway" />
          {t("focusLayer.hemingway")}
        </label>
        {!hasEditor && (
          <button type="button" style={{ ...control, cursor: "pointer" }} onClick={() => useAppStore.getState().setMode("source")} data-testid="focus-to-source">
            {t("focusLayer.toSource")}
          </button>
        )}
      </div>
      {hemingway &&
        hasEditor &&
        // A portal: the bar fades when idle, the legend must not.
        createPortal(
        <aside
          aria-label={t("focusLayer.legend")}
          data-testid="focus-legend"
          style={{ position: "fixed", insetInlineStart: 16, top: 56, width: 190, padding: "10px 12px", borderRadius: 10, border: "1px solid hsl(var(--border))", background: "hsl(var(--bg))", color: "hsl(var(--fg))", fontSize: 12, zIndex: 9999, boxShadow: "0 2px 10px rgb(0 0 0 / 0.08)" }}
        >
          <p style={{ margin: "0 0 6px", fontWeight: 600 }} aria-live="polite" data-testid="focus-total">
            {t("focusLayer.total", { n: total })}
          </p>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
            {HEMINGWAY_KINDS.map((k) => (
              <li key={k} style={{ display: "flex", gap: 8, alignItems: "baseline", justifyContent: "space-between" }} data-testid={`focus-count-${k}`}>
                <span data-hw={k} style={{ ...swatchStyle(k, dark), paddingInline: 4, color: "hsl(var(--fg))" }}>
                  {t(`focusLayer.kind.${k}`)}
                </span>
                <span style={{ fontVariantNumeric: "tabular-nums" }}>{counts[k]}</span>
              </li>
            ))}
          </ul>
          <p style={{ margin: "8px 0 0", color: "hsl(var(--fg-muted))" }}>{t("focusLayer.note")}</p>
        </aside>,
          document.body,
        )}
    </>
  );
}
