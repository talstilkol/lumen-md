/**
 * The network gate for agent tools (scope `network`).
 *
 * Under the `local-only` AI policy nothing may leave the device — with one
 * explicit exception (plan §2.4): web research, which by its nature asks
 * the web. A network tool call therefore goes out only when the user
 * consented to it; otherwise it is refused before any request is made,
 * the refusal is recorded in the privacy ledger and the call fails with
 * the ledger's `PrivacyBlockedError`. Under `local-first` / `cloud` the
 * policy itself allows the network.
 *
 * Either way the tool gets a fetch built by the ledger (`ledgerFetch`), so
 * each request it makes is recorded (host, bytes, reason, policy, and
 * whether it went out on consent). A network tool has no other way to the
 * network: without the gate's fetch it refuses to run (`networkFetch`).
 */

import type { AgentTool, NetworkConsentRequest, ToolCall } from "./types";
import { getAiPolicy } from "../ai/policy";
import { ledgerFetch, recordBlockedRequest } from "../ai/privacyLedger";
import { ToolError } from "./tools/define";

export type ConsentHook = (request: NetworkConsentRequest) => boolean | Promise<boolean>;

/**
 * What the call would send and where, for the consent prompt and the
 * ledger. Every network tool goes through the research service (SearXNG /
 * the research worker); without one configured nothing could be sent, so
 * the call fails here, before any consent is asked.
 */
export async function describeNetworkCall(tool: AgentTool, call: ToolCall): Promise<NetworkConsentRequest & { url: string }> {
  const { researchEndpoint } = await import("../research/client");
  const endpoint = researchEndpoint();
  if (!endpoint) throw new ToolError("failed", "The research service isn't configured (VITE_RESEARCH_ENDPOINT or a local SearXNG in AI settings), so there is no way to reach the web");
  const hostOf = (u: string) => {
    try {
      return new URL(u).hostname;
    } catch {
      return "";
    }
  };
  if (tool.name === "fetch_page") {
    // The research service fetches the page: the page's host learns of the visit.
    const page = typeof call.args.url === "string" ? call.args.url : "";
    return { tool: tool.name, host: hostOf(page) || hostOf(endpoint), sends: "the page address", args: call.args, url: `${endpoint}/extract` };
  }
  return { tool: tool.name, host: hostOf(endpoint), sends: tool.name === "search_web" ? "the search query" : "the tool's arguments", args: call.args, url: `${endpoint}/search` };
}

async function defaultConsent(): Promise<boolean> {
  const { hasWebConsent } = await import("../research/consent");
  return hasWebConsent();
}

/**
 * Decide one network tool call. Resolves to the fetch the tool must use;
 * rejects with `PrivacyBlockedError` (recorded as blocked) when the
 * `local-only` policy holds and the user did not consent to this call.
 */
export async function openNetworkGate(tool: AgentTool, call: ToolCall, consent?: ConsentHook): Promise<{ fetch: typeof fetch; consented: boolean }> {
  const reason = `Agent tool ${tool.name}`;
  const { url, ...req } = await describeNetworkCall(tool, call);
  if (getAiPolicy() !== "local-only") return { fetch: ledgerFetch({ force: { category: "research", reason } }), consented: false };
  let ok = false;
  try {
    ok = await (consent ?? defaultConsent)(req);
  } catch {
    ok = false;
  }
  if (!ok) throw recordBlockedRequest(url, "research", `${reason} (local-only, no consent)`);
  return { fetch: ledgerFetch({ force: { category: "research", reason: `${reason} (user consent)` }, consent: true }), consented: true };
}
