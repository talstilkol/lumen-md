/**
 * W12.S5 — garden features on the published site, on a synthetic vault of
 * 100 Hebrew notes (labelled synthetic: generated here, not real data):
 * backlinks, a local graph, tags with tag pages, previews, per-page
 * lang/dir, no broken internal links, and the site's own search finding
 * "בירושלים" from "ירושלים" and back.
 */
import { describe, it, expect } from "vitest";
import { buildSite, SEARCH_JS, type SiteFile, type SiteNote } from "../publish/site";
import { backlinkMap, noteTags, outgoingLinks, textLang } from "../publish/siteGarden";
import type { HtmlDocumentOptions } from "../storage/exportHtml";

/** The same stand-in renderer shape as publishSite.test.ts. */
async function render(md: string, opts: HtmlDocumentOptions): Promise<string> {
  const rtl = /^[^A-Za-z]*[֐-׿]/.test(md.replace(/^---[\s\S]*?---/, "").replace(/[#\s*_-]/g, ""));
  const body = md
    .replace(/^---[\s\S]*?---\n?/, "")
    .replace(/\[\[([^\]|]+)\]\]/g, (_m, t: string) => `<a class="wiki-link" data-wiki-target="${t}" href="#${t.toLowerCase().replace(/\s+/g, "-")}">${t}</a>`)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/^# (.*)$/gm, '<h1 id="$1">$1</h1>');
  return `<!doctype html>\n<html lang="${rtl ? "he" : "en"}" dir="${rtl ? "rtl" : "ltr"}" class="">\n<head>\n<title>${opts.title}</title>${opts.head ?? ""}\n</head>\n<body>\n${opts.before ?? ""}<main class="prose-lumen lumen-export">\n${body}\n</main>\n</body>\n</html>`;
}

const CITIES = ["ירושלים", "חיפה", "באר שבע", "צפת", "טבריה"];
/** 100 synthetic Hebrew notes in 4 folders, each linking to the next and to a hub; tags in frontmatter and inline. */
function vault(): SiteNote[] {
  const notes: SiteNote[] = [{ path: "index.md", content: "# הגן\n\nמתחילים ב־[[מרכז]]." }, { path: "מרכז.md", content: "# מרכז\n\nדף מרכזי. #מרכזי" }];
  for (let i = 1; i <= 98; i++) {
    const city = CITIES[i % CITIES.length];
    const next = (i % 98) + 1;
    notes.push({
      path: `${["היסטוריה", "גאוגרפיה", "אנשים", "יומן"][i % 4]}/פתק ${i}.md`,
      content: `---\ntags: [${i % 2 ? "זוגי-לא" : "זוגי"}]\n---\n# פתק ${i}\n\nביקרנו ב${city} ביום ${i}. ראו [[פתק ${next}]] ו־[[מרכז]]. #${city.replace(/\s/g, "_")}\n`,
    });
  }
  return notes;
}

const text = (files: SiteFile[], path: string): string => {
  const f = files.find((x) => x.path === path);
  if (!f) throw new Error(`no ${path}`);
  return typeof f.data === "string" ? f.data : new TextDecoder().decode(f.data);
};

describe("garden helpers", () => {
  it("tags from frontmatter (inline and list) and from #tags, not from headings, code or numbers", () => {
    expect(noteTags("---\ntags: [a, \"b\"]\n---\n# H\n\ntext #עברית and `#code` #12 (#x/y)")).toEqual(["a", "b", "x/y", "עברית"]);
    expect(noteTags("---\ntags:\n  - one\n  - two\n---\nbody")).toEqual(["one", "two"]);
  });

  it("lang and dir from the page's own letters", () => {
    expect(textLang("שלום עולם and a bit", "en")).toEqual({ lang: "he", dir: "rtl" });
    expect(textLang("Hello עולם", "he")).toEqual({ lang: "en", dir: "ltr" });
    expect(textLang("123", "he")).toEqual({ lang: "he", dir: "rtl" });
  });

  it("outgoing links resolve relative hrefs to existing pages only; backlinks invert them", () => {
    const outputs = new Set(["a/x.html", "b/y.html", "index.html"]);
    const html = '<main><a href="../b/y.html#h">y</a><a href="x.html">self</a><a href="https://e.com/z.html">ext</a><a href="../nope.html">n</a></main>';
    expect(outgoingLinks(html, "a/x.html", outputs)).toEqual(["b/y.html"]);
    expect(backlinkMap(new Map([["a/x.html", ["b/y.html"]], ["index.html", ["b/y.html"]]])).get("b/y.html")).toEqual(["a/x.html", "index.html"]);
  });
});

describe("a 100-note Hebrew garden", () => {
  it("every page has backlinks and a local graph; 0 broken internal links; tag pages exist", async () => {
    const { files, pages } = await buildSite(vault(), { title: "הגן", lang: "he", render });
    expect(pages).toHaveLength(100);
    const html = new Map(files.filter((f) => f.path.endsWith(".html")).map((f) => [f.path, text(files, f.path)]));

    const hub = html.get("מרכז.html")!;
    const hubBack = /<section class="lumen-garden-backlinks">[\s\S]*?<\/section>/.exec(hub)![0];
    expect((hubBack.match(/<li>/g) ?? []).length).toBe(99); // index + 98 notes
    expect(hub).toContain('<h2>דפים שמקשרים לכאן</h2>');
    const p5 = html.get("גאוגרפיה/פתק 5.html") ?? html.get("אנשים/פתק 5.html")!;
    expect(p5).toMatch(/<a href="[^"]*%D7%A4%D7%AA%D7%A7%204\.html">פתק 4<\/a>/); // linked from note 4
    expect(p5).toContain('<figure class="lumen-garden-graph">');
    expect(p5).toContain(`href="../tags/${encodeURIComponent("ירושלים")}.html" rel="tag">#ירושלים</a>`);
    expect(html.has("tags/ירושלים.html")).toBe(true);
    expect(html.get("tags/ירושלים.html")).toContain("פתק 5");

    // No internal link points at a page the site does not have.
    const broken: string[] = [];
    for (const [path, page] of html) {
      const dir = path.split("/").slice(0, -1);
      for (const m of page.matchAll(/\shref="([^"#?]+)(?:[#?][^"]*)?"/g)) {
        if (/^([a-z]+:|\/\/|\/)/i.test(m[1])) continue;
        const parts = [...dir];
        for (const seg of decodeURIComponent(m[1]).split("/")) seg === ".." ? parts.pop() : seg !== "." && parts.push(seg);
        const target = parts.join("/");
        if (!files.some((f) => f.path === target)) broken.push(`${path} → ${target}`);
      }
    }
    expect(broken).toEqual([]);
    expect(files.some((f) => f.path === "preview.js")).toBe(true);
    expect(hub).toContain('<script src="preview.js" defer></script>');
  });

  it("a Hebrew note on an English site gets lang=he; garden: false leaves the page as before", async () => {
    const notes: SiteNote[] = [{ path: "a.md", content: "# Hello\n\nEnglish text [[b]]." }, { path: "b.md", content: "# שלום\n\nטקסט בעברית." }];
    const on = await buildSite(notes, { title: "G", lang: "en", render });
    expect(text(on.files, "b.html")).toContain('<html lang="he" dir="rtl"');
    expect(text(on.files, "b.html")).toContain('<h2>Linked from</h2>');
    const off = await buildSite(notes, { title: "G", lang: "en", render, garden: false });
    expect(text(off.files, "b.html")).not.toContain("lumen-garden");
    expect(off.files.some((f) => f.path === "preview.js")).toBe(false);
  });

  it("the site's search finds בירושלים from ירושלים and ירושלים from בירושלים, with or without niqqud", async () => {
    const { files } = await buildSite(vault(), { title: "הגן", lang: "he", render });
    const index = text(files, "search-index.json");
    document.body.innerHTML = '<input id="lumen-site-q"><ul id="lumen-site-results" hidden data-empty="אין"></ul>';
    globalThis.fetch = (async () => new Response(index, { headers: { "content-type": "application/json" } })) as typeof fetch;
    new Function(SEARCH_JS)();
    const q = document.getElementById("lumen-site-q") as HTMLInputElement;
    const results = async (v: string) => {
      q.value = v;
      q.dispatchEvent(new Event("input"));
      await new Promise((r) => setTimeout(r, 30));
      return [...document.querySelectorAll("#lumen-site-results a")].map((a) => a.textContent);
    };
    const plain = await results("ירושלים");
    expect(plain.length).toBeGreaterThan(0);
    expect(plain).toContain("פתק 5");
    expect(await results("בירושלים")).toEqual(plain);
    expect(await results("יְרוּשָׁלַיִם")).toEqual(plain);
    expect(await results("שלום")).toEqual([]); // a short word is not broadened (no "לום")
  });
});
