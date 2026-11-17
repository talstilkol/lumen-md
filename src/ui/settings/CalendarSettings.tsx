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
import { useRef, useState } from "react";
import { t } from "../../i18n";
import { basicAuth, type DiscoveredCalendar } from "../../calendar/caldav";
import { forgetAccount, readAccount, readSubscriptions, saveAccount, saveSubscriptions, type CalDavAccount, type IcsSubscription } from "../../calendar/config";
import type { ConnectionResult } from "../../calendar/app";
import type { SyncReport } from "../../calendar/taskSync";
import "./calendarSettingsStrings";
import "../PromptDialog.css";
import "./CalendarSettings.css";
import { explainError } from "../../lib/userError";

type App = typeof import("../../calendar/app");
const app = (): Promise<App> => import("../../calendar/app");

/** When the last task sync ended, and how (not secret: settings storage). */
export const LAST_SYNC_KEY = "lumen.calendar.caldav.lastSync";
interface LastSync {
  at: string;
  pushed: number;
  pulled: number;
  conflicts: number;
  errors: number;
}
function readLastSync(): LastSync | null {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_SYNC_KEY) ?? "null") as LastSync | null;
    return v && typeof v.at === "string" ? v : null;
  } catch {
    return null;
  }
}
const when = (iso: string) => {
  try {
    return new Date(iso).toLocaleString(document.documentElement.lang || undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
};
const btn = "prompt-btn prompt-btn-cancel cal-btn";

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
  const [icsMessage, setIcsMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "test" | "sync" | "find">(null);
  const [last, setLast] = useState<LastSync | null>(() => readLastSync());
  const nameInput = useRef<HTMLInputElement | null>(null);
  const subsList = useRef<HTMLUListElement | null>(null);
  const auth = () => (password ? basicAuth(account.user, password) : undefined);

  const say = (r: ConnectionResult) => setMessage(r.ok ? t("calendar.settings.ok", { n: r.tasks }) : t(`calendar.settings.fail.${r.reason}`));
  /** One request at a time; a failure (offline, a bug) is said, never swallowed. */
  const run = async (what: "test" | "sync" | "find", f: () => Promise<void>) => {
    if (busy) return;
    setBusy(what);
    setMessage(t(`calendar.settings.busy.${what}`));
    try {
      await f();
    } catch (e) {
      setMessage(t("calendar.settings.fail.error", { error: explainError(e) }));
    } finally {
      setBusy(null);
    }
  };
  const syncNow = () =>
    run("sync", async () => {
      const r: SyncReport | null = await (await calendarApp()).syncTasksNow();
      if (!r) return setMessage(t("calendar.settings.fail.no-account"));
      const l = { at: new Date().toISOString(), pushed: r.pushed, pulled: r.pulled, conflicts: r.conflicts.length, errors: r.errors.length };
      try {
        localStorage.setItem(LAST_SYNC_KEY, JSON.stringify(l));
      } catch {
        /* why: storage blocked: the time shows for this session only */
      }
      setLast(l);
      setMessage(t("calendar.settings.synced", { pushed: r.pushed, pulled: r.pulled, conflicts: r.conflicts.length, errors: r.errors.length }));
    });
  const removeSub = (id: string) => {
    const i = subs.findIndex((x) => x.id === id);
    const next = subs.filter((x) => x.id !== id);
    setSubs(next);
    void saveSubscriptions(next);
    setIcsMessage(t("calendar.settings.removed", { name: subs[i]?.name ?? "" }));
    // Focus stays in the list: the next subscription's Remove, else the previous one's, else the name field.
    requestAnimationFrame(() => {
      const buttons = subsList.current?.querySelectorAll<HTMLButtonElement>("button") ?? [];
      (buttons[Math.min(i, buttons.length - 1)] ?? nameInput.current)?.focus();
    });
  };

  return (
    <div data-testid="calendar-settings" className="cal-settings">
      <p className="cal-muted">{t("calendar.settings.intro")}</p>
      <section className="cal-card" aria-labelledby="cal-caldav" aria-busy={busy !== null}>
        <h3 id="cal-caldav" className="cal-h3">
          {t("calendar.settings.caldav")}
        </h3>
        <label className="cal-row">
          {t("calendar.settings.url")}
          <input className="cal-input" dir="ltr" value={account.url} data-testid="cal-url" onChange={(e) => setAccount({ ...account, url: e.target.value })} />
        </label>
        <label className="cal-row">
          {t("calendar.settings.user")}
          <input className="cal-input" dir="ltr" value={account.user} autoComplete="username" data-testid="cal-user" onChange={(e) => setAccount({ ...account, user: e.target.value })} />
        </label>
        <label className="cal-row">
          {t("calendar.settings.password")}
          <input className="cal-input" dir="ltr" type="password" value={password} autoComplete="current-password" placeholder={saved ? t("calendar.settings.passwordKept") : ""} data-testid="cal-password" onChange={(e) => setPassword(e.target.value)} />
        </label>
        <label className="cal-row">
          {t("calendar.settings.inbox")}
          <input className="cal-input" dir="auto" value={account.inbox} onChange={(e) => setAccount({ ...account, inbox: e.target.value })} />
        </label>
        <div className="cal-row">
          <button
            type="button"
            className="prompt-btn prompt-btn-ok cal-btn"
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
          <button type="button" className={btn} data-testid="cal-test" disabled={busy !== null} onClick={() => void run("test", async () => say(await (await calendarApp()).testConnection(account, auth() ?? undefined)))}>
            {t("calendar.settings.test")}
          </button>
          <button type="button" className={btn} data-testid="cal-sync" disabled={busy !== null} onClick={() => void syncNow()}>
            {t("calendar.settings.syncNow")}
          </button>
          <button
            type="button"
            className={`${btn} cal-danger`}
            data-testid="cal-forget"
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
        <div className="cal-row">
          <label className="cal-row">
            {t("calendar.settings.home")}
            <input className="cal-input" dir="ltr" value={home} data-testid="cal-home" onChange={(e) => setHome(e.target.value)} />
          </label>
          <button
            type="button"
            className={btn}
            data-testid="cal-find"
            disabled={busy !== null}
            onClick={() =>
              void run("find", async () => {
                const r = await (await calendarApp()).findCalendars(home, auth());
                if (Array.isArray(r)) {
                  setFound(r);
                  setMessage(null);
                } else say(r);
              })
            }
          >
            {t("calendar.settings.find")}
          </button>
        </div>
        {found && !found.length && <p className="cal-muted">{t("calendar.settings.noneFound")}</p>}
        {found && found.length > 0 && (
          <div role="radiogroup" aria-label={t("calendar.settings.choose")} data-testid="cal-found">
            {found.map((c) => (
              <label key={c.url} className="cal-row">
                <input type="radio" name="cal-choice" checked={account.url === c.url} onChange={() => setAccount({ ...account, url: c.url })} />
                <span dir="auto">{c.name}</span>
                <span className="cal-muted">{c.tasks === false ? t("calendar.settings.noTasks") : ""}</span>
              </label>
            ))}
          </div>
        )}
        {/* Mounted before it has anything to say, so a screen reader hears each message. */}
        <p role="status" data-testid="cal-message" className="cal-status">
          {message}
        </p>
        {last && (
          <p className="cal-muted" data-testid="cal-last-sync">
            {t("calendar.settings.lastSync", { when: when(last.at), pushed: last.pushed, pulled: last.pulled, conflicts: last.conflicts })}
          </p>
        )}
      </section>

      <section className="cal-card" aria-labelledby="cal-ics">
        <h3 id="cal-ics" className="cal-h3">
          {t("calendar.settings.ics")}
        </h3>
        <p className="cal-muted">{t("calendar.settings.icsNote")}</p>
        {subs.length === 0 ? (
          <p className="cal-muted" data-testid="cal-ics-empty">
            {t("calendar.settings.icsEmpty")}
          </p>
        ) : (
          <ul className="cal-subs" ref={subsList} aria-label={t("calendar.settings.ics")}>
            {subs.map((s) => (
              <li key={s.id} className="cal-row cal-sub" data-testid="cal-ics-item">
                <span dir="auto" className="cal-sub-name">
                  {s.name}
                </span>
                <button type="button" className={`${btn} cal-danger`} aria-label={t("calendar.settings.removeLabel", { name: s.name })} onClick={() => removeSub(s.id)}>
                  {t("calendar.settings.remove")}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="cal-row">
          <input ref={nameInput} className="cal-input cal-input-short" aria-label={t("calendar.settings.icsName")} placeholder={t("calendar.settings.icsName")} value={newSub.name} data-testid="cal-ics-name" onChange={(e) => setNewSub({ ...newSub, name: e.target.value })} />
          <input aria-label={t("calendar.settings.icsUrl")} className="cal-input" dir="ltr" value={newSub.url} data-testid="cal-ics-url" onChange={(e) => setNewSub({ ...newSub, url: e.target.value })} />
          <button
            type="button"
            className={btn}
            data-testid="cal-ics-add"
            onClick={() => {
              // The ICS section's own message: a bad address is said here, next to the field.
              if (!newSub.url.trim() || !/^(https|webcals?):\/\//i.test(newSub.url.trim())) return setIcsMessage(t("calendar.settings.fail.url"));
              const name = newSub.name.trim() || newSub.url.trim();
              const next = [...subs, { id: crypto.randomUUID(), name, url: newSub.url.trim() }];
              setSubs(next);
              setNewSub({ name: "", url: "" });
              void saveSubscriptions(next);
              setIcsMessage(t("calendar.settings.added", { name }));
              nameInput.current?.focus();
            }}
          >
            {t("calendar.settings.add")}
          </button>
        </div>
        <p role="status" data-testid="cal-ics-message" className="cal-status">
          {icsMessage}
        </p>
      </section>
    </div>
  );
}
