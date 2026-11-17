/**
 * Host of the entity graph view (plan W12.E7 with W12.X3's citations),
 * mounted once in App. The view, its loader and its strings load when it is
 * opened (⌘K "Entity graph", or `openEntityGraph()`), so they stay out of
 * the startup bundle.
 */
import { lazy, Suspense, useEffect, useState } from "react";
import { OPEN_ENTITY_GRAPH } from "../entities/graphEvents";
import type { EntityVault } from "../entities/vaultIo";

const EntityGraphScreen = lazy(() => import("./EntityGraphScreen").then((m) => ({ default: m.EntityGraphScreen })));

export function EntityGraphHost({ vault }: { vault?: EntityVault }) {
  const [open, setOpen] = useState(0);
  useEffect(() => {
    const on = () => setOpen((n) => n + 1);
    window.addEventListener(OPEN_ENTITY_GRAPH, on);
    return () => window.removeEventListener(OPEN_ENTITY_GRAPH, on);
  }, []);
  return open ? (
    <Suspense fallback={null}>
      {/* A new opening reads the vault again. */}
      <EntityGraphScreen key={open} vault={vault} onClose={() => setOpen(0)} />
    </Suspense>
  ) : null;
}
