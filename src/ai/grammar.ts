import { fetchWithRetry } from "../lib/fetchRetry";
import { cloudAllowed, isLocalOrigin } from "./policy";
import { connectAllowedByCsp } from "../lib/cspConnect";

/**
 * LanguageTool grammar checker — a thin client that hits the public
 * `https://api.languagetool.org/v2/check` endpoint. Returns the raw matches
 * so the editor can render squiggle decorations or surface a summary.
 *
 * The free tier rate-limits anonymous requests, so callers should debounce
 * (e.g. 1.5s after the user stops typing) and skip very short documents.
 *
 * Self-host: run LanguageTool locally (docker/local-ai.yml, port 8010) and set
 * the endpoint at run time (`lumen.grammar.endpoint`, CSP-checked) or at
 * build time (`VITE_LANGUAGETOOL_URL`). When no LanguageTool on this machine
 * is configured and the AI policy keeps the public API off limits, an
 * explicit check (`{ allowModel: true }`) uses the local `proofreader`
 * agent instead; background checks just return nothing.
 */

export interface GrammarMatch {
  /** 0-based UTF-16 offset into the input. */
  offset: number;
  length: number;
  /** Short human description of the suggested fix. */
  message: string;
  /** Up to a few suggested replacements — usually present, sometimes empty. */
  replacements: string[];
  rule: { id: string; category?: string };
}

const DEFAULT_URL = "https://api.languagetool.org/v2/check";
const RECENT: Map<string, GrammarMatch[]> = new Map();
const RECENT_LIMIT = 16;

export const GRAMMAR_ENDPOINT_KEY = "lumen.grammar.endpoint";

export function grammarEndpoint(): string {
  try {
    const stored = localStorage.getItem(GRAMMAR_ENDPOINT_KEY);
    if (stored && connectAllowedByCsp(stored)) return stored;
  } catch {
    /* storage denied */
  }
  const env = (
    import.meta as ImportMeta & { env?: { VITE_LANGUAGETOOL_URL?: string } }
  ).env?.VITE_LANGUAGETOOL_URL;
  return env || DEFAULT_URL;
}

const endpoint = grammarEndpoint;

/** Grammar through the local proofreader agent: issues mapped to LanguageTool-shaped matches. */
async function checkWithModel(text: string, language: string): Promise<GrammarMatch[]> {
  const { runAgentOrThrow } = await import("../agents/runtime");
  const { proofreaderAgent, locateIssues, PROOF_MAX_CHARS } = await import("../agents/defs");
  const slice = text.slice(0, PROOF_MAX_CHARS);
  const out = await runAgentOrThrow(proofreaderAgent, { text: slice, extra: { language } }, { document: text });
  return locateIssues(out.issues, slice).map((i) => ({ ...i, rule: { id: "LOCAL_MODEL", category: "local" } }));
}

/**
 * Check `text` for grammar/spelling/style issues. Empty / very short inputs
 * return immediately with no matches — LanguageTool isn't useful below ~10
 * words and the public endpoint penalises us for hammering it.
 */
export async function checkGrammar(
  text: string,
  language = "en-US",
  opts: { allowModel?: boolean } = {},
): Promise<GrammarMatch[]> {
  const trimmed = text.trim();
  if (trimmed.length < 40) return [];
  const cacheKey = `${language}\n${trimmed}`;
  const cached = RECENT.get(cacheKey);
  if (cached) return cached;
  // A self-hosted LanguageTool on this machine or network is fine under
  // every policy; the public API is a third party.
  if (!isLocalOrigin(endpoint()) && !cloudAllowed()) {
    if (!opts.allowModel) return [];
    const matches = await checkWithModel(trimmed, language);
    RECENT.set(cacheKey, matches);
    return matches;
  }

  const body = new URLSearchParams({
    text: trimmed,
    language,
    enabledOnly: "false",
  });
  const res = await fetchWithRetry(
    endpoint(),
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    },
    {
      label: "grammar.check",
      maxRetries: 2,
      baseDelayMs: 600,
      maxDelayMs: 2000,
    },
  );
  if (!res.ok) {
    throw new Error(`LanguageTool ${res.status}`);
  }
  const json = (await res.json()) as {
    matches: Array<{
      offset: number;
      length: number;
      message: string;
      replacements?: { value: string }[];
      rule: { id: string; category?: { id?: string } };
    }>;
  };
  const matches: GrammarMatch[] = json.matches.map((m) => ({
    offset: m.offset,
    length: m.length,
    message: m.message,
    replacements: (m.replacements ?? []).map((r) => r.value).slice(0, 5),
    rule: { id: m.rule.id, category: m.rule.category?.id },
  }));

  // Tiny LRU.
  if (RECENT.size >= RECENT_LIMIT) {
    const firstKey = RECENT.keys().next().value;
    if (firstKey !== undefined) RECENT.delete(firstKey);
  }
  RECENT.set(cacheKey, matches);
  return matches;
}

export function clearGrammarCache(): void {
  RECENT.clear();
}
