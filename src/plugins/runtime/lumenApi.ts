/**
 * The `lumen` object a sandboxed plugin gets (plan 11.2), as types — the
 * source of the generated API reference (plan W13.D3,
 * scripts/plugin-api-docs.mjs → docs/src/content/docs/plugins/api-v<N>.md).
 *
 * Every method here is a host method of capabilities.ts METHOD_CAPABILITY
 * (the test holds the two lists equal) and every one has a doc comment,
 * `@capability`, `@since` (the apiVersion it arrived in) and an `@example`
 * that runs in src/__tests__/pluginApiDocs.test.ts. A method on its way out
 * says `@deprecated <why> — removed in apiVersion <N>`.
 *
 * Types only: nothing here ships in a bundle.
 */

/** API versions a plugin can declare in its manifest; the newest is the default. */
export const PLUGIN_API_VERSIONS = [1] as const;
export type PluginApiVersion = (typeof PLUGIN_API_VERSIONS)[number];

/** An element of a panel or rendered block (see the UI elements section of the API page). */
export type UiNode = { type: string; [field: string]: unknown };

export interface LumenDocument {
  /**
   * The open note's whole Markdown text.
   * @capability document:read
   * @since 1
   * @example
   * const text = await lumen.document.getText();
   * console.log(text.split(/\s+/).filter(Boolean).length, "words");
   */
  getText(): Promise<string>;
  /**
   * The open note's file name (`notes/plan.md`), or `Untitled.md`.
   * @capability document:read
   * @since 1
   * @example
   * const name = await lumen.document.getFileName();
   * console.log(name.endsWith(".md"));
   */
  getFileName(): Promise<string>;
  /**
   * The selection: `{ from, to, text }`, or `null` when nothing is selected.
   * @capability document:read
   * @since 1
   * @example
   * const sel = await lumen.document.getSelection();
   * if (sel) console.log(sel.text.length, "characters selected");
   */
  getSelection(): Promise<{ from: number; to: number; text: string } | null>;
  /**
   * Replace the open note's whole text (one undo step). It loses the cursor, the selection and the user's undo steps.
   * @capability document:write
   * @since 1
   * @deprecated use document.applyEdits (apiVersion 1.1) — removed in apiVersion 2
   * @example
   * const text = await lumen.document.getText();
   * await lumen.document.setText(text.replace(/\s+$/g, "") + "\n");
   */
  setText(text: string): Promise<void>;
  /**
   * Insert text at the cursor (it replaces a selection).
   * @capability document:write
   * @since 1
   * @example
   * await lumen.document.insertText(`\n> נכתב ב-${new Date().toISOString().slice(0, 10)}\n`);
   */
  insertText(text: string): Promise<void>;
  /**
   * Replace the selected text.
   * @capability document:write
   * @since 1
   * @example
   * const sel = await lumen.document.getSelection();
   * if (sel) await lumen.document.replaceSelection(sel.text.toUpperCase());
   */
  replaceSelection(text: string): Promise<void>;
  /**
   * Replacements `{ from, to, insert }`, in the coordinates of the text before the batch, applied as one undoable change; resolves to how many were applied (W13.L1).
   * @capability document:write
   * @since 1.1
   * @example
   * const text = await lumen.document.getText();
   * const at = text.indexOf("world");
   * if (at >= 0) await lumen.document.applyEdits([{ from: at, to: at + 5, insert: "עולם" }]);
   */
  applyEdits(edits: { from: number; to: number; insert: string }[]): Promise<number>;
}

export interface LumenVault {
  /**
   * The vault's entries under `dir` (relative, no `..`, no hidden folders).
   * @capability vault:read
   * @since 1
   * @example
   * const entries = await lumen.vault.list("notes");
   * console.log(entries.filter((e) => e.path.endsWith(".md")).length);
   */
  list(dir?: string): Promise<Array<{ name: string; path: string; kind: "file" | "dir" }>>;
  /**
   * A file's text (5 MB at most).
   * @capability vault:read
   * @since 1
   * @example
   * const text = await lumen.vault.read("notes/plan.md");
   * console.log(text.startsWith("#"));
   */
  read(path: string): Promise<string>;
  /**
   * Write a `.md`, `.txt`, `.json` or `.csv` file (5 MB at most).
   * @capability vault:write
   * @since 1
   * @example
   * await lumen.vault.write("exports/words.csv", "word,count\nשלום,3\n");
   */
  write(path: string, text: string): Promise<void>;
}

export interface LumenCommands {
  /**
   * Add a palette command (50 per plugin; the label shows "· your plugin name"); running it fires the event `command:<id>`.
   * @capability commands
   * @since 1
   * @example
   * await lumen.commands.register({ id: "count", label: "Count words" });
   * lumen.on("command:count", async () => lumen.notifications.show("Counted", "success"));
   */
  register(cmd: { id: string; label: string; hint?: string }): Promise<void>;
  /**
   * Remove a command you registered.
   * @capability commands
   * @since 1
   * @example
   * await lumen.commands.unregister("count");
   */
  unregister(id: string): Promise<void>;
}

export interface LumenPanel {
  /**
   * Open your side panel (one plugin panel at a time).
   * @capability panel
   * @since 1
   * @example
   * await lumen.panel.open({ title: "סטטיסטיקה" });
   */
  open(opts?: { title?: string }): Promise<void>;
  /**
   * Draw the panel from a tree of UI elements.
   * @capability panel
   * @since 1
   * @example
   * await lumen.panel.render({ type: "box", direction: "column", gap: 8, children: [{ type: "heading", level: 2, text: "Words" }, { type: "text", text: "42" }] });
   */
  render(tree: UiNode): Promise<void>;
  /**
   * Close your panel.
   * @capability panel
   * @since 1
   * @example
   * await lumen.panel.close();
   */
  close(): Promise<void>;
}

export interface LumenRenderer {
  /**
   * Render ```` ```<lang> ```` blocks (10 languages; Lumen's own are refused); their event is `render:<lang>`.
   * @capability renderer
   * @since 1
   * @example
   * await lumen.renderer.register("callout");
   */
  register(lang: string): Promise<void>;
  /**
   * Answer a `render:<lang>` event with the block's UI tree.
   * @capability renderer
   * @since 1
   * @example
   * lumen.on("render:callout", ({ requestId, source }) => lumen.renderer.result(requestId, { type: "paragraph", children: [{ type: "text", text: source }] }));
   */
  result(requestId: string, tree: UiNode): Promise<void>;
}

export interface LumenSettings {
  /**
   * Your plugin's settings object (`{}` at first).
   * @capability settings
   * @since 1
   * @example
   * const s = await lumen.settings.get();
   * console.log(s.goal ?? 500);
   */
  get(): Promise<Record<string, unknown>>;
  /**
   * Save your settings (JSON, 64 KB at most).
   * @capability settings
   * @since 1
   * @example
   * await lumen.settings.set({ goal: 750, language: "he" });
   */
  set(value: Record<string, unknown>): Promise<void>;
}

export interface LumenStorage {
  /**
   * A value you stored, or `null`.
   * @capability storage
   * @since 1
   * @example
   * const n = (await lumen.storage.get("runs")) ?? 0;
   * console.log(n);
   */
  get(key: string): Promise<unknown>;
  /**
   * Store a JSON value (1,000 keys of at most 1 MB each).
   * @capability storage
   * @since 1
   * @example
   * await lumen.storage.set("runs", 1);
   */
  set(key: string, value: unknown): Promise<void>;
  /**
   * Remove a key.
   * @capability storage
   * @since 1
   * @example
   * await lumen.storage.delete("runs");
   */
  delete(key: string): Promise<void>;
}

export interface LumenClipboard {
  /**
   * Put text on the clipboard.
   * @capability clipboard:write
   * @since 1
   * @example
   * await lumen.clipboard.writeText("[[" + (await lumen.document.getFileName()).replace(/\.md$/, "") + "]]");
   */
  writeText(text: string): Promise<void>;
}

export interface LumenNotifications {
  /**
   * A toast, with your plugin's name in front.
   * @capability notifications
   * @since 1
   * @example
   * await lumen.notifications.show("נשמר", "success");
   */
  show(text: string, kind?: "info" | "success" | "error"): Promise<void>;
}

export interface LumenNetwork {
  /**
   * Fetch from the one origin you were granted (no cookies, no redirects, 30 s, 5 MB); recorded in the privacy ledger, blocked under local-only.
   * @capability network:<origin>
   * @since 1
   * @example
   * const r = await lumen.network.fetch("https://api.example.org/v1/word?q=שלום");
   * if (r.status === 200) console.log(JSON.parse(r.body));
   */
  // privacy-ledger: not a call — the type of lumen.network.fetch; pluginHost.ts records each request (recordPluginRequest).
  fetch(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; headers: Record<string, string>; body: string }>;
}

export interface LumenBases {
  /**
   * A `.base` view's rows as the app shows them (10,000 per call).
   * @capability bases:read
   * @since 1
   * @example
   * const { rows, total } = await lumen.bases.query("books.base", "Table", { limit: 20 });
   * console.log(total, rows.map((r) => r.path));
   */
  query(path: string, view?: string, page?: { offset?: number; limit?: number }): Promise<{ view: string; columns: string[]; rows: Array<{ path: string; cells: Record<string, unknown> }>; total: number; errors: string[] }>;
  /**
   * Change note properties; one approval screen covers the whole call (5,000 rows).
   * @capability bases:write
   * @since 1
   * @example
   * const res = await lumen.bases.update([{ path: "books/dune.md", set: { status: "read" } }]);
   * console.log(res.written, res.declined);
   */
  update(rows: Array<{ path: string; set: Record<string, unknown> }>): Promise<{ written: number; unchanged: number; declined: boolean }>;
}

/** The global `lumen` inside a plugin's sandbox. */
export interface LumenApi {
  /**
   * Listen to an event: `command:<id>`, `render:<lang>`, `ui:panel`, `ui:block`, `panel:closed`. Returns the function that stops listening. Each call of your handler gets 250 ms of CPU.
   * @capability —
   * @since 1
   * @example
   * const off = lumen.on("panel:closed", () => console.log("closed"));
   * off();
   */
  on(event: string, handler: (payload: unknown) => void): () => void;
  /**
   * Your manifest, read-only.
   * @capability —
   * @since 1
   * @example
   * console.log(lumen.manifest.id, lumen.manifest.version);
   */
  readonly manifest: { id: string; name: string; version: string; [field: string]: unknown };
  document: LumenDocument;
  vault: LumenVault;
  commands: LumenCommands;
  panel: LumenPanel;
  renderer: LumenRenderer;
  settings: LumenSettings;
  storage: LumenStorage;
  clipboard: LumenClipboard;
  notifications: LumenNotifications;
  network: LumenNetwork;
  bases: LumenBases;
}
