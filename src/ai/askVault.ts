/**
 * The context "Ask the vault" sends to the model (T29, W12.A1–A2), built
 * in one pure step so a test can read the exact prompt text:
 *
 *  - the scope filter runs first (W12.A2, ./askScope): a note out of scope
 *    is dropped here even if a retriever let it through, so it can reach
 *    neither the prompt nor a citation;
 *  - the packer keeps the parts relevant to the question within the AI
 *    mode's budget (./contextPacker);
 *  - each source is numbered `[n]` (the number citations use), and a note
 *    from outside is cleaned and fenced as untrusted (plan 2.7).
 */
import { packContext } from "./contextPacker";
import { keepInScope, type ScopeFilter } from "./askScope";

export interface AskSource {
  path: string;
  content: string;
}

export interface AskContextDeps {
  /** Where a note came from when it is untrusted (agents/untrusted `untrustedSourcesOfNote`). */
  untrustedOf: (path: string, content: string | undefined) => string[];
  /** Fence an untrusted entry (agents/untrusted `guardUntrusted`). */
  guard: (text: string, sources: string[]) => { text: string };
  /** What the model sees when nothing in scope matched. */
  noRelevant: string;
}

export interface AskContext<T extends AskSource> {
  /** The sources that went into the prompt, numbered from 1 in this order. */
  sources: T[];
  /** The context text for the prompt. */
  context: string;
  /** Untrusted origins of the sources that went in (they taint the run). */
  untrusted: string[];
}

export function buildAskContext<T extends AskSource>(query: string, results: readonly T[], budgetTokens: number, filter: ScopeFilter, deps: AskContextDeps): AskContext<T> {
  const sources = keepInScope(results, filter);
  const packed = packContext(query, sources.map((r) => ({ path: r.path, content: r.content })), budgetTokens);
  const untrusted: string[] = [];
  const context = sources.length
    ? packed
        .map((r, i) => {
          const entry = `📄 [${i + 1}] ${r.path}\n${r.text}`;
          const from = deps.untrustedOf(r.path, sources[i]?.content);
          untrusted.push(...from);
          return `---\n${from.length ? deps.guard(entry, from).text : entry}`;
        })
        .join("\n")
    : deps.noRelevant;
  return { sources, context, untrusted };
}
