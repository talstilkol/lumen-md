/**
 * The Hebrew proofreader in the suggestion contract (plan W13.W1): the
 * on-device grammar rules of W5.3 (number gender, שתי/שני, הכי … ביותר,
 * את/עם, the article in a construct, אני + future, register) shown as
 * writing suggestions, with the same cards, per-hunk accept and one-step
 * undo as every other writing agent. Rules only: no model, no network.
 */
import { hebrewGrammar } from "../../../ai/hebrewGrammar";
import { checkAbort, registerWritingAgent, type WritingAgent } from "../agent";
import { suggestionsFromIssues } from "../adapters";

export const PROOFREADER_HE_ID = "proofreaderHe";

export const proofreaderHe: WritingAgent = registerWritingAgent({
  id: PROOFREADER_HE_ID,
  kind: "detector",
  needsModel: false,
  async run(ctx) {
    checkAbort(ctx.signal);
    if (ctx.lang !== "he") return [];
    const matches = hebrewGrammar(ctx.text, ctx.level === "academic" ? "academic" : "everyday");
    return suggestionsFromIssues(ctx.text, matches, { agentId: PROOFREADER_HE_ID, model: "rules", confidence: 0.85 });
  },
});
