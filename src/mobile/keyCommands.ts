/**
 * iPad keyboard shortcuts (plan W13.M5). Every app-wide shortcut of the
 * palette (src/lib/shortcuts.ts: scopes app, global and tabs) becomes a
 * UIKeyCommand in the iOS app, so iPadOS lists it when ⌘ is held and in the
 * menu bar (iPadOS 26), in English and Hebrew. Editor keys (⌘B, ⌘Z…) stay
 * the WebView's own and are not registered: a UIKeyCommand would take them
 * from the editor.
 *
 * The Swift table (ios/App/App/KeyCommandsData.swift) is generated from
 * keyCommandSpecs() — src/__tests__/ipadKeyCommands.test.ts fails when it
 * is out of date, and rewrites it with UPDATE_IOS_KEYS=1. A command fires
 * "lumen:key-command" in the WebView with its id; this module turns it into
 * the same keydown a hardware keyboard would send, so one handler
 * (useAppShortcuts) serves the web, the desktop and the iPad.
 */
import { SHORTCUTS, type Shortcut } from "../lib/shortcuts";

/** The i18n key of each command's title (the palette's own words). */
export const KEY_COMMAND_TITLES: Record<string, string> = {
  "file.new": "cmd.new",
  "file.open": "cmd.open",
  "file.save": "cmd.save",
  "file.saveAs": "cmd.saveAs",
  "palette.toggle": "cmd.cmdPalette",
  "view.findReplace": "cmd.view.findReplace",
  "view.focusMode": "cmd.focusMode",
  "view.source": "cmd.source",
  "view.split": "cmd.split",
  "view.preview": "cmd.preview",
  "view.wysiwyg": "cmd.view.wysiwyg",
  "insert.smart": "ipad.key.smartPaste",
  "help.shortcuts": "cmd.shortcuts",
  "note.today": "cmd.note.today",
  "note.capture": "capture.title",
  "cite.insert": "cmd.cite.insert",
  "sources.open": "cmd.sources.open",
  "help.open": "cmd.help.open",
  "tab.close": "ipad.key.closeTab",
  "window.new": "cmd.window.new",
  // ⌘, (W13.E4, #1208): the settings screen, as every Mac and iPad app has it.
  "settings.open": "settings.title",
};

/** The menu each command sits under in the iPadOS menu bar. */
const MENU: Record<string, "file" | "view" | "go" | "help"> = {
  "file.new": "file",
  "file.open": "file",
  "file.save": "file",
  "file.saveAs": "file",
  "note.capture": "file",
  "tab.close": "file",
  "window.new": "file",
  "palette.toggle": "go",
  "note.today": "go",
  "sources.open": "go",
  "cite.insert": "go",
  "insert.smart": "go",
  "view.findReplace": "view",
  "view.focusMode": "view",
  "view.source": "view",
  "view.split": "view",
  "view.preview": "view",
  "view.wysiwyg": "view",
  "help.shortcuts": "help",
  "help.open": "help",
};

export interface KeyCommandSpec {
  id: string;
  /** UIKeyCommand input: a lower-case character, or "F1". */
  input: string;
  modifiers: Array<"command" | "shift" | "alternate" | "control">;
  menu: "file" | "view" | "go" | "help";
  titleEn: string;
  titleHe: string;
}

const isRegistered = (s: Shortcut) => s.scope === "app" || s.scope === "global" || s.scope === "tabs";

/** The commands iPadOS shows when ⌘ is held. `tr(key, lang)` gives a string (the app's t, or the JSON in tests). */
export function keyCommandSpecs(tr: (key: string, lang: "en" | "he") => string): KeyCommandSpec[] {
  return SHORTCUTS.filter(isRegistered).map((s) => {
    const parts = s.combo.split("+");
    const key = parts.pop() ?? "";
    const modifiers = parts.map((p) => ({ Mod: "command", Shift: "shift", Alt: "alternate", Ctrl: "control" })[p] as KeyCommandSpec["modifiers"][number]);
    const title = KEY_COMMAND_TITLES[s.id];
    if (!title) throw new Error(`no title for the key command ${s.id}: add it to KEY_COMMAND_TITLES`);
    return { id: s.id, input: key.length === 1 ? key.toLowerCase() : key, modifiers, menu: MENU[s.id] ?? "go", titleEn: tr(title, "en"), titleHe: tr(title, "he") };
  });
}

const swiftString = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** ios/App/App/KeyCommandsData.swift, generated. */
export function swiftSource(specs: KeyCommandSpec[]): string {
  const rows = specs.map((k) => `        .init(id: ${swiftString(k.id)}, input: ${swiftString(k.input)}, modifiers: [${k.modifiers.map((m) => `.${m}`).join(", ")}], menu: .${k.menu}, en: ${swiftString(k.titleEn)}, he: ${swiftString(k.titleHe)}),`);
  return [
    "// Generated from src/lib/shortcuts.ts by src/mobile/keyCommands.ts (plan W13.M5).",
    "// Do not edit: UPDATE_IOS_KEYS=1 npx vitest run src/__tests__/ipadKeyCommands.test.ts",
    "",
    "import UIKit",
    "",
    "extension LumenKeyCommands {",
    "    static let all: [Spec] = [",
    ...rows,
    "    ]",
    "}",
    "",
  ].join("\n");
}

/** The keydown a hardware keyboard would send for a combo ("Mod+Alt+D" → ⌘⌥D, code KeyD). */
export function keydownFor(combo: string): KeyboardEventInit {
  const parts = combo.split("+");
  const key = parts.pop() ?? "";
  const code = /^[A-Za-z]$/.test(key) ? `Key${key.toUpperCase()}` : /^[0-9]$/.test(key) ? `Digit${key}` : key === "/" ? "Slash" : key;
  return { key: key.length === 1 ? key.toLowerCase() : key, code, metaKey: parts.includes("Mod"), shiftKey: parts.includes("Shift"), altKey: parts.includes("Alt"), ctrlKey: parts.includes("Ctrl"), bubbles: true, cancelable: true };
}

/**
 * Run "lumen:key-command" events from the iOS app as keydowns; `native` gives
 * the commands the WebView cannot do itself (a new window). Returns a stop function.
 */
export function installKeyCommandBridge(win: Window = window, native: Partial<Record<string, () => void>> = {}): () => void {
  const byId = new Map(SHORTCUTS.filter(isRegistered).map((s) => [s.id, s.combo]));
  const on = (e: Event) => {
    const id = (e as CustomEvent<{ id?: unknown }>).detail?.id;
    if (typeof id === "string" && native[id]) return native[id]!();
    const combo = typeof id === "string" ? byId.get(id) : undefined;
    if (!combo) return;
    const target = win.document.activeElement instanceof HTMLElement ? win.document.activeElement : win.document.body;
    target.dispatchEvent(new KeyboardEvent("keydown", keydownFor(combo)));
  };
  win.addEventListener("lumen:key-command", on);
  return () => win.removeEventListener("lumen:key-command", on);
}
