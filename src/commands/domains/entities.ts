/**
 * The entity graph in the palette (plan W12.E5/E6):
 *
 *  - "Entity graph: proposals to review" opens the review panel, where the
 *    graph proposals sit above the agents' staged changes.
 *  - "Entities: People", "Entities: Laws", "Entities: Sources", … (one per
 *    entity type) open the list of that type's approved entities; each
 *    opens its entity page (relations by predicate, mentions in context).
 *
 * The list and pages load on first use (ui/EntityIndexHost.tsx).
 */
import { t } from "../../i18n";
import { cmdIcons, type Command } from "../../ui/CommandPalette";
import { ENTITY_TYPES, type EntityType } from "../../entities/model";
import type { CommandContext } from "./context";

export const OPEN_ENTITIES_EVENT = "lumen-open-entities";

export function openEntities(type: EntityType): void {
  window.dispatchEvent(new CustomEvent(OPEN_ENTITIES_EVENT, { detail: { type } }));
}

export function buildEntityCommands(_ctx: CommandContext): Command[] {
  return [
    { id: "entities.review", label: t("cmd.entities.review"), icon: cmdIcons.FileText, action: () => window.dispatchEvent(new Event("lumen-open-agent-review")) },
    ...ENTITY_TYPES.map((type) => ({ id: `entities.list.${type}`, label: t(`cmd.entities.${type}`), icon: cmdIcons.Table, action: () => openEntities(type) })),
  ];
}
