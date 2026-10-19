/**
 * Autonomous research agent (Plan D: D6): question → searches → sources →
 * a Markdown note whose claims carry footnotes with the supporting quote,
 * each quote checked against the source text.
 *
 * Two routes:
 *  - Claude web search (provider Anthropic): one Messages API call with the
 *    server-side `web_search` tool; Claude's citations come with verbatim
 *    `cited_text`.
 *  - Brave / Tavily with the user's key, through the research worker:
 *    plan queries → search → read pages → pack the relevant parts
 *    (context packer) → answer with numbered citations + verbatim quotes →
 *    every quote verified against the page text it came from.
 *
 * Caps: searches, sources and answer length; the usage meter records
 * every model call.
 */
import { anthropicWebResearch, type CitedBlock } from "../ai/anthropicProvider";
import { CONTEXT_BUDGET, getAiMode, packContext } from "../ai/contextPacker";
import { chat, getActiveProvider, getProviderKey, parseJsonResponse } from "../ai/llm";
import { recordUsage } from "../ai/usage";
import { chargeAiCommandDispatch } from "../billing/aiQuota";
import { APPROXIMATE_AT, quoteCoverage } from "./citations";
import { extractPage, getResearchSettings, researchEndpoint, searchWeb, type ExtractedPage, type ResearchSettings, type SearchHit } from "./client";
import { assertCloudAllowed, getAiPolicy, isLocalOrigin } from "../ai/policy";

export interface ResearchOptions {
  question: string;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
  /** Pages read (proxy route) — default 6. */
  maxSources?: number;
  /** Search requests — default 4 (proxy) / 5 (Claude). */
  maxSearches?: number;
  /** Injected for tests. */
  deps?: {
    extract?: (url: string) => Promise<ExtractedPage>;
    search?: (q: string, s: ResearchSettings) => Promise<SearchHit[]>;
    settings?: ResearchSettings;
  };
}

export interface ResearchResult {
  markdown: string;
  route: "claude" | "brave" | "tavily" | "searxng" | "library";
  sources: number;
  /** Footnotes whose quote couldn't be found in the source text. */
  unverified: number;
}

const SYSTEM_REPORT =
  "You are a careful research assistant. Answer the question in a well-structured Markdown report: a two-sentence summary first, " +
  "then sections with short paragraphs. State only what the sources support, say where they disagree or where evidence is thin, " +
  "and never invent facts, numbers or sources.";

const title = (q: string) => q.replace(/\s+/g, " ").trim().slice(0, 120);
const hostOf = (u: string) => {
  try {
    return new URL(u).hostname;
  } catch {
    return u;
  }
};
const footnote = (n: number, src: { title: string; url: string }, quote: string, flag = "") =>
  `[^${n}]: [${(src.title || hostOf(src.url)).replace(/[[\]]/g, "")}](${src.url})${quote ? ` — “${quote.replace(/[“”]/g, '"').replace(/\s+/g, " ")}”` : ""}${flag}`;

/* ─── Claude web search ─────────────────────────────────────────────── */

/** A passage substantial enough to need a source (not a heading or a short connective line). */
/**
 * Replace fenced code blocks and inline code spans with opaque tokens (no
 * punctuation, no `[^n]`, no newlines) so citation and sentence matching
 * only see prose; `restore` puts the code back verbatim.
 */
export function maskCode(md: string): { masked: string; restore: (s: string) => string } {
  const saved: string[] = [];
  const token = (code: string) => `\uE000${saved.push(code) - 1}\uE001`;
  const masked = md
    .replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n {0,3}\1[`~]*[ \t]*(?=\n|$)|(?![\s\S]))/gm, token) // an unclosed fence runs to the end
    // A code span doesn't cross a blank line (a paragraph break).
    .replace(/(`+)(?!`)(?:[^\n]|\n(?![ \t]*\n))*?[^`\n]\1(?!`)/g, token);
  return { masked, restore: (s) => s.replace(/\uE000(\d+)\uE001/g, (_m, i: string) => saved[Number(i)]) };
}

const isClaim = (text: string) => {
  const prose = text.replace(/^\s*#{1,6}\s.*$/gm, "").replace(/\s+/g, " ").trim();
  return prose.length >= 60 && /[.!?]/.test(prose);
};

export function citedBlocksToMarkdown(
  question: string,
  blocks: readonly CitedBlock[],
  now = new Date(),
): { markdown: string; sources: number; unverified: number } {
  let unverified = 0;
  const ids = new Map<string, number>(); // url + quote → footnote number
  const defs: string[] = [];
  const urls = new Set<string>();
  let body = "";
  for (const b of blocks) {
    let refs = "";
    for (const c of b.citations) {
      const key = `${c.url}\n${c.quote}`;
      let n = ids.get(key);
      if (!n) {
        n = ids.size + 1;
        ids.set(key, n);
        defs.push(footnote(n, c, c.quote));
      }
      urls.add(c.url);
      if (!refs.includes(`[^${n}]`)) refs += `[^${n}]`;
    }
    // A substantial passage Claude gave without any source is flagged.
    if (!b.citations.length && isClaim(b.text)) {
      unverified++;
      refs = " ⚠️ *no source cited*";
    }
    // Citations attach to the end of the passage, before trailing whitespace.
    const m = /^([\s\S]*?)(\s*)$/.exec(b.text)!;
    body += m[1] + refs + m[2];
  }
  const markdown = [
    `# ${title(question)}`,
    "",
    `*Researched ${now.toISOString().slice(0, 10)} with Claude web search · ${urls.size} sources · quotes are verbatim from the cited pages${
      unverified ? ` · **${unverified} passage${unverified === 1 ? "" : "s"} without a source**` : ""
    }.*`,
    "",
    body.trim(),
    "",
    ...defs,
    "",
  ].join("\n");
  return { markdown, sources: urls.size, unverified };
}

async function claudeResearch(o: ResearchOptions): Promise<ResearchResult> {
  getProviderKey("anthropic"); // NO_KEY before anything is charged
  o.onProgress?.("Claude is searching and reading…");
  const blocks = await anthropicWebResearch(
    [
      { role: "system", content: SYSTEM_REPORT },
      { role: "user", content: o.question },
    ],
    {
      signal: o.signal,
      maxSearches: o.maxSearches ?? 5,
      maxTokens: 4096,
      // Charged once the first request passes the rate limit, not before.
      charge: chargeAiCommandDispatch,
      onUsage: (u) => recordUsage({ ...u, provider: "anthropic" }),
    },
  );
  const { markdown, sources, unverified } = citedBlocksToMarkdown(o.question, blocks);
  // An answer without web citations isn't research (Claude answered from memory).
  if (!sources) throw new Error("Claude answered without citing any web source — try again or rephrase the question.");
  return { markdown, route: "claude", sources, unverified };
}

/* ─── Brave / Tavily / SearXNG through the research worker ─────────── */

type ProxyProvider = "brave" | "tavily" | "searxng";
const PROVIDER_LABEL: Record<ProxyProvider, string> = { brave: "Brave", tavily: "Tavily", searxng: "SearXNG" };

const QUOTES_MARK = "---QUOTES---";

/**
 * The report and its quotes: for each source number, the supporting
 * passages in the order of that source's markers in the report (one quote
 * per cited claim).
 */
export function parseAnswer(raw: string): { report: string; quotes: Map<number, string[]> } {
  const at = raw.indexOf(QUOTES_MARK);
  const report = (at === -1 ? raw : raw.slice(0, at)).trim();
  const quotes = new Map<number, string[]>();
  if (at !== -1) {
    try {
      const arr = parseJsonResponse<Array<{ n?: number; i?: number; quote?: string }>>(raw.slice(at + QUOTES_MARK.length));
      for (const q of Array.isArray(arr) ? arr : []) {
        if (typeof q.n !== "number") continue;
        const list = quotes.get(q.n) ?? [];
        const quote = typeof q.quote === "string" ? q.quote.trim() : "";
        // `i` names the claim (the i-th marker of that source); without it,
        // entries are in marker order. An empty quote keeps its place.
        if (Number.isInteger(q.i) && q.i! >= 1 && q.i! <= 200) list[q.i! - 1] = quote;
        else list.push(quote);
        quotes.set(q.n, list);
      }
    } catch {
      /* no quotes: footnotes without them */
    }
  }
  return { report, quotes };
}

async function proxyResearch(o: ResearchOptions, settings: ResearchSettings): Promise<ResearchResult> {
  const extract = o.deps?.extract ?? ((u: string) => extractPage(u, o.signal));
  const search = o.deps?.search ?? ((q: string, s: ResearchSettings) => searchWeb(q, s, 5, o.signal));
  const maxSources = o.maxSources ?? 6;

  // 1. Plan searches.
  o.onProgress?.("Planning searches…");
  let queries: string[] = [];
  // Provider errors (no key, quota, network, cancel) stop here, before any
  // search is spent; only an unparseable plan falls back to the question.
  const plan = await chat(
    [
      { role: "system", content: "Reply with a JSON array of 2-4 short web search queries that together answer the user's question. No prose." },
      { role: "user", content: o.question },
    ],
    { maxTokens: 200, temperature: 0.2, tier: "light", signal: o.signal },
  );
  try {
    const arr = parseJsonResponse<unknown>(plan);
    if (Array.isArray(arr)) queries = arr.filter((q): q is string => typeof q === "string" && !!q.trim());
  } catch {
    /* fall back to the question itself */
  }
  if (!queries.length) queries = [o.question];
  queries = queries.slice(0, o.maxSearches ?? 4);

  // 2. Search; interleave results so every query contributes.
  const lists: SearchHit[][] = [];
  let lastError: unknown = null;
  for (const q of queries) {
    o.onProgress?.(`Searching: ${q}`);
    lists.push(
      await search(q, settings).catch((e) => {
        lastError = e;
        return [];
      }),
    );
  }
  // Every search failed (bad key, quota, service down): say why.
  if (lastError && lists.every((l) => !l.length)) throw lastError instanceof Error ? lastError : new Error(String(lastError));
  const picked: SearchHit[] = [];
  const seen = new Set<string>();
  for (let r = 0; picked.length < maxSources && lists.some((l) => l.length > r); r++) {
    for (const l of lists) {
      const h = l[r];
      if (!h || picked.length >= maxSources) continue;
      const key = h.url.replace(/#.*$/, "").replace(/\/$/, "");
      if (seen.has(key)) continue;
      seen.add(key);
      picked.push(h);
    }
  }
  if (!picked.length) throw new Error("The search returned no results.");

  // 3. Read the pages.
  const pages: Array<{ hit: SearchHit; page: ExtractedPage }> = [];
  let done = 0;
  await Promise.all(
    picked.map(async (hit) => {
      const page = await extract(hit.url);
      o.onProgress?.(`Reading sources ${++done}/${picked.length}…`);
      if (page.text && !page.error) pages.push({ hit, page });
    }),
  );
  pages.sort((a, b) => picked.indexOf(a.hit) - picked.indexOf(b.hit));
  if (!pages.length) throw new Error("None of the sources could be read.");

  // 4. Answer from the relevant parts only.
  const budget = Math.min(20_000, CONTEXT_BUDGET[getAiMode()] * 2);
  const packed = packContext(
    o.question,
    pages.map((p, i) => ({ path: `[${i + 1}] ${p.page.title || p.hit.title} — ${p.page.finalUrl}`, content: p.page.text! })),
    budget,
  );
  o.onProgress?.("Writing the answer…");
  const raw = await chat(
    [
      {
        role: "system",
        content:
          SYSTEM_REPORT +
          " Use ONLY the numbered sources below. After each claim add a footnote marker with the source number, like [^2]. " +
          `Then, on its own line, write ${QUOTES_MARK} followed by a JSON array with one entry per footnote marker, in the order the markers appear: ` +
          '[{"n": 2, "i": 1, "quote": "a short passage copied verbatim from source 2 that supports that specific claim"}], ' +
          'where "i" counts the markers of that source (1 for its first claim, 2 for its second…). ' +
          "A source cited for three claims gets three entries, each with the passage behind its own claim.",
      },
      { role: "user", content: `Question: ${o.question}\n\nSources:\n\n${packed.map((p) => `${p.path}\n${p.text}`).join("\n\n---\n\n")}` },
    ],
    { maxTokens: 3000, temperature: 0.2, signal: o.signal },
  );
  const { report, quotes } = parseAnswer(raw);

  // 5. One footnote per cited claim: each marker gets its own supporting
  //    quote, verified against the page it came from.
  const valid = (n: number) => n >= 1 && n <= pages.length;
  const cited = new Set<number>();
  const seenPerSource = new Map<number, number>();
  const defs: string[] = [];
  let unverified = 0;
  // Code (fenced blocks, inline spans) is masked first: a `text[^1]` example
  // isn't a citation, and code isn't a claim to flag.
  const { masked, restore } = maskCode(report);
  const body = masked.replace(/\[\^(\d+)\]/g, (_m, num: string) => {
    const n = Number(num);
    if (!valid(n)) {
      // A marker for a source that wasn't read: the claim stays, flagged.
      unverified++;
      return " ⚠️ *cites a source that wasn't read*";
    }
    cited.add(n);
    const k = seenPerSource.get(n) ?? 0;
    seenPerSource.set(n, k + 1);
    const { hit, page } = pages[n - 1];
    const quote = quotes.get(n)?.[k] ?? "";
    let flag = "";
    if (!quote) {
      // No supporting passage given for this claim: it can't be checked.
      unverified++;
      flag = " ⚠️ *no supporting quote given*";
    } else if (quoteCoverage(quote, page.text!) < APPROXIMATE_AT) {
      unverified++;
      flag = " ⚠️ *quote not found in the source*";
    }
    const id = defs.length + 1;
    defs.push(footnote(id, { title: page.title || hit.title, url: page.finalUrl }, quote, flag));
    return `[^${id}]`;
  });
  // An answer that cites none of the sources read isn't research.
  if (!cited.size) throw new Error("The answer didn't cite any of the sources it read — try again or rephrase the question.");
  // Claims the model left without a marker are flagged, sentence by
  // sentence (a marker elsewhere in the paragraph doesn't cover them).
  // Heading lines are skipped, not the prose right under them. A marker may
  // follow closing quotes, brackets or emphasis: `“…result.”[^1]`.
  const flaggedBody = restore(
    body
      .split(/\n{2,}/)
      .map((para) => {
        if (!isClaim(para)) return para;
        return para
          .split("\n")
          .map((line) =>
            /^\s*#{1,6}\s/.test(line)
              ? line
              : line.replace(/[^.!?\n]*[.!?]+[)\]"'”’»*_]*(?:\[\^\d+\]|\s*⚠️ \*[^*]+\*)*/g, (sentence) => {
                  if (/\[\^\d+\]|⚠️/.test(sentence) || sentence.trim().length < 40) return sentence;
                  unverified++;
                  return `${sentence} ⚠️ *no source cited*`;
                }),
          )
          .join("\n");
      })
      .join("\n\n"),
  );
  const uncited = pages.map((p, i) => ({ p, n: i + 1 })).filter(({ n }) => !cited.has(n));
  const markdown = [
    `# ${title(o.question)}`,
    "",
    `*Researched ${new Date().toISOString().slice(0, 10)} with ${PROVIDER_LABEL[settings.provider as ProxyProvider] ?? settings.provider} search · ${pages.length} sources read · ${
      unverified ? `**${unverified} quote${unverified === 1 ? "" : "s"} could not be verified**` : "every quote checked against its source"
    }.*`,
    "",
    flaggedBody,
    "",
    ...(uncited.length ? ["## Also read", "", ...uncited.map(({ p }) => `- [${p.page.title || p.hit.title}](${p.page.finalUrl})`), ""] : []),
    ...defs,
    "",
  ].join("\n");
  return { markdown, route: settings.provider as ProxyProvider, sources: pages.length, unverified };
}

/* ─── Library research (T34): the clipped pages, nothing leaves the device ─ */

/** Would this research go to the web (a non-local service or Claude)? */
export function researchGoesOnline(settings: ResearchSettings = getResearchSettings()): boolean {
  if (getAiPolicy() === "local-only") return false;
  if (settings.provider === "claude") return true;
  const endpoint = researchEndpoint();
  return !!endpoint && !isLocalOrigin(endpoint);
}

export { hasWebConsent, grantWebConsent } from "./consent";

/**
 * Answer from the library (Library/ · ספרייה/) only: the best passages by
 * hybrid search + rerank, a local model's answer with [n] "quote" citations,
 * every quote checked against its page.
 */
export async function libraryResearch(o: ResearchOptions): Promise<ResearchResult> {
  const { searchHybrid } = await import("../ai/semanticSearch");
  const { rerank } = await import("../ai/reranker");
  const { readWorkspaceFile } = await import("../storage/workspace");
  const { isLibraryPath } = await import("./clipper");
  const { CITE_INSTRUCTIONS, markVaultCitations, verifyVaultCitations } = await import("../ai/vaultCitations");
  o.onProgress?.("Searching your library…");
  // Scope to the library before the limit: 40 ordinary notes ranking higher
  // must not push every library page out of the results.
  const hits = (await searchHybrid(o.question, 40, { filter: isLibraryPath }).catch(() => [])).filter((h) => isLibraryPath(h.path));
  if (!hits.length) throw new Error("Nothing in your library matches — clip some pages first (Clip a web page…), or allow web research in AI settings.");
  const withText = await Promise.all(hits.map(async (h) => ({ ...h, content: await readWorkspaceFile(h.path).catch(() => h.snippet) })));
  const top = (await rerank(o.question, withText.map((h) => ({ ...h, text: `${h.snippet}\n${h.content.slice(0, 1500)}` })))).slice(0, 6);
  const packed = packContext(o.question, top.map((h) => ({ path: h.path, content: h.content })), CONTEXT_BUDGET[getAiMode()]);
  const context = packed.map((p, i) => `---\n[${i + 1}] ${p.path}\n${p.text}`).join("\n");
  const answer = await chat(
    [
      { role: "system", content: SYSTEM_REPORT + "\n\n" + CITE_INSTRUCTIONS },
      { role: "user", content: `Library pages:\n${context}\n\nQuestion: ${o.question}` },
    ],
    { signal: o.signal },
  );
  const sources = top.map((h) => ({ path: h.path, content: h.content }));
  const { citations, verifiedCount } = verifyVaultCitations(answer, sources);
  // An answer that cites nothing wasn't checked at all: unsupported, not
  // "0 unverified".
  const uncited = citations.length === 0;
  const unverified = uncited ? 1 : citations.filter((c) => !c.verified).length;
  const stemOf = (p: string) => p.replace(/^.*\//, "").replace(/\.md$/i, "");
  const markdown = [
    `# ${title(o.question)}`,
    "",
    `*From your library only (nothing left this device) · ${top.length} pages · ${verifiedCount} of ${citations.length} quotes verified.*`,
    "",
    ...(uncited ? ["> ⚠️ **The answer cites no library page — nothing in it could be checked.**", ""] : []),
    markVaultCitations(answer.trim(), citations),
    "",
    "## Sources",
    "",
    ...top.map((h, i) => `${i + 1}. [[${stemOf(h.path)}]]`),
    "",
  ].join("\n");
  return { markdown, route: "library", sources: top.length, unverified };
}

export async function runResearch(o: ResearchOptions): Promise<ResearchResult> {
  const settings = o.deps?.settings ?? getResearchSettings();
  // Local-only: the web is off-limits — research the library instead (T34).
  if (getAiPolicy() === "local-only" && !o.deps?.search && !o.deps?.extract) {
    const endpoint = researchEndpoint();
    if (settings.provider === "claude" || !endpoint || !isLocalOrigin(endpoint)) return libraryResearch(o);
  }
  if (settings.provider === "claude") {
    assertCloudAllowed("Claude web search");
    if (getActiveProvider() !== "anthropic") {
      throw new Error("Claude web search needs the Anthropic provider (AI: Switch Provider), or pick Brave / Tavily in Research: Settings.");
    }
    return claudeResearch(o);
  }
  // The research service (search + page extraction) is a third party unless
  // it runs on this machine / network (e.g. a local SearXNG + extractor).
  const endpoint = o.deps?.search || o.deps?.extract ? null : researchEndpoint();
  if (endpoint && !isLocalOrigin(endpoint)) assertCloudAllowed("the research service (web search and page extraction)");
  return proxyResearch(o, settings);
}
