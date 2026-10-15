/**
 * Webview-side script (bundled to media/preview.js). Renders `pre.mermaid`
 * blocks with a bundled mermaid — no CDN, the webview CSP only allows this
 * nonce'd script — and follows VS Code's light/dark theme.
 */
import mermaid from "mermaid";

const dark =
  document.body.classList.contains("vscode-dark") ||
  document.body.classList.contains("vscode-high-contrast");

mermaid.initialize({ startOnLoad: false, theme: dark ? "dark" : "default", securityLevel: "strict" });

void mermaid.run({ querySelector: "pre.mermaid" }).catch((err: unknown) => {
  for (const el of Array.from(document.querySelectorAll("pre.mermaid:not([data-processed])"))) {
    el.classList.add("mermaid-error");
    el.setAttribute("title", String(err));
  }
});
