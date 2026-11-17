// Everything that has to run before the first paint, in one classic,
// render-blocking same-origin script in <head> (W10.E19, plan 8.2; it was
// three files: locale-boot.js, theme-boot.js and note-boot.js). The page CSP
// allows no inline script. Three parts, in order:
//
// 1. The interface language and direction (W4.10).
// 2. The saved theme (C1).
// 3. The last note in the boot shell, editable (W2.21, W10.E20).
// 4. Parallel modulepreload of the start's lazy chunks (W10.E20).

// The interface language and direction, set before the first paint (plan
// W4.10): the saved choice; else Hebrew if the system lists it at all
// (W4.35); else the first supported language of the system
// (navigator.languages); else English. The page itself is written
// lang="he" dir="rtl" (Hebrew first, and right without JavaScript).
// Mirrors detectLocale() in src/i18n/detect.ts (src/__tests__/
// hebrewFirstLoad.test.ts runs both on the same inputs).
(function () {
  var SUPPORTED = { en: "ltr", he: "rtl", ar: "rtl", ru: "ltr", fr: "ltr", de: "ltr", ja: "ltr", "zh-CN": "ltr", fa: "rtl" };
  function pick(saved, languages) {
    if (saved && Object.prototype.hasOwnProperty.call(SUPPORTED, saved)) return saved;
    // Plan W4.35: Hebrew anywhere in the system's list wins.
    for (var h = 0; h < (languages || []).length; h++) {
      if (/^(he|iw)(-|$)/i.test(String(languages[h] || ""))) return "he";
    }
    for (var i = 0; i < (languages || []).length; i++) {
      var tag = String(languages[i] || "").toLowerCase();
      var base = tag.split("-")[0];
      if (base === "iw") base = "he"; // the old code for Hebrew
      if (base === "zh") {
        // Simplified Chinese only (zh-CN, zh-Hans, zh-SG, plain zh).
        if (!/-(tw|hk|mo|hant)\b/.test(tag)) return "zh-CN";
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(SUPPORTED, base)) return base;
    }
    return "en";
  }
  var saved = null;
  try {
    var raw = localStorage.getItem("lumen-md");
    var s = raw ? JSON.parse(raw) : null;
    saved = s && s.state && s.state.locale;
  } catch (e) {
    /* storage unavailable or corrupt */
  }
  var langs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
  var locale = pick(saved, langs);
  var el = document.documentElement;
  el.lang = locale;
  el.dir = SUPPORTED[locale];
  // Read by initLocale(), so the app starts in the same language without a flip.
  window.__lumenBootLocale = locale;
  window.__lumenPickLocale = pick;
})();

// Apply the saved theme before the boot shell paints (C1). Mirrors applyTheme() in src/store/useStore.ts — "dark" (the default),
// "light", or "system" (the OS preference); App re-applies it on start.
(function () {
  var theme = "dark";
  try {
    var raw = localStorage.getItem("lumen-md");
    var saved = raw ? JSON.parse(raw) : null;
    var t = saved && saved.state && saved.state.theme;
    if (t === "light" || t === "dark" || t === "system") theme = t;
  } catch (e) {
    /* storage unavailable or corrupt: keep the default */
  }
  var dark = theme === "dark";
  if (theme === "system") {
    try {
      dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    } catch (e) {
      dark = true;
    }
  }
  document.documentElement.classList.toggle("dark", dark);
})();

// The last note, painted before the bundle loads (plan W2.21), and editable
// at once (W10.E20): it reads the note the app already keeps in localStorage
// ("lumen-md", the persisted store — no new copy is stored anywhere) and puts
// its beginning in a plain <textarea> in the boot shell, so a cold start
// shows the user's own note at once and takes typing before the app has
// loaded. Text only (a textarea's value), never HTML. A long note shows its
// first MAX_CHARS characters; the rest is kept aside and put back after them.
// src/boot/bootNote.ts hands what was typed to the editor before React
// replaces the shell (window.__lumenBootNote). This runs in <head>, before
// the shell exists, so it fills the shell as soon as the parser inserts it:
// mutation records are delivered at the end of the parser's task, before
// the next paint.
(function () {
  var MAX_CHARS = 4000;
  function paint(page) {
    var text = "";
    var name = "";
    var rtl = false;
    try {
      var raw = localStorage.getItem("lumen-md");
      var saved = raw ? JSON.parse(raw) : null;
      var s = saved && saved.state;
      if (s && s.doc && typeof s.doc.content === "string") text = s.doc.content;
      if (s && s.doc && typeof s.doc.name === "string") name = s.doc.name;
      rtl = !!(s && s.rtl);
    } catch (e) {
      /* storage unavailable or corrupt: keep the skeleton */
      return;
    }
    if (!text.trim()) return;
    var head = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;
    var note = document.createElement("textarea");
    note.className = "boot-note";
    note.setAttribute("dir", rtl ? "rtl" : "auto");
    note.setAttribute("spellcheck", "false");
    if (name) note.setAttribute("aria-label", name);
    note.value = head;
    page.textContent = "";
    page.appendChild(note);
    // The note can be typed in: the shell is no longer decoration.
    var shell = page.closest ? page.closest(".boot-shell") : null;
    if (shell) shell.removeAttribute("aria-hidden");
    window.__lumenBootNote = { el: note, name: name, base: text, tail: text.slice(head.length) };
    note.addEventListener("input", function () {
      document.documentElement.setAttribute("data-boot-edited", "");
    });
    // Read by e2e/cold-start.spec.ts (the shell showed the note before the
    // app started) and by index.html's CSS, which hides skeleton bars the
    // parser adds after this ran.
    document.documentElement.setAttribute("data-boot-note", "");
  }
  function find() {
    return document.querySelector ? document.querySelector(".boot-shell .boot-page") : null;
  }
  var page = find();
  if (page) return paint(page);
  if (typeof MutationObserver !== "function" || !document.documentElement) return;
  var mo = new MutationObserver(function () {
    var p = find();
    if (!p) return;
    mo.disconnect();
    paint(p);
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("DOMContentLoaded", function () {
    mo.disconnect();
  });
})();

// The chunks the start will load, fetched in parallel now rather than one
// after another (W10.E20): the build writes their list into the page
// (#lumen-boot-preload, src/build/bootPreload.ts), and this picks the ones
// this start needs: the vault's, the saved language's strings, and the
// editor of the saved view. Without the list (the dev server) it does nothing.
(function () {
  var data = null;
  try {
    var tag = document.getElementById("lumen-boot-preload");
    data = tag ? JSON.parse(tag.textContent || "null") : null;
  } catch (e) {
    return;
  }
  if (!data || typeof data !== "object") return;
  var mode = "";
  try {
    var raw = localStorage.getItem("lumen-md");
    var saved = raw ? JSON.parse(raw) : null;
    mode = (saved && saved.state && saved.state.mode) || "";
  } catch (e) {
    /* storage unavailable or corrupt: no saved view */
  }
  var files = [].concat(data.always || []);
  var locale = window.__lumenBootLocale;
  if (locale && data.locales && data.locales[locale]) files = files.concat(data.locales[locale]);
  // The view the app opens in; with none saved, defaultMode() in src/store/useStore.ts (Preview under 768 px, else Split).
  if (!mode) mode = (window.innerWidth || 1280) < 768 ? "preview" : "split";
  var editor = mode === "source" || mode === "split" ? "source" : mode === "wysiwyg" ? "wysiwyg" : "";
  if (editor && data.editors && data.editors[editor]) files = files.concat(data.editors[editor]);
  var seen = {};
  for (var i = 0; i < files.length; i++) {
    var href = files[i];
    if (typeof href !== "string" || seen[href] || !/^\/(?!\/)[\w\-./]+\.js$/.test(href)) continue;
    seen[href] = true;
    var link = document.createElement("link");
    link.rel = "modulepreload";
    link.href = href;
    link.setAttribute("crossorigin", "");
    document.head.appendChild(link);
  }
})();
