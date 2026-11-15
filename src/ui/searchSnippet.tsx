/** A search hit's snippet with the matched part marked (src/ui/SearchDialog.tsx; moved out unchanged for max-lines). */
import type { SearchHit } from "../storage/workspaceIndex";
import { t } from "../i18n";
import { looseMatches, type MatchedAs } from "../text/matchedAs";

/** The snippet line's style (one line, cut with an ellipsis). */
export const SNIPPET_STYLE: React.CSSProperties = {
  color: "hsl(var(--fg-muted))",
  fontSize: 11.5,
  marginTop: 2,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

function how(m: MatchedAs): string {
  switch (m.tier) {
    case "niqqud":
      return t("searchDialog.matchedAs.niqqud");
    case "finals":
      return t("searchDialog.matchedAs.finals");
    case "prefix":
      return t("searchDialog.matchedAs.prefix", { prefix: m.prefix ?? "" });
    case "ktiv":
      return t("searchDialog.matchedAs.ktiv");
    case "lemma":
      return t("searchDialog.matchedAs.lemma");
    case "synonym":
      return t("searchDialog.matchedAs.synonym");
    case "english":
      return t("searchDialog.matchedAs.english");
    case "translit":
      return t("searchDialog.matchedAs.translit");
    case "exact":
      return "";
  }
}

/**
 * "Matched as …" under a result (plan R12.16): for each query word the note
 * did not contain as typed, how it matched — "without the prefix (ו)",
 * "transliteration: Kohen → כהן". Nothing for an exact match.
 */
export function MatchedAsLine({ query, hit }: { query: string; hit: SearchHit }) {
  const loose = looseMatches(query, `${hit.name} ${hit.snippet ?? ""}`);
  if (!loose.length) return null;
  const parts = loose.map((m) => `${how(m)}: ${m.query} → ${m.word}`);
  return (
    <div data-testid="search-matched-as" dir="auto" style={{ ...SNIPPET_STYLE, fontSize: 10.5 }}>
      {t("searchDialog.matchedAs", { how: parts.join(" · ") })}
    </div>
  );
}

export function renderSnippet(hit: SearchHit): React.ReactNode {
  if (!hit.snippet) return null;
  if (!hit.match) return hit.snippet;
  const { start, end } = hit.match;
  return (
    <>
      {hit.snippet.slice(0, start)}
      <mark
        style={{
          background: "hsl(var(--accent) / 0.25)",
          color: "hsl(var(--fg))",
          padding: 0,
        }}
      >
        {hit.snippet.slice(start, end)}
      </mark>
      {hit.snippet.slice(end)}
    </>
  );
}
