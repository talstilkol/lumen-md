/**
 * Host of the type page (plan W12.T3), mounted once in App. The page loads
 * when it is opened (⌘K "All <type>", or `openTypePage`), so it stays out of
 * the startup bundle.
 */
import { lazy, Suspense, useEffect, useState } from "react";
import { OPEN_TYPE_PAGE } from "./vaultTypes";

const TypePage = lazy(() => import("./TypePage").then((m) => ({ default: m.TypePage })));

export function TypePageHost() {
  const [open, setOpen] = useState<{ type?: string } | null>(null);
  useEffect(() => {
    const on = (e: Event) => setOpen({ type: (e as CustomEvent<{ type?: string }>).detail?.type });
    window.addEventListener(OPEN_TYPE_PAGE, on);
    return () => window.removeEventListener(OPEN_TYPE_PAGE, on);
  }, []);
  return open ? (
    <Suspense fallback={null}>
      <TypePage type={open.type} onClose={() => setOpen(null)} />
    </Suspense>
  ) : null;
}
