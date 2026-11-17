/**
 * The desktop shell, WebView side (plan W3.9): which window this is, what
 * the Rust shell asks it to open (files from Finder / Explorer, `lumen://`
 * links, the tray), tabs that move between windows, and the tray menu.
 * Rust decides (src-tauri/desktop, tested offline); this file applies.
 *
 * Nothing here runs in the browser build: every entry point returns early
 * outside the desktop app.
 */

// Which window this is, its storage and the tab state it hands over: in ./window,
// so the store and the tab strip get them at startup without the rest of the shell.
import { isDesktop, parseTabState, storeKeyFor, windowLabel, type TabState } from "./window";
import type { LinkAction } from "../security/linkConfirm";
export { isDesktop, windowLabel, STORE_KEY, storeKeyFor, seedFromMain, windowStorage, parseTabState, droppedOutside, type TabState } from "./window";

/** What Rust asks the main window to open (`lumen-open`). */
export type OpenRequest =
  /** `link`: from a `lumen://` link (confirmed first, W13.X5); the OS and the tray are not links. */
  | { kind: "vault"; root: string; rel: string; line: number | null; link?: boolean }
  | { kind: "file"; token: string; name: string }
  | { kind: "unknown-vault"; name: string }
  | { kind: "new"; title: string | null; text: string | null; folder: string | null }
  | { kind: "capture"; text: string };

export interface OpenDeps {
  /** The active folder vault's root, or "" for app storage. */
  activeRoot: () => string;
  /** Switch to a known folder vault (Rust granted it). */
  switchVault: (root: string) => Promise<void>;
  openVaultFile: (rel: string, line: number | null) => Promise<void>;
  openStandalone: (token: string, name: string) => Promise<void>;
  newNote: (title: string | null, text: string | null, folder: string | null) => Promise<void>;
  capture: (text: string) => Promise<void>;
  notifyUnknownVault: (name: string) => void;
  /**
   * W13.X5: may a link do this? Asks the user (src/security/linkConfirm.ts). Without it, a link that writes or
   * opens does nothing: a link is any page's or app's request, so it fails closed.
   */
  confirm?: (a: LinkAction) => Promise<boolean>;
  /** The text of a vault file, for the confirmation of local HTML (does it load from the network?). */
  peek?: (rel: string) => Promise<string | null>;
}

/** Apply one open request. A file of another known vault switches to that vault first. */
export async function handleOpenRequest(req: OpenRequest, d: OpenDeps): Promise<void> {
  const allowed = (a: LinkAction) => (d.confirm ? d.confirm(a) : Promise.resolve(false));
  switch (req.kind) {
    case "vault":
      if (req.link) {
        const html = /\.(x?html?|mhtml)$/i.test(req.rel) && d.peek ? await d.peek(req.rel).catch(() => null) : null;
        if (!(await allowed({ kind: "open-file", path: req.rel, html }))) return;
      }
      if (req.root && req.root !== d.activeRoot()) await d.switchVault(req.root);
      return d.openVaultFile(req.rel, req.line);
    case "file":
      return d.openStandalone(req.token, req.name);
    case "unknown-vault":
      return d.notifyUnknownVault(req.name);
    case "new":
      // An empty new note is the tray's (or a harmless link's): nothing to confirm.
      if ((req.title || req.text || req.folder) && !(await allowed({ kind: "new-note", title: req.title, text: req.text, folder: req.folder }))) return;
      return d.newNote(req.title, req.text, req.folder);
    case "capture":
      if (!(await allowed({ kind: "capture", text: req.text }))) return;
      return d.capture(req.text);
  }
}

/** The inbox quick capture writes to (vault-relative). */
export const INBOX_PATH = "inbox.md";

type Invoke = <T>(cmd: string, args?: unknown, opts?: { headers?: Record<string, string> }) => Promise<T>;

async function tauri(): Promise<{ invoke: Invoke; listen: <T>(ev: string, fn: (e: { payload: T }) => void) => Promise<() => void> }> {
  const core = await import("@tauri-apps/api/core");
  const event = await import("@tauri-apps/api/event");
  return { invoke: core.invoke as Invoke, listen: event.listen as never };
}

/** A save-able handle for a file opened from outside every vault: saving writes it back by token. */
export function standaloneHandle(token: string, name: string, invoke: Invoke): FileSystemFileHandle {
  const handle = {
    kind: "file",
    name,
    async createWritable() {
      let text = "";
      return {
        async write(chunk: string) {
          text += chunk;
        },
        async close() {
          await invoke("external_write", new TextEncoder().encode(text), { headers: { "x-file-token": token } });
        },
      };
    },
    async getFile() {
      const bytes = await invoke<ArrayBuffer>("external_read", { token });
      return new File([bytes], name, { type: "text/markdown" });
    },
  };
  return handle as unknown as FileSystemFileHandle;
}

export interface ShellHooks extends OpenDeps {
  /** This window's tabs (ids). */
  tabIds: () => string[];
  /** Open a tab moved here; resolve when it is open. */
  receiveTab: (state: TabState) => Promise<void>;
  /** The tab moved away: close it without asking about unsaved changes (they travelled). */
  dropTab: (id: string) => void;
}

/** Start listening (desktop only). Returns a stop function. */
export async function initDesktopShell(h: ShellHooks): Promise<() => void> {
  if (!isDesktop()) return () => {};
  const { invoke, listen } = await tauri();
  const label = windowLabel();
  const offs: Array<() => void> = [];
  const take = async (tab: string, raw?: string) => {
    const state = parseTabState(raw ?? (await invoke<string | null>("tab_take", { tab })) ?? "");
    if (!state) return;
    await h.receiveTab(state);
    await invoke("tab_accept", { tab });
  };
  offs.push(await listen<string>("lumen-tab-offer", (e) => void take(e.payload)));
  offs.push(await listen<string>("lumen-tab-moved", (e) => h.dropTab(e.payload)));
  if (label === "main") {
    offs.push(await listen<OpenRequest>("lumen-open", (e) => void handleOpenRequest(e.payload, h)));
    for (const req of await invoke<OpenRequest[]>("shell_ready")) await handleOpenRequest(req, h);
  }
  for (const [tab, raw] of await invoke<[string, string][]>("tab_pending")) await take(tab, raw);
  await invoke("tabs_sync", { tabs: h.tabIds() });
  if (label !== "main") {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    // A secondary window's state ends with the window.
    offs.push(
      await getCurrentWindow().onCloseRequested(() => {
        try {
          localStorage.removeItem(storeKeyFor(label));
        } catch {
          // why: storage is blocked or full (private mode, quota): the setting holds for this session only
          /* storage blocked */
        }
      }),
    );
  }
  return () => offs.forEach((f) => f());
}

/** Tell Rust which tabs this window shows (after every change). */
export async function syncTabs(ids: string[]): Promise<void> {
  if (!isDesktop()) return;
  const { invoke } = await tauri();
  await invoke("tabs_sync", { tabs: ids });
}

/** A tab dropped outside the window: Rust moves it (or not). Returns the target label. */
export async function dragTabOut(state: TabState): Promise<string | null> {
  if (!isDesktop()) return null;
  const { invoke } = await tauri();
  const to = await invoke<string | null>("tab_drag_out", { tab: state.id, tabState: JSON.stringify(state) });
  if (to) {
    // If the target never takes it (closed, failed), the tab simply stays here.
    setTimeout(() => void invoke("tab_cancel", { tab: state.id }).catch(() => undefined), 15_000);
  }
  return to;
}

export async function newWindow(): Promise<void> {
  if (!isDesktop()) return;
  const { invoke } = await tauri();
  await invoke("window_new");
}

/** The tray's labels in the UI language, and up to 5 recent notes (name, vault path). */
export async function setTrayMenu(labels: { capture: string; new_note: string; recent: string; show: string; quit: string }, recent: Array<[string, string]>): Promise<void> {
  if (!isDesktop()) return;
  const { invoke } = await tauri();
  await invoke("tray_set_menu", { labels, recent });
}

/** Quick capture: the inbox's new text with `text` added (Rust formats the entry), or null. */
export async function formatCapture(text: string, existing: string): Promise<string | null> {
  const { invoke } = await tauri();
  return invoke<string | null>("capture_format", { text, existing, offsetMinutes: -new Date().getTimezoneOffset() });
}
