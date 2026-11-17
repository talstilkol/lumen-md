/**
 * The admin's member list (plan W12.S4): every device in the ACL with its
 * role and whether it has a personal folder, the revoked ones after them,
 * the join requests waiting, and a Revoke button per member.
 *
 * Revoking asks first, in the app's own dialog (ui/PromptDialog `uiConfirm`),
 * then writes the new ACL (the relay refuses that device's writes from the
 * next request on) and re-keys (a new read key sealed to every device but
 * that one): ../vault.ts `revokeMember`, through the controller.
 */

import { useCallback, useEffect, useState } from "react";
import { t } from "../../../../i18n";
import "../../strings";
import { accept, listMembers, listPending, revoke, type AdminSession, type MemberRow, type Pending, type RoleDeps } from "./controller";
import { badge, card, ghost, list, muted, primary, row } from "./styles";

const short = (id: string) => (id.length > 10 ? id.slice(0, 8) : id);

/** `onChanged`: an accepted request used up its invite (the invite screen shows it). */
export function MemberList({ session, deps, onError, onChanged }: { session: AdminSession; deps: RoleDeps; onError: (e: unknown) => void; onChanged?: () => void }) {
  const [rows, setRows] = useState<MemberRow[] | null>(null);
  const [pending, setPending] = useState<Pending[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [news, setNews] = useState<string | null>(null);
  const me = session.record.keys.id;

  const reload = useCallback(() => void listMembers(session).then(setRows, onError), [session, onError]);
  useEffect(reload, [reload]);

  const check = async () => {
    setBusy(true);
    try {
      setPending(await listPending(session));
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  const take = async (j: Pending) => {
    setBusy(true);
    try {
      await accept(deps, session, j);
      setPending((p) => (p ?? []).filter((x) => x.name !== j.name));
      onChanged?.();
      reload();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    const { uiConfirm } = await import("../../../../ui/PromptDialog");
    const ok = await uiConfirm({ title: t("e2ee.roles.revoke.title"), message: t("e2ee.roles.revoke.confirm", { id: short(id) }), okLabel: t("e2ee.roles.members.revoke") });
    if (!ok) return;
    setBusy(true);
    setNews(null);
    try {
      await revoke(session, id);
      setNews(t("e2ee.roles.revoke.done", { id: short(id) }));
      reload();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section style={card} aria-labelledby="role-pending-title" data-testid="role-pending">
        <h3 id="role-pending-title" style={{ margin: 0, fontSize: 15 }}>
          {t("e2ee.roles.pending.title")}
        </h3>
        <button type="button" style={{ ...ghost, justifySelf: "start" }} disabled={busy} onClick={() => void check()} data-testid="role-pending-check">
          {t("e2ee.roles.pending.check")}
        </button>
        {pending &&
          (pending.length === 0 ? (
            <div role="status" style={muted}>
              {/* empty-action: the "check for requests" button right above */}
              {t("e2ee.roles.pending.none")}
            </div>
          ) : (
            <ul style={list}>
              {pending.map((j) => (
                <li key={j.name} style={row} data-testid="role-pending-row">
                  <span>{t("e2ee.roles.pending.row", { id: short(j.request.member), role: t(`e2ee.roles.role.${j.invite.role}`) })}</span>
                  {j.invite.personal && <span style={badge}>{t("e2ee.roles.personal.badge")}</span>}
                  <button type="button" style={primary} disabled={busy} aria-label={t("e2ee.roles.pending.acceptLabel", { id: short(j.request.member) })} onClick={() => void take(j)}>
                    {t("e2ee.roles.pending.accept")}
                  </button>
                </li>
              ))}
            </ul>
          ))}
      </section>

      <section style={card} aria-labelledby="role-members-title" data-testid="role-members">
        <h3 id="role-members-title" style={{ margin: 0, fontSize: 15 }}>
          {t("e2ee.roles.members.title")}
        </h3>
        {rows && (
          <ul style={list}>
            {rows.map((m) => (
              <li key={`${m.revoked ? "r" : "m"}:${m.id}`} style={{ ...row, opacity: m.revoked ? 0.7 : 1 }} data-testid="role-member" data-member={m.id} data-role={m.role} data-revoked={m.revoked ? "1" : undefined}>
                <span>
                  {t("e2ee.roles.members.device", { id: short(m.id) })}
                  {m.id === me ? ` (${t("e2ee.roles.members.thisDevice")})` : ""}
                </span>
                <span style={badge}>{t(`e2ee.roles.role.${m.role}`)}</span>
                {m.personal && (
                  <span style={badge} title={t("e2ee.roles.personal.member")} data-testid="role-member-personal">
                    {t("e2ee.roles.personal.badge")}
                  </span>
                )}
                {m.revoked ? (
                  <span style={muted}>{t("e2ee.roles.members.revoked")}</span>
                ) : (
                  m.role !== "admin" && (
                    <button type="button" style={ghost} disabled={busy} aria-label={t("e2ee.roles.members.revokeLabel", { id: short(m.id) })} onClick={() => void remove(m.id)} data-testid="role-member-revoke">
                      {t("e2ee.roles.members.revoke")}
                    </button>
                  )
                )}
              </li>
            ))}
          </ul>
        )}
        {news && (
          <div role="status" style={muted}>
            {news}
          </div>
        )}
      </section>
    </>
  );
}
