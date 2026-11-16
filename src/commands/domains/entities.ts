/**
 * The entity graph in the palette:
 *
 *  - "Entity graph: proposals to review" (W12.E5) opens the review panel,
 *    where the graph proposals sit above the agents' staged changes.
 *  - "Entity: link to Wikidata…" (W12.E10), for the open entity note: asks
 *    for consent, then searches Wikidata for its name (ui/WikidataHost.tsx).
 *    Not listed in airplane mode.
 *  - "Entity graph" (W12.E7, W12.X3) opens the graph view of every entity
 *    and citation.
 *
 *  - "Where my notes disagree" (R12.10) runs the contradiction finder over
 *    the vault (no model) and stages its report note in the review panel;
 *    it never edits a note.
 *
 * The entity types themselves ("All People", "All Laws", …, each with its
 * Base and its field form) come from the typed-object registry (W12.T3):
 * entities/types.ts registers them as built-in types.
 */
import { t } from "../../i18n";
import type { Command } from "../../ui/CommandPalette";
import { cmdIcons } from "../../ui/cmdIcons";
import { showAiToast } from "../../ui/AiToast";
import { airplaneFlagOn } from "../../privacy/airplaneBoot";
import type { CommandContext } from "./context";
import { openEntityGraph } from "../../entities/graphEvents";

export const WIKIDATA_EVENT = "lumen-wikidata-link";

async function linkOpenEntity(ctx: CommandContext): Promise<void> {
  const doc = ctx.liveDoc();
  const path = doc.workspaceName;
  const { parseEntityNote } = await import("../../entities/notes");
  const entity = path ? parseEntityNote(path, doc.content) : null;
  if (!path || !entity) {
    showAiToast(t("cmd.entities.wikidata.notEntity"), "info");
    return;
  }
  window.dispatchEvent(new CustomEvent(WIKIDATA_EVENT, { detail: { name: entity.name, path } }));
}

export function buildEntityCommands(ctx: CommandContext): Command[] {
  const out: Command[] = [
    { id: "entities.review", label: t("cmd.entities.review"), icon: cmdIcons.FileText, action: () => window.dispatchEvent(new Event("lumen-open-agent-review")) },
    { id: "entities.graph", label: t("cmd.entities.graph"), hint: t("cmd.entities.graph.hint"), icon: cmdIcons.Network, action: openEntityGraph },
    { id: "entities.contradictions", label: t("cmd.entities.contradictions"), hint: t("cmd.entities.contradictions.hint"), icon: cmdIcons.FileText, action: () => import("./contradictionsAction").then((m) => m.findContradictionsFlow()) },
  ];
  if (!airplaneFlagOn()) out.push({ id: "entities.wikidata", label: t("cmd.entities.wikidata"), icon: cmdIcons.FileText, action: () => void linkOpenEntity(ctx) });
  return out;
}
