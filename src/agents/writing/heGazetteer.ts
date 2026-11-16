/**
 * Hebrew names the fact guard knows without a model (plans W13.W4, W13.W5):
 * Hebrew has no capital letters, so a name that a rewrite drops or invents
 * cannot be seen by its shape. These are common Israeli given names,
 * surnames and places; the app's NER (W11.H11), when loaded, finds the rest
 * (facts.ts `entities`). A list, not a model: it misses rare names, and the
 * eval cards say how often.
 */
const GIVEN =
  "אבי אביב אביגיל אביטל אבישי אברהם אהרון אודי אודליה אופיר אור אורה אורי אוריה אורית אורן אושרת איילת איל איתן אילן אילנה אלה אלון אלי אליה אליהו אלינור אליעזר אלמוג אלעד אמיר אמנון אסף אסתר אפרת אריאל אריה אתי בן בני בנימין בתיה גאיה גדי גיא גיל גילה גלעד גלית דבורה דוד דודי דוד דורית דורון דין דנה דני דניאל דניאלה דפנה הדס הדר הילה הלל זהבה זיו חגית חגי חיים חנה חנן טל טליה טובה יאיר יגאל ידידיה יהודה יהונתן יואב יואל יובל יוחנן יונתן יוסי יוסף יעל יעקב יפית יצחק ירדן ישראל כרמל כרמית לאה לי ליאור ליאת לילך לימור לירון מאיה מאיר מוטי מורן מיכאל מיכל מירב מירי מרים משה נגה נדב נועה נוי נועם נחום ניר נירית נעמה נתן נתנאל סיון סתיו עדי עדן עומר עופר עידו עידן עמית ענבל ענת ערן עינת פנינה צבי ציפי צביה קרן רבקה רועי רון רונה רוני רונית רות רחל רינת רם רן רפאל שגיא שושנה שי שירה שירן שלום שלמה שמואל שמעון שני שקד שרה שרון תום תומר תמר תמי";
const SURNAMES = "כהן לוי מזרחי פרץ ביטון דהן אברהם פרידמן שפירא אזולאי מלכה חדד גבאי בן דוד אוחיון קליין וקנין גולן ברק שרעבי עמר יוסף אלון רוזנברג";
const PLACES =
  "ירושלים תל אביב חיפה באר שבע אילת נצרת עכו צפת טבריה אשדוד אשקלון נתניה הרצליה רמת גן גבעתיים פתח תקווה ראשון לציון רחובות חולון בת ים כפר סבא רעננה הוד השרון מודיעין בית שמש אום אל פחם רהט דימונה ערד קריית שמונה נהריה כרמיאל עפולה בית שאן יפו לוד רמלה קיסריה זכרון יעקב הגולן הנגב הגליל ישראל ירדן מצרים לבנון סוריה אירופה אמריקה ניו יורק לונדון פריז ברלין";

/** The names, longest first (a two-word place before its first word). */
export const HE_NAMES: readonly string[] = [
  ...new Set([...PLACES.split(/\s+(?=\S)/).join(" ").match(/תל אביב|באר שבע|רמת גן|פתח תקווה|ראשון לציון|בת ים|כפר סבא|הוד השרון|בית שמש|אום אל פחם|קריית שמונה|בית שאן|זכרון יעקב|ניו יורק|בן דוד|[^\s]+/g)!, ...GIVEN.split(/\s+/), ...SURNAMES.split(/\s+/)]),
].sort((a, b) => b.length - a.length);

const RE = new RegExp(`(?<![\\p{L}\\p{M}])[והבכלמש]{0,2}(${HE_NAMES.join("|")})(?![\\p{L}\\p{M}])`, "gu");

/** The gazetteer names a Hebrew text mentions (with a one-letter prefix peeled: "לדנה" → "דנה"). */
export function heNamesIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(RE)) out.push(m[1]);
  return out;
}
