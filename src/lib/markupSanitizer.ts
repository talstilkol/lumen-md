import DOMPurify from "dompurify";

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
  "button",
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
];

const SVG_FORBID_ATTRS = [
  "onerror",
  "onload",
  "onclick",
  "onmouseenter",
  "onmouseleave",
  "style",
  "xlink:href",
  "fill",
];

let hooksInstalled = false;

function installSanitizerHooks(purifier: ReturnType<typeof DOMPurify>): void {
  if (hooksInstalled) return;
  hooksInstalled = true;

  purifier.addHook("uponSanitizeAttribute", (node, data) => {
    const element = node as Element | null;
    const name = (data.attrName || "").toLowerCase();
    const value = String(data.attrValue || "");
    if (!element) return;
    if (name.startsWith("on")) {
      data.keepAttr = false;
      return;
    }
    if (name === "style" && /(expression|url\(\s*['"]?\s*javascript:|behavior:)/i.test(value)) {
      data.keepAttr = false;
      return;
    }
    const isUriAttr = name === "href" || name === "src" || name === "xlink:href" || name === "action" || name === "formaction";
    if (
      /^\s*javascript:|^\s*vbscript:|^\s*data:text\/html/i.test(value) ||
      (isUriAttr && /^data:/i.test(value) && !/^data:image\//i.test(value))
    ) {
      data.keepAttr = false;
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
  });
}

function getSanitizer(): ReturnType<typeof DOMPurify> | null {
  if (typeof window === "undefined") return null;
  if (typeof document === "undefined") return null;
  return DOMPurify(window);
}

function baseConfig(): DOMPurify.Config {
  return {
    ALLOWED_URI_REGEXP: SAFE_URI_REGEXP,
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
        USE_PROFILES: { svg: true },
        FORBID_TAGS: [...SVG_FORBID_TAGS],
        FORBID_ATTR: [...SVG_FORBID_ATTRS],
      }
    : {
        ...baseConfig(),
        USE_PROFILES: { html: true },
        FORBID_TAGS: [...HTML_FORBID_TAGS],
        FORBID_ATTR: [...HTML_FORBID_ATTRS],
      };

  return String(purifier.sanitize(raw, cfg));
}

export function sanitizeHtmlMarkup(raw: string): string {
  return sanitize(raw, "html");
}

export function sanitizeSvgMarkup(raw: string): string {
  return sanitize(raw, "svg");
}
