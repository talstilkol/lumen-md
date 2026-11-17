/**
 * Gathers what the exit package (./exitPackage.ts, plan W13.P3) holds from
 * the running app: the vault's files, every document's version history,
 * the settings file, and the AI profiles (the settings schema's "ai" tab
 * entries, without secrets — exportSettings never writes a secret).
 */
import { collectVault } from "./exportAll";
import { listDocuments, listSnapshots } from "./history";
import { exportSettings, type SettingsTarget } from "../settings/io";
import { buildExitPackage, type ExitSources } from "./exitPackage";
import { zip } from "./zip";

export async function collectExitSources(settingsTarget: SettingsTarget): Promise<ExitSources> {
  const files = await collectVault();
  const history: NonNullable<ExitSources["history"]> = {};
  for (const d of await listDocuments().catch(() => [])) {
    const snaps = await listSnapshots(d.name).catch(() => []);
    if (snaps.length) history[d.name] = snaps.map((s) => ({ timestamp: s.timestamp, content: s.content, ...(s.reason ? { reason: s.reason } : {}), ...(s.author ? { author: s.author } : {}) }));
  }
  const settings = exportSettings(settingsTarget);
  const aiProfiles = Object.fromEntries(Object.entries(settings.local).filter(([k]) => /^lumen[.-]ai[.-]/.test(k)));
  return { files, history, settings, aiProfiles };
}

/** The whole package as one .zip. */
export async function exitPackageZip(settingsTarget: SettingsTarget): Promise<{ bytes: Uint8Array; files: number }> {
  const pkg = await buildExitPackage(await collectExitSources(settingsTarget));
  return { bytes: await zip(pkg.map((f) => ({ name: f.path, data: f.data }))), files: pkg.length };
}
