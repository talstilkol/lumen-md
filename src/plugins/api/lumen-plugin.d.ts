/**
 * The public plugin API of Lumen (plan W13.L1): everything a plugin's
 * `main` can reach inside the QuickJS sandbox, as the global `lumen`, and
 * the CSS custom properties a theme may set.
 *
 * This file is the contract. `scripts/plugin-api-report.mjs` reads it and
 * writes `plugin-api/api-report.md`; a change here without the matching
 * `PLUGIN_API_VERSION` bump in src/plugins/api/version.ts fails the check:
 *   - an addition needs a minor bump;
 *   - a removal or a changed signature needs a major bump, and a removed
 *     member must have been `@deprecated` in at least two released minor
 *     versions first.
 *
 * Tags the report reads, one per member:
 *   `@since <version>`                    the API version that added it;
 *   `@deprecated <since> <removeIn> <use>` deprecated since, removed in, and its replacement.
 *
 * Self-contained on purpose (no imports): plugin authors copy it as is.
 */

/** A JSON value: what crosses the sandbox boundary. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** UI is data, never HTML: the app validates the tree and renders it (src/plugins/runtime/uiTree.ts). */
export type UiNode =
  | { type: "text"; text: string }
  | { type: "heading"; level?: 1 | 2 | 3; text: string }
  | { type: "paragraph"; children: UiNode[] }
  | { type: "box"; direction?: "row" | "column"; gap?: number; children: UiNode[] }
  | { type: "list"; ordered?: boolean; items: UiNode[][] }
  | { type: "button"; id: string; label: string; primary?: boolean; disabled?: boolean }
  | { type: "input"; id: string; value?: string; placeholder?: string; multiline?: boolean }
  | { type: "checkbox"; id: string; checked?: boolean; label: string }
  | { type: "select"; id: string; value?: string; options: { value: string; label: string }[] }
  | { type: "code"; text: string; lang?: string }
  | { type: "noteLink"; target: string; label?: string }
  | { type: "divider" };

export interface Selection {
  from: number;
  to: number;
  text: string;
}

/**
 * One change to the open note: replace `[from, to)` (UTF-16 offsets into the text before any edit of the batch) with `insert`.
 * @since 1.1.0
 */
export interface TextEdit {
  from: number;
  to: number;
  insert: string;
}

export interface VaultEntry {
  name: string;
  path: string;
  kind: "file" | "dir";
}

export interface CommandSpec {
  /** Letters, digits, "_", "." and "-"; unique inside the plugin. */
  id: string;
  label: string;
  hint?: string;
}

export interface FetchInit {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD";
  headers?: Record<string, string>;
  body?: string;
}

export interface FetchResult {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface BasesQueryResult {
  view: string;
  columns: Array<{ id: string; label: string }>;
  rows: Array<{ path: string; cells: Record<string, JsonValue> }>;
  total: number;
  errors: string[];
}

export interface BasesRowEdit {
  path: string;
  set: Record<string, JsonValue>;
}

export type BasesUpdateResult = { written: number; unchanged: number; declined: false } | { written: 0; unchanged: number; declined: true };

export interface LumenDocumentApi {
  /** @since 1.0.0 */
  getText(): Promise<string>;
  /** @since 1.0.0 */
  getFileName(): Promise<string>;
  /** @since 1.0.0 */
  getSelection(): Promise<Selection | null>;
  /**
   * Replaces the whole note. Loses the cursor, the selection and the user's undo granularity.
   * @since 1.0.0
   * @deprecated 1.1.0 2.0.0 document.applyEdits
   */
  setText(text: string): Promise<void>;
  /** @since 1.0.0 */
  insertText(text: string): Promise<void>;
  /** @since 1.0.0 */
  replaceSelection(text: string): Promise<void>;
  /**
   * Applies edits to the open note as one undoable change; returns how many were applied.
   * @since 1.1.0
   */
  applyEdits(edits: TextEdit[]): Promise<number>;
}

export interface LumenVaultApi {
  /** @since 1.0.0 */
  list(dir?: string): Promise<VaultEntry[]>;
  /** @since 1.0.0 */
  read(path: string): Promise<string>;
  /** @since 1.0.0 */
  write(path: string, text: string): Promise<void>;
}

export interface LumenCommandsApi {
  /** @since 1.0.0 */
  register(command: CommandSpec, handler?: (payload: { source: "palette" }) => void | Promise<void>): Promise<void>;
  /** @since 1.0.0 */
  unregister(id: string): Promise<void>;
}

export interface LumenPanelApi {
  /** @since 1.0.0 */
  open(options?: { title?: string }): Promise<void>;
  /** @since 1.0.0 */
  close(): Promise<void>;
  /** @since 1.0.0 */
  render(tree: UiNode): Promise<void>;
}

export interface LumenRendererApi {
  /** @since 1.0.0 */
  register(lang: string): Promise<void>;
  /** @since 1.0.0 */
  result(requestId: string, tree: UiNode): Promise<void>;
}

export interface LumenSettingsApi {
  /** @since 1.0.0 */
  get(): Promise<JsonValue>;
  /** @since 1.0.0 */
  set(value: JsonValue): Promise<void>;
}

export interface LumenStorageApi {
  /** @since 1.0.0 */
  get(key: string): Promise<JsonValue>;
  /** @since 1.0.0 */
  set(key: string, value: JsonValue): Promise<void>;
  /** @since 1.0.0 */
  delete(key: string): Promise<void>;
}

export interface LumenClipboardApi {
  /** @since 1.0.0 */
  writeText(text: string): Promise<void>;
}

export interface LumenNotificationsApi {
  /** @since 1.0.0 */
  show(text: string, kind?: "info" | "success" | "error"): Promise<void>;
}

export interface LumenNetworkApi {
  /** @since 1.0.0 */
  fetch(url: string, init?: FetchInit): Promise<FetchResult>;
}

export interface LumenBasesApi {
  /** @since 1.0.0 */
  query(path: string, view?: string | number, page?: { offset?: number; limit?: number }): Promise<BasesQueryResult>;
  /** @since 1.0.0 */
  update(edits: BasesRowEdit[]): Promise<BasesUpdateResult>;
}

/** The global `lumen` inside the sandbox. */
export interface LumenPluginApi {
  /** @since 1.0.0 */
  readonly document: LumenDocumentApi;
  /** @since 1.0.0 */
  readonly vault: LumenVaultApi;
  /** @since 1.0.0 */
  readonly commands: LumenCommandsApi;
  /** @since 1.0.0 */
  readonly panel: LumenPanelApi;
  /** @since 1.0.0 */
  readonly renderer: LumenRendererApi;
  /** @since 1.0.0 */
  readonly settings: LumenSettingsApi;
  /** @since 1.0.0 */
  readonly storage: LumenStorageApi;
  /** @since 1.0.0 */
  readonly clipboard: LumenClipboardApi;
  /** @since 1.0.0 */
  readonly notifications: LumenNotificationsApi;
  /** @since 1.0.0 */
  readonly network: LumenNetworkApi;
  /** @since 1.0.0 */
  readonly bases: LumenBasesApi;
  /** @since 1.0.0 */
  on(event: string, handler: (payload: JsonValue) => void | Promise<void>): () => void;
  /** @since 1.0.0 */
  readonly manifest: Readonly<Record<string, JsonValue>>;
  /**
   * The plugin API version the sandbox speaks to this plugin: its `targetApiVersion` when that is older (compatibility mode), or Lumen's own.
   * @since 1.1.0
   */
  readonly apiVersion: string;
}

/**
 * The CSS custom properties a theme may set (HSL triplets such as `220 14% 98%`, used as `hsl(var(--bg))`).
 * Lumen defines every one of them in light and dark; a theme that sets only these keeps working across minor versions.
 * @since 1.0.0
 */
export type LumenThemeVariable =
  | "--bg"
  | "--bg-subtle"
  | "--bg-muted"
  | "--bg-inset"
  | "--fg"
  | "--fg-subtle"
  | "--fg-muted"
  | "--border"
  | "--border-strong"
  | "--accent"
  | "--accent-fg"
  | "--danger"
  | "--success"
  | "--warning"
  | "--info";

declare global {
  const lumen: LumenPluginApi;
}
