/*
 * Lumen's Obsidian compatibility layer (plan W13.L3), part: files, vault, metadata cache, editor, settings components. MIT.
 * The parts run in order (wrap.mjs): shim-dom.js, shim-vault.js, shim.js; they share names through
 * globalThis.__obsK, which the last part deletes.
 */
(function () {
  "use strict";
  const { missing, report, watch, es5able, Events, ShimEl } = globalThis.__obsK;
  // ── Files ─────────────────────────────────────────────────────────────
  class TAbstractFile {
    constructor(path) {
      this.path = path;
      this.name = path.split("/").pop();
      this.parent = null;
      this.vault = null;
    }
  }
  class TFile extends TAbstractFile {
    constructor(path, size) {
      super(path);
      const dot = this.name.lastIndexOf(".");
      this.basename = dot > 0 ? this.name.slice(0, dot) : this.name;
      this.extension = dot > 0 ? this.name.slice(dot + 1) : "";
      this.stat = { ctime: 0, mtime: 0, size: size || 0 };
    }
  }
  class TFolder extends TAbstractFile {
    constructor(path) {
      super(path);
      this.children = [];
    }
    isRoot() {
      return this.path === "/" || this.path === "";
    }
  }

  // ── Vault and metadata over lumen.vault ───────────────────────────────
  const texts = new Map();
  const files = new Map();
  const root = new TFolder("/");
  const folderOf = (path) => {
    const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    if (!dir) return root;
    let f = files.get(dir);
    if (!f) {
      f = new TFolder(dir);
      files.set(dir, f);
      const up = folderOf(dir);
      f.parent = up;
      up.children.push(f);
    }
    return f;
  };
  const addFile = (path, text) => {
    texts.set(path, text);
    let f = files.get(path);
    if (!f) {
      f = new TFile(path, text.length);
      files.set(path, f);
      const dir = folderOf(path);
      f.parent = dir;
      dir.children.push(f);
    }
    f.stat.size = text.length;
    f.stat.mtime = Date.now();
    return f;
  };
  const pathOf = (f) => (typeof f === "string" ? f : f && f.path);

  function parseYaml(src) {
    // Enough of YAML for front matter: key: value, lists (- x and [a, b]), quoted strings, numbers, booleans.
    const out = {};
    let key = null;
    for (const raw of String(src).split("\n")) {
      if (!raw.trim() || raw.trim().startsWith("#")) continue;
      const item = /^\s+-\s*(.*)$/.exec(raw);
      if (item && key) {
        if (!Array.isArray(out[key])) out[key] = [];
        out[key].push(scalar(item[1]));
        continue;
      }
      const m = /^([^:#][^:]*):\s*(.*)$/.exec(raw);
      if (!m) continue;
      key = m[1].trim();
      const v = m[2].trim();
      out[key] = v === "" ? null : /^\[.*\]$/.test(v) ? v.slice(1, -1).split(",").map((x) => scalar(x.trim())).filter((x) => x !== "") : scalar(v);
    }
    return out;
  }
  function scalar(v) {
    if (/^(['"]).*\1$/.test(v)) return v.slice(1, -1);
    if (v === "true" || v === "false") return v === "true";
    if (v === "null" || v === "~") return null;
    if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
    return v;
  }
  function stringifyYaml(o) {
    return Object.keys(o)
      .map((k) => (Array.isArray(o[k]) ? `${k}:\n${o[k].map((x) => `  - ${x}`).join("\n")}` : `${k}: ${o[k] === null ? "" : o[k]}`))
      .join("\n") + "\n";
  }
  function cacheOf(text) {
    const lines = String(text).split("\n");
    const cache = { headings: [], tags: [], links: [], embeds: [], listItems: [], sections: [] };
    let off = 0;
    let body = 0;
    if (lines[0] === "---") {
      const end = lines.indexOf("---", 1);
      if (end > 0) {
        cache.frontmatter = parseYaml(lines.slice(1, end).join("\n"));
        cache.frontmatterPosition = { start: { line: 0, col: 0, offset: 0 }, end: { line: end, col: 3, offset: lines.slice(0, end + 1).join("\n").length } };
        body = end + 1;
        off = lines.slice(0, body).join("\n").length + 1;
      }
    }
    for (let i = body; i < lines.length; i++) {
      const line = lines[i];
      const pos = (s, e) => ({ start: { line: i, col: s, offset: off + s }, end: { line: i, col: e, offset: off + e } });
      const h = /^(#{1,6})\s+(.*)$/.exec(line);
      if (h) cache.headings.push({ heading: h[2], level: h[1].length, position: pos(0, line.length) });
      for (const m of line.matchAll(/(^|\s)(#[\p{L}\p{N}_/-]+)/gu)) cache.tags.push({ tag: m[2], position: pos(m.index + m[1].length, m.index + m[0].length) });
      for (const m of line.matchAll(/(!?)\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g)) (m[1] ? cache.embeds : cache.links).push({ link: m[2], original: m[0], displayText: m[3] ?? m[2], position: pos(m.index, m.index + m[0].length) });
      const li = /^(\s*)([-*+]|\d+[.)])\s+(\[(.)\]\s+)?/.exec(line);
      if (li) cache.listItems.push({ parent: -1, task: li[4], position: pos(0, line.length) });
      off += line.length + 1;
    }
    if (cache.frontmatter && cache.frontmatter.tags) for (const t of [].concat(cache.frontmatter.tags)) cache.tags.push({ tag: "#" + String(t).replace(/^#/, ""), position: null });
    return cache;
  }

  const vaultEvents = new Events();
  const vault = watch(
    Object.assign(vaultEvents, {
      configDir: ".obsidian",
      adapter: watch(
        {
          exists: async (p) => texts.has(p) || files.has(p),
          read: async (p) => {
            if (!texts.has(p)) throw new Error("ENOENT: " + p);
            return texts.get(p);
          },
          write: async (p, d) => void (await vault.modify(addFile(p, ""), d)),
          list: async () => ({ files: [...texts.keys()], folders: [...files.values()].filter((f) => f instanceof TFolder).map((f) => f.path) }),
          getName: () => "vault",
          stat: async (p) => (files.get(p) ? { type: "file", ...files.get(p).stat } : null),
          mkdir: async () => undefined,
          remove: async () => undefined,
          getResourcePath: (p) => "app://local/" + p,
        },
        "app.vault.adapter",
      ),
      getName: () => "vault",
      getRoot: () => root,
      getFiles: () => [...files.values()].filter((f) => f instanceof TFile),
      getMarkdownFiles: () => [...files.values()].filter((f) => f instanceof TFile && f.extension === "md"),
      getAllLoadedFiles: () => [root, ...files.values()],
      getAllFolders: () => [...files.values()].filter((f) => f instanceof TFolder),
      getAbstractFileByPath: (p) => (p === "/" || p === "" ? root : files.get(p) ?? null),
      getFileByPath: (p) => (files.get(p) instanceof TFile ? files.get(p) : null),
      getFolderByPath: (p) => (p === "/" || p === "" ? root : files.get(p) instanceof TFolder ? files.get(p) : null),
      read: async (f) => texts.get(pathOf(f)) ?? "",
      cachedRead: async (f) => texts.get(pathOf(f)) ?? "",
      modify: async (f, data) => {
        const p = pathOf(f);
        await lumen.vault.write(p, String(data));
        addFile(p, String(data));
        vaultEvents.trigger("modify", files.get(p));
      },
      process: async (f, fn) => {
        const p = pathOf(f);
        const next = fn(texts.get(p) ?? "");
        await vault.modify(f, next);
        return next;
      },
      append: async (f, data) => vault.modify(f, (texts.get(pathOf(f)) ?? "") + data),
      create: async (p, data) => {
        if (texts.has(p)) throw new Error("File already exists.");
        await lumen.vault.write(p, String(data));
        const f = addFile(p, String(data));
        vaultEvents.trigger("create", f);
        return f;
      },
      createFolder: async (p) => folderOf(p + "/x"),
      delete: async () => {
        throw new Error("deleting files is not available to Obsidian plugins in Lumen");
      },
      trash: async () => {
        throw new Error("deleting files is not available to Obsidian plugins in Lumen");
      },
      rename: async () => {
        throw new Error("renaming files is not available to Obsidian plugins in Lumen");
      },
      getResourcePath: (f) => "app://local/" + pathOf(f),
      getConfig: (k) => ({ useMarkdownLinks: false, newLinkFormat: "shortest", attachmentFolderPath: "/" })[k],
    }),
    "app.vault",
  );

  const metaEvents = new Events();
  const caches = new Map();
  const metadataCache = watch(
    Object.assign(metaEvents, {
      resolvedLinks: {},
      unresolvedLinks: {},
      getFileCache: (f) => {
        const p = pathOf(f);
        if (!texts.has(p)) return null;
        if (!caches.has(p) || caches.get(p).text !== texts.get(p)) caches.set(p, { text: texts.get(p), cache: cacheOf(texts.get(p)) });
        return caches.get(p).cache;
      },
      getCache: (p) => metadataCache.getFileCache(p),
      getFirstLinkpathDest: (link) => {
        const name = String(link).split("#")[0];
        return [...files.values()].find((f) => f instanceof TFile && (f.path === name || f.path === name + ".md" || f.basename === name)) ?? null;
      },
      fileToLinktext: (f) => f.basename,
      getTags: () => {
        const out = {};
        for (const f of vault.getMarkdownFiles()) for (const t of metadataCache.getFileCache(f).tags) out[t.tag] = (out[t.tag] ?? 0) + 1;
        return out;
      },
      getBacklinksForFile: () => ({ data: new Map(), keys: () => [] }),
    }),
    "app.metadataCache",
  );

  // ── Editor over lumen.document ────────────────────────────────────────
  const posToOffset = (text, pos) => {
    const lines = text.split("\n");
    let o = 0;
    for (let i = 0; i < Math.min(pos.line, lines.length); i++) o += lines[i].length + 1;
    return Math.min(text.length, o + Math.min(pos.ch, (lines[pos.line] ?? "").length));
  };
  const offsetToPos = (text, off) => {
    const before = text.slice(0, off).split("\n");
    return { line: before.length - 1, ch: before[before.length - 1].length };
  };
  class Editor {
    constructor(text, sel) {
      this._text = text;
      this._anchor = sel ? sel.from : 0;
      this._head = sel ? sel.to : 0;
      this._start = text;
    }
    getValue() {
      return this._text;
    }
    setValue(v) {
      this._text = String(v);
    }
    getLine(n) {
      return this._text.split("\n")[n] ?? "";
    }
    setLine(n, t) {
      const lines = this._text.split("\n");
      lines[n] = t;
      this._text = lines.join("\n");
    }
    lineCount() {
      return this._text.split("\n").length;
    }
    lastLine() {
      return this.lineCount() - 1;
    }
    getSelection() {
      return this._text.slice(Math.min(this._anchor, this._head), Math.max(this._anchor, this._head));
    }
    somethingSelected() {
      return this._anchor !== this._head;
    }
    getRange(from, to) {
      return this._text.slice(posToOffset(this._text, from), posToOffset(this._text, to));
    }
    replaceSelection(t) {
      const a = Math.min(this._anchor, this._head);
      const b = Math.max(this._anchor, this._head);
      this._text = this._text.slice(0, a) + t + this._text.slice(b);
      this._anchor = this._head = a + String(t).length;
    }
    replaceRange(t, from, to) {
      const a = posToOffset(this._text, from);
      const b = to ? posToOffset(this._text, to) : a;
      this._text = this._text.slice(0, a) + t + this._text.slice(b);
    }
    getCursor(which) {
      return offsetToPos(this._text, which === "from" || which === "anchor" ? Math.min(this._anchor, this._head) : this._head);
    }
    setCursor(pos, ch) {
      const p = typeof pos === "number" ? { line: pos, ch: ch ?? 0 } : pos;
      this._anchor = this._head = posToOffset(this._text, p);
    }
    setSelection(a, b) {
      this._anchor = posToOffset(this._text, a);
      this._head = posToOffset(this._text, b ?? a);
    }
    listSelections() {
      return [{ anchor: offsetToPos(this._text, this._anchor), head: offsetToPos(this._text, this._head) }];
    }
    posToOffset(p) {
      return posToOffset(this._text, p);
    }
    offsetToPos(o) {
      return offsetToPos(this._text, o);
    }
    transaction(tx) {
      for (const c of tx.changes ?? []) this.replaceRange(c.text, c.from, c.to);
    }
    focus() {}
    blur() {}
    hasFocus() {
      return true;
    }
    scrollIntoView() {}
    refresh() {}
    getDoc() {
      return this;
    }
    exec() {}
    /** The change as one edit: common prefix and suffix kept (Lumen's API 1.1 applyEdits). */
    _edit() {
      const a = this._start;
      const b = this._text;
      if (a === b) return null;
      let s = 0;
      while (s < a.length && s < b.length && a[s] === b[s]) s++;
      let e = 0;
      while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
      return { from: s, to: a.length - e, insert: b.slice(s, b.length - e) };
    }
  }

  class ValueComponent {
    constructor(el) {
      this.disabled = false;
      this._value = undefined;
      this._change = null;
      this.inputEl = el ?? new ShimEl("input");
      this.selectEl = this.inputEl;
      this.toggleEl = this.inputEl;
      this.buttonEl = this.inputEl;
      this.sliderEl = this.inputEl;
      this.extraSettingsEl = this.inputEl;
    }
    setValue(v) {
      this._value = v;
      return this;
    }
    getValue() {
      return this._value;
    }
    onChange(cb) {
      this._change = cb;
      return this;
    }
    setPlaceholder() {
      return this;
    }
    setDisabled(d) {
      this.disabled = d;
      return this;
    }
    setTooltip() {
      return this;
    }
    setButtonText() {
      return this;
    }
    setCta() {
      return this;
    }
    setWarning() {
      return this;
    }
    setIcon() {
      return this;
    }
    setClass() {
      return this;
    }
    onClick(cb) {
      this._click = cb;
      return this;
    }
    addOption(v, label) {
      (this._options ??= []).push([v, label]);
      return this;
    }
    addOptions(o) {
      for (const k of Object.keys(o)) this.addOption(k, o[k]);
      return this;
    }
    setLimits() {
      return this;
    }
    setDynamicTooltip() {
      return this;
    }
    setDefaultFormat() {
      return this;
    }
    setSampleEl() {
      return this;
    }
    registerOptionListener() {
      return this;
    }
    then(cb) {
      cb(this);
      return this;
    }
  }
  class Setting {
    constructor(containerEl) {
      this.settingEl = (containerEl ?? new ShimEl("div")).createDiv({ cls: "setting-item" });
      this.infoEl = this.settingEl.createDiv();
      this.nameEl = this.infoEl.createDiv();
      this.descEl = this.infoEl.createDiv();
      this.controlEl = this.settingEl.createDiv();
      this.components = [];
    }
    setName(n) {
      this.nameEl.setText(typeof n === "string" ? n : n && n.textContent);
      return this;
    }
    setDesc(d) {
      this.descEl.setText(typeof d === "string" ? d : d && d.textContent);
      return this;
    }
    setHeading() {
      return this;
    }
    setClass(c) {
      this.settingEl.addClass(c);
      return this;
    }
    setTooltip() {
      return this;
    }
    setDisabled() {
      return this;
    }
    then(cb) {
      cb(this);
      return this;
    }
    _add(cb) {
      const c = new ValueComponent(this.controlEl.createEl("input"));
      this.components.push(c);
      if (cb) cb(c);
      return this;
    }
    addText(cb) {
      return this._add(cb);
    }
    addTextArea(cb) {
      return this._add(cb);
    }
    addSearch(cb) {
      return this._add(cb);
    }
    addToggle(cb) {
      return this._add(cb);
    }
    addDropdown(cb) {
      return this._add(cb);
    }
    addButton(cb) {
      return this._add(cb);
    }
    addExtraButton(cb) {
      return this._add(cb);
    }
    addSlider(cb) {
      return this._add(cb);
    }
    addColorPicker(cb) {
      return this._add(cb);
    }
    addMomentFormat(cb) {
      return this._add(cb);
    }
    addProgressBar(cb) {
      return this._add(cb);
    }
    addComponent(cb) {
      return this._add(cb);
    }
  }
  class PluginSettingTab {
    constructor(appArg, plugin) {
      this.app = appArg ?? app;
      this.plugin = plugin;
      this.containerEl = new ShimEl("div");
    }
    display() {}
    hide() {}
  }
  class Menu {
    constructor() {
      this.items = [];
    }
    addItem(cb) {
      const item = new ValueComponent();
      Object.assign(item, { setTitle: () => item, setSection: () => item, setChecked: () => item, setSubmenu: () => new Menu() });
      cb(item);
      this.items.push(item);
      return this;
    }
    addSeparator() {
      return this;
    }
    showAtMouseEvent() {}
    showAtPosition() {}
    hide() {}
    onHide() {}
  }

  // A small moment: what plugins call at load (format with YYYY MM DD HH mm ss; add/subtract days).
  globalThis.__obsK = Object.assign(globalThis.__obsK ?? {}, { TAbstractFile, TFile, TFolder, texts, files, root, addFile, pathOf, parseYaml, stringifyYaml, cacheOf, vault, metadataCache, posToOffset, offsetToPos, Editor, ValueComponent, Setting, PluginSettingTab, Menu, folderOf });
})();
