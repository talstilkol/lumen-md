// Everything that has to run before the first paint, in one classic,
// render-blocking same-origin script in <head> (W10.E19, plan 8.2; it was
// three files: locale-boot.js, theme-boot.js and note-boot.js). The page CSP
// allows no inline script. Three parts, in order:
//
// 1. The interface language and direction (W4.10).
// 2. The saved theme (C1).
// 3. The last note in the boot shell (W2.21).

// The interface language and direction, set before the first paint (plan
// W4.10): the saved choice; else Hebrew if the system lists it at all
// (W4.35); else the first supported language of the system
// (navigator.languages); else English. The page itself is written
// lang="he" dir="rtl" (Hebrew first, and right without JavaScript).
// Mirrors detectLocale() in src/i18n/detect.ts (src/__tests__/
// hebrewFirstLoad.test.ts runs both on the same inputs).
(function () {
  var SUPPORTED = { en: "ltr", he: "rtl", ar: "rtl", ru: "ltr", fr: "ltr", de: "ltr", ja: "ltr", "zh-CN": "ltr" };
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

// The last note, painted before the bundle loads (plan W2.21): it reads the
// note the app already keeps in localStorage ("lumen-md", the persisted
// store — no new copy is stored anywhere) and shows its beginning as plain
// text in the boot shell, so a cold start shows the user's own note at once
// instead of skeleton bars. React replaces the whole shell on its first
// render. Text only (textContent), never HTML. This runs in <head>, before
// the shell exists, so it fills the shell as soon as the parser inserts it:
// mutation records are delivered at the end of the parser's task, before
// the next paint.
(function () {
  var MAX_CHARS = 4000;
  function paint(page) {
    var text = "";
    var rtl = false;
    try {
      var raw = localStorage.getItem("lumen-md");
      var saved = raw ? JSON.parse(raw) : null;
      var s = saved && saved.state;
      if (s && s.doc && typeof s.doc.content === "string") text = s.doc.content;
      rtl = !!(s && s.rtl);
    } catch (e) {
      /* storage unavailable or corrupt: keep the skeleton */
      return;
    }
    if (!text.trim()) return;
    var note = document.createElement("pre");
    note.className = "boot-note";
    note.setAttribute("dir", rtl ? "rtl" : "auto");
    note.textContent = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;
    page.textContent = "";
    page.appendChild(note);
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
