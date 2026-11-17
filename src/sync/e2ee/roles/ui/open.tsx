/**
 * Mounts the role-vault panel in its own root (plan W12.S4), like the
 * classroom (../../classroom/open.tsx), so the startup bundle carries only
 * the command and the boot hook (./launch.ts).
 */

import { createRoot, type Root } from "react-dom/client";
import { isEnabled } from "../../../../flags/flags";
import { E2EE_FLAG } from "../../ui/unaudited";
import { relayOrigin } from "../../providers/relay";
import { parseInviteHash, type Invite } from "../vault";
import { idbRecords } from "./records";
import { RoleVaultPanel } from "./RoleVaultPanel";
import type { RoleDeps } from "./controller";

let root: Root | null = null;
let host: HTMLElement | null = null;
let deps: RoleDeps | null = null;

/** This build's relay origin (the encrypted sync's relay setting); one name at a time (src/lib/publicEnv.ts). */
const buildRelay = (): string | null => relayOrigin((import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_SYNC_RELAY_URL);

export function closeRoleVaults(): void {
  root?.unmount();
  host?.remove();
  root = null;
  host = null;
}

/** Opens the panel; does nothing while sync.e2ee is off (the launcher asks through the gate first). */
export function openRoleVaults(joining: Invite | "bad" | null = null, with_: Partial<RoleDeps> = {}): void {
  if (!isEnabled(E2EE_FLAG)) return;
  closeRoleVaults();
  deps ??= { records: idbRecords() };
  host = document.createElement("div");
  host.dataset.lumenRoleVaults = "";
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(<RoleVaultPanel onClose={closeRoleVaults} deps={{ ...deps, ...with_ }} relay={buildRelay()} origin={location.origin} joining={joining} />);
}

/**
 * A `#rolevault=` link was opened: drop the fragment from the address (it
 * holds the invite's secret: it stays out of the history and of anything
 * that later reads the URL), then offer to join. A broken link opens the
 * panel with a notice and nothing to join. Nothing is sent until the user
 * presses "Ask to join".
 */
export function joinFromHash(hash: string, with_: Partial<RoleDeps> = {}): void {
  if (!isEnabled(E2EE_FLAG)) return;
  history.replaceState(null, "", location.pathname + location.search);
  let invite: Invite | "bad";
  try {
    invite = parseInviteHash(hash);
  } catch {
    invite = "bad";
  }
  openRoleVaults(invite, with_);
}
