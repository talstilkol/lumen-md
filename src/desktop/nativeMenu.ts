/**
 * The desktop app's native menu bar in the UI language (plan W13.K5).
 *
 * The menu is a model built here from the app's strings, sent to the shell
 * with the tray labels (`tray_set_menu`, its `appMenu` field — no new IPC
 * command), and rebuilt whenever the language changes. Every item is a
 * palette command (its id is the command id) or one of the system's own
 * items (copy, paste, Services…), which the shell builds as predefined
 * items so the system's behaviour — and, on macOS, the Services submenu —
 * stays native.
 *
 * Order: the same in every language. In a right-to-left language the
 * system mirrors the menu bar itself (macOS does for a Hebrew or Arabic
 * system language; Windows mirrors an RTL window's menu), so the model is
 * never reversed here — reversing it as well would undo the system's
 * mirroring. `rtl` is sent so the shell can set the Windows menu's layout.
 *
 * A click comes back as a `lumen-menu` event with the item id, and runs
 * the palette command of that id (`runCommandById`).
 *
 * Loaded on the desktop only, after startup; nothing here is in the
 * startup bundle.
 */
import "./nativeMenuStrings";
import { t, SUPPORTED_LOCALES, type Locale } from "../i18n";

/** The system's own items, built by the shell (tauri PredefinedMenuItem). */
export type MenuRole =
  | "about"
  | "services"
  | "hide"
  | "hideOthers"
  | "showAll"
  | "quit"
  | "undo"
  | "redo"
  | "cut"
  | "copy"
  | "paste"
  | "selectAll"
  | "minimize"
  | "zoom"
  | "fullscreen"
  | "closeWindow";

export type MenuEntry =
  | { kind: "command"; id: string; key: string; accel?: string }
  | { kind: "role"; role: MenuRole; key: string }
  | { kind: "separator" };

export interface MenuSectionDef {
  id: "app" | "file" | "edit" | "view" | "window" | "help";
  key: string;
  /** macOS only (the application menu). */
  macOnly?: boolean;
  items: MenuEntry[];
}

const cmd = (id: string, accel?: string): MenuEntry => ({ kind: "command", id, key: `nativeMenu.cmd.${id}`, ...(accel ? { accel } : {}) });
const role = (r: MenuRole): MenuEntry => ({ kind: "role", role: r, key: `nativeMenu.role.${r}` });
const sep: MenuEntry = { kind: "separator" };

/**
 * The menu bar. The ids are the ones the shell's startup menu (lib.rs
 * `build_menu`, English until the WebView sends this one) and
 * `useTauriMenu` already use, with the same shortcuts (Tauri's syntax:
 * CmdOrCtrl is ⌘ on macOS, Ctrl elsewhere); an id `useTauriMenu` does not
 * know runs the palette command of that id.
 */
export const MENU: readonly MenuSectionDef[] = [
  { id: "app", key: "nativeMenu.app", macOnly: true, items: [role("about"), sep, cmd("app.checkUpdates"), sep, role("services"), sep, role("hide"), role("hideOthers"), role("showAll"), sep, role("quit")] },
  {
    id: "file",
    key: "nativeMenu.file",
    items: [
      cmd("file.new", "CmdOrCtrl+N"),
      cmd("window.new", "CmdOrCtrl+Shift+N"),
      cmd("file.open", "CmdOrCtrl+O"),
      cmd("file.insertText"),
      cmd("file.quickCapture"),
      cmd("note.today"),
      sep,
      cmd("file.save", "CmdOrCtrl+S"),
      cmd("file.saveAs", "CmdOrCtrl+Shift+S"),
      sep,
      cmd("file.exportHtml"),
      cmd("file.exportPdf"),
      cmd("file.exportDocx"),
      cmd("file.print", "CmdOrCtrl+P"),
      sep,
      cmd("file.toggleWorkspace"),
      sep,
      role("closeWindow"),
    ],
  },
  {
    id: "edit",
    key: "nativeMenu.edit",
    items: [role("undo"), role("redo"), sep, role("cut"), role("copy"), role("paste"), role("selectAll"), sep, cmd("edit.find", "CmdOrCtrl+F"), cmd("edit.workspaceSearch", "CmdOrCtrl+Shift+F"), sep, cmd("edit.toggleDirection"), cmd("edit.hebrewTypography")],
  },
  {
    id: "view",
    key: "nativeMenu.view",
    items: [
      cmd("view.source", "CmdOrCtrl+1"),
      cmd("view.split", "CmdOrCtrl+2"),
      cmd("view.preview", "CmdOrCtrl+3"),
      cmd("view.wysiwyg", "CmdOrCtrl+4"),
      cmd("view.sideBySide"),
      sep,
      cmd("view.reading"),
      cmd("view.readingOptions"),
      sep,
      cmd("view.toggleOutline"),
      cmd("view.backlinks"),
      cmd("view.graphView"),
      sep,
      // The startup menu gave Focus mode ⌘⇧F too, which is Search workspace's: one shortcut, one item.
      cmd("view.focusMode"),
      cmd("view.typewriter"),
      cmd("view.toggleTheme"),
      role("fullscreen"),
    ],
  },
  { id: "window", key: "nativeMenu.window", items: [role("minimize"), role("zoom")] },
  { id: "help", key: "nativeMenu.help", items: [cmd("help.commandPalette", "CmdOrCtrl+K"), cmd("help.shortcuts"), cmd("help.tour"), cmd("help.open"), cmd("help.whatsNew"), sep, cmd("help.feedback"), cmd("help.diagnostics"), cmd("help.github")] },
];

/** Ids the shell or `useTauriMenu` handle themselves (not palette commands). */
export const SHELL_IDS: readonly string[] = [
  "window.new", "file.insertText", "file.quickCapture", "file.toggleWorkspace", "edit.find", "edit.workspaceSearch", "view.toggleOutline", "view.focusMode", "view.toggleTheme", "help.commandPalette", "help.shortcuts", "help.tour", "help.github",
];

/** What the shell receives (`tray_set_menu`'s `appMenu`). */
export interface NativeMenu {
  lang: Locale;
  rtl: boolean;
  sections: Array<{ id: string; label: string; items: Array<{ id: string; label: string; accel?: string } | { role: MenuRole; label: string } | { separator: true }> }>;
}

/** The menu bar in the active language. `platform` drops the macOS application menu elsewhere. */
export function buildNativeMenu(lang: Locale, platform: "macos" | "windows" | "linux"): NativeMenu {
  const rtl = SUPPORTED_LOCALES.find((l) => l.code === lang)?.dir === "rtl";
  return {
    lang,
    rtl,
    sections: MENU.filter((s) => !s.macOnly || platform === "macos").map((s) => ({
      id: s.id,
      label: t(s.key),
      items: s.items
        // Services, Hide and About are macOS menu items.
        .filter((i) => platform === "macos" || i.kind !== "role" || !["services", "hide", "hideOthers", "showAll", "about"].includes(i.role))
        .map((i) => (i.kind === "separator" ? { separator: true as const } : i.kind === "role" ? { role: i.role, label: t(i.key) } : { id: i.id, label: t(i.key), ...(i.accel ? { accel: i.accel } : {}) })),
    })),
  };
}

/** Every string key the menu uses (the i18n test reads it). */
export function menuKeys(): string[] {
  const out = new Set<string>();
  for (const s of MENU) {
    out.add(s.key);
    for (const i of s.items) if (i.kind !== "separator") out.add(i.key);
  }
  return [...out];
}

/** Every command the menu runs. */
export function menuCommands(): string[] {
  return MENU.flatMap((s) => s.items.flatMap((i) => (i.kind === "command" ? [i.id] : [])));
}

type Invoke = (cmd: string, args: Record<string, unknown>) => Promise<unknown>;

/** Send the menu to the shell. `recent` is left out, so the tray keeps its list. */
export async function applyNativeMenu(invoke: Invoke, lang: Locale, platform: "macos" | "windows" | "linux"): Promise<NativeMenu> {
  const menu = buildNativeMenu(lang, platform);
  await invoke("tray_set_menu", { appMenu: menu });
  return menu;
}

/** A click on a menu item: the palette command of that id, when the menu has it. */
export function onNativeMenu(id: unknown, run: (id: string) => void): boolean {
  if (typeof id !== "string" || !menuCommands().includes(id)) return false;
  run(id);
  return true;
}
