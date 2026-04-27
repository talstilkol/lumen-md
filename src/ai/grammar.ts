/**
 * LanguageTool grammar checker — a thin client that hits the public
 * `https://api.languagetool.org/v2/check` endpoint. Returns the raw matches
 * so the editor can render squiggle decorations or surface a summary.
 *
 * The free tier rate-limits anonymous requests, so callers should debounce
 * (e.g. 1.5s after the user stops typing) and skip very short documents.
 *
 * Self-host: drop in `VITE_LANGUAGETOOL_URL=https://your-host:8081/v2/check`
 * to send traffic somewhere private.
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

function endpoint(): string {
  const env = (
    import.meta as ImportMeta & { env?: { VITE_LANGUAGETOOL_URL?: string } }
  ).env?.VITE_LANGUAGETOOL_URL;
  return env || DEFAULT_URL;
}

/**
 * Check `text` for grammar/spelling/style issues. Empty / very short inputs
 * return immediately with no matches — LanguageTool isn't useful below ~10
 * words and the public endpoint penalises us for hammering it.
 */
export async function checkGrammar(
  text: string,
  language = "en-US",
): Promise<GrammarMatch[]> {
  const trimmed = text.trim();
  if (trimmed.length < 40) return [];
  const cacheKey = `${language}\n${trimmed}`;
  const cached = RECENT.get(cacheKey);
  if (cached) return cached;

  const body = new URLSearchParams({
    text: trimmed,
    language,
    enabledOnly: "false",
  });
  const res = await fetch(endpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
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
