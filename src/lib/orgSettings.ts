/**
 * Organization settings — local-first store (MASTER_PLAN ε.1.3 / TASKS F4.4).
 *
 * There is no org backend yet (the SSO worker only issues sessions), so
 * the org name and allowed e-mail domains live in this browser's
 * localStorage. That is also the correct behaviour offline and for
 * self-hosted builds without any cloud: the admin panel shows and edits
 * local-only state and says so.
 */

export interface OrgSettings {
  name: string;
  /** Lower-cased e-mail domains members sign in with, e.g. `acme.com`. */
  domains: string[];
}

const STORAGE_KEY = "lumen.org.settings";
const EMPTY: OrgSettings = { name: "", domains: [] };
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Normalise user input (`@Acme.COM `, `https://acme.com/`) to `acme.com`, or null if invalid. */
export function normalizeDomain(input: string): string | null {
  let d = input.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "").replace(/^@/, "").replace(/\/.*$/, "");
  return DOMAIN_RE.test(d) ? d : null;
}

export function loadOrgSettings(): OrgSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY, domains: [] };
    const parsed = JSON.parse(raw) as Partial<OrgSettings>;
    const name = typeof parsed.name === "string" ? parsed.name.slice(0, 120) : "";
    const domains = Array.isArray(parsed.domains)
      ? [...new Set(parsed.domains.map((d) => (typeof d === "string" ? normalizeDomain(d) : null)).filter((d): d is string => !!d))]
      : [];
    return { name, domains };
  } catch {
    return { ...EMPTY, domains: [] };
  }
}

/** Persist settings. Returns false when storage is unavailable (private mode). */
export function saveOrgSettings(settings: OrgSettings): boolean {
  try {
    const clean: OrgSettings = {
      name: settings.name.trim().slice(0, 120),
      domains: [...new Set(settings.domains.map(normalizeDomain).filter((d): d is string => !!d))],
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
    return true;
  } catch {
    return false;
  }
}
