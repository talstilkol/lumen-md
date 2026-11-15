/**
 * The entity graph in the palette (plan W12.E5): "Entity graph: proposals
 * to review" opens the review panel, where the graph proposals sit above
 * the agents' staged changes.
 *
 * The entity types themselves ("All People", "All Laws", …, each with its
 * Base and its field form) come from the typed-object registry (W12.T3):
 * entities/types.ts registers them as built-in types.
 */
import { t } from "../../i18n";
import { cmdIcons, type Command } from "../../ui/CommandPalette";
import type { CommandContext } from "./context";

export function buildEntityCommands(_ctx: CommandContext): Command[] {
  return [{ id: "entities.review", label: t("cmd.entities.review"), icon: cmdIcons.FileText, action: () => window.dispatchEvent(new Event("lumen-open-agent-review")) }];
}
