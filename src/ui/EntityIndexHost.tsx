/**
 * Host of the entity lists (plan W12.E6), mounted once in App. ⌘K
 * "Entities: People" (and the other types) fires `lumen-open-entities`;
 * the list and the entity pages load only then, so they stay out of the
 * startup bundle.
 */
import { lazy, Suspense, useEffect, useState } from "react";
import { OPEN_ENTITIES_EVENT } from "../commands/domains/entities";
import type { EntityType } from "../entities/model";

const EntityIndex = lazy(() => import("./EntityIndex").then((m) => ({ default: m.EntityIndex })));

export function EntityIndexHost() {
  const [type, setType] = useState<EntityType | null>(null);
  useEffect(() => {
    const on = (e: Event) => setType((e as CustomEvent<{ type: EntityType }>).detail?.type ?? null);
    window.addEventListener(OPEN_ENTITIES_EVENT, on);
    return () => window.removeEventListener(OPEN_ENTITIES_EVENT, on);
  }, []);
  return type ? (
    <Suspense fallback={null}>
      <EntityIndex type={type} onClose={() => setType(null)} />
    </Suspense>
  ) : null;
}
