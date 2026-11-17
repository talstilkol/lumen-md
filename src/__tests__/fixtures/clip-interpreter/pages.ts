/**
 * The 20 synthetic golden pages of the clip interpreter (plan W2.14), shared
 * by the unit test (clipInterpreter.test.ts, a stand-in model) and the
 * real-model eval (src/agents/eval/clipInterpreter.eval.ts).
 *
 * Every page is written here, after each site's public markup (its <meta>
 * tags, ld+json, the elements the templates read). No page of those sites
 * is stored.
 *
 * `fields`: what the page itself fills (title, author, dates...), and, for
 * the stand-in model that answers each prompt with the first sentence of
 * its context, the prompt fields too.
 * `model`: what a real model's answer to each prompt field must satisfy to
 * count as right (the eval's scorer, clipInterpreterScore.ts): its
 * language, its shape, and at least one of the key terms the page states.
 */
import type { FieldExpectation } from "../../../../scripts/eval/lib/clipInterpreterScore";

export function wikipedia(title: string, lead: string): string {
  return `<!doctype html><html lang="en"><head><title>${title} - Wikipedia</title><meta property="og:site_name" content="Wikipedia"></head><body><div id="mw-navigation">Main page Contents Random article</div><h1 id="firstHeading">${title}</h1><div id="mw-content-text"><div class="mw-parser-output"><p>${lead} ${"It has a long and well documented history that many sources describe. ".repeat(3)}</p><p>${"Later sections cover its geography, economy and culture in detail. ".repeat(4)}</p></div></div><footer>Text is available under the Creative Commons Attribution-ShareAlike License</footer></body></html>`;
}

function news(site: "ynet" | "haaretz", title: string, author: string, published: string, lead: string): string {
  const name = site === "ynet" ? "ynet" : "הארץ";
  return `<!doctype html><html lang="he" dir="rtl"><head><title>${title} | ${name}</title><meta property="og:site_name" content="${name}"><meta name="author" content="${author}"><meta property="article:published_time" content="${published}"><script type="application/ld+json">${JSON.stringify({ "@type": "NewsArticle", headline: title, author: { "@type": "Person", name: author }, datePublished: published })}</script></head><body><header>תפריט ראשי חדשות ספורט כלכלה</header><article><h1>${title}</h1><p>${lead} ${"הכתבה ממשיכה בפרטים נוספים על האירוע ועל תגובות הגורמים המעורבים בו. ".repeat(3)}</p><p>${"בהמשך מובאים נתונים, ציטוטים ורקע היסטורי שמסבירים את ההקשר הרחב. ".repeat(4)}</p></article><footer>כל הזכויות שמורות</footer></body></html>`;
}

function youtube(title: string, channel: string, published: string, description: string): string {
  return `<!doctype html><html lang="en"><head><title>${title} - YouTube</title><meta name="description" content="${description}"><meta property="og:title" content="${title}"><meta itemprop="datePublished" content="${published}"></head><body><div id="masthead">YouTube Home Shorts Subscriptions</div><h1>${title}</h1><span itemprop="author"><link itemprop="name" content="${channel}"></span><div id="description">${description} ${"Links and chapters follow below in the description box. ".repeat(3)}</div></body></html>`;
}

function arxiv(id: string, title: string, authors: string[], date: string, abstract: string): string {
  const metas = [`<meta name="citation_title" content="${title}">`, ...authors.map((a) => `<meta name="citation_author" content="${a}">`), `<meta name="citation_date" content="${date}">`, `<meta name="citation_arxiv_id" content="${id}">`, `<meta name="citation_pdf_url" content="https://arxiv.org/pdf/${id}">`].join("");
  return `<!doctype html><html lang="en"><head><title>[${id}] ${title}</title>${metas}</head><body><div id="header">arXiv cs</div><h1 class="title mathjax"><span class="descriptor">Title:</span>${title}</h1><div class="authors">${authors.join(", ")}</div><blockquote class="abstract mathjax"><span class="descriptor">Abstract:</span>${abstract} ${"We evaluate the approach on several benchmarks and report consistent gains. ".repeat(2)}</blockquote><div class="submission-history">Submission history</div></body></html>`;
}

function github(repo: string, about: string, readme: string): string {
  return `<!doctype html><html lang="en"><head><title>GitHub - ${repo}: ${about}</title><meta property="og:title" content="${repo}"><meta property="og:description" content="${about}"><meta property="og:site_name" content="GitHub"></head><body><header>Product Solutions Open Source Pricing</header><p class="f4 my-3">${about}</p><article class="markdown-body"><h1>${repo.split("/")[1]}</h1><p>${readme} ${"Install it with your package manager and see the docs for the options. ".repeat(3)}</p></article></body></html>`;
}

export interface Page {
  url: string;
  html: string;
  transcript?: string;
  template: string;
  /** Property → expected value (the stand-in model answers each prompt with the first sentence of its context). */
  fields: Record<string, string>;
  /** Prompt property → what a real model's answer must satisfy. */
  model: Record<string, FieldExpectation>;
}

export const PAGES: Page[] = [
  { url: "https://en.wikipedia.org/wiki/Rome", html: wikipedia("Rome", "Rome is the capital city of Italy."), template: "wikipedia", fields: { title: "Rome", license: "CC BY-SA 4.0", summary: "Rome" }, model: {"summary": {"kind": "sentence", "lang": "en", "anyOf": ["capital", "Italy"]}} },
  { url: "https://he.wikipedia.org/wiki/Haifa", html: wikipedia("Haifa", "Haifa is a port city in northern Israel."), template: "wikipedia", fields: { title: "Haifa", license: "CC BY-SA 4.0", summary: "Haifa" }, model: {"summary": {"kind": "sentence", "lang": "en", "anyOf": ["port", "Israel"]}} },
  { url: "https://en.m.wikipedia.org/wiki/Moby-Dick", html: wikipedia("Moby-Dick", "Moby-Dick is an 1851 novel by Herman Melville."), template: "wikipedia", fields: { title: "Moby-Dick", license: "CC BY-SA 4.0", summary: "Moby-Dick" }, model: {"summary": {"kind": "sentence", "lang": "en", "anyOf": ["novel", "Melville", "1851"]}} },
  { url: "https://fr.wikipedia.org/wiki/Paris", html: wikipedia("Paris", "Paris is the capital of France."), template: "wikipedia", fields: { title: "Paris", license: "CC BY-SA 4.0", summary: "Paris" }, model: {"summary": {"kind": "sentence", "lang": "en", "anyOf": ["capital", "France"]}} },
  { url: "https://www.ynet.co.il/news/article/abc123", html: news("ynet", "גשם ראשון בצפון", "דנה לוי", "2026-11-01T08:00:00Z", "הגשם הראשון של העונה ירד הלילה בצפון."), template: "ynet", fields: { title: "גשם ראשון בצפון", author: "דנה לוי", published: "2026-11-01", summary: "גשם ראשון בצפון" }, model: {"summary": {"kind": "sentence", "lang": "he", "anyOf": ["גשם", "צפון"]}, "topics": {"kind": "list", "lang": "he", "anyOf": ["גשם", "צפון", "מזג אוויר", "עונה"], "min": 3, "max": 5}} },
  { url: "https://www.ynet.co.il/economy/article/def456", html: news("ynet", "הריבית נותרה ללא שינוי", "יוסי כהן", "2026-10-28T12:30:00Z", "בנק ישראל הודיע כי הריבית נותרה ללא שינוי."), template: "ynet", fields: { title: "הריבית נותרה ללא שינוי", author: "יוסי כהן", published: "2026-10-28", summary: "הריבית נותרה ללא שינוי" }, model: {"summary": {"kind": "sentence", "lang": "he", "anyOf": ["ריבית", "בנק ישראל"]}, "topics": {"kind": "list", "lang": "he", "anyOf": ["ריבית", "בנק ישראל", "כלכלה"], "min": 3, "max": 5}} },
  { url: "https://www.ynetnews.com/article/ghi789", html: news("ynet", "New bridge opens", "Maya Stern", "2026-09-15T06:00:00Z", "A new bridge opened to traffic this morning."), template: "ynet", fields: { title: "New bridge opens", author: "Maya Stern", published: "2026-09-15", summary: "New bridge opens" }, model: {"summary": {"kind": "sentence", "lang": "en", "anyOf": ["bridge"]}, "topics": {"kind": "list", "lang": "en", "anyOf": ["bridge", "traffic", "transport", "infrastructure"], "min": 3, "max": 5}} },
  { url: "https://www.haaretz.co.il/news/politics/2026-11-02/ty-article/1", html: news("haaretz", "הכנסת אישרה את התקציב", "נועה ברק", "2026-11-02T20:00:00Z", "מליאת הכנסת אישרה הערב את תקציב המדינה."), template: "haaretz", fields: { title: "הכנסת אישרה את התקציב", author: "נועה ברק", published: "2026-11-02", summary: "הכנסת אישרה את התקציב" }, model: {"summary": {"kind": "sentence", "lang": "he", "anyOf": ["תקציב", "כנסת"]}, "topics": {"kind": "list", "lang": "he", "anyOf": ["תקציב", "כנסת", "פוליטיקה"], "min": 3, "max": 5}} },
  { url: "https://www.haaretz.co.il/science/2026-10-20/ty-article/2", html: news("haaretz", "גילוי חדש במדבר", "עמית רון", "2026-10-20T10:00:00Z", "חוקרים גילו ממצא ארכאולוגי חדש במדבר יהודה."), template: "haaretz", fields: { title: "גילוי חדש במדבר", author: "עמית רון", published: "2026-10-20", summary: "גילוי חדש במדבר" }, model: {"summary": {"kind": "sentence", "lang": "he", "anyOf": ["ארכאולוג", "מדבר", "ממצא"]}, "topics": {"kind": "list", "lang": "he", "anyOf": ["ארכאולוגיה", "מדבר", "ממצא", "מדבר יהודה", "מחקר"], "min": 3, "max": 5}} },
  { url: "https://www.haaretz.com/israel-news/2026-10-05/ty-article/3", html: news("haaretz", "Tech exports rise", "Lior Ben", "2026-10-05T09:00:00Z", "Israel's tech exports rose again this quarter."), template: "haaretz", fields: { title: "Tech exports rise", author: "Lior Ben", published: "2026-10-05", summary: "Tech exports rise" }, model: {"summary": {"kind": "sentence", "lang": "en", "anyOf": ["export", "tech"]}, "topics": {"kind": "list", "lang": "en", "anyOf": ["tech", "export", "economy", "israel"], "min": 3, "max": 5}} },
  { url: "https://www.youtube.com/watch?v=aaa111", html: youtube("How sourdough works", "Bake Lab", "2026-08-01", "We explain the chemistry of sourdough bread."), template: "youtube", fields: { title: "How sourdough works", channel: "Bake Lab", published: "2026-08-01", summary: "We explain the chemistry of sourdough bread." }, model: {"summary": {"kind": "sentence", "lang": "en", "anyOf": ["sourdough", "bread", "chemistry"]}} },
  { url: "https://www.youtube.com/watch?v=bbb222", html: youtube("שיעור עברית למתחילים", "לומדים עברית", "2026-07-10", "שיעור ראשון בקריאה ובכתיבה."), transcript: "שלום לכולם וברוכים הבאים לשיעור הראשון. היום נלמד את האותיות.", template: "youtube", fields: { title: "שיעור עברית למתחילים", channel: "לומדים עברית", published: "2026-07-10", summary: "שלום לכולם וברוכים הבאים לשיעור הראשון." }, model: {"summary": {"kind": "sentence", "lang": "he", "anyOf": ["שיעור", "אותיות", "עברית"]}} },
  { url: "https://youtu.be/ccc333", html: youtube("Fixing a bike chain", "Garage Tips", "2026-06-20", "A quick guide to fixing a broken chain."), template: "youtube", fields: { title: "Fixing a bike chain", channel: "Garage Tips", published: "2026-06-20", summary: "A quick guide to fixing a broken chain." }, model: {"summary": {"kind": "sentence", "lang": "en", "anyOf": ["chain", "bike"]}} },
  { url: "https://arxiv.org/abs/2601.00001", html: arxiv("2601.00001", "Small Models for Hebrew Diacritics", ["A. Levi", "B. Cohen"], "2026/01/02", "We present a small model that restores Hebrew diacritics."), template: "arxiv", fields: { title: "Small Models for Hebrew Diacritics", authors: "A. Levi, B. Cohen", arxiv: "2601.00001", published: "2026/01/02", pdf: "https://arxiv.org/pdf/2601.00001", contribution: "Abstract:We present a small model that restores Hebrew diacritics." }, model: {"contribution": {"kind": "sentence", "lang": "en", "anyOf": ["diacritic"]}} },
  { url: "https://arxiv.org/abs/2602.02104", html: arxiv("2602.02104", "Long Context Retrieval", ["C. Mor"], "2026/02/10", "We study retrieval over very long contexts."), template: "arxiv", fields: { title: "Long Context Retrieval", authors: "C. Mor", arxiv: "2602.02104", published: "2026/02/10", pdf: "https://arxiv.org/pdf/2602.02104", contribution: "Abstract:We study retrieval over very long contexts." }, model: {"contribution": {"kind": "sentence", "lang": "en", "anyOf": ["long context", "retrieval"]}} },
  { url: "https://arxiv.org/abs/2603.11111", html: arxiv("2603.11111", "OCR for Mixed Scripts", ["D. Ziv", "E. Tal", "F. Or"], "2026/03/03", "Mixed-script lines are hard for OCR engines."), template: "arxiv", fields: { title: "OCR for Mixed Scripts", authors: "D. Ziv, E. Tal, F. Or", arxiv: "2603.11111", published: "2026/03/03", pdf: "https://arxiv.org/pdf/2603.11111", contribution: "Abstract:Mixed-script lines are hard for OCR engines." }, model: {"contribution": {"kind": "sentence", "lang": "en", "anyOf": ["OCR", "mixed-script", "mixed script"]}} },
  { url: "https://www.arxiv.org/abs/2604.22222", html: arxiv("2604.22222", "Local Agents", ["G. Bar"], "2026/04/04", "Agents that run fully on device."), template: "arxiv", fields: { title: "Local Agents", authors: "G. Bar", arxiv: "2604.22222", published: "2026/04/04", pdf: "https://arxiv.org/pdf/2604.22222", contribution: "Abstract:Agents that run fully on device." }, model: {"contribution": {"kind": "sentence", "lang": "en", "anyOf": ["on device", "on-device", "local"]}} },
  { url: "https://github.com/example/notes-app", html: github("example/notes-app", "A local-first notes app.", "Notes app keeps your notes on your device."), template: "github", fields: { title: "example/notes-app", description: "A local-first notes app.", purpose: "A local-first notes app." }, model: {"purpose": {"kind": "sentence", "lang": "en", "anyOf": ["notes"]}} },
  { url: "https://github.com/example/hebrew-tools", html: github("example/hebrew-tools", "Tools for Hebrew text.", "Hebrew tools normalise, segment and point text."), template: "github", fields: { title: "example/hebrew-tools", description: "Tools for Hebrew text.", purpose: "Tools for Hebrew text." }, model: {"purpose": {"kind": "sentence", "lang": "en", "anyOf": ["Hebrew"]}} },
  { url: "https://github.com/example/tiny-db/tree/main", html: github("example/tiny-db", "A tiny embedded database.", "Tiny DB stores rows in one file."), template: "github", fields: { title: "example/tiny-db", description: "A tiny embedded database.", purpose: "A tiny embedded database." }, model: {"purpose": {"kind": "sentence", "lang": "en", "anyOf": ["database", "db"]}} },
];

/** The note's front matter as name → value: the eval's own reader, so the test and the eval read notes alike. */
export { frontmatterOf as frontmatter } from "../../../../scripts/eval/lib/clipInterpreterRun";
