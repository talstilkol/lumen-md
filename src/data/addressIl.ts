/**
 * Israeli postal addresses (plan R12.17): split one into its fields and give
 * it a key that two spellings of the same address share.
 *
 *   parseAddress(text)  { street, streetType, number, apartment, entrance,
 *                         poBox, postcode, city, key } or null
 *   streetKey(name)     the street's consonant classes, the same for Hebrew
 *                       and Latin spellings ("הרצל" = "Herzl")
 *   addressSortKey(v)   what a Bases column sorts an address by
 *
 * What it reads: a PO box ("ת.ד. 1234", "ת"ד 1234", "P.O. Box 1234"), a
 * seven-digit postcode ("מיקוד 6688101" or bare), a city from the short list
 * below (Hebrew, English and the usual abbreviations: ת"א, י-ם, ב"ש, פ"ת),
 * a house number ("45", "12א", "45/3" = apartment 3, "דירה 3", "כניסה ב")
 * and a street with its type word kept apart (רחוב / רח', שדרות / שד', דרך,
 * סמטה / סמ', כיכר, St, Ave, Blvd, Rd).
 *
 * It does not geocode. There is no street-level table under a licence that
 * fits the bundle, so a coordinate is never guessed (the Bases map view keeps
 * using explicit lat/lng).
 *
 * Written for lumen-md from the behaviour israelconnect documents for its
 * address_il.py; no code or data was copied (the city list is a hand-written
 * list of common Israeli city names, not the Wikidata gazetteer).
 */

export interface IlAddress {
  street: string | null;
  streetType: string | null;
  number: string | null;
  apartment: string | null;
  entrance: string | null;
  poBox: string | null;
  postcode: string | null;
  city: string | null;
  /** city | street classes | number | apartment — equal for two spellings of one address. */
  key: string;
}

/* ─── Cities ─────────────────────────────────────────────────────────── */

/** Canonical Hebrew name → other spellings (lower-case for Latin). */
const CITIES: Record<string, string[]> = {
  "תל אביב-יפו": ["תל אביב", "תל-אביב", 'ת"א', "ת״א", "tel aviv", "tel-aviv", "tel aviv-yafo", "יפו"],
  ירושלים: ["י-ם", 'י"ם', "י״ם", "jerusalem"],
  חיפה: ["haifa"],
  "באר שבע": ['ב"ש', "ב״ש", "beer sheva", "be'er sheva", "beersheba"],
  "פתח תקווה": ["פתח תקוה", 'פ"ת', "פ״ת", "petah tikva", "petah tiqva"],
  "רמת גן": ['ר"ג', "ר״ג", "ramat gan"],
  "ראשון לציון": ['ראשל"צ', "ראשל״צ", "rishon lezion", "rishon le-zion"],
  חולון: ["holon"],
  "בת ים": ["bat yam"],
  "בני ברק": ['ב"ב', "ב״ב", "bnei brak"],
  נתניה: ["netanya"],
  אשדוד: ["ashdod"],
  אשקלון: ["ashkelon"],
  הרצליה: ["herzliya", "herzlia"],
  "כפר סבא": ['כ"ס', "כ״ס", "kfar saba"],
  רעננה: ["raanana", "ra'anana"],
  רחובות: ["rehovot"],
  "מודיעין-מכבים-רעות": ["מודיעין", "modiin", "modi'in"],
  חדרה: ["hadera"],
  נצרת: ["nazareth"],
  "בית שמש": ["beit shemesh"],
  אילת: ["eilat"],
  טבריה: ["tiberias"],
  צפת: ["safed", "tzfat"],
  עכו: ["acre", "akko"],
  "קריית שמונה": ["קרית שמונה", 'ק"ש', "ק״ש", "kiryat shmona"],
  "קריית גת": ["קרית גת", 'ק"ג', "ק״ג", "kiryat gat"],
  "קריית אונו": ["קרית אונו", "kiryat ono"],
  "גבעתיים": ["givatayim"],
  "הוד השרון": ["hod hasharon"],
  "רמת השרון": ["ramat hasharon"],
  "ראש העין": ["rosh haayin", "rosh ha'ayin"],
  לוד: ["lod"],
  רמלה: ["ramla"],
  עפולה: ["afula"],
  "נס ציונה": ["ness ziona", "nes ziona"],
  יבנה: ["yavne"],
  דימונה: ["dimona"],
  אופקים: ["ofakim"],
  שדרות: ["sderot"],
  "אור יהודה": ["or yehuda"],
};

const fold = (s: string) =>
  s
    .normalize("NFKC")
    .replace(/[֑-ׇ]/g, "") // niqqud and cantillation
    .replace(/[״”“]/g, '"')
    .replace(/[׳’‘`]/g, "'")
    .replace(/[־–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/** Every spelling, folded, longest first, to its canonical name. */
const CITY_SPELLINGS: Array<[string, string]> = Object.entries(CITIES)
  .flatMap(([canon, alts]) => [canon, ...alts].map((a) => [fold(a), canon] as [string, string]))
  .sort((a, b) => b[0].length - a[0].length);

/* ─── Street key ─────────────────────────────────────────────────────── */

/** Hebrew consonant → class; א ה ח ע ו י carry no class. */
const HE: Record<string, string> = {
  ב: "b", ג: "g", ד: "d", ז: "s", ט: "t", ת: "t", כ: "k", ך: "k", ק: "k", ל: "l", מ: "m", ם: "m",
  נ: "n", ן: "n", ס: "s", ש: "s", צ: "s", ץ: "s", פ: "p", ף: "p", ר: "r",
};
/** Latin letters → the same classes; vowels, h, w, y carry none. Digraphs first. */
const LATIN_DIGRAPH: Array<[RegExp, string]> = [[/sch|sh|tz|ts|zh/g, "s"], [/ch|kh|ck/g, "k"], [/ph/g, "p"], [/th/g, "t"]];
const LATIN: Record<string, string> = {
  b: "b", v: "b", w: "b", g: "g", d: "d", z: "s", s: "s", j: "s", c: "k", k: "k", q: "k", x: "k",
  t: "t", l: "l", m: "m", n: "n", p: "p", f: "p", r: "r",
};

/**
 * One consonant-class string per street name, the same in either script:
 * "הרצל" and "Herzl" → "rsl", "רוטשילד" and "Rothschild" → "rtsld". The article
 * (ה / ha-) and doubled letters are dropped.
 */
export function streetKey(name: string): string {
  const words = fold(name).replace(/['"]/g, "").split(/[\s-]+/).filter(Boolean);
  const out: string[] = [];
  for (let w of words) {
    let cls = "";
    if (/[א-ת]/.test(w)) {
      if (w.startsWith("ה") && w.length > 3) w = w.slice(1);
      for (const ch of w) cls += HE[ch] ?? "";
    } else {
      if (w.startsWith("ha") && w.length > 4) w = w.slice(2);
      for (const [re, to] of LATIN_DIGRAPH) w = w.replace(re, to.toUpperCase());
      for (const ch of w) cls += ch === ch.toUpperCase() && /[A-Z]/.test(ch) ? ch.toLowerCase() : LATIN[ch] ?? "";
    }
    cls = cls.replace(/(.)\1+/g, "$1");
    if (cls) out.push(cls);
  }
  return out.join(" ");
}

/* ─── Parsing ────────────────────────────────────────────────────────── */

const STREET_TYPES: Array<[RegExp, string]> = [
  [/^(?:שדרות|שד')$/, "שדרות"],
  [/^(?:רחוב|רח')$/, "רחוב"],
  [/^דרך$/, "דרך"],
  [/^(?:סמטת|סמטה|סמ')$/, "סמטה"],
  [/^(?:כיכר|ככר)$/, "כיכר"],
  [/^(?:st\.?|street)$/, "street"],
  [/^(?:ave\.?|avenue)$/, "avenue"],
  [/^(?:blvd\.?|boulevard)$/, "boulevard"],
  [/^(?:rd\.?|road)$/, "road"],
];

const PO_BOX = /(?:^|[\s,])(?:ת\.?\s?ד\.?|ת"ד|תיבת\s+דואר|p\.?\s?o\.?\s?b(?:ox)?\.?|p\.?o\.?\s+box)\s*(\d{1,6})(?=$|[\s,])/i;
const POSTCODE = /(?:^|[\s,])(?:מיקוד|zip|postal\s+code)?\s*(\d{7})(?=$|[\s,])/i;
const APARTMENT = /(?:^|[\s,])(?:דירה|apt\.?|apartment)\s*(\d{1,4})(?=$|[\s,])/i;
const ENTRANCE = /(?:^|[\s,])(?:כניסה|entrance)\s*([א-תa-z]|\d{1,2})'?(?=$|[\s,])/i;
/** "45", "12א", "12 א'", "45/3" (apartment), "מס' 12". */
const NUMBER = /(?:^|[\s,])(?:מס'\s*)?(\d{1,4})(?:\s?([א-ת])'?(?=$|[\s,/])|([a-z])(?=$|[\s,/]))?(?:\/(\d{1,4}))?(?=$|[\s,])/i;
const DROP = /(?:^|[\s,])(?:ישראל|israel)(?=$|[\s,])/gi;

/** The city nearest the end, with a ב / ל / ו prefix allowed; its span is cut from the text. */
function takeCity(text: string): { city: string | null; rest: string } {
  let best: { at: number; len: number; canon: string } | null = null;
  for (const [spell, canon] of CITY_SPELLINGS) {
    let from = 0;
    for (;;) {
      const at = text.indexOf(spell, from);
      if (at < 0) break;
      from = at + 1;
      const before = text.slice(0, at);
      const after = text[at + spell.length] ?? "";
      const lead = before.slice(-1);
      const boundaryBefore = !lead || /[\s,]/.test(lead) || (/[בלו]/.test(lead) && (before.length === 1 || /[\s,]/.test(before.slice(-2, -1))));
      if (!boundaryBefore || (after && !/[\s,]/.test(after))) continue;
      // A street named for a city ("שדרות ירושלים 5", "דרך חיפה 10"): after a
      // street type word, or before a house number, it is the street.
      const prevWord = before.replace(/[\s,]+$/, "").split(/[\s,]+/).pop() ?? "";
      const tail = text.slice(at + spell.length);
      if (STREET_TYPES.some(([re]) => re.test(prevWord)) || /^\s*\d/.test(tail)) continue;
      // Sderot is also the word for a boulevard: before a street name it is the type.
      if (canon === "שדרות" && /^\s*[א-ת]/.test(tail)) continue;
      const start = /[בלו]/.test(lead) ? at - 1 : at;
      if (!best || at > best.at || (at === best.at && spell.length > best.len)) best = { at: start, len: spell.length + (at - start), canon };
    }
  }
  if (!best) return { city: null, rest: text };
  return { city: best.canon, rest: text.slice(0, best.at) + " " + text.slice(best.at + best.len) };
}

const clean = (s: string) => s.replace(/[\s,]+/g, " ").trim();

/** An Israeli address's fields, or null when the text does not read as one. */
export function parseAddress(input: unknown): IlAddress | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw || raw.length > 160 || raw.includes("\n")) return null;
  let text = " " + fold(raw) + " ";
  const grab = (re: RegExp): string | null => {
    const m = re.exec(text);
    if (!m) return null;
    text = text.slice(0, m.index) + " " + text.slice(m.index + m[0].length);
    return m[1];
  };
  const poBox = grab(PO_BOX);
  const postcode = grab(POSTCODE);
  const apartmentWord = grab(APARTMENT);
  const entrance = grab(ENTRANCE);
  text = text.replace(DROP, " ");
  const { city, rest } = takeCity(text);
  text = rest;
  let number: string | null = null;
  let apartment = apartmentWord;
  const nm = NUMBER.exec(text);
  if (nm) {
    number = nm[1] + (nm[2] ?? nm[3] ?? "");
    if (nm[4]) apartment = apartment ?? nm[4];
    text = text.slice(0, nm.index) + " " + text.slice(nm.index + nm[0].length);
  }
  const words = clean(text.replace(/["]/g, "")).split(" ").filter(Boolean);
  let streetType: string | null = null;
  const streetWords: string[] = [];
  for (const w of words) {
    const t = STREET_TYPES.find(([re]) => re.test(w));
    if (t && !streetType) streetType = t[1];
    else streetWords.push(w);
  }
  const street = streetWords.length ? streetWords.join(" ") : null;
  // Strict, so that ordinary text is not read as an address: a PO box; a
  // postcode with a city; or a short street name with a house number and
  // either a street type word or a city set off by a comma ("הרצל 12, חיפה").
  const shortStreet = !!street && streetWords.length <= 4;
  const isAddress =
    !!poBox || (!!postcode && !!city) || (shortStreet && !!number && (!!streetType || (!!city && raw.includes(","))));
  if (!isAddress) return null;
  const key = [city ?? "", street ? streetKey(street) : poBox ? "pob" + poBox : "", number ?? "", apartment ?? ""].join("|");
  return { street, streetType, number, apartment, entrance, poBox, postcode, city, key };
}

/** True when two texts are the same address (same key). */
export function sameAddress(a: string, b: string): boolean {
  const x = parseAddress(a);
  const y = parseAddress(b);
  return !!x && !!y && x.key === y.key;
}

/** What a Bases column sorts an address by: city, street, then the house number as a number. */
export function addressSortKey(value: unknown): string | null {
  const a = parseAddress(value);
  if (!a) return null;
  const n = a.number ? a.number.replace(/^(\d+)/, (d) => d.padStart(5, "0")) : "";
  return [a.city ?? "", a.street ?? "", n, (a.apartment ?? "").padStart(5, "0")].join("\u0001");
}
