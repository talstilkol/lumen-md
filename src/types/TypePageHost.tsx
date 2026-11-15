/**
 * Host of the type page (plan W12.T3) and of Object Studio (W12.T2),
 * mounted once in App. Both load when opened (⌘K), so they stay out of the
 * startup bundle.
 */
import { lazy, Suspense, useEffect, useState } from "react";
import { OPEN_OBJECT_STUDIO, OPEN_TYPE_PAGE } from "./typeEvents";
import { useAppStore } from "../store/useStore";

const TypePage = lazy(() => import("./TypePage").then((m) => ({ default: m.TypePage })));
const ObjectStudio = lazy(() => import("./ObjectStudio").then((m) => ({ default: m.ObjectStudio })));

export function TypePageHost() {
  const [open, setOpen] = useState<{ type?: string } | null>(null);
  const [studio, setStudio] = useState(false);
  const locale = useAppStore((s) => s.locale) as string;
  useEffect(() => {
    const on = (e: Event) => setOpen({ type: (e as CustomEvent<{ type?: string }>).detail?.type });
    const onStudio = () => setStudio(true);
    window.addEventListener(OPEN_TYPE_PAGE, on);
    window.addEventListener(OPEN_OBJECT_STUDIO, onStudio);
    return () => {
      window.removeEventListener(OPEN_TYPE_PAGE, on);
      window.removeEventListener(OPEN_OBJECT_STUDIO, onStudio);
    };
  }, []);
  return (
    <>
      {open && (
        <Suspense fallback={null}>
          <TypePage type={open.type} onClose={() => setOpen(null)} />
        </Suspense>
      )}
      {studio && (
        <Suspense fallback={null}>
          <ObjectStudio locale={locale} onClose={() => setStudio(false)} />
        </Suspense>
      )}
    </>
  );
}
