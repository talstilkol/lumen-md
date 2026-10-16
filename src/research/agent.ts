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
import { extractPage, getResearchSettings, searchWeb, type ExtractedPage, type ResearchSettings, type SearchHit } from "./client";

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
  route: "claude" | "brave" | "tavily";
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

export function citedBlocksToMarkdown(question: string, blocks: readonly CitedBlock[], now = new Date()): { markdown: string; sources: number } {
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
    // Citations attach to the end of the passage, before trailing whitespace.
    const m = /^([\s\S]*?)(\s*)$/.exec(b.text)!;
    body += m[1] + refs + m[2];
  }
  const markdown = [
    `# ${title(question)}`,
    "",
    `*Researched ${now.toISOString().slice(0, 10)} with Claude web search · ${urls.size} sources · quotes are verbatim from the cited pages.*`,
    "",
    body.trim(),
    "",
    ...defs,
    "",
  ].join("\n");
  return { markdown, sources: urls.size };
}

async function claudeResearch(o: ResearchOptions): Promise<ResearchResult> {
  getProviderKey("anthropic"); // NO_KEY before anything is charged
  chargeAiCommandDispatch();
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
      onUsage: (u) => recordUsage({ ...u, provider: "anthropic" }),
    },
  );
  const { markdown, sources } = citedBlocksToMarkdown(o.question, blocks);
  // An answer without web citations isn't research (Claude answered from memory).
  if (!sources) throw new Error("Claude answered without citing any web source — try again or rephrase the question.");
  return { markdown, route: "claude", sources, unverified: 0 };
}

/* ─── Brave / Tavily through the research worker ───────────────────── */

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
  const body = report.replace(/\[\^(\d+)\]/g, (_m, num: string) => {
    const n = Number(num);
    if (!valid(n)) return ""; // a marker for a source that doesn't exist
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
  const uncited = pages.map((p, i) => ({ p, n: i + 1 })).filter(({ n }) => !cited.has(n));
  const markdown = [
    `# ${title(o.question)}`,
    "",
    `*Researched ${new Date().toISOString().slice(0, 10)} with ${settings.provider === "brave" ? "Brave" : "Tavily"} search · ${pages.length} sources read · ${
      unverified ? `**${unverified} quote${unverified === 1 ? "" : "s"} could not be verified**` : "every quote checked against its source"
    }.*`,
    "",
    body,
    "",
    ...(uncited.length ? ["## Also read", "", ...uncited.map(({ p }) => `- [${p.page.title || p.hit.title}](${p.page.finalUrl})`), ""] : []),
    ...defs,
    "",
  ].join("\n");
  return { markdown, route: settings.provider as "brave" | "tavily", sources: pages.length, unverified };
}

export async function runResearch(o: ResearchOptions): Promise<ResearchResult> {
  const settings = o.deps?.settings ?? getResearchSettings();
  if (settings.provider === "claude") {
    if (getActiveProvider() !== "anthropic") {
      throw new Error("Claude web search needs the Anthropic provider (AI: Switch Provider), or pick Brave / Tavily in Research: Settings.");
    }
    return claudeResearch(o);
  }
  return proxyResearch(o, settings);
}
