/**
 * HTML and SVG outputs of a notebook, made safe to show (plan W12.F4).
 *
 * The sanitizer (the `lumen` Trusted Types policy, DOMPurify) removes what
 * could run: `<script>`, event handlers, `javascript:` URLs. It keeps what
 * could *load*: an `<img src="https://…">` in a pandas or plotly output is
 * a request to a third party the moment the notebook is opened, which is a
 * tracking pixel in a file someone sent you. Nothing leaves the device
 * without consent (privacy ledger), so every URL that would be fetched is
 * dropped here, in an inert document, before the markup reaches the page:
 * only `data:` and `blob:` sources stay. The count of what was held back is
 * returned so the viewer can say so.
 *
 * An image left without a text alternative gets a generic one, so a screen
 * reader says "image" instead of reading out a file name.
 */
import { parseInertDocument, toTrustedHTML, type HtmlKind } from "../lib/trustedTypes";

/** Sources that are already on the device. Anything else would be a request. */
const LOCAL = /^\s*(?:data:|blob:|#)/i;
/** Attributes that make the browser fetch something. */
const FETCH_ATTRS = ["src", "srcset", "poster", "background", "lowsrc", "dynsrc", "data"];
/** In SVG, href on these elements is a fetch (on `<a>` it is only a link). */
const SVG_FETCH = new Set(["image", "use", "feimage", "script", "tref", "pattern", "filter", "lineargradient", "radialgradient"]);
const CSS_URL = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;

export interface LocalOnlyHtml {
  html: string;
  /** How many remote references were removed. */
  blocked: number;
}

function stripCssUrls(css: string, count: () => void): string {
  return css.replace(CSS_URL, (m, _q: string, url: string) => {
    if (LOCAL.test(url)) return m;
    count();
    return "none";
  });
}

/**
 * Sanitize, then remove every remote reference. `imageAlt` is the text given
 * to an `<img>` that has none. Returns a plain string; the caller passes it
 * through `toTrustedHTML` again at the sink (idempotent).
 */
export function localOnlyHtml(markup: string, kind: HtmlKind, imageAlt: string): LocalOnlyHtml {
  const clean = String(toTrustedHTML(markup, kind));
  // Inert: parsing here loads nothing and runs nothing.
  const doc = parseInertDocument(`<!doctype html><body>${clean}</body>`, "text/html");
  let blocked = 0;
  const count = () => {
    blocked++;
  };
  for (const el of Array.from(doc.body.querySelectorAll("*"))) {
    const tag = el.localName.toLowerCase();
    for (const a of FETCH_ATTRS) {
      const v = el.getAttribute(a);
      if (v === null) continue;
      // srcset is a list; one remote entry is enough to drop it.
      const parts = a === "srcset" ? v.split(",").map((s) => s.trim().split(/\s+/)[0]) : [v];
      if (parts.every((p) => !p || LOCAL.test(p))) continue;
      el.removeAttribute(a);
      el.setAttribute("data-lumen-blocked", "");
      count();
    }
    if (el.namespaceURI === "http://www.w3.org/2000/svg" && SVG_FETCH.has(tag)) {
      for (const a of ["href", "xlink:href"]) {
        const v = el.getAttribute(a);
        if (v !== null && !LOCAL.test(v)) {
          el.removeAttribute(a);
          el.setAttribute("data-lumen-blocked", "");
          count();
        }
      }
    }
    const style = el.getAttribute("style");
    if (style && /url\(/i.test(style)) el.setAttribute("style", stripCssUrls(style, count));
    if (tag === "style" && el.textContent && /url\(|@import/i.test(el.textContent)) {
      el.textContent = stripCssUrls(el.textContent, count).replace(/@import[^;]*;?/gi, () => {
        count();
        return "";
      });
    }
    if (tag === "img" && !el.hasAttribute("alt")) el.setAttribute("alt", imageAlt);
  }
  return { html: doc.body.innerHTML, blocked };
}
