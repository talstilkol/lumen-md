/**
 * Family and classroom vaults with roles (plan W12.S4): the one panel.
 *
 *   list     the role vaults this device is in (admin or member), "New".
 *   new      the admin's passphrase, "Create the vault".
 *   admin    unlock with the passphrase, then the invite screen (link + QR),
 *            the join requests and the member list with Revoke.
 *   member   waiting for the admin, the one-time freshness prompt, the
 *            personal-folder indicator, "Sync now".
 *   join     opened from a `#rolevault=` link (./open.tsx).
 *
 * Behind the sync.e2ee flag (W11.S1): only ./launch.ts opens it, through
 * `whenE2eeOn`; and every view shows the "not externally audited" notice.
 */

import { useCallback, useEffect, useState } from "react";
import { getLocale, t } from "../../../../i18n";
import "../../strings";
import { Modal } from "../../../../ui/Modal";
import { HelpButton } from "../../../../ui/HelpButton";
import { UnauditedNotice } from "../../ui/unaudited";
import { e2eeErrorText } from "../../ui/errorText";
import type { Invite } from "../vault";
import { createRoleVault, joinWithInvite, openAdmin, type AdminSession, type RoleDeps } from "./controller";
import type { RoleRecord } from "./records";
import { InviteScreen } from "./InviteScreen";
import { MemberList } from "./MemberList";
import { SharedConsent } from "./SharedConsent";
import { JoinScreen, MemberView } from "./MemberView";
import { card, errorStyle, field, ghost, list, muted, primary, row } from "./styles";
import { EmptyState, learnHow } from "../../../../ui/EmptyState";

type View = { v: "list" } | { v: "new" } | { v: "admin"; record: Extract<RoleRecord, { kind: "admin" }> } | { v: "member"; record: Extract<RoleRecord, { kind: "member" }> };

export interface RoleVaultPanelProps {
  onClose: () => void;
  deps: RoleDeps;
  /** This build's relay origin (null: none set). */
  relay: string | null;
  /** The app's address, for invite links. */
  origin: string;
  /** Opened from a `#rolevault=` link: the invite, or "bad" for a broken link. */
  joining?: Invite | "bad" | null;
}

function errorText(e: unknown): string {
  return t("e2ee.roles.error", { error: e2eeErrorText(e) });
}

function PassphraseRow({ go, label, testid, onSubmit }: { go: string; label: string; testid: string; onSubmit: (p: string) => void }) {
  const [p, setP] = useState("");
  return (
    <form
      style={row}
      onSubmit={(e) => {
        e.preventDefault();
        if (p) onSubmit(p);
      }}
    >
      <input type="password" autoComplete="new-password" style={{ ...field, flex: 1, minWidth: 160 }} value={p} onChange={(e) => setP(e.target.value)} aria-label={label} data-testid={`${testid}-passphrase`} />
      <button type="submit" style={primary} disabled={!p} data-testid={`${testid}-go`}>
        {go}
      </button>
    </form>
  );
}

export function RoleVaultPanel({ onClose, deps, relay, origin, joining = null }: RoleVaultPanelProps) {
  const [records, setRecords] = useState<RoleRecord[]>([]);
  const [view, setView] = useState<View>({ v: "list" });
  const [admin, setAdmin] = useState<AdminSession | null>(null);
  const [invite, setInvite] = useState<Invite | "bad" | null>(joining);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const onError = useCallback((e: unknown) => setError(errorText(e)), []);
  const reload = useCallback(() => void deps.records.list().then(setRecords, onError), [deps, onError]);
  useEffect(reload, [reload]);

  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await f();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  const create = (passphrase: string) =>
    run(async () => {
      if (!relay) return;
      const s = await createRoleVault(deps, relay, passphrase);
      setAdmin(s);
      setView({ v: "admin", record: s.record });
      reload();
    });

  const unlock = (record: Extract<RoleRecord, { kind: "admin" }>, passphrase: string) =>
    run(async () => {
      setAdmin(await openAdmin(deps, record, passphrase));
    });

  const join = () =>
    run(async () => {
      if (!invite || invite === "bad") return;
      const record = await joinWithInvite(deps, invite);
      setInvite(null);
      setView({ v: "member", record });
      reload();
    });

  const back = () => {
    setAdmin(null);
    setError(null);
    setView({ v: "list" });
  };

  return (
    <Modal aria-labelledby="role-vault-title" onClose={onClose} style={{ position: "fixed", inset: 0, background: "var(--overlay)", display: "grid", placeItems: "center", zIndex: 1000 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        dir={getLocale() === "he" || getLocale() === "ar" ? "rtl" : "ltr"}
        data-testid="role-vault"
        style={{ width: "min(640px, calc(100vw - 32px))", maxHeight: "calc(100vh - 32px)", overflow: "auto", background: "hsl(var(--bg))", color: "hsl(var(--fg))", border: "1px solid hsl(var(--border))", borderRadius: 12, padding: 20, display: "grid", gap: 14 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h2 id="role-vault-title" style={{ margin: 0, fontSize: 18 }}>
            {t("e2ee.roles.title")}
          </h2>
          <span style={{ flex: 1 }} />
          <HelpButton topic="sync/role-vaults" />
          <button type="button" aria-label={t("e2ee.sync.close")} onClick={onClose} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontSize: 20 }}>
            ×
          </button>
        </div>
        <div style={muted}>{t("e2ee.roles.intro")}</div>
        <UnauditedNotice />

        {invite === "bad" && (
          <div role="alert" style={errorStyle} data-testid="role-join-bad">
            {t("e2ee.roles.join.bad")}
          </div>
        )}
        {invite && invite !== "bad" && <JoinScreen invite={invite} relay={relay} onJoin={() => void join()} />}

        {view.v === "list" && (
          <section style={{ display: "grid", gap: 8 }} data-testid="role-list">
            {records.length === 0 ? (
              <EmptyState style={{ padding: 0 }} message={t("e2ee.roles.empty")} action={learnHow("sync/role-vaults")} />
            ) : (
              <ul style={list}>
                {records.map((r) => (
                  <li key={`${r.kind}:${r.id}`} style={{ ...card, padding: 10 }}>
                    <div style={row}>
                      <strong dir="ltr">{t("e2ee.roles.vault", { id: r.id })}</strong>
                      <span style={muted}>{t(`e2ee.roles.role.${r.kind === "admin" ? "admin" : r.role}`)}</span>
                      <span style={{ flex: 1 }} />
                      <button type="button" style={ghost} aria-label={`${t("e2ee.roles.open")} ${t("e2ee.roles.vault", { id: r.id })}`} onClick={() => setView(r.kind === "admin" ? { v: "admin", record: r } : { v: "member", record: r })}>
                        {t("e2ee.roles.open")}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {relay ? (
              <button type="button" style={{ ...primary, justifySelf: "start" }} onClick={() => setView({ v: "new" })} data-testid="role-new">
                {t("e2ee.roles.create.title")}
              </button>
            ) : (
              <div style={muted}>{t("e2ee.roles.noRelay")}</div>
            )}
          </section>
        )}

        {view.v === "new" && (
          <section style={card} aria-labelledby="role-new-title" aria-busy={busy}>
            <h3 id="role-new-title" style={{ margin: 0, fontSize: 15 }}>
              {t("e2ee.roles.create.title")}
            </h3>
            <div style={muted}>{t("e2ee.roles.create.note")}</div>
            <PassphraseRow go={t("e2ee.roles.create.go")} label={t("e2ee.roles.passphrase")} testid="role-create" onSubmit={(p) => void create(p)} />
          </section>
        )}

        {view.v === "admin" && (
          <section style={{ display: "grid", gap: 10 }} aria-busy={busy} data-testid="role-admin">
            <div style={row}>
              <strong dir="ltr">{t("e2ee.roles.vault", { id: view.record.id })}</strong>
              <span style={muted}>{t("e2ee.roles.you", { role: t("e2ee.roles.role.admin") })}</span>
            </div>
            {admin && admin.record.id === view.record.id ? (
              <>
                <InviteScreen session={admin} deps={deps} origin={origin} onError={onError} version={version} />
                <MemberList session={admin} deps={deps} onError={onError} onChanged={() => setVersion((n) => n + 1)} />
                <SharedConsent vault={view.record.id} />
              </>
            ) : (
              <PassphraseRow go={t("e2ee.roles.unlock.go")} label={t("e2ee.roles.passphrase")} testid="role-unlock" onSubmit={(p) => void unlock(view.record, p)} />
            )}
          </section>
        )}

        {view.v === "member" && <MemberView key={view.record.id} record={view.record} deps={deps} onError={onError} />}
        {view.v === "member" && <SharedConsent key={`consent-${view.record.id}`} vault={view.record.id} />}

        {view.v !== "list" && (
          <button type="button" style={{ ...ghost, justifySelf: "start" }} onClick={back} data-testid="role-back">
            {t("e2ee.roles.back")}
          </button>
        )}

        {error && (
          <div role="alert" style={errorStyle}>
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}
