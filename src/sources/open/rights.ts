/**
 * What Lumen may keep from an open source (plans W7.5, W7.6, W7.7, W7.24).
 *
 * Every result from an open source carries one of these rights, and the
 * rights decide how it is stored in a note:
 *
 *   public-domain, cc0          → a full copy; credit is a courtesy.
 *   cc-by, cc-by-sa             → a full copy with the credit the licence asks for.
 *   section-6                   → a full copy: Copyright Act 2007 §6 — no
 *                                 copyright in laws, regulations, Knesset
 *                                 records (דברי הכנסת) and judicial decisions.
 *   cbs-licence                 → a full copy of the numbers with the CBS
 *                                 attribution (licence 2.1, commercial use allowed).
 *   gov-open                    → data.gov.il: a full copy with its credit
 *                                 (site, dataset, update date — the site's FAQ).
 *   link-only                   → only a link (and a title): anything else —
 *                                 non-commercial, no-derivatives, copyrighted,
 *                                 attachments to Knesset records (opinions,
 *                                 presentations) and unknown terms.
 *
 * Sefaria (W5.1) keeps its own per-version licence classes in
 * sources/sefaria/license.ts; `rightsOfSefariaLicense` maps them here.
 */

export type Rights = "public-domain" | "cc0" | "cc-by" | "cc-by-sa" | "section-6" | "cbs-licence" | "gov-open" | "link-only";

export const ALL_RIGHTS: readonly Rights[] = ["public-domain", "cc0", "cc-by", "cc-by-sa", "section-6", "cbs-licence", "gov-open", "link-only"];

/** May the content itself be copied into the vault? */
export function mayCopy(rights: Rights): boolean {
  return rights !== "link-only";
}

/** Where each right is explained (shown with the badge). */
export const RIGHTS_URL: Record<Rights, string | null> = {
  "public-domain": "https://en.wikipedia.org/wiki/Public_domain",
  cc0: "https://creativecommons.org/publicdomain/zero/1.0/",
  "cc-by": "https://creativecommons.org/licenses/by/4.0/",
  "cc-by-sa": "https://creativecommons.org/licenses/by-sa/4.0/",
  "section-6": "https://sherut.haifa.ac.il/extprojects/scill/images/pdf/Copyright_Law_2007_Hebrew.pdf",
  "cbs-licence": "https://www.cbs.gov.il/he/Pages/%D7%A8%D7%99%D7%A9%D7%99%D7%95%D7%9F-%D7%A9%D7%99%D7%9E%D7%95%D7%A9.aspx",
  "gov-open": "https://data.gov.il",
  "link-only": null,
};

/** Sefaria's per-version licence (W5.1) as a right. */
export function rightsOfSefariaLicense(license: string | null | undefined): Rights {
  const k = (license ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (k === "public domain" || k === "pd") return "public-domain";
  if (/^cc ?0/.test(k)) return "cc0";
  if (k === "cc-by" || k === "cc by") return "cc-by";
  if (k === "cc-by-sa" || k === "cc by-sa") return "cc-by-sa";
  return "link-only";
}

/** Text kept only when the rights allow it: link-only content is dropped here, before it can reach a note. */
export function keepIfAllowed<T>(rights: Rights, content: T): T | null {
  return mayCopy(rights) ? content : null;
}

/* ─── Licence lights for the Israeli registers (plan R12.19) ─────────── */

/**
 * A source's terms at a glance: green (open licence, commercial use
 * allowed, credit asked), amber (the site's own terms, or terms not yet
 * read: link and quote only), red (do not use).
 */
export type LicenceLight = "green" | "amber" | "red";

export type RegisterSource = "amutot" | "companies" | "reshumot";

export interface SourceTerms {
  source: RegisterSource;
  /** Who publishes it, in Hebrew and English. */
  he: string;
  en: string;
  light: LicenceLight;
  /** What a result may become in a note. */
  rights: Rights;
  /** False: the data never goes into anything Lumen ships or sells (a non-commercial source). */
  commercial: boolean;
  /** The page whose terms apply. */
  termsUrl: string;
  /** Where the data is read. */
  host: string;
  /**
   * The day these terms were last read from the terms page, or null when they
   * were not read by a person or a tool here (then the light is at most amber,
   * or is the licence of the hosting site as documented by this repo).
   */
  checked: string | null;
  /** One line on what the terms allow, shown with the light. */
  noteHe: string;
  noteEn: string;
}

/**
 * The three registers. data.gov.il's open-data terms (used for
 * `gov-open` above, W7.6) cover the non-profits and companies registers it
 * hosts. Reshumot (the official gazette, ילקוט הפרסומים) is on gov.il under
 * the site's terms of use: a link and a short quote, no copy, and kept out of
 * anything commercial until its terms are read.
 */
export const REGISTER_TERMS: Record<RegisterSource, SourceTerms> = {
  amutot: {
    source: "amutot",
    he: "רשם העמותות (רשות התאגידים) — data.gov.il",
    en: "Registrar of Non-profits (Israeli Corporations Authority) — data.gov.il",
    light: "green",
    rights: "gov-open",
    commercial: true,
    termsUrl: "https://data.gov.il/terms",
    host: "data.gov.il",
    checked: null,
    noteHe: "נתונים פתוחים של הממשלה: מותר להעתיק, גם לשימוש מסחרי, עם ציון המקור והתאריך.",
    noteEn: "Government open data: may be copied, commercial use included, with the source and date credited.",
  },
  companies: {
    source: "companies",
    he: "רשם החברות (רשות התאגידים) — data.gov.il",
    en: "Registrar of Companies (Israeli Corporations Authority) — data.gov.il",
    light: "green",
    rights: "gov-open",
    commercial: true,
    termsUrl: "https://data.gov.il/terms",
    host: "data.gov.il",
    checked: null,
    noteHe: "נתונים פתוחים של הממשלה: מותר להעתיק, גם לשימוש מסחרי, עם ציון המקור והתאריך.",
    noteEn: "Government open data: may be copied, commercial use included, with the source and date credited.",
  },
  reshumot: {
    source: "reshumot",
    he: "רשומות — ילקוט הפרסומים (gov.il)",
    en: "Reshumot — the official gazette, Yalkut HaPirsumim (gov.il)",
    light: "amber",
    rights: "link-only",
    commercial: false,
    termsUrl: "https://www.gov.il/he/pages/terms_of_use",
    host: "www.gov.il",
    checked: null,
    noteHe: "לפי תנאי השימוש של gov.il: קישור וציטוט קצר בלבד; לא נכנס לשום חבילה מסחרית.",
    noteEn: "Under gov.il's terms of use: a link and a short quote only; never in a commercial bundle.",
  },
};

/** May data from this source go into something commercial (a bundled dataset, a paid export)? Never for a non-commercial or red source. */
export function mayBundle(terms: SourceTerms): boolean {
  return terms.commercial && terms.light !== "red";
}
