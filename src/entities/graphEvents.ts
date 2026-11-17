/** The entity graph view's open event (plan W12.E7), without dependencies, so startup code can use it. */
export const OPEN_ENTITY_GRAPH = "lumen-open-entity-graph";

export function openEntityGraph(): void {
  window.dispatchEvent(new Event(OPEN_ENTITY_GRAPH));
}
