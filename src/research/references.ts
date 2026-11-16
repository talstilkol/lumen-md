/**
 * The reference list at the end of a research answer (plan 6.13, W10.E38):
 * every source the answer cites, as a web reference in APA 7, Chicago
 * author-date or MLA 9 (Lumen's own formatter, data/citationStyles.ts), in
 * the answer's language. The footnotes stay; this is the list a paper needs.
 */
import { formatReference, runsToMarkdown, type CitationLang, type CitationStyle } from "../data/citationStyles";

export interface CitedSource {
  title: string;
  url: string;
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/** Hebrew when the question is mostly Hebrew letters. */
export function answerLang(question: string): CitationLang {
  const he = question.match(/[א-ת]/g)?.length ?? 0;
  const la = question.match(/[A-Za-z]/g)?.length ?? 0;
  return he > la ? "he" : "en";
}

/** The "References" section (heading and one line per source), or [] when nothing is cited. Sources by first citation; the same URL once. */
export function referenceSection(sources: readonly CitedSource[], style: CitationStyle = "apa", lang: CitationLang = "en"): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const s of sources) {
    if (!/^https?:\/\//i.test(s.url) || seen.has(s.url)) continue;
    seen.add(s.url);
    lines.push(`- ${runsToMarkdown(formatReference({ type: "web", authors: [], title: s.title || hostOf(s.url), container: hostOf(s.url), url: s.url }, style, lang))}`);
  }
  if (!lines.length) return [];
  return [lang === "he" ? "## מקורות" : "## References", "", ...lines, ""];
}
