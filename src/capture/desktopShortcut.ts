/**
 * The desktop app's system-wide capture shortcut (plan 4.16): ⌥⌘N
 * (Ctrl+Alt+N) brings Lumen to the front with the capture box open, even
 * when another app has the focus.
 *
 * A system-wide shortcut needs Tauri's global-shortcut plugin, which the
 * desktop shell does not bundle yet (src-tauri/Cargo.toml has only the
 * dialog and fs plugins). So this is a feature check: it asks the plugin
 * to register the shortcut through Tauri's IPC, and when the plugin is
 * missing the call fails and nothing else happens — the in-window ⌥⌘N and
 * the File ▸ Quick capture menu item (which work today) stay the way in.
 * docs/src/content/docs/workspace/quick-capture.md lists the three lines
 * that turn it on.
 *
 * Loaded only inside the desktop app.
 */

/** The accelerator, in the plugin's syntax. */
export const GLOBAL_CAPTURE_SHORTCUT = "CommandOrControl+Alt+N";

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** What the plugin sends on each press (`ShortcutEvent`). */
interface ShortcutEvent {
  shortcut: string;
  state: "Pressed" | "Released";
}

/**
 * Register the global shortcut; `onCapture` runs on every press. Resolves
 * to true when the plugin took it, false outside the desktop app or when
 * the plugin is not part of this build.
 */
export async function registerGlobalCapture(onCapture: () => void): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const core = await import("@tauri-apps/api/core");
    // The plugin's own JS API does exactly this (plugin:global-shortcut|register
    // with a Channel for the events); calling it directly needs no npm package.
    const handler = new core.Channel<ShortcutEvent>();
    handler.onmessage = (e) => {
      if (e.state !== "Pressed") return;
      void bringToFront();
      onCapture();
    };
    // Registered by an earlier load of the page (a reload keeps the process).
    await core.invoke("plugin:global-shortcut|unregister", { shortcuts: [GLOBAL_CAPTURE_SHORTCUT] }).catch(() => undefined);
    await core.invoke("plugin:global-shortcut|register", { shortcuts: [GLOBAL_CAPTURE_SHORTCUT], handler });
    return true;
  } catch {
    // No global-shortcut plugin in this build, or the OS refused the keys.
    return false;
  }
}

/** Show and focus the main window (it may be hidden or behind other apps). */
async function bringToFront(): Promise<void> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const w = getCurrentWindow();
    await w.show();
    await w.unminimize();
    await w.setFocus();
  } catch {
    /* not permitted by the capability: the box still opens when the user switches back */
  }
}
