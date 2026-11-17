/**
 * Command hints, shown on demand. Their English is a lazy chunk
 * (commands/cmdHintStrings.ts), so a command built before it loaded holds
 * the key ("cmd.view.zen.hint") as its hint. Whatever shows or searches a
 * hint reads it through `shownHint`, which resolves such a key once the
 * strings are registered; any other hint (translated text, a path, a time)
 * is returned as it is.
 */
import { useEffect, useState } from "react";
import { t } from "../i18n";

const HINT_KEY = /^cmd\.[\w.-]+\.hint$/;

/** The hint as shown: a still-unresolved hint key is translated now. */
export function shownHint(hint: string | undefined): string | undefined {
  return hint && HINT_KEY.test(hint) ? t(hint) : hint;
}

let loading: Promise<void> | null = null;
let ready = false;
const waiting = new Set<() => void>();

/** Load the hints' English (once); resolves when t() knows it. */
export function loadCommandHints(): Promise<void> {
  loading ??= import("./cmdHintStrings").then(
    () => {
      ready = true;
      for (const w of [...waiting]) w();
    },
    () => {
      loading = null; // why: offline or a stale chunk: the keys stay, the next opening tries again
    },
  );
  return loading;
}

/** Re-render once the hints are registered; starts loading them when `active` (a menu that shows hints is open). */
export function useCommandHints(active: boolean): void {
  const [, setReady] = useState(ready);
  useEffect(() => {
    if (!active || ready) return;
    const done = () => setReady(true);
    waiting.add(done);
    void loadCommandHints();
    return () => void waiting.delete(done);
  }, [active]);
}
