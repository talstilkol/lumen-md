/**
 * "Ask the vault" in scope (W12.A2): the same allow / deny rules by folder
 * and tag as the vault's MCP server (W11.I7), from the same module
 * (mcp-server/src/vault/scope.ts) and the same file (`.lumen/mcp.json`,
 * its vault-wide `scope`). A note out of scope is not retrieved, never
 * reaches the prompt, and so can never be cited. One scope for both paths
 * means the agent outside the app is never held to a narrower view than
 * the one inside it.
 *
 * The scope picker in the Ask tab narrows further: the whole vault (the
 * default: everything the vault scope allows, so the folders and tags the
 * user denied there stay out), one folder, or one tag. Deny always wins.
 *
 * Locked notes (plan W5.11) are never in scope: neither the sealed file
 * nor a locked note that is open in this session.
 */
import { inScope, readScope, type ScopeRules } from "../../mcp-server/src/vault/scope";
import { isSealedNote, lockedNotes } from "../storage/lockedNotesRegistry";

export type { ScopeRules };

/** The vault's MCP config, the file both paths read their scope from. */
export const MCP_CONFIG_PATH = ".lumen/mcp.json";

export type AskScopeChoice = { kind: "vault" } | { kind: "folder"; folder: string } | { kind: "tag"; tag: string };

/** The vault-wide scope from the text of `.lumen/mcp.json` (missing or malformed: no rules). */
export function vaultScopeFromConfig(json: string | null | undefined): ScopeRules | undefined {
  if (!json) return undefined;
  try {
    return readScope((JSON.parse(json) as { scope?: unknown }).scope);
  } catch {
    return undefined;
  }
}

/** The picker's choice as rules on top of the vault's. */
export function choiceRules(choice: AskScopeChoice): ScopeRules | undefined {
  if (choice.kind === "folder" && choice.folder.trim()) return readScope({ allow: { folders: [choice.folder] } });
  if (choice.kind === "tag" && choice.tag.trim()) return readScope({ allow: { tags: [choice.tag] } });
  return undefined;
}

export type ScopeFilter = (path: string, content: string) => boolean;

/** In scope: not locked, and every rule set (the vault's, then the picker's) lets it through. */
export function scopeFilter(vault: ScopeRules | undefined, choice: AskScopeChoice = { kind: "vault" }): ScopeFilter {
  const rules = [vault, choiceRules(choice)];
  return (path, content) => !isSealedNote(content) && !lockedNotes.has(path) && inScope(path, content, rules);
}

/** Only the items in scope, in order. */
export function keepInScope<T extends { path: string; content: string }>(items: readonly T[], filter: ScopeFilter): T[] {
  return items.filter((x) => filter(x.path, x.content));
}

/** The vault's scope, read through `read` (the workspace reader); a missing file means no rules. */
export async function loadVaultScope(read: (path: string) => Promise<string>): Promise<ScopeRules | undefined> {
  return vaultScopeFromConfig(await read(MCP_CONFIG_PATH).catch(() => null));
}
