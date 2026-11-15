/**
 * Money amounts and percentages in Hebrew and English text (plan R12.17).
 *
 *   findAmounts(text)  every amount, left to right, with its offsets
 *   parseAmount(value) the one money amount a whole property value is, or null
 *   amountSortKey(v)   the number a Bases column sorts an amount by
 *
 * Each amount has a unit (money or percent), a currency (ILS, USD, EUR, GBP;
 * null for a percent), and either one number or a range. A range keeps both
 * ends and is never collapsed into one number. The precision says how sure the
 * text is: exact, approx ("כ-", "בערך", "about"), lower_bound ("מעל", "לפחות",
 * "over"), upper_bound ("עד", "לא יותר מ", "up to") or range.
 *
 * A number with no currency and no percent sign is not an amount, and a number
 * word with no scale ("שלושה שקלים") is a phrase, not a figure. A vague
 * quantity ("מאות אלפי שקלים", "כמה מיליונים") is not an amount either.
 *
 * Written for lumen-md from the behaviour israelconnect documents for its
 * amounts_he.py; no code was copied. It is a hand-written scanner over tokens,
 * not a port. Deterministic: no network, no model, no clock.
 */

export type Currency = "ILS" | "USD" | "EUR" | "GBP";
export type AmountPrecision = "exact" | "approx" | "lower_bound" | "upper_bound" | "range";

export interface Amount {
  /** The matched text, and its offsets in the input. */
  text: string;
  start: number;
  end: number;
  unit: "money" | "percent";
  currency: Currency | null;
  /** The number; null for a range. */
  amount: number | null;
  min: number | null;
  max: number | null;
  precision: AmountPrecision;
  /** The scale word that multiplied the number (מיליון, אלף, M, K …), if any. */
  scale: string | null;
}

/* ─── Vocabulary ─────────────────────────────────────────────────────── */

const SCALE: Record<string, number> = {
  אלף: 1e3, אלפים: 1e3, אלפי: 1e3, thousand: 1e3, K: 1e3, k: 1e3,
  מיליון: 1e6, מליון: 1e6, מיליונים: 1e6, מיליוני: 1e6, "מ'": 1e6, "מ׳": 1e6, million: 1e6, M: 1e6, m: 1e6,
  מיליארד: 1e9, מליארד: 1e9, מיליארדים: 1e9, מיליארדי: 1e9, billion: 1e9, bn: 1e9, B: 1e9,
};
/** Plural scale words that never name one number ("אלפי שקלים" = some thousands). */
const VAGUE_SCALE = new Set(["אלפים", "אלפי", "מיליונים", "מיליוני", "מיליארדים", "מיליארדי"]);
const VAGUE_LEAD = new Set(["מאות", "עשרות", "כמה", "מספר", "hundreds", "tens", "several", "many"]);

function scaleKey(w: string): string | null {
  if (w in SCALE) return w;
  const l = w.toLowerCase();
  return l.length > 1 && l in SCALE ? l : null;
}

const NUMBER_WORD: Record<string, number> = {
  אחד: 1, אחת: 1, שני: 2, שתי: 2, שניים: 2, שתיים: 2, שלושה: 3, שלוש: 3, שלושת: 3, ארבעה: 4, ארבע: 4, ארבעת: 4,
  חמישה: 5, חמש: 5, חמשת: 5, שישה: 6, שש: 6, ששת: 6, שבעה: 7, שבע: 7, שבעת: 7, שמונה: 8, שמונת: 8,
  תשעה: 9, תשע: 9, תשעת: 9, עשרה: 10, עשר: 10, עשרת: 10, חצי: 0.5, רבע: 0.25,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, half: 0.5,
};

/** Currency words, as lower-cased token sequences joined by a space. */
const CURRENCY_WORD: Record<string, Currency> = {
  'ש"ח': "ILS", "ש״ח": "ILS", "ש''ח": "ILS", "ש'ח": "ILS", שח: "ILS", שקל: "ILS", שקלים: "ILS", "שקלים חדשים": "ILS",
  nis: "ILS", ils: "ILS", shekel: "ILS", shekels: "ILS",
  דולר: "USD", דולרים: "USD", usd: "USD", dollar: "USD", dollars: "USD",
  אירו: "EUR", יורו: "EUR", eur: "EUR", euro: "EUR", euros: "EUR",
  'ליש"ט': "GBP", "ליש״ט": "GBP", gbp: "GBP", pound: "GBP", pounds: "GBP",
};
const CURRENCY_SIGN: Record<string, Currency> = { "₪": "ILS", $: "USD", "€": "EUR", "£": "GBP" };
const PERCENT_WORD = new Set(["%", "אחוז", "אחוזים", "percent"]);

/** Qualifiers before the amount, as token sequences; the longest that ends right before it wins. */
const BEFORE: Array<[string[], AmountPrecision]> = [
  [["לא", "יותר", "מ"], "upper_bound"], [["לכל", "היותר"], "upper_bound"], [["פחות", "מ"], "upper_bound"],
  [["up", "to"], "upper_bound"], [["less", "than"], "upper_bound"], [["עד"], "upper_bound"], [["under"], "upper_bound"],
  [["למעלה", "מ"], "lower_bound"], [["יותר", "מ"], "lower_bound"], [["more", "than"], "lower_bound"], [["at", "least"], "lower_bound"],
  [["לפחות"], "lower_bound"], [["מעל"], "lower_bound"], [["over"], "lower_bound"],
  [["קרוב", "ל"], "approx"], [["בסביבות"], "approx"], [["בערך"], "approx"], [["כמעט"], "approx"], [["כ"], "approx"],
  [["about"], "approx"], [["around"], "approx"], [["approximately"], "approx"], [["nearly"], "approx"],
];
/** Qualifiers after the amount. */
const AFTER: Array<[string[], AmountPrecision]> = [
  [["לפחות"], "lower_bound"], [["ומעלה"], "lower_bound"], [["או", "יותר"], "lower_bound"], [["or", "more"], "lower_bound"],
  [["at", "least"], "lower_bound"], [["לכל", "היותר"], "upper_bound"], [["או", "פחות"], "upper_bound"],
  [["or", "less"], "upper_bound"], [["at", "most"], "upper_bound"],
];

/* ─── Tokens ─────────────────────────────────────────────────────────── */

type Tok = { k: "num" | "word" | "sign" | "dash"; s: string; start: number; end: number };

const TOKEN =
  /(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)|([א-ת]+(?:(?:["״׳']{1,2})[א-ת]+)*['׳]?|[A-Za-z]+)|([₪$€£%])|([-–—־])/g;
const PREFIX = "בלמשוהכ";

function lex(text: string): Tok[] {
  const out: Tok[] = [];
  for (const m of text.matchAll(TOKEN)) {
    const start = m.index ?? 0;
    const k = m[1] ? "num" : m[2] ? "word" : m[3] ? "sign" : "dash";
    out.push({ k, s: m[0], start, end: start + m[0].length });
  }
  return out;
}

/** Tokens are adjacent when only spaces lie between them (no comma, full stop or line break). */
function joined(text: string, a: Tok, b: Tok): boolean {
  return /^[ \t ]*$/.test(text.slice(a.end, b.start));
}

const low = (t: Tok | undefined) => (t ? t.s.toLowerCase() : "");

/** A one-letter Hebrew prefix glued to a word ("בשקלים", "מ-") comes off when the rest is known. */
function unprefixed(word: string, known: (w: string) => boolean): string | null {
  if (known(word)) return word;
  if (word.length > 1 && PREFIX.includes(word[0]) && known(word.slice(1))) return word.slice(1);
  return null;
}

/* ─── Scanner ────────────────────────────────────────────────────────── */

interface Qty {
  value: number;
  scale: string | null;
  digits: boolean;
  /** A number word without a scale (needs a percent to count). */
  bareWord: boolean;
  /** Index of the first and one past the last token. */
  from: number;
  to: number;
}

interface Unit {
  unit: "money" | "percent";
  currency: Currency | null;
  from: number;
  to: number;
}

class Scanner {
  readonly toks: Tok[];
  constructor(readonly text: string) {
    this.toks = lex(text);
  }

  private adj(i: number, j: number): boolean {
    const a = this.toks[i], b = this.toks[j];
    return !!a && !!b && joined(this.text, a, b);
  }

  /** A currency or percent at token i: a sign, a word (two-word "שקלים חדשים" first), a prefixed word. */
  unitAt(i: number): Unit | null {
    const t = this.toks[i];
    if (!t) return null;
    if (t.k === "sign") return t.s === "%" ? { unit: "percent", currency: null, from: i, to: i + 1 } : { unit: "money", currency: CURRENCY_SIGN[t.s], from: i, to: i + 1 };
    if (t.k !== "word") return null;
    const two = low(t) + " " + low(this.toks[i + 1]);
    if (CURRENCY_WORD[two] && this.adj(i, i + 1)) return { unit: "money", currency: CURRENCY_WORD[two], from: i, to: i + 2 };
    const w = unprefixed(low(t), (x) => x in CURRENCY_WORD || PERCENT_WORD.has(x));
    if (!w) return null;
    return PERCENT_WORD.has(w) ? { unit: "percent", currency: null, from: i, to: i + 1 } : { unit: "money", currency: CURRENCY_WORD[w], from: i, to: i + 1 };
  }

  /** A quantity at token i (after an optional "מ-"/"ב-" prefix token): digits or a number word, a scale, "וחצי". */
  qtyAt(i: number): Qty | null {
    let j = i;
    const t = this.toks[j];
    if (!t) return null;
    let value: number;
    let digits = false;
    let word = false;
    let scale: string | null = null;
    if (t.k === "num") {
      value = Number(t.s.replace(/,/g, ""));
      digits = true;
      j++;
    } else if (t.k === "word") {
      const nw = unprefixed(t.s, (x) => x in NUMBER_WORD);
      const sw = unprefixed(t.s, (x) => x in SCALE);
      if (nw !== null) {
        value = NUMBER_WORD[nw];
        word = true;
        j++;
      } else if (sw !== null) {
        if (VAGUE_SCALE.has(sw)) return null;
        if (VAGUE_LEAD.has(low(this.toks[i - 1]))) return null;
        value = 1;
        scale = sw;
        j++;
        return this.half({ value: SCALE[sw], scale, digits: false, bareWord: false, from: i, to: j });
      } else return null;
    } else return null;
    // A scale word right after the number ("2.5 מיליון", "300K", "1.2 מ'").
    const s = this.toks[j];
    const sk = s && s.k === "word" ? scaleKey(s.s) : null;
    if (s && sk && this.adj(j - 1, j)) {
      if (VAGUE_SCALE.has(sk) && !digits) return null;
      scale = sk;
      value *= SCALE[sk];
      j++;
    }
    return this.half({ value, scale, digits, bareWord: word && scale === null, from: i, to: j });
  }

  private half(q: Qty): Qty {
    const h = this.toks[q.to];
    if (q.scale && h && h.s === "וחצי" && this.adj(q.to - 1, q.to)) return { ...q, value: q.value + 0.5 * SCALE[q.scale], to: q.to + 1 };
    return q;
  }

  /** Index after a range separator at i ("–", "-", "עד", "ל-", "to", "and"), or -1. */
  sepAt(i: number, hyphenOk: boolean): number {
    const t = this.toks[i];
    if (!t) return -1;
    if (t.k === "dash") return hyphenOk ? i + 1 : -1;
    const w = low(t);
    if (w === "עד" || w === "to" || w === "and") {
      // "עד ל-3": the "ל" with its hyphen is part of the separator.
      if (w === "עד" && low(this.toks[i + 1]) === "ל" && this.toks[i + 2]?.k === "dash") return i + 3;
      return i + 1;
    }
    if (w === "ל" && this.toks[i + 1]?.k === "dash") return i + 2;
    return -1;
  }

  /** The "מ-" / "ב-" / "כ-" prefix written as its own token before a number: skip it. */
  skipPrefix(i: number): number {
    const t = this.toks[i];
    if (t && t.k === "word" && t.s.length === 1 && PREFIX.includes(t.s) && this.toks[i + 1]?.k === "dash") return i + 2;
    return i;
  }

  /** The qualifier ending right before token i. */
  qualifierBefore(i: number): AmountPrecision | null {
    let k = i;
    if (this.toks[k - 1]?.k === "dash") k--; // "כ-45", "מ-10"
    let best: [number, AmountPrecision] | null = null;
    for (const [seq, prec] of BEFORE) {
      const first = k - seq.length;
      if (first < 0) continue;
      let ok = true;
      for (let n = 0; n < seq.length && ok; n++) {
        const tok = this.toks[first + n];
        const w = low(tok);
        // The last word may carry the "ו" of a list ("ולפחות") or be glued to the number's prefix.
        ok = w === seq[n] || (n === 0 && w === "ו" + seq[n]);
        if (ok && n > 0) ok = this.adj(first + n - 1, first + n) || tok.start === this.toks[first + n - 1].end;
      }
      if (ok && (!best || seq.length > best[0])) best = [seq.length, prec];
    }
    // A glued "כ" ("כ45" is rare; "כ-45" is the dash case above).
    return best ? best[1] : null;
  }

  qualifierAfter(i: number): AmountPrecision | null {
    for (const [seq, prec] of AFTER) {
      let ok = true;
      for (let n = 0; n < seq.length && ok; n++) ok = low(this.toks[i + n]) === seq[n] && this.adj(i + n - 1, i + n);
      if (ok) return prec;
    }
    return null;
  }

  /** One amount starting at token i, or null. */
  at(i: number): { a: Amount; next: number } | null {
    const toks = this.toks;
    let open = i;
    let isRange = false;
    const lead = low(toks[i]);
    if (lead === "בין" || lead === "between" || lead === "from") { open = i + 1; isRange = true; }
    else if (lead === "מ" && toks[i + 1]?.k === "dash") { open = i + 2; isRange = true; }
    let pre = this.unitAt(open);
    let q0 = pre && this.adj(open, pre.to) ? pre.to : open;
    if (!pre || q0 === open) pre = null;
    q0 = this.skipPrefix(q0);
    const a = this.qtyAt(q0);
    if (!a) return null;
    let cur: Unit | null = pre;
    let j = a.to;
    let b: Qty | null = null;
    // A unit right after the first number, before any range ("12% ל-3.4 מיליון" stays two amounts).
    const midUnit = !cur && this.adj(j - 1, j) ? this.unitAt(j) : null;
    if (midUnit) { cur = midUnit; j = midUnit.to; }
    const sep = this.adj(j - 1, j) || toks[j]?.k === "dash" ? this.sepAt(j, a.digits) : -1;
    if (sep > 0) {
      let k = sep;
      const pre2 = this.unitAt(k);
      if (pre2 && (!cur || pre2.currency === cur.currency)) k = pre2.to;
      k = this.skipPrefix(k);
      const cand = this.qtyAt(k);
      const hyphen = toks[j].k === "dash";
      const unitAfterB = cand ? this.unitAt(cand.to) : null;
      const sameUnit = !midUnit || (unitAfterB && unitAfterB.unit === midUnit.unit && unitAfterB.currency === midUnit.currency) || (pre2 && pre2.currency === midUnit.currency);
      if (cand && (!hyphen || (a.digits && cand.digits)) && sameUnit) {
        b = cand;
        j = cand.to;
        if (pre2 && !cur) cur = pre2;
      }
    }
    if (!b && isRange) {
      // "מ-2 עד 3" without a second number is no range, but "מ-50 ש״ח" is one amount with a stray "מ".
      isRange = false;
    }
    const post = !midUnit && this.adj(j - 1, j) ? this.unitAt(j) : null;
    if (post && (!cur || post.unit === cur.unit)) { cur = post; j = post.to; }
    else if (midUnit && b) {
      const again = this.unitAt(j);
      if (again && again.currency === midUnit.currency && again.unit === midUnit.unit && this.adj(j - 1, j)) j = again.to;
    }
    if (!cur) return null;
    if (a.bareWord && cur.unit !== "percent") return null;
    if (b?.bareWord && cur.unit !== "percent") b = null;
    let va = a.value;
    let scale = a.scale;
    if (b) {
      // "2–3 מיליון": the second end's scale belongs to both.
      if (!a.scale && b.scale && a.digits) va = a.value * SCALE[b.scale];
      scale = b.scale ?? a.scale;
    }
    const startTok = b ? (isRange ? i : pre ? open : q0) : pre ? open : q0;
    const start = toks[startTok].start;
    const end = toks[j - 1].end;
    let precision: AmountPrecision = "exact";
    if (b) precision = "range";
    else precision = this.qualifierBefore(pre ? open : q0) ?? this.qualifierAfter(j) ?? "exact";
    const lo = b ? Math.min(va, b.value) : null;
    const hi = b ? Math.max(va, b.value) : null;
    return {
      a: {
        text: this.text.slice(start, end),
        start,
        end,
        unit: cur.unit,
        currency: cur.unit === "percent" ? null : cur.currency,
        amount: b ? null : round(va),
        min: lo === null ? null : round(lo),
        max: hi === null ? null : round(hi),
        precision,
        scale,
      },
      next: j,
    };
  }
}

const QUALIFIER_WORDS = new Set(
  [...BEFORE, ...AFTER].flatMap(([seq]) => seq).flatMap((w) => [w, "ו" + w]),
);

const round = (n: number) => Math.round(n * 1e6) / 1e6;

/** Every amount in `text`, left to right. */
export function findAmounts(text: string): Amount[] {
  const sc = new Scanner(text);
  const out: Amount[] = [];
  for (let i = 0; i < sc.toks.length; ) {
    const hit = sc.at(i);
    if (hit) {
      out.push(hit.a);
      i = hit.next;
    } else i++;
  }
  return out;
}

/** The one money amount a whole value is ("₪300 אלף", "כ-2.5 מיליון ש״ח"), or null. */
export function parseAmount(value: unknown): Amount | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (!s || s.length > 80) return null;
  const all = findAmounts(s);
  if (all.length !== 1 || all[0].unit !== "money") return null;
  // Nothing but the amount and its qualifier words around it.
  const rest = (s.slice(0, all[0].start) + " " + s.slice(all[0].end)).split(/[\s,.;:()\-־]+/).filter(Boolean);
  if (!rest.every((w) => QUALIFIER_WORDS.has(w.toLowerCase()))) return null;
  return all[0];
}

/** The number a Bases column sorts an amount value by (a range by its lower end), or null. */
export function amountSortKey(value: unknown): number | null {
  const a = parseAmount(value);
  if (!a) return null;
  return a.amount ?? a.min;
}
