/**
 * The import wizard's preset (W11.P6, W11.P7), out of App.tsx to keep it
 * under 800 lines: the first run's "Bring your notes" (OPEN_IMPORT_EVENT)
 * and a `?import=<source>` link (the "Leaving Evernote or Notion?" page,
 * read once and removed from the address) open the wizard on that source.
 */
import { useEffect, useState } from "react";
import { useWindowEvent } from "./useWindowEvent";
import { FIRST_RUN_SOURCES, OPEN_IMPORT_EVENT, importFromSearch, readOpenImport, type OpenImportDetail } from "../onboarding/importEvent";

export function useImportPreset(open: () => void): OpenImportDetail {
  const [preset, setPreset] = useState<OpenImportDetail>({});
  useWindowEvent(OPEN_IMPORT_EVENT, (e) => {
    setPreset(readOpenImport(e, FIRST_RUN_SOURCES));
    open();
  });
  useEffect(() => {
    const source = importFromSearch(window.location.search);
    if (!source) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("import");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    setPreset({ source });
    open();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on the first render, as in App
  }, []);
  return preset;
}
