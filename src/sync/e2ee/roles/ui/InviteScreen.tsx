/**
 * The admin's invite screen (plan W12.S4): pick a role (and a personal
 * folder), make a link, show it as text and as a QR code. One link per role
 * and device. Neither the link nor the QR carries a name or an e-mail: the
 * `#rolevault=` fragment holds the relay, the space token, the admin's keys,
 * the role and the invite's id and secret (../vault.ts `inviteHash`), and
 * the fragment never reaches a server.
 */

import { useMemo, useState } from "react";
import { t } from "../../../../i18n";
import "../../strings";
import { encodeQr, qrPath } from "../../../../lib/qr";
import type { Invite } from "../vault";
import { inviteLink, makeInvite, withdrawInvite, type AdminSession, type RoleDeps } from "./controller";
import { badge, card, field, ghost, list, muted, primary, row } from "./styles";

/** The link as a QR code (lib/qr.ts, level M), black on white so every camera reads it. */
export function InviteQr({ link }: { link: string }) {
  const qr = useMemo(() => encodeQr(link, "M"), [link]);
  const n = qr.size + 8;
  return (
    <figure style={{ margin: 0, display: "grid", gap: 6 }} data-testid="role-invite-qr">
      {/* design-allow: a QR code is black on white in both themes, so every scanner reads it */}
      <svg role="img" aria-label={t("e2ee.roles.invite.qr")} viewBox={`0 0 ${n} ${n}`} width={Math.min(260, n * 3)} height={Math.min(260, n * 3)} shapeRendering="crispEdges" style={{ background: "#fff", borderRadius: 4, justifySelf: "start" }}>
        {/* design-allow: the QR modules are black (see above) */}
        <path d={qrPath(qr)} fill="#000" />
      </svg>
      <figcaption style={muted}>{t("e2ee.roles.invite.qrHint")}</figcaption>
    </figure>
  );
}

/** `version` changes when another section changed the invites (an accepted request uses its invite up). */
export function InviteScreen({ session, deps, origin, onError, version = 0 }: { session: AdminSession; deps: RoleDeps; origin: string; onError: (e: unknown) => void; version?: number }) {
  const [role, setRole] = useState<"writer" | "reader">("reader");
  const [personal, setPersonal] = useState(false);
  const [current, setCurrent] = useState<Invite | null>(null);
  const [, rerender] = useState(0);
  const open = session.record.invites;
  // An invite used up elsewhere is no longer the one on screen.
  const shown = current && open.some((i) => i.id === current.id) ? current : null;
  const link = shown ? inviteLink(shown, origin) : null;
  void version;

  const make = async () => {
    try {
      const invite = await makeInvite(deps, session, role, personal);
      setCurrent(invite);
    } catch (e) {
      onError(e);
    }
  };

  const withdraw = async (id: string) => {
    try {
      await withdrawInvite(deps, session, id);
      if (current?.id === id) setCurrent(null);
      rerender((n) => n + 1);
    } catch (e) {
      onError(e);
    }
  };

  return (
    <section style={card} aria-labelledby="role-invite-title" data-testid="role-invite">
      <h3 id="role-invite-title" style={{ margin: 0, fontSize: 15 }}>
        {t("e2ee.roles.invite.title")}
      </h3>
      <fieldset style={{ border: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
        <legend style={{ fontSize: 14, marginBottom: 4 }}>{t("e2ee.roles.invite.role")}</legend>
        {(["reader", "writer"] as const).map((r) => (
          <label key={r} style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 14 }}>
            <input type="radio" name="role-invite-role" value={r} checked={role === r} onChange={() => setRole(r)} data-testid={`role-invite-${r}`} />
            <span>
              <strong>{t(`e2ee.roles.role.${r}`)}</strong> <span style={muted}>{t(`e2ee.roles.role.${r}Hint`)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <label style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 14 }}>
        <input type="checkbox" checked={personal} onChange={(e) => setPersonal(e.target.checked)} data-testid="role-invite-personal" />
        {t("e2ee.roles.invite.personal")}
      </label>
      <button type="button" style={{ ...primary, justifySelf: "start" }} onClick={() => void make()} data-testid="role-invite-make">
        {t("e2ee.roles.invite.make")}
      </button>

      {shown && link && (
        <div style={{ display: "grid", gap: 8 }} data-testid="role-invite-result">
          <div style={row}>
            <span style={badge}>{t(`e2ee.roles.role.${shown.role}`)}</span>
            {shown.personal && <span style={badge}>{t("e2ee.roles.personal.badge")}</span>}
          </div>
          <div style={row}>
            <input
              readOnly
              dir="ltr"
              style={{ ...field, flex: 1, minWidth: 0, fontFamily: "ui-monospace, monospace", fontSize: 12 }}
              value={link}
              aria-label={t("e2ee.roles.invite.link")}
              data-testid="role-invite-link"
              onFocus={(e) => e.currentTarget.select()}
            />
            <button type="button" style={ghost} onClick={() => void navigator.clipboard?.writeText(link).catch(() => undefined)}>
              {t("e2ee.roles.invite.copy")}
            </button>
          </div>
          <InviteQr link={link} />
        </div>
      )}
      <div style={muted}>{t("e2ee.roles.invite.note")}</div>

      {open.length > 0 && (
        <div style={{ display: "grid", gap: 6 }}>
          <div style={muted}>{t("e2ee.roles.invite.open", { n: open.length })}</div>
          <ul style={list} data-testid="role-invite-open">
            {open.map((i) => (
              <li key={i.id} style={row}>
                <span style={badge}>{t(`e2ee.roles.role.${i.role}`)}</span>
                {i.personal && <span style={badge}>{t("e2ee.roles.personal.badge")}</span>}
                <code dir="ltr" style={{ fontSize: 12 }}>
                  {i.id.slice(0, 6)}
                </code>
                <button type="button" style={ghost} aria-label={t("e2ee.roles.invite.withdrawLabel", { role: t(`e2ee.roles.role.${i.role}`), id: i.id.slice(0, 6) })} onClick={() => void withdraw(i.id)}>
                  {t("e2ee.roles.invite.withdraw")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
