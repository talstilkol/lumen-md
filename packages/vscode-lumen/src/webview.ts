/**
 * Webview-side script (bundled to media/preview.js). Renders `pre.mermaid`
 * blocks with a bundled mermaid — no CDN, the webview CSP only allows this
 * nonce'd script — follows VS Code's light/dark theme, and forwards link
 * clicks to the extension (a webview can't follow relative links itself),
 * including `[[wiki links]]` to other notes.
 */
import mermaid from "mermaid";
import { previewClickMessage } from "./wikiLinks";

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const vscodeApi = acquireVsCodeApi();

document.addEventListener("click", (e) => {
  const a = (e.target as Element | null)?.closest?.("a[href]");
  if (!a) return;
  const msg = previewClickMessage(a, (id) => document.getElementById(id) !== null);
  if (!msg) return; // in-page anchor: let the browser scroll
  e.preventDefault();
  vscodeApi.postMessage(msg);
});

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
