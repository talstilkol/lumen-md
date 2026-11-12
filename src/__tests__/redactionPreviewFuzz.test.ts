/**
 * Review F-8 (coordinator's decision, 12.11): the export's mark parser
 * (`redactMarks`) and the preview's HTML parser (parse5 through rehype-raw)
 * are different code. The property that matters: every passage the preview
 * shades as redacted is gone from the export (preview ⊆ export). The export
 * may remove more (it fails closed); it must never keep a shaded passage.
 *
 * The preview's side is the browser's own HTML parser (`DOMParser`), which
 * implements the same WHATWG tokenizer and tree builder as parse5. Over a
 * seeded fuzz set of `<redact>` tag variants and the HTML constructs that
 * change how a tag is read (comments, other tags' attributes, raw-text
 * elements, CDATA, end of input), each text run carries a unique token; a
 * token inside a `redact` element must not survive `exportReadyText`.
 * Under vitest's jsdom, DOMParser is parse5 itself, the preview's parser; in
 * the offline Chromium harness it is Blink's. Skipped where there is none.
 */
import { describe, expect, it } from "vitest";
import { exportReadyText } from "../storage/exportReady";

/** A small seeded PRNG (mulberry32), so a failure names a case that comes back. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = ["redact", "REDACT", "Redact", "rEdAcT"];
const AFTER = ["", " ", "\t", "\n", "\f", "\r", "/", " /", "  "];
const ATTRS = ["", ' class="x"', " id=1", " title='a>b'", ' title="a>b"', " a=b>c", " x=`y`", ' data-x="</redact>"', " a", ' a="', " a='", " /x", " =x"];
const CLOSERS = ["</redact>", "</REDACT>", "</redact >", "</redact\t>", "</redact foo>", "</redact/>", "</redact x='>'>", "</ redact>", "</redact", "</redactx>", "</redac>"];
/** Constructs that change how what follows them is read. `@` is where a closing tag variant goes. */
const WRAPS = [
  "<!-- @ -->",
  "<!--@-->",
  "<!-->@",
  "<!--->@",
  "<!-- @",
  "<!--- @ --->",
  "<!@>",
  "<?@?>",
  '<a title="@">',
  "<a title='@'>",
  "<a title=@>",
  '<img alt="@">',
  "<script>@</script>",
  "<style>@</style>",
  "<textarea>@</textarea>",
  "<title>@</title>",
  "<xmp>@</xmp>",
  "<noembed>@</noembed>",
  "<noframes>@</noframes>",
  "<iframe>@</iframe>",
  "<svg><![CDATA[@]]></svg>",
  "<math><![CDATA[@]]></math>",
  "<svg><title>@</title></svg>",
  "`@`",
  "\\@",
  "&lt;@",
  "<p>@</p>",
  "<table><tr><td>@</td></tr></table>",
  "<b>@</b>",
  "@",
];

const pick = <T,>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

function openTag(r: () => number): string {
  const after = pick(r, AFTER);
  const attrs = after === "" || after.endsWith("/") ? "" : pick(r, ATTRS);
  return `<${pick(r, NAMES)}${after}${attrs}${r() < 0.85 ? ">" : ""}`;
}

/** One case: text runs, each with its own token, around marks and wrapped closing variants. */
function makeCase(r: () => number): { md: string; tokens: string[] } {
  const tokens: string[] = [];
  const tok = () => {
    const t = `TK${tokens.length}Q`;
    tokens.push(t);
    return t;
  };
  let md = tok();
  const parts = 1 + Math.floor(r() * 4);
  for (let p = 0; p < parts; p++) {
    md += ` ${openTag(r)}${tok()}`;
    const inner = Math.floor(r() * 3);
    for (let k = 0; k < inner; k++) {
      const what = r();
      if (what < 0.5) md += pick(r, WRAPS).replace("@", pick(r, CLOSERS)) + tok();
      else if (what < 0.7) md += `${openTag(r)}${tok()}`;
      else md += (r() < 0.5 ? "\n\n" : " ") + tok();
    }
    if (r() < 0.8) md += pick(r, CLOSERS);
    md += ` ${tok()}`;
  }
  return { md, tokens };
}

/** The tokens the preview shades: inside a `redact` element of the parsed document. */
function shadedTokens(md: string, tokens: string[]): string[] {
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${md}</body>`, "text/html");
  const shaded = [...doc.querySelectorAll("redact")].map((e) => e.textContent ?? "").join("\u0000");
  return tokens.filter((t) => shaded.includes(t));
}

const haveDom = typeof DOMParser !== "undefined" && typeof document !== "undefined";

describe("what the preview shades, the export removes (F-8, preview ⊆ export)", () => {
  (haveDom ? it : it.skip)("the fixed corpus and 3,000 seeded variants: no shaded token survives the export", async () => {
    const S = "סוד-מקור";
    const corpus = [
      `<redact class="x">${S}</redact>`,
      `<redact\tid=1>${S}</redact>`,
      `<redact/>${S}`,
      `<redact title='a>b'>${S}</redact>`,
      `<redact><!-- </redact> -->${S}</redact>`,
      `<redact><a title="</redact>">${S}</a></redact>`,
      `<redact><script></redact></script>${S}</redact>`,
      `<redact><textarea></redact></textarea>${S}</redact>`,
      `<redact><svg><![CDATA[</redact>]]></svg>${S}</redact>`,
    ];
    const cases = corpus.map((md) => ({ md, tokens: [S] }));
    const r = rng(0x4c554d45);
    for (let i = 0; i < 3000; i++) cases.push(makeCase(r));
    const kept: string[] = [];
    let shadedTotal = 0;
    for (const { md, tokens } of cases) {
      const shaded = shadedTokens(md, tokens);
      if (!shaded.length) continue;
      shadedTotal += shaded.length;
      const out = await exportReadyText(md);
      const leak = shaded.filter((t) => out.includes(t));
      if (leak.length) kept.push(`${JSON.stringify(md)} kept ${leak.join(",")} → ${JSON.stringify(out)}`);
    }
    // The fuzz set does reach the preview's shading: a corpus that shaded nothing would prove nothing.
    expect(shadedTotal).toBeGreaterThan(2000);
    expect(kept.slice(0, 10)).toEqual([]);
  }, 60_000);

  it("a closing mark the Markdown layer shows as text ends nothing: code, math, link targets, escapes", async () => {
    const S = "Dana Levi";
    for (const md of [
      `<redact>a \`</redact>\` ${S}</redact> b`,
      `<redact>a \`x\n</redact>\` ${S}</redact> b`,
      `<redact>a \\</redact> ${S}</redact> b`,
      `<redact>a $x</redact>$ ${S}</redact> b`,
      `<redact>a [l](</redact>) ${S}</redact> b`,
      `<redact>a [l](x "</redact>") ${S}</redact> b`,
      `<redact>a [[</redact>]] ${S}</redact> b`,
      `<redact>\n\n\`\`\`\n</redact>\n\`\`\`\n\n${S}</redact> b`,
      `<redact>\n\n    </redact>\n\n${S}</redact> b`,
    ]) {
      const out = await exportReadyText(md);
      expect(out, JSON.stringify(md)).not.toContain(S);
      expect(out.endsWith(" b"), JSON.stringify(md)).toBe(true);
    }
    // A closing mark the preview does read still closes: the text after it stays.
    expect(await exportReadyText(`<redact>${S}</redact> <p>kept</p> \`code\` after`)).toBe(`█████ <p>kept</p> \`code\` after`);
    expect(await exportReadyText(`<redact><b>${S}</b><span>x</span></redact> kept`)).toBe("█████ kept");
  });
});
