import { renderMarkdown } from "../renderer/pipeline";
import { fetchWithRetry } from "../lib/fetchRetry";

/**
 * Render the markdown to a self-contained HTML document and trigger a
 * download. Inlines all stylesheets currently attached to the page, including
 * the bundled Vite CSS, KaTeX, and Leaflet — so the resulting file looks the
 * same as the live preview when opened anywhere.
 */
export async function exportToHtml(
  markdown: string,
  filename: string,
): Promise<void> {
  const isDark = document.documentElement.classList.contains("dark");
  // Render to a React tree, then stringify.
  const tree = await renderMarkdown(markdown, () => isDark);
  const { renderToStaticMarkup } = await import("react-dom/server");
  const body = renderToStaticMarkup(tree as React.ReactElement);

  const styles = await collectStyles();
  const docTitle = (filename.replace(/\.(md|markdown|html)$/i, "") || "Document").trim();

  const html = `<!doctype html>
<html lang="en" class="${isDark ? "dark" : ""}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="generator" content="Lumen" />
<title>${escapeHtml(docTitle)}</title>
<style>
${styles}

/* Self-contained tweaks */
body {
  margin: 0;
  padding: 2.5rem 1rem;
  background: hsl(var(--bg));
  color: hsl(var(--fg));
}
.lumen-export {
  max-width: 760px;
  margin: 0 auto;
}
@media print {
  body { padding: 0; }
  .code-block, .chart-block, .mermaid-block { break-inside: avoid; }
}
</style>
</head>
<body>
<main class="prose-lumen lumen-export">
${body}
</main>
</body>
</html>`;

  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = (filename.replace(/\.(md|markdown)$/i, "") || "document") + ".html";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Inline all current stylesheets (including <style> tags and external <link>s
 * already loaded by the page).
 */
async function collectStyles(): Promise<string> {
  const chunks: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const rules = sheet.cssRules;
      if (!rules) continue;
      for (const rule of Array.from(rules)) {
        chunks.push(rule.cssText);
      }
    } catch {
      // Cross-origin stylesheet (Google Fonts, etc.) — fetch its text directly.
      const href = (sheet as CSSStyleSheet).href;
      if (!href) continue;
      try {
        const res = await fetchWithRetry(href, {}, { label: "exportHtml.stylesheet", maxRetries: 2, baseDelayMs: 600, maxDelayMs: 2500 });
        if (res.ok) chunks.push(await res.text());
      } catch {
        /* network unavailable; skip */
      }
    }
  }
  return chunks.join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
