import DOMPurify from "dompurify";
import type { Config as DOMPurifyConfig } from "dompurify";

const SAFE_URI_REGEXP =
  /^(?:https?|mailto|tel|blob|#|\/|\.\/|\.\.\/|data:image\/(?:png|jpe?g|gif|webp|svg\+xml)(?:;charset=[\w.-]+)?;base64|data:application\/pdf;base64)/i;

const HTML_FORBID_TAGS = [
  "script",
  "iframe",
  "object",
  "embed",
  "base",
  "meta",
  "link",
  "form",
  "input",
  "textarea",
  "select",
  "option",
  "frameset",
  "frame",
];

const HTML_FORBID_ATTRS = [
  "onerror",
  "onload",
  "onmouseenter",
  "onmouseleave",
  "onmouseover",
  "onmouseout",
  "onclick",
  "ondblclick",
  "onchange",
  "onsubmit",
  "onfocus",
  "onblur",
  "onkeydown",
  "onkeyup",
  "onmessage",
  "srcdoc",
  "formaction",
];

const SVG_FORBID_TAGS = [
  "script",
  "iframe",
  "object",
  "embed",
  "form",
  "input",
  "textarea",
  "button",
  "select",
  "option",
  "foreignObject",
  "annotation-xml",
  "meta",
  "base",
  "frameset",
  "frame",
  // <a> in SVG can carry xlink:href payloads and offers no rendering
  // value over a plain group/text element. Strip the wrapper but keep
  // its contents (KEEP_CONTENT in baseConfig).
  "a",
];

// `fill` and `stroke` are intentionally NOT in this list — Mermaid /
// Graphviz / etc. emit SVGs with explicit per-element fill colors that
// the diagram needs to be visible. The `uponSanitizeAttribute` hook
// below checks fill / stroke values for `url(javascript:...)` payloads
// via the URI-attr branch, which is the only way they can carry an
// active payload. Other style-attribute injection vectors are covered
// by the style-attr check.
const SVG_FORBID_ATTRS = [
  "onerror",
  "onload",
  "onclick",
  "onmouseenter",
  "onmouseleave",
  "style",
  "xlink:href",
];

// Per-instance hook tracking. The previous module-scoped flag was a
// real security bug: `getSanitizer()` returns a fresh DOMPurify
// instance per call (DOMPurify(window) is a factory), so the first
// instance got the hook and every subsequent instance had no
// attribute-stripping hook installed at all — meaning event-handler
// removal, javascript: in style, etc. silently stopped working after
// the first sanitize() call.
const hooksInstalledFor = new WeakSet<object>();

const removeMarker = new WeakSet<Element>();

function installSanitizerHooks(purifier: ReturnType<typeof DOMPurify>): void {
  if (hooksInstalledFor.has(purifier as unknown as object)) return;
  hooksInstalledFor.add(purifier as unknown as object);

  purifier.addHook("uponSanitizeAttribute", (node, data) => {
    const element = node as Element | null;
    const name = (data.attrName || "").toLowerCase();
    const value = String(data.attrValue || "");
    if (!element) return;
    if (name.startsWith("on")) {
      data.keepAttr = false;
      return;
    }
    if (name === "style" && /(expression|javascript:|behavior:)/i.test(value)) {
      data.keepAttr = false;
      return;
    }
    // `fill` and `stroke` can carry `url(#defs-id)` references — those are
    // safe (same-document SVG defs) — but if the URL contains a
    // javascript: payload it's an injection vector. Reject `url(...)`
    // values whose contents look unsafe; keep the rest.
    if (
      (name === "fill" || name === "stroke") &&
      /url\(\s*['"]?\s*(?:javascript|vbscript|data:text\/html)/i.test(value)
    ) {
      data.keepAttr = false;
      return;
    }
    const isUriAttr = name === "href" || name === "src" || name === "xlink:href" || name === "action" || name === "formaction";
    if (
      /^\s*javascript:|^\s*vbscript:|^\s*data:text\/html/i.test(value) ||
      (isUriAttr && /^data:/i.test(value) && !/^data:image\//i.test(value))
    ) {
      data.keepAttr = false;
      if (name === "xlink:href" && element?.namespaceURI === "http://www.w3.org/2000/svg") {
        removeMarker.add(element);
      }
    }
  });

  purifier.addHook("afterSanitizeAttributes", (node) => {
    const element = node as Element | null;
    if (!element) return;
    if (removeMarker.has(element)) {
      removeMarker.delete(element);
      element.remove();
      return;
    }
    const style = element.getAttribute("style");
    if (style && /javascript:/i.test(style)) {
      element.removeAttribute("style");
    }
  });

  purifier.addHook("uponSanitizeElement", (node, data) => {
    const element = node as Element | null;
    const tag = String(data.tagName || "").toLowerCase();
    if (
      tag === "svg" &&
      element?.namespaceURI === "http://www.w3.org/2000/svg"
    ) {
      return;
    }
    if (tag === "a") {
      const xlinkHref = element?.getAttribute("xlink:href");
      if (xlinkHref && /^\s*javascript:/i.test(xlinkHref)) {
        element?.parentNode?.removeChild(node as Node);
      }
    }
  });
}

// Cache the configured DOMPurify instance so the hook is installed
// exactly once and reused across every sanitize() call.
let cachedPurifier: ReturnType<typeof DOMPurify> | null = null;
function getSanitizer(): ReturnType<typeof DOMPurify> | null {
  if (typeof window === "undefined") return null;
  if (typeof document === "undefined") return null;
  if (!cachedPurifier) cachedPurifier = DOMPurify(window);
  return cachedPurifier;
}

function baseConfig(): DOMPurifyConfig {
  return {
    ALLOW_UNKNOWN_PROTOCOLS: false,
    KEEP_CONTENT: true,
    SANITIZE_DOM: true,
  };
}

function sanitize(raw: string, mode: "html" | "svg"): string {
  const purifier = getSanitizer();
  if (!purifier) return raw;
  installSanitizerHooks(purifier);

  const cfg = mode === "svg"
    ? {
        ...baseConfig(),
        USE_PROFILES: { svg: true, svgFilters: true },
        FORBID_TAGS: [...SVG_FORBID_TAGS],
        FORBID_ATTR: [...SVG_FORBID_ATTRS],
        // DOMPurify's svg profile is conservative about both geometry
        // and presentational attributes — without them, Mermaid /
        // Graphviz / hand-authored SVGs render as invisible shapes
        // (this was the round-11 screenshot bug). Add back the safe
        // SVG attr set explicitly. The hook above rejects
        // `fill="url(javascript:...)"` payloads, so allowing these is
        // safe; scripts are already FORBID_TAGS in this profile.
        ADD_ATTR: [
          // Geometry — without these the shapes have no position/size.
          "d",
          "cx",
          "cy",
          "r",
          "rx",
          "ry",
          "x",
          "y",
          "x1",
          "y1",
          "x2",
          "y2",
          "points",
          "width",
          "height",
          "viewBox",
          "preserveAspectRatio",
          // Paint
          "fill",
          "stroke",
          "stroke-width",
          "stroke-dasharray",
          "stroke-linecap",
          "stroke-linejoin",
          "stroke-opacity",
          "fill-opacity",
          "fill-rule",
          "opacity",
          // Transform & layout
          "transform",
          "transform-origin",
          // Defs references
          "marker-end",
          "marker-start",
          "marker-mid",
          "clip-path",
          "mask",
          // Gradient stops
          "stop-color",
          "stop-opacity",
          "offset",
          // Text
          "font-family",
          "font-size",
          "font-weight",
          "text-anchor",
          "dominant-baseline",
          "alignment-baseline",
          // ID / class for defs / styling
          "id",
          "class",
        ],
      }
    : {
        ...baseConfig(),
        USE_PROFILES: { html: true },
        FORBID_TAGS: [...HTML_FORBID_TAGS],
        FORBID_ATTR: [...HTML_FORBID_ATTRS],
        // URI allowlist is HTML-only. SVG mode handles unsafe URLs in
        // the uponSanitizeAttribute hook (javascript: / vbscript: /
        // data:text/html prefix check) — applying ALLOWED_URI_REGEXP
        // in SVG mode also strips non-URI attribute values like
        // `cx="10"`, `fill="red"`, etc., making diagrams invisible
        // (the round-11 screenshot bug).
        ALLOWED_URI_REGEXP: SAFE_URI_REGEXP,
      };

  let cleaned = String(purifier.sanitize(raw, cfg));
  if (mode === "html") {
    cleaned = cleaned.replace(/\sstyle="[^"]*javascript:[^"]*"/gi, "");
  }
  if (mode === "svg") {
    cleaned = cleaned.replace(/<a\b[^>]*xlink:href\s*=\s*["']?javascript:[^"']*["']?[^>]*>[\s\S]*?<\/a>/gi, "");
    cleaned = cleaned.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, "");
  }
  return cleaned;
}

export function sanitizeHtmlMarkup(raw: string): string {
  return sanitize(raw, "html");
}

export function sanitizeSvgMarkup(raw: string): string {
  const trimmed = raw.trim();
  const isFragment = !trimmed.toLowerCase().startsWith("<svg");
  const wrapped = isFragment ? `<svg xmlns="http://www.w3.org/2000/svg">${trimmed}</svg>` : trimmed;
  const sanitized = sanitize(wrapped, "svg");
  if (isFragment && sanitized.toLowerCase().startsWith("<svg")) {
    const innerMatch = sanitized.match(/^<svg[^>]*>([\s\S]*)<\/svg>$/i);
    return innerMatch ? innerMatch[1].trim() : sanitized;
  }
  return sanitized;
}
