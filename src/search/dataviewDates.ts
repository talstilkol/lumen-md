/**
 * Dates in Dataview queries (plan W2.12): dateformat()'s Luxon tokens and
 * the ISO week. UTC, like every date the queries read (dataview.ts scalar).
 */
const DAY = 86_400_000;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Luxon's format tokens that vaults use (yyyy-MM-dd, LLL d, EEEE, HH:mm …), in UTC like the dates here; text in '…' is literal. */
export function formatDate(ms: number, fmt: string): string {
  const d = new Date(ms);
  const two = (n: number) => String(n).padStart(2, "0");
  const tokens: Record<string, () => string> = {
    yyyy: () => String(d.getUTCFullYear()),
    yy: () => two(d.getUTCFullYear() % 100),
    MMMM: () => MONTHS[d.getUTCMonth()],
    LLLL: () => MONTHS[d.getUTCMonth()],
    MMM: () => MONTHS[d.getUTCMonth()].slice(0, 3),
    LLL: () => MONTHS[d.getUTCMonth()].slice(0, 3),
    MM: () => two(d.getUTCMonth() + 1),
    LL: () => two(d.getUTCMonth() + 1),
    M: () => String(d.getUTCMonth() + 1),
    L: () => String(d.getUTCMonth() + 1),
    dd: () => two(d.getUTCDate()),
    d: () => String(d.getUTCDate()),
    EEEE: () => DAYS[d.getUTCDay()],
    cccc: () => DAYS[d.getUTCDay()],
    EEE: () => DAYS[d.getUTCDay()].slice(0, 3),
    ccc: () => DAYS[d.getUTCDay()].slice(0, 3),
    HH: () => two(d.getUTCHours()),
    H: () => String(d.getUTCHours()),
    mm: () => two(d.getUTCMinutes()),
    ss: () => two(d.getUTCSeconds()),
    WW: () => two(isoWeek(d)),
    W: () => String(isoWeek(d)),
  };
  return fmt.replace(/'([^']*)'|yyyy|yy|MMMM|LLLL|MMM|LLL|MM|LL|M|L|dd|d|EEEE|cccc|EEE|ccc|HH|H|mm|ss|WW|W/g, (m, lit: string | undefined) => (lit !== undefined ? lit : tokens[m]()));
}

export function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  return Math.ceil(((t.getTime() - Date.UTC(t.getUTCFullYear(), 0, 1)) / DAY + 1) / 7);
}
