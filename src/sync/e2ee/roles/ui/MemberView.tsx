/**
 * A member's side of a role vault (plan W12.S4):
 *
 *   JoinScreen          a `#rolevault=` link was opened: what role it gives,
 *                       that nothing about the person is sent, "Ask to join".
 *   MemberView          waiting for the admin, or open: the role, the
 *                       personal-folder indicator, the one-time "confirm
 *                       this vault is current" prompt, and "Sync now".
 *   ConfirmCurrent      the prompt itself. A device enrolled without pairing
 *                       pulls but doesn't upload until its user confirms
 *                       (engine N6); the engine keeps the answer in its
 *                       state store, so it is asked once per device.
 *   PersonalFolderNote  "only you and the admin can read it".
 */

import { usePresence } from "./usePresence";
import { useCallback, useEffect, useState } from "react";
import { t } from "../../../../i18n";
import "../../strings";
import type { Invite } from "../vault";
import { confirmCurrent, folderOf, needsConfirm, openMember, type MemberSession, type RoleDeps } from "./controller";
import type { RoleRecord } from "./records";
import { badge, card, errorStyle, ghost, muted, primary, row } from "./styles";

export function JoinScreen({ invite, relay, onJoin }: { invite: Invite; relay: string | null; onJoin: () => void }) {
  const otherRelay = invite.relay !== relay;
  return (
    <section style={card} aria-labelledby="role-join-title" data-testid="role-join">
      <h3 id="role-join-title" style={{ margin: 0, fontSize: 15 }}>
        {t("e2ee.roles.join.title")}
      </h3>
      {otherRelay ? (
        <div role="alert" style={errorStyle}>
          {t("e2ee.roles.join.otherRelay", { relay: invite.relay })}
        </div>
      ) : (
        <>
          <div style={row}>
            <span>{t("e2ee.roles.join.as", { role: t(`e2ee.roles.role.${invite.role}`) })}</span>
            {invite.personal && <span style={badge}>{t("e2ee.roles.personal.badge")}</span>}
          </div>
          <div style={muted}>{t(`e2ee.roles.role.${invite.role}Hint`)}</div>
          <div style={muted}>{t("e2ee.roles.join.note")}</div>
          <button type="button" style={{ ...primary, justifySelf: "start" }} onClick={onJoin} data-testid="role-join-go">
            {t("e2ee.roles.join.go")}
          </button>
        </>
      )}
    </section>
  );
}

export function PersonalFolderNote() {
  return (
    <div style={row} data-testid="role-personal">
      <span style={badge}>{t("e2ee.roles.personal.badge")}</span>
      <span style={muted}>{t("e2ee.roles.personal.mine")}</span>
    </div>
  );
}

export function ConfirmCurrent({ onConfirm, busy }: { onConfirm: () => void; busy: boolean }) {
  return (
    <section role="region" aria-labelledby="role-fresh-title" style={{ ...card, borderColor: "hsl(var(--warning, var(--accent)))" }} data-testid="role-fresh">
      <h3 id="role-fresh-title" style={{ margin: 0, fontSize: 15 }}>
        {t("e2ee.roles.fresh.title")}
      </h3>
      <div style={muted}>{t("e2ee.roles.fresh.body")}</div>
      <button type="button" style={{ ...primary, justifySelf: "start" }} disabled={busy} onClick={onConfirm} data-testid="role-fresh-confirm">
        {t("e2ee.roles.fresh.confirm")}
      </button>
    </section>
  );
}

export function MemberView({ record, deps, onError }: { record: Extract<RoleRecord, { kind: "member" }>; deps: RoleDeps; onError: (e: unknown) => void }) {
  const [session, setSession] = useState<MemberSession | null>(null);
  // W13.S6: presence runs while this vault is open here (when switched on).
  usePresence(session?.sync);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(true);
  const [news, setNews] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const s = await openMember(deps, record);
      setSession(s);
      setConfirm(await needsConfirm(s));
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }, [deps, record, onError]);
  useEffect(() => void load(), [load]);

  const act = async (run: () => Promise<unknown>, done: string) => {
    if (!session) return;
    setBusy(true);
    setNews(null);
    try {
      await run();
      setConfirm(await needsConfirm(session));
      setNews(done);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section style={{ display: "grid", gap: 10 }} data-testid="role-member-view" aria-busy={busy}>
      <div style={row}>
        <span>{t("e2ee.roles.you", { role: t(`e2ee.roles.role.${record.role}`) })}</span>
      </div>
      {session && !session.sync && (
        <div style={card} data-testid="role-waiting">
          <div role="status" style={muted}>
            {t("e2ee.roles.join.waiting")}
          </div>
          <button type="button" style={{ ...ghost, justifySelf: "start" }} disabled={busy} onClick={() => void load()} data-testid="role-waiting-refresh">
            {t("e2ee.roles.join.refresh")}
          </button>
        </div>
      )}
      {session?.sync && (
        <>
          {session.scope && <PersonalFolderNote />}
          {record.role === "reader" && <div style={muted}>{t("e2ee.roles.readOnly")}</div>}
          {confirm && <ConfirmCurrent busy={busy} onConfirm={() => void act(() => confirmCurrent(session), t("e2ee.roles.fresh.done"))} />}
          <div style={muted} dir="auto">
            {t("e2ee.roles.folder", { folder: folderOf(record.id) })}
          </div>
          <button type="button" style={{ ...ghost, justifySelf: "start" }} disabled={busy} onClick={() => void act(() => session.sync!.sync(), t("e2ee.roles.synced"))} data-testid="role-sync">
            {t("e2ee.roles.syncNow")}
          </button>
        </>
      )}
      {news && (
        <div role="status" style={muted}>
          {news}
        </div>
      )}
    </section>
  );
}
