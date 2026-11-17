/**
 * Property values that are text in the frontmatter but have a meaning to sort
 * and show by (plan R12.17): a money amount ("₪300 אלף", "כ-2.5 מיליון ש״ח")
 * and an Israeli address ("שד' רוטשילד 45/3, ת"א").
 *
 *   valueKind(v)         "amount" | "address" | null
 *   inferValueType(v,k)  frontmatter's inferType, with amount and address on top
 *   typedSortKey(v)      a number (amount) or a key (address) to sort by, or null
 *   describeValue(v,…)   one short line for the properties panel ("2,500,000 ₪ · about")
 *
 * The value stays the text the user wrote; nothing here rewrites it. The
 * parsers live in src/data/amountsHe.ts and src/data/addressIl.ts, and are
 * imported only by the lazily loaded property panel and Bases views, not by
 * frontmatter.ts, so they stay out of the startup bundle.
 */
import { addressSortKey, parseAddress } from "../data/addressIl";
import { amountSortKey, parseAmount } from "../data/amountsHe";
import { inferType, type PropertyType } from "./frontmatter";

export type ValueKind = "amount" | "address";

/** A cheap test before the parsers: a currency sign or word, or a digit next to a letter. */
const MAYBE_AMOUNT = /[₪$€£]|ש["״'׳]{0,2}ח|שקל|דולר|אירו|יורו|ליש|\b(?:nis|ils|usd|eur|gbp|dollars?|euros?|shekels?)\b/i;
const MAYBE_ADDRESS = /\d/;

const CACHE_MAX = 5000;
const cache = new Map<string, { kind: ValueKind | null; sort: number | string | null }>();

function read(s: string): { kind: ValueKind | null; sort: number | string | null } {
  const hit = cache.get(s);
  if (hit) return hit;
  let out: { kind: ValueKind | null; sort: number | string | null } = { kind: null, sort: null };
  if (MAYBE_AMOUNT.test(s)) {
    const n = amountSortKey(s);
    if (n !== null) out = { kind: "amount", sort: n };
  }
  if (!out.kind && MAYBE_ADDRESS.test(s)) {
    const k = addressSortKey(s);
    if (k !== null) out = { kind: "address", sort: k };
  }
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(s, out);
  return out;
}

/** What a text value is, when it is an amount or an address. */
export function valueKind(v: unknown): ValueKind | null {
  return typeof v === "string" && v.trim() ? read(v.trim()).kind : null;
}

/** frontmatter's inferType, plus "amount" and "address" for text that reads as one. */
export function inferValueType(v: unknown, key = ""): PropertyType {
  const base = inferType(v, key);
  if (base !== "text") return base;
  return valueKind(v) ?? base;
}

/** The number (amount) or key (address) a column sorts by; null for other values. */
export function typedSortKey(v: unknown): number | string | null {
  return typeof v === "string" && v.trim() ? read(v.trim()).sort : null;
}

/**
 * Compare two values by their typed sort keys, when both have one of the same
 * kind (two amounts by number, two addresses by city, street, house number).
 * null when they are not both amounts or both addresses.
 */
export function compareTyped(a: unknown, b: unknown): number | null {
  const x = typedSortKey(a);
  const y = typedSortKey(b);
  if (x === null || y === null || typeof x !== typeof y) return null;
  if (typeof x === "number") return Math.sign(x - (y as number));
  return x < (y as string) ? -1 : x > (y as string) ? 1 : 0;
}

/** The words describeValue puts around the reading, from the caller's t(). */
export interface ValueWords {
  approx: string;
  lowerBound: string;
  upperBound: string;
  apartment: string;
  poBox: string;
}

/**
 * One line that shows how the value was read: "2,500,000 ₪ · about",
 * "תל אביב-יפו · רוטשילד 45 · apt 3". `locale` formats the number. null for
 * other values.
 */
export function describeValue(v: unknown, locale: string, words: ValueWords): string | null {
  const kind = valueKind(v);
  if (!kind || typeof v !== "string") return null;
  if (kind === "amount") {
    const a = parseAmount(v);
    if (!a || !a.currency) return null;
    let fmt: Intl.NumberFormat;
    try {
      fmt = new Intl.NumberFormat(locale, { style: "currency", currency: a.currency, maximumFractionDigits: 2 });
    } catch {
      fmt = new Intl.NumberFormat("en", { style: "currency", currency: a.currency, maximumFractionDigits: 2 });
    }
    const money = a.amount !== null ? fmt.format(a.amount) : `${fmt.format(a.min ?? 0)}–${fmt.format(a.max ?? 0)}`;
    const q = a.precision === "approx" ? words.approx : a.precision === "lower_bound" ? words.lowerBound : a.precision === "upper_bound" ? words.upperBound : "";
    return q ? `${money} · ${q}` : money;
  }
  const ad = parseAddress(v);
  if (!ad) return null;
  const parts: string[] = [];
  if (ad.city) parts.push(ad.city);
  if (ad.street) parts.push([ad.street, ad.number].filter(Boolean).join(" "));
  if (ad.apartment) parts.push(`${words.apartment} ${ad.apartment}`);
  if (ad.poBox) parts.push(`${words.poBox} ${ad.poBox}`);
  if (ad.postcode) parts.push(ad.postcode);
  return parts.join(" · ");
}
