/**
 * Lumen Web Clipper — content-script side. Reads the current page, picks
 * the most readable region (selection if present, else the article body)
 * and converts it to plain markdown using a tiny inline serializer.
 *
 * No external library: we walk the DOM and emit markdown ourselves so the
 * extension stays under 30 KB and ships without a build step.
 */

(function () {
  function htmlToMarkdown(node) {
    const out = [];
    function walk(n, depth = 0) {
      if (n.nodeType === Node.TEXT_NODE) {
        out.push(n.textContent.replace(/\s+/g, " "));
        return;
      }
      if (n.nodeType !== Node.ELEMENT_NODE) return;
      const tag = n.tagName.toLowerCase();
      if (tag === "script" || tag === "style" || tag === "noscript") return;
      switch (tag) {
        case "h1": out.push("\n\n# "); walkChildren(n, depth); out.push("\n\n"); return;
        case "h2": out.push("\n\n## "); walkChildren(n, depth); out.push("\n\n"); return;
        case "h3": out.push("\n\n### "); walkChildren(n, depth); out.push("\n\n"); return;
        case "h4": out.push("\n\n#### "); walkChildren(n, depth); out.push("\n\n"); return;
        case "p":  out.push("\n\n"); walkChildren(n, depth); out.push("\n\n"); return;
        case "br": out.push("  \n"); return;
        case "hr": out.push("\n\n---\n\n"); return;
        case "strong":
        case "b":  out.push("**"); walkChildren(n, depth); out.push("**"); return;
        case "em":
        case "i":  out.push("*"); walkChildren(n, depth); out.push("*"); return;
        case "code": {
          const block = n.parentElement?.tagName === "PRE";
          if (block) {
            out.push("\n\n```\n" + n.textContent + "\n```\n\n");
          } else {
            out.push("`" + n.textContent + "`");
          }
          return;
        }
        case "pre": {
          const code = n.querySelector("code");
          out.push("\n\n```\n" + (code ? code.textContent : n.textContent) + "\n```\n\n");
          return;
        }
        case "a": {
          const href = n.getAttribute("href") ?? "";
          out.push("[");
          walkChildren(n, depth);
          out.push(`](${href})`);
          return;
        }
        case "img": {
          const src = n.getAttribute("src") ?? "";
          const alt = n.getAttribute("alt") ?? "";
          out.push(`![${alt}](${src})`);
          return;
        }
        case "blockquote":
          out.push("\n\n> ");
          walkChildren(n, depth + 1);
          out.push("\n\n");
          return;
        case "ul":
        case "ol":
          out.push("\n");
          for (const li of n.children) {
            if (li.tagName?.toLowerCase() !== "li") continue;
            const bullet = tag === "ol" ? "1. " : "- ";
            out.push("\n" + "  ".repeat(depth) + bullet);
            walkChildren(li, depth + 1);
          }
          out.push("\n\n");
          return;
        default:
          walkChildren(n, depth);
      }
    }
    function walkChildren(n, depth) {
      for (const c of n.childNodes) walk(c, depth);
    }
    walk(node);
    return out.join("").replace(/\n{3,}/g, "\n\n").trim();
  }

  function pickSource() {
    const sel = window.getSelection();
    if (sel && sel.toString().trim().length > 20) {
      const range = sel.getRangeAt(0);
      const div = document.createElement("div");
      div.appendChild(range.cloneContents());
      return { source: div, isSelection: true };
    }
    // No selection — pick the most-likely article container.
    const candidate =
      document.querySelector("article") ||
      document.querySelector("main") ||
      document.querySelector('[role="main"]') ||
      document.body;
    return { source: candidate, isSelection: false };
  }

  function clip() {
    const { source, isSelection } = pickSource();
    const markdown = htmlToMarkdown(source);
    const payload = {
      title: document.title,
      url: location.href,
      capturedAt: new Date().toISOString(),
      isSelection,
      markdown,
    };
    chrome.runtime.sendMessage({ type: "lumen-clip", payload }, (resp) => {
      if (resp?.ok) {
        flashBadge(resp.fallback ? "Opened Lumen — paste to save" : "Saved to Lumen ✓");
      } else {
        flashBadge("Save failed", true);
      }
    });
  }

  function flashBadge(message, error = false) {
    const el = document.createElement("div");
    el.textContent = message;
    el.style.cssText = `
      position: fixed; bottom: 22px; right: 22px; z-index: 999999;
      padding: 10px 16px; border-radius: 999px; font-family: system-ui;
      font-size: 13px; font-weight: 500; color: white;
      background: ${error ? "#dc2626" : "linear-gradient(135deg,#7c5cff,#22d3ee)"};
      box-shadow: 0 8px 24px -4px rgba(0,0,0,.3); animation: lumen-pop 200ms ease;
    `;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2400);
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "lumen-clip-page") clip();
  });

  // Allow the popup to invoke directly:
  window.__LUMEN_CLIP__ = clip;
})();
