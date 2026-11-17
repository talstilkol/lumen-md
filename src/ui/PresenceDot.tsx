/**
 * The dot next to a note's name, in the tree and on its tab, when another
 * device of a shared vault has it open (plan W13.S6). The device names are
 * its accessible name and its tooltip; nothing renders when nobody is there.
 */
import { useSyncExternalStore } from "react";
import { devicesOn, subscribePresence } from "../collab/presenceStore";
import { t } from "../i18n";

export function PresenceDot({ path }: { path: string | null | undefined }) {
  const devices = useSyncExternalStore(subscribePresence, () => (path ? devicesOn(path) : EMPTY));
  if (!devices.length) return null;
  const label = t("presence.openOn", { devices: devices.join(", ") });
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-testid="presence-dot"
      className="presence-dot"
      style={{ display: "inline-block", width: 8, height: 8, borderRadius: 999, background: "hsl(var(--success))", marginInline: 4, flex: "none", outline: "1px solid hsl(var(--bg))" }}
    />
  );
}
const EMPTY: readonly string[] = [];
