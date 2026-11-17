/**
 * A vault shared with other people does not carry code or settings (plan
 * W13.S2), the way Obsidian 1.15.1 stopped syncing settings, themes,
 * snippets and hotkeys in shared vaults and 1.13 warned before syncing
 * plugins.
 *
 * Between one person's own devices everything syncs, as before. In a vault
 * with more than one person (a role vault: family, classroom, team) a
 * member's plugin folder, theme, CSS snippet, hotkeys, app settings,
 * automations or agent skills would run on everyone else's device: that is
 * remote code execution with extra steps. So, in a shared channel:
 *
 *   - every protected path is kept out of the sync in both directions —
 *     nothing of this device's goes up, nothing of theirs comes down —
 *     unless this device has said yes to that kind, explicitly, per vault;
 *   - settings and hotkeys that arrive anyway are kept for the user to look
 *     at as `<path>.bak` and never loaded (Obsidian 1.15.1), and the `.bak`
 *     itself never syncs back;
 *   - a plugin that did arrive (the user said yes to plugins) is only files:
 *     it runs after the permission screen of an install (plugins/vaultPlugins.ts).
 *
 * The consent is stored on this device only, never in the vault: a member
 * cannot grant it to everyone by syncing a file.
 */

import { swallowed } from "../../lib/logger";
import type { ExcludeRule } from "./status";

export type ProtectedKind = "plugins" | "themes" | "snippets" | "hotkeys" | "settings" | "automations" | "agents";

export const PROTECTED_KINDS: readonly ProtectedKind[] = ["plugins", "themes", "snippets", "hotkeys", "settings", "automations", "agents"];

/** Kinds whose arrivals are kept as `.bak` for the user to read (data the app would load as configuration). */
const BAK_KINDS: ReadonlySet<ProtectedKind> = new Set(["hotkeys", "settings"]);

/**
 * The protected paths, by kind. Folders end with "/"; a file name matches
 * exactly. Both Lumen's own `.lumen/` and an Obsidian vault's `.obsidian/`
 * (an imported vault can carry community plugins and snippets).
 */
const RULES: ReadonlyArray<{ kind: ProtectedKind; prefix: string }> = [
  { kind: "plugins", prefix: ".lumen/plugins/" },
  { kind: "plugins", prefix: ".obsidian/plugins/" },
  { kind: "plugins", prefix: ".obsidian/community-plugins.json" },
  { kind: "themes", prefix: ".lumen/themes/" },
  { kind: "themes", prefix: ".obsidian/themes/" },
  { kind: "snippets", prefix: ".lumen/snippets/" },
  { kind: "snippets", prefix: ".obsidian/snippets/" },
  { kind: "hotkeys", prefix: ".lumen/hotkeys.json" },
  { kind: "hotkeys", prefix: ".obsidian/hotkeys.json" },
  { kind: "settings", prefix: ".lumen/settings.json" },
  { kind: "settings", prefix: ".lumen/app.json" },
  { kind: "settings", prefix: ".lumen/appearance.json" },
  { kind: "settings", prefix: ".lumen/mcp.json" },
  { kind: "settings", prefix: ".obsidian/app.json" },
  { kind: "settings", prefix: ".obsidian/appearance.json" },
  { kind: "settings", prefix: ".obsidian/core-plugins.json" },
  { kind: "automations", prefix: ".lumen/automations.json" },
  { kind: "automations", prefix: ".lumen/automations-state.json" },
  { kind: "automations", prefix: ".lumen/automations-log.json" },
  { kind: "agents", prefix: ".lumen/skills/" },
];

const BAK = ".bak";

/** Unicode and case games (`.Lumen/Plugins/`, a full-width dot) don't get a path past the rules. */
function canonical(path: string): string {
  return path.normalize("NFKC").replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
}

/**
 * The protected kind of `path` (relative to the shared folder's root), or
 * null. A `.bak` this policy wrote is protected like the file it came from.
 * Nested copies count too: `notes/.lumen/plugins/x/main.js` is protected,
 * since a folder can be moved to the root later.
 */
export function protectedKind(path: string): ProtectedKind | null {
  let p = canonical(path);
  if (p.endsWith(BAK)) p = p.slice(0, -BAK.length);
  const segs = p.split("/");
  for (let i = 0; i < segs.length; i++) {
    if (segs[i] !== ".lumen" && segs[i] !== ".obsidian") continue;
    const tail = segs.slice(i).join("/");
    for (const r of RULES) if (r.prefix.endsWith("/") ? tail.startsWith(r.prefix) : tail === r.prefix) return r.kind;
  }
  return null;
}

export type SharedConsent = Readonly<Record<ProtectedKind, boolean>>;

export const NO_CONSENT: SharedConsent = { plugins: false, themes: false, snippets: false, hotkeys: false, settings: false, automations: false, agents: false };

const KEY = "lumen.sharedVault.consent.v1.";

/** This device's consent for shared vault `vault`: every kind off unless the user turned it on here. Fails closed. */
export function loadConsent(vault: string): SharedConsent {
  try {
    const raw = localStorage.getItem(KEY + vault);
    if (!raw) return NO_CONSENT;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out = { ...NO_CONSENT };
    for (const k of PROTECTED_KINDS) out[k] = parsed?.[k] === true;
    return out;
  } catch {
    return NO_CONSENT;
  }
}

export function saveConsent(vault: string, consent: SharedConsent): void {
  try {
    if (PROTECTED_KINDS.every((k) => !consent[k])) localStorage.removeItem(KEY + vault);
    else localStorage.setItem(KEY + vault, JSON.stringify(Object.fromEntries(PROTECTED_KINDS.filter((k) => consent[k]).map((k) => [k, true]))));
  } catch (e) {
    swallowed("sync/e2ee/sharedVault: the consent could not be saved; every kind stays off", e);
  }
}

/** The reason the policy gives an excluded path (the activity log shows it). */
export const sharedReason = (kind: ProtectedKind) => `shared:${kind}`;

/**
 * The exclude rule of a shared channel: protected kinds without consent are
 * out in both directions, and a `.bak` this policy wrote never goes up.
 * Combined with the device's own selective-sync rule (`base`).
 */
export function sharedExclude(consent: () => SharedConsent, base: ExcludeRule = () => null): ExcludeRule {
  return (path, size) => {
    const kind = protectedKind(path);
    if (kind && (canonical(path).endsWith(BAK) || !consent()[kind])) return sharedReason(kind);
    return base(path, size);
  };
}

/**
 * Where an arrival of `path` is kept instead, when it is excluded: settings
 * and hotkeys as `<path>.bak` (read, never loaded); everything else nowhere
 * (null). A path that is already a `.bak` is never quarantined again.
 */
export function sharedQuarantine(consent: () => SharedConsent): (path: string) => string | null {
  return (path) => {
    const kind = protectedKind(path);
    if (!kind || !BAK_KINDS.has(kind) || consent()[kind] || canonical(path).endsWith(BAK)) return null;
    return path + BAK;
  };
}
