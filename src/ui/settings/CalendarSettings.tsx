/**
 * Settings → Calendar (plan W7.20 step 1, W10.C4): the CalDAV account for
 * task sync, and read-only ICS subscriptions for the daily note.
 *
 *   • The password goes to the secret store (the OS keychain on the desktop,
 *     encrypted storage elsewhere: lib/secretStore), never to settings
 *     storage, and never into a settings export. The ICS list lives there
 *     too: a private ICS address is itself a key.
 *   • "Find my calendars" lists the collections under a calendar home
 *     (PROPFIND); choosing one fills the calendar address.
 *   • "Test the connection" makes one request and says what happened, in the
 *     app's language (a wrong password, a server that does not allow this
 *     app's origin, an address that is not a calendar).
 *   • "Sync tasks now" runs one task sync; a conflict opens the conflict
 *     dialog.
 * Every request goes through the privacy ledger (calendar/config.ts).
 */
import { useState } from "react";
import { t } from "../../i18n";
import { basicAuth, type DiscoveredCalendar } from "../../calendar/caldav";
import { forgetAccount, readAccount, readSubscriptions, saveAccount, saveSubscriptions, type CalDavAccount, type IcsSubscription } from "../../calendar/config";
import type { ConnectionResult } from "../../calendar/app";
import type { SyncReport } from "../../calendar/taskSync";

type App = typeof import("../../calendar/app");
const app = (): Promise<App> => import("../../calendar/app");

const row: React.CSSProperties = { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", margin: "4px 0" };
const card: React.CSSProperties = { border: "1px solid hsl(var(--border))", borderRadius: 6, padding: 10, margin: "8px 0" };
const ltr: React.CSSProperties = { direction: "ltr", flex: "1 1 240px", minWidth: 0 };
const muted: React.CSSProperties = { fontSize: 12, opacity: 0.8 };

export interface CalendarSettingsProps {
  /** Tests: the calendar app's functions (default: calendar/app.ts, loaded on use). */
  calendarApp?: () => Promise<Pick<App, "testConnection" | "findCalendars" | "syncTasksNow">>;
}

export function CalendarSettings({ calendarApp = app }: CalendarSettingsProps) {
  const saved = readAccount();
  const [account, setAccount] = useState<CalDavAccount>(saved ?? { url: "", user: "", inbox: "Tasks/Calendar.md" });
  const [password, setPassword] = useState("");
  const [home, setHome] = useState("");
  const [found, setFound] = useState<DiscoveredCalendar[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [subs, setSubs] = useState<IcsSubscription[]>(() => readSubscriptions());
  const [newSub, setNewSub] = useState({ name: "", url: "" });
  const auth = () => (password ? basicAuth(account.user, password) : undefined);

  const say = (r: ConnectionResult) => setMessage(r.ok ? t("calendar.settings.ok", { n: r.tasks }) : t(`calendar.settings.fail.${r.reason}`));

  return (
    <div data-testid="calendar-settings">
      <p style={muted}>{t("calendar.settings.intro")}</p>
      <section style={card} aria-labelledby="cal-caldav">
        <h3 id="cal-caldav" style={{ fontSize: 14, margin: 0 }}>
          {t("calendar.settings.caldav")}
        </h3>
        <label style={row}>
          {t("calendar.settings.url")}
          <input style={ltr} value={account.url} data-testid="cal-url" onChange={(e) => setAccount({ ...account, url: e.target.value })} />
        </label>
        <label style={row}>
          {t("calendar.settings.user")}
          <input style={ltr} value={account.user} autoComplete="username" data-testid="cal-user" onChange={(e) => setAccount({ ...account, user: e.target.value })} />
        </label>
        <label style={row}>
          {t("calendar.settings.password")}
          <input style={ltr} type="password" value={password} autoComplete="current-password" placeholder={saved ? t("calendar.settings.passwordKept") : ""} data-testid="cal-password" onChange={(e) => setPassword(e.target.value)} />
        </label>
        <label style={row}>
          {t("calendar.settings.inbox")}
          <input style={{ flex: "1 1 240px", minWidth: 0 }} dir="auto" value={account.inbox} onChange={(e) => setAccount({ ...account, inbox: e.target.value })} />
        </label>
        <div style={row}>
          <button
            type="button"
            data-testid="cal-save"
            onClick={() =>
              void saveAccount(account, password || null).then(() => {
                setPassword("");
                setMessage(t("calendar.settings.saved"));
              })
            }
          >
            {t("calendar.settings.save")}
          </button>
          <button type="button" data-testid="cal-test" onClick={() => void calendarApp().then((m) => m.testConnection(account, auth() ?? undefined).then(say))}>
            {t("calendar.settings.test")}
          </button>
          <button
            type="button"
            data-testid="cal-sync"
            onClick={() =>
              void calendarApp()
                .then((m) => m.syncTasksNow())
                .then((r: SyncReport | null) => setMessage(r ? t("calendar.settings.synced", { pushed: r.pushed, pulled: r.pulled, conflicts: r.conflicts.length, errors: r.errors.length }) : t("calendar.settings.fail.no-account")))
            }
          >
            {t("calendar.settings.syncNow")}
          </button>
          <button
            type="button"
            onClick={() =>
              void forgetAccount().then(() => {
                setAccount({ url: "", user: "", inbox: "Tasks/Calendar.md" });
                setMessage(t("calendar.settings.forgotten"));
              })
            }
          >
            {t("calendar.settings.forget")}
          </button>
        </div>
        <div style={row}>
          <label style={row}>
            {t("calendar.settings.home")}
            <input style={ltr} value={home} data-testid="cal-home" onChange={(e) => setHome(e.target.value)} />
          </label>
          <button
            type="button"
            data-testid="cal-find"
            onClick={() =>
              void calendarApp()
                .then((m) => m.findCalendars(home, auth()))
                .then((r) => (Array.isArray(r) ? setFound(r) : say(r)))
            }
          >
            {t("calendar.settings.find")}
          </button>
        </div>
        {found && !found.length && <p style={muted}>{t("calendar.settings.noneFound")}</p>}
        {found && found.length > 0 && (
          <div role="radiogroup" aria-label={t("calendar.settings.choose")} data-testid="cal-found">
            {found.map((c) => (
              <label key={c.url} style={row}>
                <input type="radio" name="cal-choice" checked={account.url === c.url} onChange={() => setAccount({ ...account, url: c.url })} />
                <span dir="auto">{c.name}</span>
                <span style={muted}>{c.tasks === false ? t("calendar.settings.noTasks") : ""}</span>
              </label>
            ))}
          </div>
        )}
        {message && (
          <p role="status" data-testid="cal-message">
            {message}
          </p>
        )}
      </section>

      <section style={card} aria-labelledby="cal-ics">
        <h3 id="cal-ics" style={{ fontSize: 14, margin: 0 }}>
          {t("calendar.settings.ics")}
        </h3>
        <p style={muted}>{t("calendar.settings.icsNote")}</p>
        {subs.map((s) => (
          <div key={s.id} style={row}>
            <span dir="auto">{s.name}</span>
            <button
              type="button"
              onClick={() => {
                const next = subs.filter((x) => x.id !== s.id);
                setSubs(next);
                void saveSubscriptions(next);
              }}
            >
              {t("calendar.settings.remove")}
            </button>
          </div>
        ))}
        <div style={row}>
          <input aria-label={t("calendar.settings.icsName")} placeholder={t("calendar.settings.icsName")} value={newSub.name} data-testid="cal-ics-name" onChange={(e) => setNewSub({ ...newSub, name: e.target.value })} />
          <input aria-label={t("calendar.settings.icsUrl")} style={ltr} value={newSub.url} data-testid="cal-ics-url" onChange={(e) => setNewSub({ ...newSub, url: e.target.value })} />
          <button
            type="button"
            data-testid="cal-ics-add"
            onClick={() => {
              if (!newSub.url.trim() || !/^(https|webcals?):\/\//i.test(newSub.url.trim())) return setMessage(t("calendar.settings.fail.url"));
              const next = [...subs, { id: crypto.randomUUID(), name: newSub.name.trim() || newSub.url.trim(), url: newSub.url.trim() }];
              setSubs(next);
              setNewSub({ name: "", url: "" });
              void saveSubscriptions(next);
            }}
          >
            {t("calendar.settings.add")}
          </button>
        </div>
      </section>
    </div>
  );
}
