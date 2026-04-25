/**
 * Print / Export to PDF utility.
 *
 * Renders the markdown preview in a new window with all styles preserved,
 * then triggers window.print() which on modern browsers offers "Save as PDF".
 */

import { renderMarkdown } from "../renderer/pipeline";

/**
 * Generate a printable document from markdown content.
 * Opens a new window with the styled preview and triggers the print dialog.
 * The user can choose "Save as PDF" from the system print dialog.
 */
export async function printDocument(
  markdownText: string,
  docName: string,
): Promise<void> {
  const isDark = () => document.documentElement.classList.contains("dark");
  const tree = await renderMarkdown(markdownText, isDark);

  // We need to serialize the React tree. We'll render to a temporary div.
  const { createRoot } = await import("react-dom/client");
  const { createElement, Fragment } = await import("react");

  const temp = document.createElement("div");
  const root = createRoot(temp);

  await new Promise<void>((resolve) => {
    root.render(
      createElement(Fragment, null, tree),
    );
    // Give React a tick to flush
    setTimeout(resolve, 100);
  });

  const htmlContent = temp.innerHTML;
  root.unmount();

  // Gather all stylesheets from the current document
  const styles: string[] = [];
  for (const sheet of document.styleSheets) {
    try {
      const rules = [...sheet.cssRules].map((r) => r.cssText).join("\n");
      styles.push(rules);
    } catch {
      // Cross-origin sheets — skip
    }
  }

  // Get current theme class
  const themeClass = document.documentElement.classList.contains("dark")
    ? "dark"
    : "";
  const dir = document.documentElement.dir || "ltr";

  const printHTML = `<!DOCTYPE html>
<html class="${themeClass}" dir="${dir}" lang="en">
<head>
  <meta charset="UTF-8">
  <title>${docName} — Lumen</title>
  <style>
    ${styles.join("\n\n")}

    /* Print overrides */
    @media print {
      body {
        margin: 0;
        padding: 20mm;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
        color-adjust: exact !important;
      }
      .prose-lumen {
        max-width: none;
        padding: 0;
      }
      /* Force background colors to print */
      * {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
    }

    @media screen {
      body {
        max-width: 800px;
        margin: 40px auto;
        padding: 20px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }
    }

    .print-header {
      text-align: center;
      padding-bottom: 16px;
      margin-bottom: 24px;
      border-bottom: 2px solid hsl(var(--border, 220 10% 30%));
      font-size: 11px;
      color: hsl(var(--fg-muted, 220 10% 60%));
    }
  </style>
</head>
<body>
  <div class="print-header">
    ${docName} &mdash; Exported from Lumen
  </div>
  <div class="prose-lumen">
    ${htmlContent}
  </div>
  <script>
    // Auto-trigger print dialog
    window.addEventListener('load', () => {
      setTimeout(() => window.print(), 300);
    });
  </script>
</body>
</html>`;

  const printWindow = window.open("", "_blank");
  if (printWindow) {
    printWindow.document.write(printHTML);
    printWindow.document.close();
  }
}
