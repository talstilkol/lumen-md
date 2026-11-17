/**
 * The only role-vault module the startup code imports, and only on use (plan
 * W12.S4): one hop to the lazily loaded panel, as ../../classroom/launch.ts.
 */

// Plan W11.S1: role vaults use the sync's unaudited cryptography, so they wait for the sync.e2ee flag too.
export function openRoleVaults(): Promise<void> {
  return import("../../ui/unaudited").then((g) => g.whenE2eeOn(() => import("./open").then((m) => m.openRoleVaults())));
}

/**
 * Boot with a `#rolevault=…` fragment: once the app has rendered its vault,
 * and only through the flag's gate, offer to join. With the flag off and the
 * gate declined, nothing is parsed, stored or sent, and the fragment stays
 * for the next start.
 */
export async function roleVaultLinkReturn(ready: Promise<unknown>): Promise<void> {
  const hash = location.hash;
  try {
    await ready;
    await (await import("../../ui/unaudited")).whenE2eeOn(async () => (await import("./open")).joinFromHash(hash));
  } catch (err) {
    const { log } = await import("../../../../lib/logger");
    log.warn("role vault link failed", err);
  }
}
