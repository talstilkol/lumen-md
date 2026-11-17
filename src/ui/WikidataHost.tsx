/**
 * Host of the Wikidata dialog (plan W12.E10), mounted once in App. ⌘K
 * "Entity: link to Wikidata…" fires `lumen-wikidata-link` for the open
 * entity note; the dialog's chunk loads only then. Nothing in airplane mode.
 */
import { lazy, Suspense, useEffect, useState } from "react";
import { airplaneFlagOn } from "../privacy/airplaneBoot";
import { WIKIDATA_EVENT } from "../commands/wikidataEvent";

const WikidataLink = lazy(() => import("./WikidataLink").then((m) => ({ default: m.WikidataLink })));

export function WikidataHost() {
  const [open, setOpen] = useState<{ name: string; path: string } | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ name: string; path: string }>).detail;
      if (d?.path && !airplaneFlagOn()) setOpen(d);
    };
    window.addEventListener(WIKIDATA_EVENT, on);
    return () => window.removeEventListener(WIKIDATA_EVENT, on);
  }, []);
  return open && !airplaneFlagOn() ? (
    <Suspense fallback={null}>
      <WikidataLink name={open.name} path={open.path} onClose={() => setOpen(null)} />
    </Suspense>
  ) : null;
}
