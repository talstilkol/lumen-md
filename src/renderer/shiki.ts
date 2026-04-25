import type { Root, Element } from "hast";
import { visit } from "unist-util-visit";

let highlighterPromise: Promise<unknown> | null = null;

const PRELOADED_LANGS = [
  "javascript",
  "typescript",
  "jsx",
  "tsx",
  "json",
  "yaml",
  "toml",
  "bash",
  "shell",
  "python",
  "rust",
  "go",
  "java",
  "c",
  "cpp",
  "csharp",
  "css",
  "scss",
  "html",
  "xml",
  "sql",
  "diff",
  "markdown",
  "ruby",
  "php",
  "kotlin",
  "swift",
];

async function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      const { createHighlighter } = await import("shiki");
      return createHighlighter({
        themes: ["github-dark-default", "github-light-default"],
        langs: PRELOADED_LANGS,
      });
    })();
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return highlighterPromise as Promise<any>;
}

interface ShikiOpts {
  isDark: () => boolean;
}

/**
 * rehype plugin: highlights `<pre><code class="language-X">` blocks using Shiki.
 * Skips elements that already have a `data-lumen-block` attribute.
 */
export function rehypeShiki(opts: ShikiOpts) {
  return async function transformer(tree: Root) {
    const tasks: Array<() => Promise<void>> = [];
    visit(tree, "element", (node: Element, index, parent) => {
      if (node.tagName !== "pre") return;
      if (!parent || index === undefined) return;
      const codeChild = node.children.find(
        (c) => c.type === "element" && (c as Element).tagName === "code",
      ) as Element | undefined;
      if (!codeChild) return;

      // Skip our custom blocks (already have hName set elsewhere)
      const cls = (codeChild.properties?.className as string[] | undefined) ?? [];
      const langClass = cls.find((c) => c.startsWith("language-"));
      const lang = langClass?.replace("language-", "") ?? "text";

      // Get raw source from text children
      const source =
        codeChild.children
          .filter((c) => c.type === "text")
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((c: any) => c.value as string)
          .join("") ?? "";

      tasks.push(async () => {
        try {
          const hl = await getHighlighter();
          const safeLang = hl.getLoadedLanguages().includes(lang) ? lang : "text";
          const themed = hl.codeToHast(source, {
            lang: safeLang,
            themes: {
              dark: "github-dark-default",
              light: "github-light-default",
            },
            defaultColor: opts.isDark() ? "dark" : "light",
            cssVariablePrefix: "--shiki-",
          });
          // Shiki's codeToHast returns a Root with a single <pre><code> element.
          const newPre = (themed as Root).children.find(
            (c) => c.type === "element" && (c as Element).tagName === "pre",
          ) as Element | undefined;
          if (!newPre) return;

          // Wrap with our header (filename + lang chip + copy button).
          const filename = parseFilenameMeta(codeChild);
          const wrapper: Element = {
            type: "element",
            tagName: "div",
            properties: { className: ["code-block"] },
            children: [
              {
                type: "element",
                tagName: "div",
                properties: { className: ["code-block-header"] },
                children: [
                  {
                    type: "element",
                    tagName: "span",
                    properties: { className: ["lang"] },
                    children: [{ type: "text", value: filename ?? safeLang }],
                  },
                  {
                    type: "element",
                    tagName: "button",
                    properties: {
                      className: ["icon-btn"],
                      "data-copy": source,
                      title: "Copy",
                      style:
                        "padding:2px 8px;font-size:11px;height:24px;width:auto;",
                    },
                    children: [{ type: "text", value: "Copy" }],
                  },
                ],
              },
              newPre,
            ],
          };
          parent.children[index] = wrapper;
        } catch {
          // leave the original code block untouched on failure
        }
      });
    });
    await Promise.all(tasks.map((fn) => fn()));
  };
}

function parseFilenameMeta(codeNode: Element): string | null {
  // Look for a data-meta attribute injected by remark-mdast metas
  const meta =
    (codeNode.data as { meta?: string } | undefined)?.meta ??
    (codeNode.properties?.metastring as string | undefined);
  if (!meta) return null;
  const m = meta.match(/(?:title|filename|file)=["']?([^"'\s]+)["']?/);
  return m?.[1] ?? null;
}
