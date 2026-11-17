/*
 * Lumen's Obsidian compatibility layer — spike (plan W13.L3). MIT.
 *
 * Runs inside the QuickJS plugin sandbox, before an Obsidian plugin's
 * CommonJS bundle. It builds the `obsidian` module (Plugin, Notice, Modal,
 * Setting, PluginSettingTab, Vault, MetadataCache, Workspace, Editor, …)
 * over Lumen's own plugin API (`lumen.*`, capability-checked), and an `app`
 * whose vault and metadata come from Lumen's vault. Everything a plugin
 * reaches that the layer does not have is recorded by name (a Proxy), so
 * the spike can say why a plugin fails.
 *
 * Written from Obsidian's public API documentation (obsidian.d.ts, MIT);
 * no Obsidian code is copied. There is no DOM in the sandbox: elements are
 * a small tree of records (`ShimEl`) that a later step can turn into
 * Lumen's UI tree.
 *
 * Globals it defines: __obsidian (the module), __obsApp (the app),
 * __obsReport(kind, data) (a JSON line on the console, read by the runner),
 * __obsBoot() (a promise: the vault index), __obsRequire(name).
 */
(function () {
  "use strict";
  const { missing, report, watch, es5able, Events, ShimEl, shimDocument, TAbstractFile, TFile, TFolder, texts, files, root, addFile, pathOf, parseYaml, stringifyYaml, cacheOf, vault, metadataCache, posToOffset, offsetToPos, Editor, ValueComponent, Setting, PluginSettingTab, Menu, folderOf } = globalThis.__obsK;
  delete globalThis.__obsK;
  // ── Components ────────────────────────────────────────────────────────
  class Component {
    constructor() {
      this._children = [];
      this._cleanup = [];
      this._loaded = false;
    }
    load() {
      this._loaded = true;
      if (this.onload) return this.onload();
    }
    unload() {
      for (const c of this._children) c.unload();
      for (const f of this._cleanup.splice(0)) f();
      if (this.onunload) this.onunload();
    }
    onload() {}
    onunload() {}
    addChild(c) {
      this._children.push(c);
      if (this._loaded) c.load();
      return c;
    }
    removeChild(c) {
      this._children = this._children.filter((x) => x !== c);
      c.unload();
      return c;
    }
    register(cb) {
      this._cleanup.push(cb);
    }
    registerEvent(ref) {
      this._cleanup.push(() => ref && ref.e && ref.e.offref(ref));
    }
    registerDomEvent(el, type, cb) {
      if (el && el.addEventListener) el.addEventListener(type, cb);
    }
    registerInterval(id) {
      return id;
    }
  }

  const state = { commands: new Map(), settingTabs: [], ribbon: 0, statusBar: 0, views: [], postProcessors: 0, codeBlocks: [], editorExtensions: 0, extensions: [], protocol: [] };
  globalThis.__obsState = state;

  /** The Lumen command id for an Obsidian one (letters, digits, "_", "." and "-"). */
  const lumenCommandId = (id) => String(id).replace(/[^A-Za-z0-9_.-]/g, "-").slice(0, 64) || "command";
  globalThis.__obsCommandId = lumenCommandId;

  async function withEditor(fn) {
    const text = (await lumen.document.getText()) ?? "";
    const sel = await lumen.document.getSelection();
    const editor = new Editor(text, sel);
    const out = await fn(editor);
    const edit = editor._edit();
    if (edit) await (lumen.document.applyEdits ? lumen.document.applyEdits([edit]) : lumen.document.setText(editor.getValue()));
    return out;
  }

  const activeFileName = { path: "note.md" };
  class View extends Component {
    constructor(leaf) {
      super();
      this.leaf = leaf;
      this.app = app;
      this.containerEl = new ShimEl("div");
      this.contentEl = this.containerEl.createDiv();
      this.icon = "";
      this.navigation = false;
    }
    getViewType() {
      return "";
    }
    getDisplayText() {
      return "";
    }
    getState() {
      return {};
    }
    setState() {
      return Promise.resolve();
    }
  }
  class ItemView extends View {}
  class FileView extends ItemView {}
  class TextFileView extends FileView {}
  class MarkdownView extends TextFileView {
    constructor(leaf) {
      super(leaf);
      this.editor = null;
      this.file = files.get(activeFileName.path) ?? null;
    }
    getViewType() {
      return "markdown";
    }
    getMode() {
      return "source";
    }
    getViewData() {
      return this.editor ? this.editor.getValue() : "";
    }
  }
  class WorkspaceLeaf extends Events {
    constructor() {
      super();
      this.view = null;
    }
    openFile() {
      return Promise.resolve();
    }
    setViewState() {
      return Promise.resolve();
    }
    getViewState() {
      return { type: "empty" };
    }
    detach() {}
  }

  // The view a command sees: a MarkdownView whose editor is the open note (set while an editor command runs).
  let currentEditor = null;
  const workspaceEvents = new Events();
  const workspace = watch(
    Object.assign(workspaceEvents, {
      layoutReady: true,
      containerEl: new ShimEl("div"),
      leftSplit: { collapsed: true },
      rightSplit: { collapsed: true },
      onLayoutReady: (cb) => Promise.resolve().then(cb),
      getActiveFile: () => files.get(activeFileName.path) ?? null,
      getActiveViewOfType: (type) => {
        // By prototype: the module exports ES5-callable wrappers that share the classes' prototypes.
        if (!currentEditor || !type || !(type.prototype === MarkdownView.prototype || MarkdownView.prototype instanceof type)) return null;
        const v = new MarkdownView(new WorkspaceLeaf());
        v.editor = currentEditor;
        return v;
      },
      get activeEditor() {
        return currentEditor ? { editor: currentEditor, file: files.get(activeFileName.path) ?? null } : null;
      },
      get activeLeaf() {
        return null;
      },
      getLeavesOfType: () => [],
      getLeaf: () => new WorkspaceLeaf(),
      getRightLeaf: () => new WorkspaceLeaf(),
      getLeftLeaf: () => new WorkspaceLeaf(),
      iterateAllLeaves: () => undefined,
      iterateRootLeaves: () => undefined,
      detachLeavesOfType: () => undefined,
      revealLeaf: () => Promise.resolve(),
      openLinkText: async () => undefined,
      setActiveLeaf: () => undefined,
      getLastOpenFiles: () => [activeFileName.path],
      updateOptions: () => undefined,
      requestSaveLayout: () => undefined,
    }),
    "app.workspace",
  );

  const app = watch(
    {
      vault,
      metadataCache,
      workspace,
      fileManager: watch(
        {
          processFrontMatter: async (f, fn) => {
            const p = pathOf(f);
            const text = texts.get(p) ?? "";
            const c = cacheOf(text);
            const fm = { ...(c.frontmatter ?? {}) };
            fn(fm);
            const body = c.frontmatterPosition ? text.slice(c.frontmatterPosition.end.offset + 1) : text;
            await vault.modify(f, "---\n" + stringifyYaml(fm) + "---\n" + body);
          },
          generateMarkdownLink: (f) => "[[" + f.basename + "]]",
          getNewFileParent: () => root,
          renameFile: async () => {
            throw new Error("renaming files is not available to Obsidian plugins in Lumen");
          },
          trashFile: async () => {
            throw new Error("deleting files is not available to Obsidian plugins in Lumen");
          },
        },
        "app.fileManager",
      ),
      commands: watch({ commands: {}, editorCommands: {}, executeCommandById: () => false, listCommands: () => [], findCommand: () => undefined }, "app.commands"),
      plugins: watch({ plugins: {}, manifests: {}, enabledPlugins: new Set(), getPlugin: () => null }, "app.plugins"),
      internalPlugins: watch({ plugins: {}, getPluginById: () => null, getEnabledPluginById: () => null }, "app.internalPlugins"),
      setting: watch({ open() {}, openTabById() {}, close() {} }, "app.setting"),
      keymap: watch({ pushScope() {}, popScope() {} }, "app.keymap"),
      scope: watch({ register() {}, unregister() {} }, "app.scope"),
      isMobile: false,
      appId: "lumen",
      emulateMobile() {},
      loadLocalStorage: () => null,
      saveLocalStorage: () => undefined,
      getTheme: () => "obsidian",
      lastEvent: null,
    },
    "app",
  );

  class Plugin extends Component {
    constructor(appArg, manifest) {
      super();
      this.app = appArg ?? app;
      this.manifest = manifest;
    }
    addCommand(cmd) {
      const id = String(cmd.id);
      state.commands.set(id, cmd);
      const run = async () => {
        if (cmd.editorCallback || cmd.editorCheckCallback) {
          return withEditor(async (editor) => {
            currentEditor = editor;
            try {
              const view = workspace.getActiveViewOfType(MarkdownView);
              if (cmd.editorCheckCallback) {
                if (cmd.editorCheckCallback(true, editor, view) !== false) await cmd.editorCheckCallback(false, editor, view);
              } else await cmd.editorCallback(editor, view);
            } finally {
              currentEditor = null;
            }
          });
        }
        if (cmd.checkCallback) {
          return withEditor(async (editor) => {
            currentEditor = editor;
            try {
              if (cmd.checkCallback(true)) await cmd.checkCallback(false);
            } finally {
              currentEditor = null;
            }
          });
        }
        if (cmd.callback) return withEditor(async (editor) => {
          currentEditor = editor;
          try {
            await cmd.callback();
          } finally {
            currentEditor = null;
          }
        });
      };
      // A command's failure is reported, never thrown: an uncaught error would end the whole sandbox.
      const safe = async () => {
        try {
          await run();
          report("command", { id, ok: true });
        } catch (e) {
          report("command", { id, ok: false, error: String(e && e.message ? e.name + ": " + e.message : e).slice(0, 200), missing: [...missing] });
        }
      };
      lumen.commands.register({ id: lumenCommandId(id), label: String(cmd.name || id).slice(0, 80) }, safe);
      state.commands.get(id).__run = run;
      return cmd;
    }
    removeCommand(id) {
      state.commands.delete(id);
    }
    addRibbonIcon(_icon, _title, cb) {
      state.ribbon++;
      const el = new ShimEl("div");
      el.onClickEvent(cb);
      return el;
    }
    addStatusBarItem() {
      state.statusBar++;
      return new ShimEl("div");
    }
    addSettingTab(tab) {
      state.settingTabs.push(tab);
    }
    registerView(type, factory) {
      state.views.push(type);
      this._viewFactories = { ...(this._viewFactories ?? {}), [type]: factory };
    }
    registerExtensions(exts, type) {
      state.extensions.push({ exts, type });
    }
    registerMarkdownPostProcessor(fn) {
      state.postProcessors++;
      return fn;
    }
    registerMarkdownCodeBlockProcessor(lang, fn) {
      state.codeBlocks.push({ lang, fn });
      return fn;
    }
    registerEditorExtension() {
      state.editorExtensions++;
    }
    registerEditorSuggest() {}
    registerObsidianProtocolHandler(action) {
      state.protocol.push(action);
    }
    registerHoverLinkSource() {}
    async loadData() {
      return (await lumen.storage.get("data.json")) ?? null;
    }
    async saveData(d) {
      await lumen.storage.set("data.json", d ?? null);
    }
    onExternalSettingsChange() {}
  }

  class Notice {
    constructor(message, timeout) {
      this.noticeEl = new ShimEl("div");
      this.messageEl = this.noticeEl;
      this.timeout = timeout;
      this.setMessage(message);
    }
    setMessage(m) {
      const text = typeof m === "string" ? m : m && m.textContent ? m.textContent : String(m ?? "");
      if (text) lumen.notifications.show(text.slice(0, 300)).catch(() => undefined);
      return this;
    }
    hide() {}
  }

  class Modal {
    constructor(appArg) {
      this.app = appArg ?? app;
      this.modalEl = new ShimEl("div");
      this.titleEl = this.modalEl.createDiv();
      this.contentEl = this.modalEl.createDiv();
      this.containerEl = this.modalEl;
      this.scope = { register() {}, unregister() {} };
      this.shouldRestoreSelection = false;
    }
    open() {
      state.modalsOpened = (state.modalsOpened ?? 0) + 1;
      if (this.onOpen) return this.onOpen();
    }
    close() {
      if (this.onClose) this.onClose();
    }
    setTitle(t) {
      this.titleEl.setText(t);
      return this;
    }
    setContent(c) {
      this.contentEl.setText(typeof c === "string" ? c : c.textContent);
      return this;
    }
    onOpen() {}
    onClose() {}
  }
  class SuggestModal extends Modal {
    constructor(a) {
      super(a);
      this.inputEl = new ShimEl("input");
      this.resultContainerEl = new ShimEl("div");
      this.limit = 50;
      this.emptyStateText = "";
    }
    setPlaceholder() {}
    setInstructions() {}
  }
  class FuzzySuggestModal extends SuggestModal {}

  // Settings: chainable components over records.
  function moment(input) {
    const d = input instanceof Date ? new Date(input) : input === undefined ? new Date() : new Date(input);
    const pad = (n, w = 2) => String(n).padStart(w, "0");
    const m = {
      _d: d,
      format: (f = "YYYY-MM-DDTHH:mm:ss") =>
        String(f).replace(/YYYY|MM|DD|HH|mm|ss|dddd|ddd|D|M/g, (t) => ({ YYYY: d.getFullYear(), MM: pad(d.getMonth() + 1), DD: pad(d.getDate()), HH: pad(d.getHours()), mm: pad(d.getMinutes()), ss: pad(d.getSeconds()), D: d.getDate(), M: d.getMonth() + 1, dddd: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d.getDay()], ddd: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()] })[t]),
      add: (n, unit) => (String(unit).startsWith("d") ? d.setDate(d.getDate() + n) : d.setTime(d.getTime() + n), m),
      subtract: (n, unit) => m.add(-n, unit),
      isValid: () => !isNaN(d.getTime()),
      toDate: () => d,
      valueOf: () => d.getTime(),
      clone: () => moment(d),
      startOf: () => m,
      endOf: () => m,
      day: () => d.getDay(),
      year: () => d.getFullYear(),
      month: () => d.getMonth(),
      date: () => d.getDate(),
      locale: () => "en",
    };
    return m;
  }
  moment.locale = () => "en";
  moment.locales = () => ["en"];
  moment.isMoment = (x) => !!(x && x._d);
  moment.utc = moment;
  moment.duration = (n) => ({ asMilliseconds: () => n, humanize: () => String(n) });

  const debounce = (fn, ms) => {
    let t = null;
    const d = (...a) => {
      t = a;
      Promise.resolve().then(() => t && fn(...t));
    };
    d.cancel = () => (t = null);
    d.run = () => t && fn(...t);
    return d;
  };

  const obsidian = watch(
    {
      Plugin: es5able(Plugin),
      Component: es5able(Component),
      Events: es5able(Events),
      Notice: es5able(Notice),
      Modal: es5able(Modal),
      SuggestModal: es5able(SuggestModal),
      FuzzySuggestModal: es5able(FuzzySuggestModal),
      Setting: es5able(Setting),
      PluginSettingTab: es5able(PluginSettingTab),
      SettingTab: es5able(PluginSettingTab),
      Menu: es5able(Menu),
      MenuItem: es5able(ValueComponent),
      TAbstractFile: es5able(TAbstractFile),
      TFile: es5able(TFile),
      TFolder: es5able(TFolder),
      Vault: class {},
      MetadataCache: class {},
      Workspace: class {},
      FileManager: class {},
      Editor: es5able(Editor),
      View: es5able(View),
      ItemView: es5able(ItemView),
      FileView: es5able(FileView),
      TextFileView: es5able(TextFileView),
      MarkdownView: es5able(MarkdownView),
      WorkspaceLeaf: es5able(WorkspaceLeaf),
      EditorSuggest: class extends Component {
        constructor(a) {
          super();
          this.app = a;
        }
      },
      AbstractInputSuggest: class {},
      PopoverSuggest: class {},
      MarkdownRenderChild: class extends Component {
        constructor(el) {
          super();
          this.containerEl = el;
        }
      },
      MarkdownRenderer: {
        render: async (_a, md, el) => void el.setText(md),
        renderMarkdown: async (md, el) => void el.setText(md),
      },
      MarkdownPreviewRenderer: { registerPostProcessor() {}, unregisterPostProcessor() {} },
      ButtonComponent: es5able(ValueComponent),
      TextComponent: es5able(ValueComponent),
      TextAreaComponent: es5able(ValueComponent),
      ToggleComponent: es5able(ValueComponent),
      DropdownComponent: es5able(ValueComponent),
      SliderComponent: es5able(ValueComponent),
      ExtraButtonComponent: es5able(ValueComponent),
      SearchComponent: es5able(ValueComponent),
      ColorComponent: es5able(ValueComponent),
      MomentFormatComponent: es5able(ValueComponent),
      ValueComponent,
      BaseComponent: es5able(ValueComponent),
      Scope: class {
        register() {}
        unregister() {}
      },
      Keymap: { isModEvent: () => false, isModifier: () => false },
      Platform: { isDesktop: true, isMobile: false, isDesktopApp: false, isMobileApp: false, isIosApp: false, isAndroidApp: false, isMacOS: false, isWin: false, isLinux: true, isSafari: false, isPhone: false, isTablet: false },
      apiVersion: "1.5.0",
      moment,
      debounce,
      normalizePath: (p) => String(p).replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "") || "/",
      parseYaml,
      stringifyYaml,
      parseFrontMatterTags: (fm) => (fm && fm.tags ? [].concat(fm.tags).map((t) => "#" + String(t).replace(/^#/, "")) : null),
      parseFrontMatterAliases: (fm) => (fm && (fm.aliases || fm.alias) ? [].concat(fm.aliases ?? fm.alias) : null),
      parseFrontMatterEntry: (fm, key) => (fm ? fm[key] ?? null : null),
      parseFrontMatterStringArray: (fm, key) => (fm && fm[key] ? [].concat(fm[key]).map(String) : null),
      getAllTags: (cache) => (cache && cache.tags ? cache.tags.map((t) => t.tag) : []),
      getLinkpath: (l) => String(l).split("#")[0],
      parseLinktext: (l) => ({ path: String(l).split("#")[0], subpath: String(l).includes("#") ? "#" + String(l).split("#")[1] : "" }),
      resolveSubpath: () => null,
      iterateCacheRefs: (cache, cb) => [...(cache.links ?? []), ...(cache.embeds ?? [])].some(cb),
      prepareFuzzySearch: (q) => (text) => (String(text).toLowerCase().includes(String(q).toLowerCase()) ? { score: 0, matches: [] } : null),
      prepareSimpleSearch: (q) => (text) => (String(text).toLowerCase().includes(String(q).toLowerCase()) ? { score: 0, matches: [] } : null),
      fuzzySearch: () => null,
      renderMatches: () => undefined,
      sortSearchResults: () => undefined,
      setIcon: () => undefined,
      getIcon: () => null,
      getIconIds: () => [],
      addIcon: () => undefined,
      setTooltip: () => undefined,
      htmlToMarkdown: (h) => String(h).replace(/<[^>]*>/g, ""),
      sanitizeHTMLToDom: (h) => Object.assign(new ShimEl("#fragment"), { _text: String(h).replace(/<[^>]*>/g, "") }),
      arrayBufferToBase64: () => "",
      base64ToArrayBuffer: () => new ArrayBuffer(0),
      // No network for an Obsidian plugin in Lumen: its manifest grants none.
      requestUrl: () => Promise.reject(new Error("network requests are not available to Obsidian plugins in Lumen")),
      request: () => Promise.reject(new Error("network requests are not available to Obsidian plugins in Lumen")),
      requireApiVersion: (v) => String(v) <= "1.5.0",
      loadMermaid: () => Promise.reject(new Error("not available")),
      loadPdfJs: () => Promise.reject(new Error("not available")),
      loadMathJax: () => Promise.resolve(),
      finishRenderMath: () => Promise.resolve(),
      renderMath: (src) => Object.assign(new ShimEl("span"), { _text: src }),
      editorInfoField: {},
      editorViewField: {},
      editorEditorField: {},
      livePreviewState: {},
    },
    "obsidian",
  );

  // Globals Obsidian defines on window that bundles use bare.
  globalThis.createEl = (tag, o, cb) => {
    const el = new ShimEl(tag, o);
    if (typeof cb === "function") cb(el);
    return el;
  };
  globalThis.createDiv = (o, cb) => globalThis.createEl("div", o, cb);
  globalThis.createSpan = (o, cb) => globalThis.createEl("span", o, cb);
  globalThis.createFragment = (cb) => {
    const f = new ShimEl("#fragment");
    if (cb) cb(f);
    return f;
  };
  globalThis.document = shimDocument;
  globalThis.activeDocument = shimDocument;
  globalThis.window = globalThis;
  globalThis.activeWindow = globalThis;
  globalThis.app = app;
  globalThis.moment = moment;
  globalThis.setTimeout = (fn) => (Promise.resolve().then(() => typeof fn === "function" && fn()), 0);
  globalThis.clearTimeout = () => undefined;
  globalThis.setInterval = () => 0;
  globalThis.clearInterval = () => undefined;
  globalThis.requestAnimationFrame = (fn) => (Promise.resolve().then(() => fn(0)), 0);
  globalThis.navigator = { platform: "Linux", userAgent: "Lumen", language: "en", clipboard: { writeText: (t) => lumen.clipboard.writeText(String(t)), readText: () => Promise.resolve("") } };
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.HTMLElement = ShimEl;
  globalThis.Element = ShimEl;
  globalThis.Node = ShimEl;
  globalThis.DocumentFragment = ShimEl;
  globalThis.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  globalThis.ResizeObserver = globalThis.MutationObserver;
  globalThis.IntersectionObserver = globalThis.MutationObserver;
  globalThis.process = { platform: "linux", env: {} };
  globalThis.self = globalThis;
  // QuickJS has no Intl: enough of it for date and number formatting at load (English, ISO-like).
  if (typeof globalThis.Intl === "undefined") {
    const fmt = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d));
    globalThis.Intl = {
      DateTimeFormat: function () {
        return { format: fmt, formatToParts: (d) => [{ type: "literal", value: fmt(d) }], resolvedOptions: () => ({ locale: "en-US", timeZone: "UTC" }) };
      },
      NumberFormat: function () {
        return { format: (n) => String(n), resolvedOptions: () => ({ locale: "en-US" }) };
      },
      Collator: function () {
        return { compare: (a, b) => (a < b ? -1 : a > b ? 1 : 0) };
      },
      PluralRules: function () {
        return { select: (n) => (n === 1 ? "one" : "other") };
      },
      RelativeTimeFormat: function () {
        return { format: (n, u) => `${n} ${u}` };
      },
      Segmenter: undefined,
      getCanonicalLocales: (l) => [].concat(l ?? []),
    };
  }
  // Ids and nonces only (no secrets are made in an Obsidian plugin here): not a cryptographic source.
  if (typeof globalThis.crypto === "undefined") {
    const hex = () => Math.floor(Math.random() * 16).toString(16);
    globalThis.crypto = {
      getRandomValues: (a) => {
        for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
        return a;
      },
      randomUUID: () => "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, hex),
    };
  }

  const NOT_AVAILABLE = /^(electron|fs|path|os|child_process|crypto|http|https|net|url|util|stream|buffer|events)$|^@codemirror\/|^@lezer\//;
  globalThis.__obsRequire = (name) => {
    if (name === "obsidian") return obsidian;
    if (NOT_AVAILABLE.test(name)) {
      missing.add("require(" + name + ")");
      throw new Error("require('" + name + "') is not available in Lumen's sandbox");
    }
    missing.add("require(" + name + ")");
    throw new Error("require('" + name + "'): unknown module");
  };
  globalThis.__obsidian = obsidian;
  globalThis.__obsApp = app;
  globalThis.__obsShimEl = ShimEl;
  globalThis.__obsBoot = async (active) => {
    // The vault index: every note the plugin may read, loaded once (Obsidian's vault is synchronous).
    const walk = async (dir) => {
      for (const e of await lumen.vault.list(dir)) {
        if (e.kind === "dir") await walk(e.path);
        else addFile(e.path, /\.(md|txt|json|csv|canvas)$/i.test(e.path) ? await lumen.vault.read(e.path) : "");
      }
    };
    try {
      await walk("");
    } catch (e) {
      report("note", { message: "vault not readable: " + String(e) });
    }
    if (active) activeFileName.path = active;
  };
})();
