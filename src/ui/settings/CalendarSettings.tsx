/**
 * Settings → Calendar (plan W7.20 step 1, W10.C4): the CalDAV account for
 * task sync, and read-only ICS subscriptions for the daily note.
 *
 *   • The password goes to the secret store (the OS keychain on the desktop,
 *     encrypted storage elsewhere: lib/secretStore), never to settings
 *     storage, and never into a settings export; the tab says which store
 *     holds it. The ICS list lives there too: a private ICS address is
 *     itself a key, so the list shows only each feed's host.
 *   • "Find my calendars" lists the collections under a calendar home
 *     (PROPFIND); choosing one fills the calendar address.
 *   • "Test the connection" makes one request and says what happened, in the
 *     app's language (a wrong password, a server that does not allow this
 *     app's origin, an address that is not a calendar).
 *   • "Sync tasks now" runs one task sync; a conflict opens the conflict
 *     dialog.
 *   • While a request runs its button is busy (disabled, aria-busy) and the
 *     status line says so; an address that is not https is named at its
 *     field before anything is sent. Focus never drops to the page: removing
 *     a subscription moves it to the next one, or to the add field.
 * Every request goes through the privacy ledger (calendar/config.ts).
 */
import { useRef, useState, useSyncExternalStore } from "react";
import { t } from "../../i18n";
import { basicAuth, type DiscoveredCalendar } from "../../calendar/caldav";
import { forgetAccount, readAccount, readSubscriptions, saveAccount, saveSubscriptions, type CalDavAccount, type IcsSubscription } from "../../calendar/config";
import type { ConnectionResult } from "../../calendar/app";
import type { SyncReport } from "../../calendar/taskSync";
import { secretStoreMode, subscribeSecretStoreMode } from "../../lib/secretStore";
import { useAppStore } from "../../store/useStore";
import { btn, btnPrimary, card, field, heading, muted, row } from "./formStyles";
import "./calendarSettingsStrings";

type App = typeof import("../../calendar/app");
const app = (): Promise<App> => import("../../calendar/app");

const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "minmax(120px, max-content) minmax(0, 1fr)", gap: "6px 10px", alignItems: "center", margin: "8px 0" };
const ltrField: React.CSSProperties = { ...field, direction: "ltr", textAlign: "start", width: "100%" };
const wide: React.CSSProperties = { ...field, width: "100%" };
const fieldError: React.CSSProperties = { ...muted, color: "hsl(var(--danger))", gridColumn: "2" };

const DEFAULT_ACCOUNT: CalDavAccount = { url: "", user: "", inbox: "Tasks/Calendar.md" };

/** An address Lumen may send a password to: https, or http on this machine only. */
export function calendarUrlOk(u: string): boolean {
  try {
    const x = new URL(u.trim());
    return x.protocol === "https:" || (x.protocol === "http:" && /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(x.hostname));
  } catch {
    return false;
  }
}

/** A subscription's host, shown instead of its private address. */
export function feedHost(url: string): string {
  try {
    return new URL(url.trim().replace(/^webcals?:\/\//i, "https://")).host;
  } catch {
    return "";
  }
}

export interface CalendarSettingsProps {
  /** Tests: the calendar app's functions (default: calendar/app.ts, loaded on use). */
  calendarApp?: () => Promise<Pick<App, "testConnection" | "findCalendars" | "syncTasksNow"> & Partial<Pick<App, "refreshCalendarInNote">>>;
}

type Busy = null | "test" | "find" | "sync" | "save" | "refresh";

export function CalendarSettings({ calendarApp = app }: CalendarSettingsProps) {
  const [saved, setSaved] = useState(() => readAccount());
  const [account, setAccount] = useState<CalDavAccount>(saved ?? DEFAULT_ACCOUNT);
  const [password, setPassword] = useState("");
  const [home, setHome] = useState("");
  const [found, setFound] = useState<DiscoveredCalendar[] | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [subs, setSubs] = useState<IcsSubscription[]>(() => readSubscriptions());
  const [newSub, setNewSub] = useState({ name: "", url: "" });
  const [touched, setTouched] = useState({ url: false, home: false, ics: false });
  const mode = useSyncExternalStore(subscribeSecretStoreMode, secretStoreMode, secretStoreMode);
  const icsName = useRef<HTMLInputElement | null>(null);
  const daily = useAppStore((x) => x.dailyNotes);
  const setDailyNotes = useAppStore((x) => x.setDailyNotes);
  const hasField = /\{\{\s*calendar\s*\}\}/.test(daily.template);
  const [dailyMsg, setDailyMsg] = useState<string | null>(null);
  const refreshBtn = useRef<HTMLButtonElement | null>(null);
  const subsRef = useRef<HTMLUListElement | null>(null);
  const auth = () => (password ? basicAuth(account.user, password) : undefined);

  const say = (r: ConnectionResult) => setMessage(r.ok ? { text: t("calendar.settings.ok", { n: r.tasks }), ok: true } : { text: t(`calendar.settings.fail.${r.reason}`), ok: false });

  /** Run one request with its button busy; the status line says it is running. */
  const run = (b: Exclude<Busy, null>, f: () => Promise<void>) => {
    if (busy) return;
    setBusy(b);
    setMessage({ text: t("calendar.settings.working"), ok: true });
    void f()
      .catch((e: unknown) => setMessage({ text: t("calendar.settings.fail.server") + (e instanceof Error && e.message ? ` (${e.message})` : ""), ok: false }))
      .finally(() => setBusy(null));
  };

  const urlBad = touched.url && !!account.url.trim() && !calendarUrlOk(account.url);
  const homeBad = touched.home && !!home.trim() && !calendarUrlOk(home);
  const icsBad = touched.ics && !!newSub.url.trim() && !/^(https|webcals?):\/\//i.test(newSub.url.trim());
  const storeNote = t(`calendar.settings.store.${mode === "keychain" ? "keychain" : mode === "encrypted" ? "encrypted" : "plain"}`);

  // aria-disabled, not disabled: a disabled button loses focus, and focus would drop to <body> mid-request.
  const look = (base: React.CSSProperties): React.CSSProperties => (busy ? { ...base, opacity: 0.6, cursor: "progress" } : base);
  const busyProps = (b: Exclude<Busy, null>) => ({ "aria-disabled": busy !== null || undefined, "aria-busy": busy === b || undefined });

  const removeSub = (id: string) => {
    const i = subs.findIndex((x) => x.id === id);
    const next = subs.filter((x) => x.id !== id);
    setSubs(next);
    void saveSubscriptions(next);
    setMessage({ text: t("calendar.settings.removed"), ok: true });
    // Focus to the next subscription's Remove (or the one before), else the add field: never <body>.
    queueMicrotask(() => {
      const buttons = subsRef.current?.querySelectorAll<HTMLButtonElement>("button");
      const target = buttons && buttons.length ? buttons[Math.min(i, buttons.length - 1)] : icsName.current;
      target?.focus();
    });
  };

  const addSub = () => {
    const url = newSub.url.trim();
    setTouched((x) => ({ ...x, ics: true }));
    if (!url || !/^(https|webcals?):\/\//i.test(url)) {
      setMessage({ text: t("calendar.settings.fail.url"), ok: false });
      return;
    }
    const next = [...subs, { id: crypto.randomUUID(), name: newSub.name.trim() || feedHost(url) || url, url }];
    setSubs(next);
    setNewSub({ name: "", url: "" });
    setTouched((x) => ({ ...x, ics: false }));
    void saveSubscriptions(next);
    setMessage({ text: t("calendar.settings.added"), ok: true });
    queueMicrotask(() => icsName.current?.focus());
  };

  return (
    <div data-testid="calendar-settings">
      <p style={muted}>{t("calendar.settings.intro")}</p>
      <section style={card} aria-labelledby="cal-caldav">
        <h3 id="cal-caldav" style={{ ...heading, marginTop: 0 }}>
          {t("calendar.settings.caldav")}
        </h3>
        <div style={grid}>
          <label htmlFor="cal-url">{t("calendar.settings.url")}</label>
          <input
            id="cal-url"
            style={ltrField}
            value={account.url}
            inputMode="url"
            // i18n-allow: the URL scheme, the same in every language
            placeholder="https://"
            aria-invalid={urlBad || undefined}
            aria-describedby={urlBad ? "cal-url-err" : undefined}
            data-testid="cal-url"
            onBlur={() => setTouched((x) => ({ ...x, url: true }))}
            onChange={(e) => setAccount({ ...account, url: e.target.value })}
          />
          {urlBad && (
            <p id="cal-url-err" style={fieldError} data-testid="cal-url-error">
              {t("calendar.settings.fail.url")}
            </p>
          )}
          <label htmlFor="cal-user">{t("calendar.settings.user")}</label>
          <input id="cal-user" style={ltrField} value={account.user} autoComplete="username" data-testid="cal-user" onChange={(e) => setAccount({ ...account, user: e.target.value })} />
          <label htmlFor="cal-password">{t("calendar.settings.password")}</label>
          <input
            id="cal-password"
            style={ltrField}
            type="password"
            value={password}
            autoComplete="current-password"
            placeholder={saved ? t("calendar.settings.passwordKept") : ""}
            aria-describedby="cal-store"
            data-testid="cal-password"
            onChange={(e) => setPassword(e.target.value)}
          />
          <p id="cal-store" style={{ ...muted, gridColumn: "2" }} data-testid="cal-store">
            {storeNote}
          </p>
          <label htmlFor="cal-inbox">{t("calendar.settings.inbox")}</label>
          <input id="cal-inbox" style={wide} dir="auto" value={account.inbox} onChange={(e) => setAccount({ ...account, inbox: e.target.value })} />
        </div>
        <div style={row}>
          <button
            type="button"
            style={look(btnPrimary)}
            data-testid="cal-save"
            {...busyProps("save")}
            onClick={() =>
              run("save", async () => {
                await saveAccount(account, password || null);
                setPassword("");
                setSaved(readAccount());
                setMessage({ text: t("calendar.settings.saved"), ok: true });
              })
            }
          >
            {t("calendar.settings.save")}
          </button>
          <button type="button" style={look(btn)} data-testid="cal-test" {...busyProps("test")} onClick={() => run("test", async () => say(await (await calendarApp()).testConnection(account, auth() ?? undefined)))}>
            {t("calendar.settings.test")}
          </button>
          <button
            type="button"
            style={look(btn)}
            data-testid="cal-sync"
            {...busyProps("sync")}
            onClick={() =>
              run("sync", async () => {
                const r: SyncReport | null = await (await calendarApp()).syncTasksNow();
                setMessage(
                  r
                    ? { text: t("calendar.settings.synced", { pushed: r.pushed, pulled: r.pulled, conflicts: r.conflicts.length, errors: r.errors.length }), ok: !r.errors.length }
                    : { text: t("calendar.settings.fail.no-account"), ok: false },
                );
              })
            }
          >
            {t("calendar.settings.syncNow")}
          </button>
          <button
            type="button"
            style={look(btn)}
            data-testid="cal-forget"
            aria-disabled={busy !== null || undefined}
            onClick={() =>
              busy === null &&
              void forgetAccount().then(() => {
                setAccount(DEFAULT_ACCOUNT);
                setSaved(null);
                setPassword("");
                setFound(null);
                setMessage({ text: t("calendar.settings.forgotten"), ok: true });
              })
            }
          >
            {t("calendar.settings.forget")}
          </button>
        </div>
        <div style={grid}>
          <label htmlFor="cal-home">{t("calendar.settings.home")}</label>
          <div style={{ ...row, margin: 0 }}>
            <input
              id="cal-home"
              style={{ ...ltrField, flex: "1 1 220px", width: "auto" }}
              value={home}
              // i18n-allow: the URL scheme, the same in every language
              placeholder="https://"
              aria-invalid={homeBad || undefined}
              data-testid="cal-home"
              onBlur={() => setTouched((x) => ({ ...x, home: true }))}
              onChange={(e) => setHome(e.target.value)}
            />
            <button
              type="button"
              style={look(btn)}
              data-testid="cal-find"
              {...busyProps("find")}
              onClick={() =>
                run("find", async () => {
                  const r = await (await calendarApp()).findCalendars(home, auth());
                  if (Array.isArray(r)) {
                    setFound(r);
                    setMessage({ text: r.length ? t("calendar.settings.foundN", { n: r.length }) : t("calendar.settings.noneFound"), ok: r.length > 0 });
                  } else say(r);
                })
              }
            >
              {t("calendar.settings.find")}
            </button>
          </div>
        </div>
        {found && found.length > 0 && (
          <fieldset style={{ border: "1px solid hsl(var(--border))", borderRadius: 6, padding: "6px 10px", margin: "8px 0" }} data-testid="cal-found">
            <legend style={{ fontSize: 13, padding: "0 4px" }}>{t("calendar.settings.choose")}</legend>
            {found.map((c) => (
              <label key={c.url} style={row}>
                <input type="radio" name="cal-choice" checked={account.url === c.url} onChange={() => setAccount({ ...account, url: c.url })} />
                <span dir="auto">{c.name}</span>
                {c.tasks === false && <span style={muted}>{t("calendar.settings.noTasks")}</span>}
              </label>
            ))}
          </fieldset>
        )}
        <p role="status" aria-live="polite" data-testid="cal-message" data-ok={message ? String(message.ok) : undefined} style={{ ...muted, minHeight: 18, color: message && !message.ok ? "hsl(var(--danger))" : undefined }}>
          {message ? `${message.ok ? "" : "⚠ "}${message.text}` : ""}
        </p>
      </section>

      <section style={card} aria-labelledby="cal-ics">
        <h3 id="cal-ics" style={{ ...heading, marginTop: 0 }}>
          {t("calendar.settings.ics")}
        </h3>
        <p style={muted}>{t("calendar.settings.icsNote")}</p>
        {/* empty-action: the name and address fields below add the first subscription */}
        {!subs.length && <p style={{ ...muted, marginTop: 6 }}>{t("calendar.settings.icsNone")}</p>}
        {subs.length > 0 && (
          <ul ref={subsRef} style={{ listStyle: "none", padding: 0, margin: "8px 0" }} data-testid="cal-subs">
            {subs.map((s) => (
              <li key={s.id} style={{ ...row, justifyContent: "space-between", borderBottom: "1px solid hsl(var(--border))", padding: "4px 0" }}>
                <span>
                  <span dir="auto">{s.name}</span> <span style={muted}>· {feedHost(s.url)}</span>
                </span>
                <button type="button" style={btn} aria-label={t("calendar.settings.removeNamed", { name: s.name })} onClick={() => removeSub(s.id)}>
                  {t("calendar.settings.remove")}
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          style={{ ...row, alignItems: "flex-start" }}
          onSubmit={(e) => {
            e.preventDefault();
            addSub();
          }}
        >
          <input ref={icsName} style={{ ...field, flex: "1 1 140px" }} dir="auto" aria-label={t("calendar.settings.icsName")} placeholder={t("calendar.settings.icsName")} value={newSub.name} data-testid="cal-ics-name" onChange={(e) => setNewSub({ ...newSub, name: e.target.value })} />
          <input
            style={{ ...ltrField, flex: "2 1 240px", width: "auto" }}
            aria-label={t("calendar.settings.icsUrl")}
            // i18n-allow: the URL schemes, the same in every language
            placeholder="webcal:// · https://"
            aria-invalid={icsBad || undefined}
            value={newSub.url}
            data-testid="cal-ics-url"
            onBlur={() => setTouched((x) => ({ ...x, ics: true }))}
            onChange={(e) => setNewSub({ ...newSub, url: e.target.value })}
          />
          <button type="submit" style={btn} data-testid="cal-ics-add">
            {t("calendar.settings.add")}
          </button>
        </form>
      </section>

      {/* W10.C6: the subscriptions in the daily note — the template's field, and a refresh of today's note. */}
      <section style={card} aria-labelledby="cal-daily">
        <h3 id="cal-daily" style={{ ...heading, marginTop: 0 }}>
          {t("calendar.settings.daily")}
        </h3>
        <p style={muted} data-testid="cal-daily-field">
          {hasField ? t("calendar.settings.dailyHasField") : t("calendar.settings.dailyNoField")}
        </p>
        <div style={row}>
          {!hasField && (
            <button
              type="button"
              style={btn}
              data-testid="cal-daily-add-field"
              onClick={() => {
                setDailyNotes({ template: addCalendarField(daily.template) });
                setDailyMsg(t("calendar.settings.dailyFieldAdded"));
                // The button goes away: focus to the refresh button beside it, never <body>.
                queueMicrotask(() => refreshBtn.current?.focus());
              }}
            >
              {t("calendar.settings.dailyAddField")}
            </button>
          )}
          <button
            ref={refreshBtn}
            type="button"
            style={look(btn)}
            data-testid="cal-daily-refresh"
            {...busyProps("refresh")}
            onClick={() =>
              run("refresh", async () => {
                const m = await calendarApp();
                const { dailyPath, dayOf, isoOf } = await import("../../daily/dailyNote");
                const day = dayOf(new Date());
                const refresh = m.refreshCalendarInNote ?? (await app()).refreshCalendarInNote;
                const r = await refresh(dailyPath(day, daily), isoOf(day), {
                  labels: { heading: t("daily.calendar.heading"), allDay: t("daily.calendar.allDay"), none: t("daily.calendar.none"), failed: (name) => t("daily.calendar.failed", { name }) },
                });
                const text =
                  r.kind === "no-subscriptions" ? t("calendar.settings.dailyNoSubs") : r.kind === "no-note" ? t("calendar.settings.dailyNoNote", { path: r.path }) : t("calendar.settings.dailyRefreshed", { n: r.events, path: r.path });
                setDailyMsg(text);
                setMessage(null);
              })
            }
          >
            {t("calendar.settings.dailyRefresh")}
          </button>
        </div>
        <p role="status" aria-live="polite" style={{ ...muted, minHeight: 18 }} data-testid="cal-daily-message">
          {dailyMsg ?? ""}
        </p>
      </section>
    </div>
  );
}

/** The template with {{calendar}} added after its first line (the title), or at the end of a one-line template. */
export function addCalendarField(template: string): string {
  if (/\{\{\s*calendar\s*\}\}/.test(template)) return template;
  const nl = template.indexOf("\n");
  if (nl < 0) return `${template}\n\n{{calendar}}\n`;
  return `${template.slice(0, nl + 1)}\n{{calendar}}\n${template.slice(nl + 1)}`;
}
