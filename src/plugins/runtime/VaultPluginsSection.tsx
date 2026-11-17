/**
 * "Plugins found in this vault" (plan W13.S2, plugins/vaultPlugins.ts): the
 * plugin folders a sync, an imported Obsidian vault or a copied folder put in
 * `.lumen/plugins/` or `.obsidian/plugins/`. Nothing here runs: a found
 * plugin is only listed, with whether it was approved for exactly these
 * bytes, never approved, or changed since. "Review and install" opens the
 * install screen (InstallDialog: permissions, scan); only its Install
 * records the approval (on this device, never in the vault) and starts the
 * plugin in its sandbox with the permissions shown there. A changed plugin
 * needs the screen again. Loaded with React.lazy by the plugin gallery.
 */
import { useCallback, useEffect, useState } from "react";
import { t } from "../../i18n";
import { describeCapability } from "./permissions";
import { InstallDialog } from "./InstallDialog";
import { BTN, BTN_PRIMARY } from "./buttons";
import { approveVaultPlugin, findVaultPlugins, revokeVaultPlugin, startVaultPlugin, VAULT_PLUGIN_DIRS, vaultApprovals, vaultPluginVerdict, type VaultPluginCandidate, type VaultPluginVerdict } from "../vaultPlugins";
import type { PluginManifest } from "./manifest";
import type { ScanResult } from "./scan";
import { explainError } from "../../lib/userError";

export interface Found {
  candidate: VaultPluginCandidate;
  verdict: VaultPluginVerdict;
  manifest: PluginManifest | null;
  /** Why it cannot be installed (not a Lumen plugin manifest). */
  invalid?: string;
}

export interface VaultPluginDeps {
  /** Every file path under the vault's plugin folders. */
  paths(): Promise<string[]>;
  read(path: string): Promise<string>;
  scan(manifest: PluginManifest, code: string): Promise<ScanResult>;
  start(opts: { manifest: PluginManifest; code: string; grants: Set<string> }): Promise<unknown>;
}

const defaultDeps: VaultPluginDeps = {
  async paths() {
    const { listWorkspaceDir, listWorkspaceFolder } = await import("../../storage/workspace");
    const out: string[] = [];
    for (const root of VAULT_PLUGIN_DIRS) {
      const dir = root.replace(/\/$/, "");
      let entries: Awaited<ReturnType<typeof listWorkspaceDir>> = [];
      try {
        entries = await listWorkspaceDir(dir);
      } catch {
        continue; // why: the vault has no such folder
      }
      for (const e of entries) if (e.kind === "directory") for (const f of await listWorkspaceFolder(e.path)) out.push(`${e.path}/${f}`);
    }
    return out;
  },
  read: async (p) => (await import("../../storage/workspace")).readWorkspaceFile(p),
  scan: async (manifest, main) => (await import("./scan")).scanPluginVersion({ manifest, main }),
  start: async (o) => (await import("./manager")).startPlugin(o),
};

export async function loadFound(deps: Pick<VaultPluginDeps, "paths" | "read">): Promise<Found[]> {
  const [candidates, approvals, { parseManifest }] = await Promise.all([deps.paths().then((p) => findVaultPlugins(p, deps.read)), vaultApprovals(), import("./manifest")]);
  return candidates.map((c) => {
    const verdict = vaultPluginVerdict(c, approvals);
    try {
      return { candidate: c, verdict, manifest: parseManifest(c.manifestText) };
    } catch (e) {
      return { candidate: c, verdict, manifest: null, invalid: e instanceof Error ? e.message : String(e) };
    }
  });
}

export function VaultPluginsSection({ deps = defaultDeps }: { deps?: VaultPluginDeps }) {
  const [found, setFound] = useState<Found[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [asking, setAsking] = useState<{ f: Found; scan: ScanResult } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  const reload = useCallback(() => {
    loadFound(deps).then(setFound, () => setFailed(true));
  }, [deps]);
  useEffect(reload, [reload]);

  const review = async (f: Found) => {
    if (!f.manifest) return;
    setBusy(true);
    setMsg(null);
    try {
      setAsking({ f, scan: await deps.scan(f.manifest, f.candidate.code) });
    } catch (e) {
      setMsg({ text: t("pluginTrust.vault.failed", { name: f.manifest.name, error: explainError(e) }), error: true });
    } finally {
      setBusy(false);
    }
  };

  const install = async () => {
    if (!asking?.f.manifest) return;
    const { f } = asking;
    const m = f.manifest!;
    setBusy(true);
    try {
      // The install screen showed exactly these permissions; they are what is approved, for these exact bytes.
      await approveVaultPlugin(f.candidate, m.capabilities.map((c) => c.id));
      await startVaultPlugin(f.candidate, ({ code, grants }) => deps.start({ manifest: m, code, grants }));
      setMsg({ text: t("pluginTrust.installed", { name: m.name }) });
      setAsking(null);
      reload();
    } catch (e) {
      setMsg({ text: t("pluginTrust.vault.failed", { name: m.name, error: explainError(e) }), error: true });
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (f: Found) => {
    await revokeVaultPlugin(f.candidate.dir);
    setMsg({ text: t("pluginTrust.vault.revoked", { name: f.manifest?.name ?? f.candidate.id }) });
    reload();
  };

  const verdictText = (v: VaultPluginVerdict) => t(v === "approved" ? "pluginTrust.vault.approved" : v === "changed" ? "pluginTrust.vault.changed" : "pluginTrust.vault.notApproved");

  return (
    <section aria-labelledby="vault-plugins-title" data-testid="vault-plugins" style={{ padding: "12px 20px", borderTop: "1px solid hsl(var(--border))" }}>
      <h3 id="vault-plugins-title" style={{ margin: "0 0 4px", fontSize: 15 }}>
        {t("pluginTrust.vault.title")}
      </h3>
      <p style={{ margin: "0 0 10px", fontSize: 12, color: "hsl(var(--fg-muted))" }}>{t("pluginTrust.vault.about")}</p>
      {failed ? (
        <p style={{ fontSize: 12 }}>{t("pluginTrust.vault.loadFailed")}</p>
      ) : !found ? (
        <p style={{ fontSize: 12 }}>{t("pluginTrust.loading")}</p>
      ) : !found.length ? (
        // empty-allow: nothing was found in the vault's plugin folders; there is nothing to act on here
        <p style={{ fontSize: 12 }} data-testid="vault-plugins-none">
          {t("pluginTrust.vault.none")}
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
          {found.map((f) => (
            <li key={f.candidate.dir} data-testid="vault-plugin" data-dir={f.candidate.dir} data-verdict={f.verdict} style={{ border: "1px solid hsl(var(--border))", borderRadius: 8, padding: "8px 10px", display: "grid", gap: 4 }}>
              <strong style={{ fontSize: 14 }}>
                <bdi>{f.manifest?.name ?? f.candidate.id}</bdi>
              </strong>
              <span style={{ fontSize: 12, color: "hsl(var(--fg-muted))" }}>
                <span dir="ltr" style={{ unicodeBidi: "isolate" }}>{f.candidate.dir}</span> · {verdictText(f.verdict)}
              </span>
              {f.manifest && f.manifest.capabilities.length > 0 && <span style={{ fontSize: 12 }}>{t("pluginTrust.vault.asks", { list: f.manifest.capabilities.map((c) => describeCapability(c.id)).join(", ") })}</span>}
              {f.invalid ? (
                <span style={{ fontSize: 12, color: "hsl(var(--danger))" }}>{t("pluginTrust.vault.invalid")}</span>
              ) : (
                <div style={{ display: "flex", gap: 8 }}>
                  {f.verdict !== "approved" && (
                    <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => void review(f)}>
                      {t("pluginTrust.vault.review", { name: f.manifest?.name ?? f.candidate.id })}
                    </button>
                  )}
                  {f.verdict !== "needs-permission" && (
                    <button type="button" className={BTN} disabled={busy} onClick={() => void revoke(f)}>
                      {t("pluginTrust.vault.revoke")}
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <p role={msg?.error ? "alert" : "status"} data-testid="vault-plugins-status" style={{ fontSize: 12, margin: "6px 0 0", color: msg?.error ? "hsl(var(--danger))" : undefined }}>
        {msg?.text ?? ""}
      </p>
      {asking?.f.manifest && <InstallDialog manifest={asking.f.manifest} scan={asking.scan} busy={busy} onCancel={() => setAsking(null)} onInstall={() => void install()} />}
    </section>
  );
}
