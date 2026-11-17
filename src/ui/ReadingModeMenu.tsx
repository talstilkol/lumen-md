/**
 * "Reading mode" (plan W13.R1): one menu for every reading mode and the
 * note's reading profile — face, width, niqqud, aids, layout, voice and
 * speed, and the chosen mode's own options. Changes show on the page at
 * once; "Save for this note" keeps them in the note's file (`lumen-reading`
 * in the frontmatter) or on this device only, and "Save for all notes"
 * makes them the global profile. Closing without saving puts the page back.
 *
 * Lazy: opened from the toolbar's View menu and the palette; its English
 * travels with it (../reading/readingModeStrings).
 */
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import "../reading/readingModeStrings";
import { t } from "../i18n";
import { useAppStore } from "../store/useStore";
import { HEBREW_FONTS } from "../reading/fonts";
import { AIDS_TINTS } from "../reading/readingAids";
import { DEFAULT_PROFILE, FOCUS_UNITS, LINE_FOCUS, NIKUD_DISPLAY, PROFILE_LIMITS, READING_LIMITS, globalProfile, localNoteProfile, profileDiff, saveGlobalProfile, saveLocalNoteProfile, type ReadingModeId, type ReadingProfile } from "../reading/settings";
import { applyProfile, noteProfile, writeFileProfile } from "../reading/profileStore";
import { PLACE_KEYS } from "../reading/profileCore";
import { COMMON_FIELDS, MODE_DEFS, modeDef } from "../reading/modes";
import { Modal } from "./Modal";
import { HelpButton } from "./HelpButton";
import { showAiToast } from "./AiToast";
// The palette's dialog look (.cmd-palette): loaded with this dialog too, which can open before the palette ever has (INT7).
import "./CommandPalette.css";

type Where = "file" | "device";

/** Review 13 M6: the note's reading place (W13.R6) is this device's, per note — never written to the file or the global profile. */
function withoutPlace<T extends Partial<ReadingProfile>>(v: T): T {
  const out = { ...v };
  for (const k of PLACE_KEYS) delete out[k];
  return out;
}
function placeOf(v: Partial<ReadingProfile> | null): Partial<ReadingProfile> | null {
  const out: Partial<ReadingProfile> = {};
  for (const k of PLACE_KEYS) if (v && k in v) (out as Record<string, unknown>)[k] = v[k];
  return Object.keys(out).length ? out : null;
}

type FieldUi = { kind: "bool" } | { kind: "range"; min: number; max: number; step: number; unit?: string } | { kind: "select"; options: ReadonlyArray<string | number>; label?: (v: string | number) => string };

const voices = (): SpeechSynthesisVoice[] => {
  try {
    return typeof speechSynthesis !== "undefined" ? speechSynthesis.getVoices().filter((v) => v.localService) : [];
  } catch {
    return [];
  }
};

/** How the menu edits each profile field. A field missing here is not shown. */
function fieldUi(k: keyof ReadingProfile): FieldUi | null {
  switch (k) {
    case "font":
      return { kind: "select", options: ["default", ...HEBREW_FONTS.map((f) => f.id)], label: (v) => (v === "default" ? t("readingMode.font.default") : (HEBREW_FONTS.find((f) => f.id === v)?.name ?? String(v))) };
    case "size":
      return { kind: "range", ...READING_LIMITS.size, unit: " px" };
    case "lineHeight":
      return { kind: "range", ...READING_LIMITS.lineHeight };
    case "width":
      return { kind: "range", ...READING_LIMITS.width, unit: " ch" };
    case "rate":
      return { kind: "range", ...PROFILE_LIMITS.rate, unit: "×" };
    case "wpm":
      return { kind: "range", ...PROFILE_LIMITS.wpm };
    case "nikud":
      return { kind: "select", options: NIKUD_DISPLAY };
    case "lineFocus":
      return { kind: "select", options: LINE_FOCUS };
    case "tint":
      return { kind: "select", options: AIDS_TINTS };
    case "focusUnit":
      return { kind: "select", options: FOCUS_UNITS };
    // Audit r4 A1.6: the two-page spread (W13.R6, book pages) is a layout the menu offers.
    case "layout":
      return { kind: "select", options: ["single", "sideBySide", "spread"] };
    case "voice": {
      const names = voices().map((v) => v.name);
      return { kind: "select", options: ["", ...names], label: (v) => (v === "" ? t("readingMode.voice.auto") : String(v)) };
    }
    case "mode":
      return null;
    default:
      return typeof DEFAULT_PROFILE[k] === "boolean" ? { kind: "bool" } : null;
  }
}

const row: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, margin: "6px 0", fontSize: 13 };
const control: CSSProperties = { border: "1px solid hsl(var(--border-strong))", borderRadius: 6, padding: "4px 8px", background: "transparent", color: "inherit", font: "inherit" };
const btn: CSSProperties = { ...control, padding: "5px 12px", cursor: "pointer" };
const muted: CSSProperties = { fontSize: 12, color: "hsl(var(--fg-muted))", margin: 0 };

function Field({ k, value, onChange, from }: { k: keyof ReadingProfile; value: ReadingProfile[keyof ReadingProfile]; onChange: (v: ReadingProfile[keyof ReadingProfile]) => void; from?: string }) {
  const ui = fieldUi(k);
  if (!ui) return null;
  const id = `rm-${k}`;
  const label = (
    <label htmlFor={id}>
      {t(`readingMode.field.${k}`)}
      {from && from !== "global" && (
        <span style={{ ...muted, marginInlineStart: 6 }} data-testid={`rm-from-${k}`}>
          · {t(`readingMode.from.${from}`)}
        </span>
      )}
    </label>
  );
  if (ui.kind === "bool") {
    return (
      <div style={{ ...row, justifyContent: "flex-start" }}>
        <input id={id} type="checkbox" checked={value as boolean} onChange={(e) => onChange(e.currentTarget.checked)} data-testid={id} />
        {label}
      </div>
    );
  }
  if (ui.kind === "range") {
    const n = value as number;
    return (
      <div style={row}>
        {label}
        <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input id={id} type="range" min={ui.min} max={ui.max} step={ui.step} value={n} onChange={(e) => onChange(Number(e.currentTarget.value))} data-testid={id} />
          <output htmlFor={id} dir="ltr" style={{ minWidth: 56, fontVariantNumeric: "tabular-nums", fontSize: 12 }}>
            {Number.isInteger(ui.step) ? n : n.toFixed(2)}
            {ui.unit ?? ""}
          </output>
        </span>
      </div>
    );
  }
  const name = (v: string | number) => (ui.label ? ui.label(v) : t(`readingMode.${k}.${v}`));
  const options = ui.options.includes(value as string | number) ? ui.options : [...ui.options, value as string | number];
  return (
    <div style={row}>
      {label}
      <select id={id} style={control} value={String(value)} onChange={(e) => onChange((typeof value === "number" ? Number(e.currentTarget.value) : e.currentTarget.value) as never)} data-testid={id}>
        {options.map((o) => (
          <option key={String(o)} value={String(o)}>
            {name(o)}
          </option>
        ))}
      </select>
    </div>
  );
}

export function ReadingModeMenu({ close }: { close: () => void }) {
  const doc = useAppStore((s) => s.doc);
  const path = doc.workspaceName ?? null;
  const initial = useMemo(() => noteProfile(path, doc.content), [path, doc.content]);
  const [p, setP] = useState<ReadingProfile>(initial.profile);
  const hasOwnFile = Object.keys(initial.file).length > 0;
  const [where, setWhere] = useState<Where>(initial.device && !hasOwnFile ? "device" : "file");
  const [saved, setSaved] = useState(false);

  useEffect(() => void applyProfile(p), [p]);

  const finish = (keep: boolean) => {
    // Unsaved changes leave the page: what the note had comes back.
    if (!keep) void applyProfile(noteProfile(path, useAppStore.getState().doc.content).profile);
    close();
  };

  const set = (k: keyof ReadingProfile, v: ReadingProfile[keyof ReadingProfile]) => {
    setSaved(false);
    setP((cur) => ({ ...cur, [k]: v }));
  };

  const saveForNote = () => {
    const global = globalProfile();
    const content = useAppStore.getState().doc.content;
    if (where === "file") {
      let next: string;
      try {
        next = writeFileProfile(content, withoutPlace(profileDiff(p, global)));
      } catch {
        showAiToast(t("readingMode.saved.invalidFrontmatter"), "error");
        setWhere("device");
        return;
      }
      // The file now says it all — but the note's place stays on this device.
      if (path) saveLocalNoteProfile(path, placeOf(localNoteProfile(path)));
      if (next !== content) useAppStore.getState().setContent(next);
    } else {
      if (!path) {
        showAiToast(t("readingMode.saved.noPath"), "info");
        return;
      }
      // Only what the file does not already say: the file is never touched.
      saveLocalNoteProfile(path, profileDiff(p, { ...global, ...initial.file }));
    }
    setSaved(true);
    showAiToast(t(where === "file" ? "readingMode.saved.file" : "readingMode.saved.device"), "info");
  };

  const saveForAll = () => {
    const global = globalProfile();
    saveGlobalProfile({ ...p, ...Object.fromEntries(PLACE_KEYS.map((k) => [k, global[k]])) });
    setSaved(true);
    showAiToast(t("readingMode.saved.global"), "info");
  };

  const resetNote = () => {
    const content = useAppStore.getState().doc.content;
    if (path) saveLocalNoteProfile(path, placeOf(localNoteProfile(path)));
    if (hasOwnFile) {
      try {
        const next = writeFileProfile(content, null);
        if (next !== content) useAppStore.getState().setContent(next);
      } catch {
        /* why: a frontmatter that does not parse is left for the person to fix */
      }
    }
    setP(globalProfile());
    setSaved(true);
  };

  const open = async () => {
    await applyProfile(p);
    if (p.nikud === "show" || (await import("./ReadingAids")).displayNikudOn()) await (await import("./ReadingAids")).toggleDisplayNikud(p.nikud === "show");
    close();
    await modeDef(p.mode).open(p);
  };

  const mode = modeDef(p.mode);
  const fileKeys = Object.keys(initial.file).length;
  const deviceKeys = Object.keys(initial.device ?? {}).length;

  return (
    <Modal onClose={() => finish(saved)} className="cmd-palette-backdrop" aria-labelledby="rm-title" data-testid="reading-mode-menu">
      <div className="cmd-palette" style={{ maxWidth: 560, padding: 0, display: "flex", flexDirection: "column", maxHeight: "88vh" }}>
        <header style={{ padding: "12px 16px", borderBottom: "1px solid hsl(var(--border))", display: "flex", gap: 10, alignItems: "center" }}>
          <h2 id="rm-title" style={{ margin: 0, fontSize: 15, fontWeight: 600, flex: 1 }}>
            {t("readingMode.title")}
          </h2>
          <HelpButton topic="editor/reading-modes" />
          <button type="button" style={btn} onClick={() => finish(saved)} aria-label={t("readingMode.close")}>
            ✕
          </button>
        </header>
        <div style={{ overflowY: "auto", padding: 16 }}>
          <p style={muted} data-testid="rm-sources" dir="auto">
            {fileKeys || deviceKeys ? t("readingMode.sources", { file: fileKeys, device: deviceKeys }) : t("readingMode.sources.none")}
          </p>
          <fieldset style={{ border: 0, padding: 0, margin: "10px 0" }}>
            <legend style={{ fontWeight: 600, marginBottom: 6 }}>{t("readingMode.mode")}</legend>
            <div role="radiogroup" aria-label={t("readingMode.mode")} style={{ display: "grid", gap: 6 }}>
              {MODE_DEFS.map((m) => (
                <label key={m.id} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "6px 8px", borderRadius: 8, border: `1px solid hsl(var(${p.mode === m.id ? "--accent" : "--border"}))` }}>
                  <input type="radio" name="rm-mode" checked={p.mode === m.id} onChange={() => set("mode", m.id as ReadingModeId)} data-testid={`rm-mode-${m.id}`} />
                  <span>
                    <span style={{ fontWeight: 600 }}>{t(m.label)}</span>
                    {m.experimental && (
                      <span style={{ ...muted, marginInlineStart: 6, border: "1px solid hsl(var(--border-strong))", borderRadius: 4, padding: "0 4px" }}>
                        {t("readingMode.experimental")}
                      </span>
                    )}
                    <span style={{ ...muted, display: "block" }}>{t(m.hint)}</span>
                    {m.experimental && p.mode === m.id && (
                      <a href={m.experimental.research} target="_blank" rel="noreferrer noopener" style={{ fontSize: 12 }}>
                        {t("readingMode.research")}
                      </a>
                    )}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          {mode.fields.length > 0 && (
            <fieldset style={{ border: 0, padding: 0, margin: "10px 0" }} data-testid="rm-mode-fields">
              <legend style={{ fontWeight: 600 }}>{t("readingMode.modeOptions", { mode: t(mode.label) })}</legend>
              {mode.fields.map((k) => (
                <Field key={k} k={k} value={p[k]} from={initial.from[k]} onChange={(v) => set(k, v)} />
              ))}
            </fieldset>
          )}
          <fieldset style={{ border: 0, padding: 0, margin: "10px 0" }}>
            <legend style={{ fontWeight: 600 }}>{t("readingMode.common")}</legend>
            {COMMON_FIELDS.map((k) => (
              <Field key={k} k={k} value={p[k]} from={initial.from[k]} onChange={(v) => set(k, v)} />
            ))}
          </fieldset>
          <fieldset style={{ border: "1px solid hsl(var(--border))", borderRadius: 8, padding: "8px 12px", margin: "12px 0" }}>
            <legend style={{ fontWeight: 600, padding: "0 4px" }}>{t("readingMode.where")}</legend>
            <label style={{ ...row, justifyContent: "flex-start" }}>
              <input type="radio" name="rm-where" checked={where === "file"} onChange={() => setWhere("file")} data-testid="rm-where-file" />
              <span>
                {t("readingMode.where.file")} <code dir="ltr">lumen-reading</code>
              </span>
            </label>
            <label style={{ ...row, justifyContent: "flex-start", opacity: path ? 1 : 0.5 }}>
              <input type="radio" name="rm-where" disabled={!path} checked={where === "device"} onChange={() => setWhere("device")} data-testid="rm-where-device" />
              <span>{t("readingMode.where.device")}</span>
            </label>
          </fieldset>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button type="button" style={btn} onClick={resetNote} data-testid="rm-reset">
              {t("readingMode.reset")}
            </button>
            <button type="button" style={btn} onClick={saveForAll} data-testid="rm-save-all">
              {t("readingMode.saveAll")}
            </button>
            <button type="button" style={btn} onClick={saveForNote} data-testid="rm-save-note">
              {t("readingMode.saveNote")}
            </button>
            <button type="button" style={{ ...btn, background: "hsl(var(--accent))", color: "hsl(var(--accent-fg, 0 0% 100%))", borderColor: "transparent" }} onClick={() => void open()} data-testid="rm-open">
              {t("readingMode.open", { mode: t(mode.label) })}
            </button>
          </div>
          <p role="status" aria-live="polite" style={{ ...muted, marginTop: 8 }} data-testid="rm-status">
            {saved ? t("readingMode.savedShort") : ""}
          </p>
        </div>
      </div>
    </Modal>
  );
}

let unmount: (() => void) | null = null;

/** Open the reading mode menu (again: brings the same one). */
export function openReadingModeMenu(): void {
  if (unmount) return;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  unmount = () => {
    unmount = null;
    root.unmount();
    host.remove();
  };
  root.render(<ReadingModeMenu close={() => unmount?.()} />);
}
