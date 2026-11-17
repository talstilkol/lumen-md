/**
 * Settings → Privacy → "Notes in the system search" (plan W13.K3): a
 * per-vault consent switch for Spotlight / Windows Search
 * (desktop/osSearchIndex.ts). Off by default. On: the vault's notes (title,
 * a 300-character excerpt, tags, an open link; never locked, encrypted,
 * private or hidden notes) go into the system index. Off: everything Lumen
 * put there for this vault is deleted, and what was sent is forgotten.
 *
 * Until the desktop shell has the command (owner: isolation allow-list) the
 * switch cannot be turned on and says why; if it is on, it can still be
 * turned off. Loaded with React.lazy by the settings screen.
 */
import { useEffect, useId, useMemo, useState } from "react";
import { t } from "../../i18n";
import "../osSearchStrings";
import { OsSearchIndexer, type Notes, type VaultRef } from "../../desktop/osSearchIndex";
import { stubBridge, vaultStore, type OsSearchBridgeStatus } from "../../desktop/osSearchBridge";
import { explainError } from "../../lib/userError";

async function vaultNotes(): Promise<Notes> {
  const { listWorkspace, readWorkspaceFile } = await import("../../storage/workspace");
  return {
    paths: async () => (await listWorkspace()).map((e) => e.path),
    read: async (p) => {
      try {
        return await readWorkspaceFile(p);
      } catch {
        return null; // why: deleted while listing; itemFor treats null as "not indexed"
      }
    },
  };
}

async function currentVault(): Promise<VaultRef> {
  const [{ activeVaultId }, { getVaultStatus }] = await Promise.all([import("../../storage/vault/identity"), import("../../storage/vault/location")]);
  const st = getVaultStatus();
  return { id: activeVaultId() ?? "", name: "name" in st ? st.name : "Lumen" };
}

export default function OsSearchIndexSwitch({ bridge = stubBridge, vault, notes = vaultNotes }: { bridge?: OsSearchBridgeStatus; vault?: VaultRef; notes?: () => Promise<Notes> }) {
  const id = useId();
  const [ref, setRef] = useState<VaultRef | null>(vault ?? null);
  useEffect(() => {
    if (ref) return;
    let live = true;
    currentVault().then(
      (v) => live && setRef(v),
      () => live && setRef({ id: "", name: "Lumen" }), // why: no vault info yet: the first vault's identity is ""
    );
    return () => {
      live = false;
    };
  }, [ref]);
  const store = useMemo(() => (ref ? vaultStore(ref) : null), [ref]);
  const [, setOn] = useState(false); // re-render after a change; the stored consent is the truth
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const consent = store?.enabled() ?? false;

  const toggle = async (want: boolean) => {
    if (!ref || !store) return;
    const indexer = new OsSearchIndexer(bridge, ref, store);
    setBusy(true);
    setMsg(null);
    try {
      if (want) {
        const n = await indexer.enable(await notes());
        setMsg({ text: t("osSearch.indexed", { n }) });
      } else {
        await indexer.disable();
        setMsg({ text: t("osSearch.cleared") });
      }
    } catch (e) {
      if (want) store.setEnabled(false);
      setMsg({ text: t("osSearch.failed", { error: explainError(e) }), error: true });
    } finally {
      setOn(store.enabled());
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby={`${id}-h`} data-testid="settings-os-search" style={{ marginTop: 16 }}>
      <h3 id={`${id}-h`} style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 600 }}>
        {t("osSearch.title")}
      </h3>
      <label htmlFor={id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
        <input
          id={id}
          type="checkbox"
          checked={consent}
          disabled={busy || !ref || (!bridge.available && !consent)}
          data-setting="lumen.osSearch.enabled"
          aria-describedby={`${id}-note ${id}-avail`}
          onChange={(e) => void toggle(e.target.checked)}
        />
        <span>{t("osSearch.switch")}</span>
      </label>
      <p id={`${id}-note`} style={{ margin: "2px 0 0", fontSize: 12, color: "hsl(var(--fg-muted))" }}>
        {t("osSearch.note")}
      </p>
      <p id={`${id}-avail`} data-testid="os-search-availability" style={{ margin: "2px 0 0", fontSize: 12, color: "hsl(var(--fg-muted))" }}>
        {bridge.available ? (
          t("osSearch.perVault")
        ) : (
          <>
            {t("osSearch.unavailable")} <bdi dir="ltr">{bridge.reason ?? ""}</bdi>
          </>
        )}
      </p>
      <p role={msg?.error ? "alert" : "status"} data-testid="os-search-status" style={{ margin: "2px 0 0", fontSize: 12, color: msg?.error ? "hsl(var(--danger))" : "hsl(var(--fg-muted))" }}>
        {msg?.text ?? ""}
      </p>
    </section>
  );
}
