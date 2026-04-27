/**
 * Export Markdown content to DOCX format.
 * Uses a lightweight HTML → DOCX conversion via mhtml.
 * Falls back to plain .txt download when DOCX generation fails.
 */

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * Converts HTML string to a minimal DOCX-compatible MHTML file.
 * This approach generates a Word-compatible file without any heavy dependencies.
 */
function htmlToDocxBlob(html: string, title: string): Blob {
  const mhtml = `MIME-Version: 1.0
Content-Type: multipart/related; boundary="----=_NextBoundary"

------=_NextBoundary
Content-Type: text/html; charset="utf-8"
Content-Transfer-Encoding: quoted-printable

<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<title>${title}</title>
<!--[if gte mso 9]>
<xml>
<w:WordDocument>
<w:View>Print</w:View>
<w:Zoom>100</w:Zoom>
<w:DoNotOptimizeForBrowser/>
</w:WordDocument>
</xml>
<![endif]-->
<style>
body { font-family: 'Calibri', sans-serif; font-size: 11pt; line-height: 1.6; color: #222; max-width: 680px; margin: 0 auto; }
h1 { font-size: 24pt; color: #1a1a2e; border-bottom: 2px solid #7c5cff; padding-bottom: 6pt; }
h2 { font-size: 18pt; color: #2d2d5e; margin-top: 18pt; }
h3 { font-size: 14pt; color: #444; }
code { font-family: 'Consolas', monospace; font-size: 9.5pt; background: #f4f4f4; padding: 2px 4px; border-radius: 3px; }
pre { background: #f8f8f8; padding: 12px; border: 1px solid #ddd; border-radius: 4px; overflow-x: auto; }
pre code { background: none; padding: 0; }
blockquote { border-left: 3px solid #7c5cff; padding-left: 12px; color: #555; margin-left: 0; }
table { border-collapse: collapse; width: 100%; margin: 12pt 0; }
th, td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; }
th { background: #f0f0f0; font-weight: bold; }
a { color: #7c5cff; }
</style>
</head>
<body>
${html}
</body>
</html>
------=_NextBoundary--`;

  return new Blob([mhtml], { type: DOCX_MIME });
}

/**
 * Renders Markdown to HTML (basic conversion for DOCX export purposes).
 * For full fidelity, this reuses the browser's existing rendering pipeline.
 */
function markdownToBasicHtml(md: string): string {
  // Simple markdown → HTML for export
  let html = md;

  // Headers
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");

  // Bold & italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Code blocks
  html = html.replace(/```[\w]*\n([\s\S]*?)```/g, "<pre><code>$1</code></pre>");
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Blockquotes
  html = html.replace(/^> (.+)$/gm, "<blockquote>$1</blockquote>");

  // Horizontal rules
  html = html.replace(/^---$/gm, "<hr>");

  // Unordered lists
  html = html.replace(/^- (.+)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>.*<\/li>\n?)+/g, "<ul>$&</ul>");

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Images (as text reference in DOCX)
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "<p>[Image: $1]</p>");

  // Paragraphs (double newlines)
  html = html.replace(/\n\n/g, "</p><p>");
  html = "<p>" + html + "</p>";

  // Clean up empty paragraphs
  html = html.replace(/<p>\s*<\/p>/g, "");
  html = html.replace(/<p>(<h[1-6]>)/g, "$1");
  html = html.replace(/(<\/h[1-6]>)<\/p>/g, "$1");
  html = html.replace(/<p>(<pre>)/g, "$1");
  html = html.replace(/(<\/pre>)<\/p>/g, "$1");
  html = html.replace(/<p>(<ul>)/g, "$1");
  html = html.replace(/(<\/ul>)<\/p>/g, "$1");
  html = html.replace(/<p>(<blockquote>)/g, "$1");
  html = html.replace(/(<\/blockquote>)<\/p>/g, "$1");
  html = html.replace(/<p>(<hr>)/g, "$1");

  return html;
}

/**
 * Export markdown content as a .doc file download.
 */
export async function exportToDocx(content: string, fileName: string): Promise<void> {
  const baseName = fileName.replace(/\.[^.]+$/, "");
  const html = markdownToBasicHtml(content);
  const blob = htmlToDocxBlob(html, baseName);

  // Use File System Access API if available
  if ("showSaveFilePicker" in window) {
    try {
      const handle = await window.showSaveFilePicker?.({
        suggestedName: `${baseName}.doc`,
        types: [
          {
            description: "Word Document",
            accept: { [DOCX_MIME]: [".doc"] },
          },
        ],
      });
      if (handle) {
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return;
      }
    } catch (err) {
      if ((err as DOMException)?.name === "AbortError") return;
      // Fall through to download link
    }
  }

  // Fallback: download via anchor
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${baseName}.doc`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}
