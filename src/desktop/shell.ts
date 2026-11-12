/**
 * The desktop shell, WebView side (plan W3.9): which window this is, what
 * the Rust shell asks it to open (files from Finder / Explorer, `lumen://`
 * links, the tray), tabs that move between windows, and the tray menu.
 * Rust decides (src-tauri/desktop, tested offline); this file applies.
 *
 * Nothing here runs in the browser build: every entry point returns early
 * outside the desktop app.
 */

export const isDesktop = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** This window's label: `main`, `w-N` or `capture` (Rust puts it in the URL). */
export function windowLabel(search: string = typeof location !== "undefined" ? location.search : ""): string {
  const w = new URLSearchParams(search).get("window") ?? "";
  return /^(main|capture|w-[0-9]{1,4})$/.test(w) ? w : "main";
}

/**
 * Each editor window keeps its own tabs and note: the main window uses the
 * usual store key, another window its own key, seeded on first load with
 * the main window's settings (theme, language, …) but none of its notes.
 */
export const STORE_KEY = "lumen-md";

export function storeKeyFor(label: string): string {
  return label === "main" ? STORE_KEY : `${STORE_KEY}:${label}`;
}

/** The main window's persisted store without its note and tabs (a new window's start). */
export function seedFromMain(mainRaw: string | null): string | null {
  if (!mainRaw) return null;
  try {
    const data = JSON.parse(mainRaw) as { state?: Record<string, unknown>; version?: number };
    if (!data?.state || typeof data.state !== "object") return null;
    const { doc: _doc, openTabs: _tabs, ...settings } = data.state;
    return JSON.stringify({ ...data, state: settings });
  } catch {
    return null;
  }
}

/** A Storage for zustand's persist that keeps a secondary window's state apart. */
export function windowStorage(label: string, base: Pick<Storage, "getItem" | "setItem" | "removeItem">): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  if (label === "main") return base;
  const own = (name: string) => (name === STORE_KEY ? storeKeyFor(label) : `${name}:${label}`);
  return {
    getItem: (name) => base.getItem(own(name)) ?? (name === STORE_KEY ? seedFromMain(base.getItem(STORE_KEY)) : null),
    setItem: (name, value) => base.setItem(own(name), value),
    removeItem: (name) => base.removeItem(own(name)),
  };
}

/** A tab's editing state, as it travels to another window. */
export interface TabState {
  id: string;
  name: string;
  workspaceName: string | null;
  content: string;
  dirty: boolean;
  mode?: "source" | "split" | "preview" | "wysiwyg";
  selection?: { anchor: number; head: number };
  scrollTop?: number;
}

const MODES = new Set(["source", "split", "preview", "wysiwyg"]);

/** Parse a tab state from another window; null when it isn't one. */
export function parseTabState(raw: string): TabState | null {
  try {
    const d = JSON.parse(raw) as Partial<TabState>;
    if (typeof d.id !== "string" || typeof d.name !== "string" || typeof d.content !== "string" || typeof d.dirty !== "boolean") return null;
    if (d.workspaceName !== null && typeof d.workspaceName !== "string") return null;
    const out: TabState = { id: d.id, name: d.name, workspaceName: d.workspaceName ?? null, content: d.content, dirty: d.dirty };
    if (d.mode && MODES.has(d.mode)) out.mode = d.mode;
    const n = d.content.length;
    if (d.selection && Number.isInteger(d.selection.anchor) && Number.isInteger(d.selection.head)) {
      out.selection = { anchor: Math.max(0, Math.min(n, d.selection.anchor)), head: Math.max(0, Math.min(n, d.selection.head)) };
    }
    if (typeof d.scrollTop === "number" && Number.isFinite(d.scrollTop) && d.scrollTop >= 0) out.scrollTop = d.scrollTop;
    return out;
  } catch {
    return null;
  }
}

/** Was a tab dropped outside this window? (Browser drag events report the drop point.) */
export function droppedOutside(e: { clientX: number; clientY: number }, size: { w: number; h: number }): boolean {
  // Chromium reports (0, 0) when a drag ends outside every window it knows of.
  return e.clientX < 0 || e.clientY < 0 || e.clientX > size.w || e.clientY > size.h || (e.clientX === 0 && e.clientY === 0);
}

/** What Rust asks the main window to open (`lumen-open`). */
export type OpenRequest =
  | { kind: "vault"; root: string; rel: string; line: number | null }
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
}

/** Apply one open request. A file of another known vault switches to that vault first. */
export async function handleOpenRequest(req: OpenRequest, d: OpenDeps): Promise<void> {
  switch (req.kind) {
    case "vault":
      if (req.root && req.root !== d.activeRoot()) await d.switchVault(req.root);
      return d.openVaultFile(req.rel, req.line);
    case "file":
      return d.openStandalone(req.token, req.name);
    case "unknown-vault":
      return d.notifyUnknownVault(req.name);
    case "new":
      return d.newNote(req.title, req.text, req.folder);
    case "capture":
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
