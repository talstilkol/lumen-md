/**
 * Plan W7.9 step 1, the block half: a block of Yiddish or Ladino inside a
 * note in another language is tagged with an HTML block (`<div lang="yi">`,
 * blank lines around its Markdown), which the preview and the export keep,
 * so screen readers and fonts switch for that block only; its direction
 * still comes from its own text.
 */
import { describe, expect, it } from "vitest";
import { renderHtmlDocument } from "../storage/exportHtml";

const NOTE = [
  "# Family letters",
  "",
  "An English note with a Yiddish and a Ladino passage.",
  "",
  '<div lang="yi">',
  "",
  "ליבע קינדער, איך שרייַב אייַך דעם בריוו.",
  "",
  "</div>",
  "",
  '<div lang="lad-Hebr">',
  "",
  "קי חאבֿיר? אקי ירושלים.",
  "",
  "</div>",
  "",
  '<p lang="lad-Latn">Ke haber? Aki Yerushalayim.</p>',
].join("\n");

describe("a language tag on one block (W7.9)", () => {
  it("keeps lang on each block, the note's own tag on <html>, and each block's direction from its text", async () => {
    const html = await renderHtmlDocument(NOTE, { title: "Letters" });
    expect(html).toMatch(/<html lang="en" dir="ltr"/);
    const yi = /<div lang="yi"[^>]*>\s*<p[^>]*>([^<]*)<\/p>/.exec(html);
    expect(yi?.[1]).toContain("ליבע קינדער");
    expect(yi?.[0]).toMatch(/dir="(rtl|auto)"/);
    expect(html).toMatch(/<div lang="lad-Hebr"[^>]*>\s*<p[^>]*dir="(rtl|auto)"[^>]*>קי חאבֿיר/);
    expect(html).toMatch(/<p lang="lad-Latn"[^>]*>Ke haber/);
  });

  it("keeps lang but not a handler on a tagged block", async () => {
    const html = await renderHtmlDocument('<div lang="yi" onclick="alert(1)">\n\nשלום\n\n</div>', { title: "X" });
    expect(html).toMatch(/<div lang="yi"/);
    expect(html).not.toMatch(/onclick|alert/);
  });
});
