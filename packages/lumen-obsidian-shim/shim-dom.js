/*
 * Lumen's Obsidian compatibility layer (plan W13.L3), part: records instead of the DOM, events, missing-API tracking. MIT.
 * The parts run in order (wrap.mjs): shim-dom.js, shim-vault.js, shim.js; they share names through
 * globalThis.__obsK, which the last part deletes.
 */
(function () {
  "use strict";
  const missing = new Set();
  const report = (kind, data) => console.log("__obs " + JSON.stringify({ kind, ...data }));
  globalThis.__obsReport = report;
  globalThis.__obsMissing = missing;

  /** A record of anything not implemented: reading it returns undefined and is counted. */
  function watch(obj, name) {
    return new Proxy(obj, {
      get(t, k, r) {
        if (typeof k === "symbol" || k in t) return Reflect.get(t, k, r);
        if (k === "then" || k === "toJSON" || k === "constructor") return undefined;
        missing.add(name + "." + String(k));
        return undefined;
      },
    });
  }

  /**
   * Obsidian's classes are callable the ES5 way: a plugin compiled to ES5 runs `_super.apply(this, arguments)`,
   * which a JavaScript class refuses. The wrapper builds the instance and copies it onto `this`.
   */
  function es5able(C) {
    function F(...args) {
      if (!new.target) {
        const inst = Reflect.construct(C, args, this && this.constructor ? this.constructor : C);
        Object.assign(this, inst);
        return this;
      }
      return Reflect.construct(C, args, new.target);
    }
    F.prototype = C.prototype;
    Object.setPrototypeOf(F, C);
    Object.defineProperty(F, "name", { value: C.name });
    return F;
  }

  // ── Events ────────────────────────────────────────────────────────────
  class Events {
    constructor() {
      this._ev = new Map();
    }
    on(name, cb, ctx) {
      const ref = { e: this, name, cb, ctx };
      const list = this._ev.get(name) ?? [];
      list.push(ref);
      this._ev.set(name, list);
      return ref;
    }
    off(name, cb) {
      this._ev.set(name, (this._ev.get(name) ?? []).filter((r) => r.cb !== cb));
    }
    offref(ref) {
      if (ref && ref.e === this) this.off(ref.name, ref.cb);
    }
    trigger(name, ...args) {
      for (const r of this._ev.get(name) ?? []) r.cb.apply(r.ctx, args);
    }
    tryTrigger(ref, args) {
      try {
        ref.cb.apply(ref.ctx, args);
      } catch (e) {
        report("error", { where: "event " + ref.name, message: String(e) });
      }
    }
  }

  // ── Elements: a record tree, no DOM ───────────────────────────────────
  class ShimEl {
    constructor(tag, o) {
      this.tagName = String(tag || "div").toUpperCase();
      this.children = [];
      this.attrs = {};
      this.classList = new Set();
      this.style = {};
      this.dataset = {};
      this._text = "";
      this.parentElement = null;
      this.listeners = [];
      this.value = "";
      this.checked = false;
      this.disabled = false;
      if (o) this._opts(o);
      return watch(this, "HTMLElement");
    }
    _opts(o) {
      if (typeof o === "string") return this.addClass(o);
      if (o.cls) [].concat(o.cls).forEach((c) => this.addClass(c));
      if (o.text !== undefined) this.setText(o.text);
      if (o.attr) for (const k of Object.keys(o.attr)) this.setAttr(k, o.attr[k]);
      if (o.title) this.setAttr("title", o.title);
      if (o.type) this.setAttr("type", o.type);
      if (o.value !== undefined) this.value = String(o.value);
      if (o.placeholder) this.setAttr("placeholder", o.placeholder);
      if (o.href) this.setAttr("href", o.href);
    }
    get textContent() {
      return this._text + this.children.map((c) => c.textContent).join("");
    }
    set textContent(v) {
      this.children = [];
      this._text = v == null ? "" : String(v);
    }
    get innerText() {
      return this.textContent;
    }
    set innerText(v) {
      this.textContent = v;
    }
    set innerHTML(v) {
      this.textContent = String(v).replace(/<[^>]*>/g, "");
    }
    get innerHTML() {
      return this.textContent;
    }
    get className() {
      return [...this.classList].join(" ");
    }
    set className(v) {
      this.classList = new Set(String(v).split(/\s+/).filter(Boolean));
    }
    get firstChild() {
      return this.children[0] ?? null;
    }
    get lastChild() {
      return this.children[this.children.length - 1] ?? null;
    }
    get childElementCount() {
      return this.children.length;
    }
    createEl(tag, o, cb) {
      const el = new ShimEl(tag, o);
      this.appendChild(el);
      if (typeof cb === "function") cb(el);
      return el;
    }
    createDiv(o, cb) {
      return this.createEl("div", o, cb);
    }
    createSpan(o, cb) {
      return this.createEl("span", o, cb);
    }
    createSvg(tag, o, cb) {
      return this.createEl(tag, o, cb);
    }
    appendChild(el) {
      if (el && el.parentElement) el.remove();
      if (el) {
        el.parentElement = this;
        this.children.push(el);
      }
      return el;
    }
    append(...els) {
      for (const e of els) this.appendChild(typeof e === "string" ? Object.assign(new ShimEl("#text"), { _text: e }) : e);
    }
    prepend(...els) {
      for (const e of els.reverse()) {
        const el = typeof e === "string" ? Object.assign(new ShimEl("#text"), { _text: e }) : e;
        el.parentElement = this;
        this.children.unshift(el);
      }
    }
    insertBefore(el, ref) {
      const i = this.children.indexOf(ref);
      el.parentElement = this;
      if (i < 0) this.children.push(el);
      else this.children.splice(i, 0, el);
      return el;
    }
    remove() {
      if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((c) => c !== this);
      this.parentElement = null;
    }
    detach() {
      this.remove();
    }
    empty() {
      this.children = [];
      this._text = "";
    }
    setText(t) {
      this.textContent = t;
      return this;
    }
    appendText(t) {
      this.append(String(t));
    }
    addClass(...c) {
      c.flat().forEach((x) => String(x).split(/\s+/).filter(Boolean).forEach((y) => this.classList.add(y)));
      return this;
    }
    addClasses(c) {
      return this.addClass(...c);
    }
    removeClass(...c) {
      c.flat().forEach((x) => this.classList.delete(x));
      return this;
    }
    toggleClass(c, on) {
      [].concat(c).forEach((x) => (on ? this.classList.add(x) : this.classList.delete(x)));
      return this;
    }
    hasClass(c) {
      return this.classList.has(c);
    }
    setAttr(k, v) {
      if (v === null) delete this.attrs[k];
      else this.attrs[k] = String(v);
      return this;
    }
    setAttrs(o) {
      for (const k of Object.keys(o)) this.setAttr(k, o[k]);
    }
    getAttr(k) {
      return this.attrs[k] ?? null;
    }
    setAttribute(k, v) {
      this.setAttr(k, v);
    }
    getAttribute(k) {
      return this.getAttr(k);
    }
    removeAttribute(k) {
      delete this.attrs[k];
    }
    hasAttribute(k) {
      return k in this.attrs;
    }
    toggle(show) {
      this.style.display = show ? "" : "none";
    }
    show() {
      this.style.display = "";
    }
    hide() {
      this.style.display = "none";
    }
    isShown() {
      return this.style.display !== "none";
    }
    setCssStyles(s) {
      Object.assign(this.style, s);
    }
    setCssProps(s) {
      Object.assign(this.style, s);
    }
    on(type, sel, cb) {
      this.listeners.push({ type, cb: cb ?? sel });
    }
    off() {}
    onClickEvent(cb) {
      this.listeners.push({ type: "click", cb });
    }
    addEventListener(type, cb) {
      this.listeners.push({ type, cb });
    }
    removeEventListener(type, cb) {
      this.listeners = this.listeners.filter((l) => l.type !== type || l.cb !== cb);
    }
    querySelector() {
      return null;
    }
    querySelectorAll() {
      return [];
    }
    find() {
      return null;
    }
    findAll() {
      return [];
    }
    closest() {
      return null;
    }
    contains(el) {
      return el === this || this.children.some((c) => c.contains(el));
    }
    focus() {}
    blur() {}
    click() {
      for (const l of this.listeners.filter((x) => x.type === "click")) l.cb({ target: this, preventDefault() {}, stopPropagation() {} });
    }
    getBoundingClientRect() {
      return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
    }
    scrollIntoView() {}
    get doc() {
      return shimDocument;
    }
    get win() {
      return globalThis;
    }
  }
  const shimDocument = watch(
    {
      body: new ShimEl("body"),
      head: new ShimEl("head"),
      documentElement: new ShimEl("html"),
      createElement: (t) => new ShimEl(t),
      createElementNS: (_ns, t) => new ShimEl(t),
      createDocumentFragment: () => new ShimEl("#fragment"),
      createTextNode: (t) => Object.assign(new ShimEl("#text"), { _text: String(t) }),
      querySelector: () => null,
      querySelectorAll: () => [],
      getElementById: () => null,
      getElementsByClassName: () => [],
      addEventListener() {},
      removeEventListener() {},
      activeElement: null,
    },
    "document",
  );

  globalThis.__obsK = Object.assign(globalThis.__obsK ?? {}, { missing, report, watch, es5able, Events, ShimEl, shimDocument });
})();
