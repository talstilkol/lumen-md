/**
 * HTML generation for the Lumen VS Code preview. Runs as part of the root
 * suite via src/__tests__/vscodeLumen.test.ts:
 *   npx vitest run vscodeLumen
 */
import { describe, it, expect } from "vitest";
import { renderMarkdownBody, renderPreviewDocument, escapeHtml, rewriteRelativeResources } from "../src/render";

const docOpts = {
  nonce: "abc123",
  cspSource: "vscode-webview://ext",
  styleUri: "vscode-resource:/media/preview.css",
  katexCssUri: "vscode-resource:/media/katex/katex.min.css",
  scriptUri: "vscode-resource:/media/preview.js",
  title: "notes <draft>.md",
};

describe("renderMarkdownBody", () => {
  it("renders GFM: tables, task lists, strikethrough, autolinks", () => {
    const html = renderMarkdownBody(
      "| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n- [ ] todo\n\n~~old~~ https://lumen.dev",
    );
    expect(html).toContain("<table>");
    expect(html).toContain("<td>1</td>");
    expect(html).toMatch(/<input type="checkbox" checked disabled>/);
    expect(html).toContain("<del>old</del>");
    expect(html).toContain('<a href="https://lumen.dev">');
  });

  it("renders inline and display math with KaTeX", () => {
    const html = renderMarkdownBody("Inline $E=mc^2$.\n\n$$\n\\int_0^1 x\\,dx\n$$\n");
    expect(html).toContain('class="katex"');
    expect(html).toContain('class="katex-display"');
    expect(html).toContain("<math");
  });

  it("does not throw on invalid TeX", () => {
    expect(() => renderMarkdownBody("$\\frac{$")).not.toThrow();
  });

  it("turns mermaid fences into pre.mermaid for the webview script", () => {
    const html = renderMarkdownBody("```mermaid\ngraph TD; A-->B\n```");
    expect(html).toBe('<pre class="mermaid">graph TD; A-->B</pre>');
  });

  it("renders Lumen :::callouts and GitHub [!ALERT] callouts", () => {
    const html = renderMarkdownBody(':::warning{title="Careful"}\nHot stuff\n:::\n\n> [!TIP]\n> Use the preview\n');
    expect(html).toContain('<div class="admonition warning">');
    expect(html).toContain('<div class="admonition-title">Careful</div>');
    expect(html).toContain('<div class="admonition tip">\n<div class="admonition-title">Tip</div>\n<p>Use the preview</p>');
    expect(html).not.toContain("[!TIP]");
  });

  it("shares Lumen's dialect: columns, wikilinks, heading slugs, frontmatter stripped", () => {
    const html = renderMarkdownBody("---\ntitle: x\n---\n# My Page\n\nSee [[Other Page|that]].\n\n:::columns\nA\n:::\nB\n:::\n");
    expect(html).not.toContain("title: x");
    expect(html).toContain('<h1 id="my-page">');
    expect(html).toContain('<a href="#other-page" class="wiki-link" data-wiki-target="Other Page">that</a>');
    expect(html).toContain("lumen-columns");
  });

  it("labels Lumen-only interactive blocks and keeps their source readable", () => {
    const html = renderMarkdownBody("```chart\ntype: bar\n```");
    expect(html).toContain("chart — interactive in Lumen");
    expect(html).toContain('data-lang="chart"');
    expect(html).toContain("type: bar");
  });

  it("strips raw HTML from the source", () => {
    const html = renderMarkdownBody('Hi <img src=x onerror="alert(1)">\n\n<script>alert(2)</script>\n\n<div class="lumen-block-label">fake</div>');
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("fake");
    expect(html).toContain("Hi");
  });
});

describe("renderPreviewDocument", () => {
  it("wraps the body with a strict nonce CSP and webview asset URIs", () => {
    const html = renderPreviewDocument("# Hello", docOpts);
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("script-src 'nonce-abc123'");
    expect(html).toContain(`style-src ${docOpts.cspSource} 'unsafe-inline'`);
    expect(html).toContain('<script nonce="abc123" src="vscode-resource:/media/preview.js"></script>');
    expect(html).toContain('href="vscode-resource:/media/katex/katex.min.css"');
    expect(html).toContain("<title>notes &lt;draft&gt;.md</title>");
    expect(html).toContain('<h1 id="hello">Hello</h1>');
    expect(html).not.toMatch(/https?:\/\/(cdn|unpkg)/);
  });

  it("escapes HTML metacharacters", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });

  it("rewrites document-relative image sources to the webview resource base", () => {
    const base = "https://file+.vscode-resource.vscode-cdn.net/home/me/notes";
    const html = renderPreviewDocument(
      "![a](images/a.png) ![b](<./my pic.png?v=2>) ![c](https://e.com/c.png) ![d](data:image/png;base64,AA==)",
      { ...docOpts, resourceBaseUri: base },
    );
    expect(html).toContain(`src="${base}/images/a.png"`);
    expect(html).toContain(`src="${base}/my%20pic.png?v=2"`);
    expect(html).toContain('src="https://e.com/c.png"');
    expect(html).toContain('src="data:image/png;base64,AA=="');
    // Bundled assets are untouched.
    expect(html).toContain('src="vscode-resource:/media/preview.js"');
  });

  it("leaves root-absolute, protocol-relative and fragment sources alone", () => {
    const out = rewriteRelativeResources('<img src="/x.png"><img src="//h/x.png"><img src="#f"><img src="y.png">', "B/");
    expect(out).toBe('<img src="/x.png"><img src="//h/x.png"><img src="#f"><img src="B/y.png">');
  });
});
