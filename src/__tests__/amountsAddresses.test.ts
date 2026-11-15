/**
 * Plan R12.17: Hebrew money amounts and Israeli addresses as property values.
 *
 * The amount and address cases are the behaviours israelconnect's
 * tools/tests/test_amounts_he.py and test_address_il.py check, rewritten here
 * against the TypeScript modules (the strings are generic phrasing and
 * well-known street and city names, no data from that repo). Everything else is
 * synthetic.
 */
import { describe, expect, it } from "vitest";
import { findAmounts, parseAmount } from "../data/amountsHe";
import { parseAddress, sameAddress, streetKey } from "../data/addressIl";
import { compareTyped, describeValue, inferValueType, typedSortKey, valueKind } from "../properties/valueTypes";
import { applyQuery, parseSort, type DatabaseRow } from "../views/database";
import { columnType } from "../views/databaseEdit";
import { basesFileFromText, parseBase, runBase } from "../views/bases/base";
import { convertValue } from "../properties/frontmatter";

const one = (text: string) => {
  const all = findAmounts(text);
  expect(all, text).toHaveLength(1);
  return all[0];
};

describe("amounts (as amounts_he)", () => {
  it("a range is never collapsed into one number", () => {
    const r = one('בין 2 ל-3 מיליון ש"ח');
    expect([r.amount, r.min, r.max, r.precision, r.currency]).toEqual([null, 2_000_000, 3_000_000, "range", "ILS"]);
    const h = one("$5-10 million");
    expect([h.min, h.max, h.currency]).toEqual([5_000_000, 10_000_000, "USD"]);
  });

  it("qualifiers set the precision, before or after the amount", () => {
    expect(one('כ-45 אלף ש"ח')).toMatchObject({ amount: 45_000, precision: "approx" });
    expect(one('לא יותר מ-10 אלף ש"ח')).toMatchObject({ amount: 10_000, precision: "upper_bound" });
    expect(one("מעל 200 אלף ₪")).toMatchObject({ amount: 200_000, precision: "lower_bound" });
    expect(one('50 ש"ח לפחות')).toMatchObject({ amount: 50, precision: "lower_bound" });
    expect(one("about $1,200")).toMatchObject({ amount: 1200, precision: "approx", currency: "USD" });
  });

  it("number words need a scale; vague quantities are not amounts", () => {
    expect(one("מיליון וחצי דולר")).toMatchObject({ amount: 1_500_000, currency: "USD", precision: "exact" });
    expect(findAmounts("מאות אלפי שקלים")).toEqual([]);
    expect(findAmounts("שלושה שקלים")).toEqual([]);
  });

  it("scales, signs and currency words on either side", () => {
    expect(one("2.5 מיליון ש״ח")).toMatchObject({ amount: 2_500_000, currency: "ILS", scale: "מיליון" });
    expect(one("₪300 אלף")).toMatchObject({ amount: 300_000, currency: "ILS" });
    expect(one("€40K")).toMatchObject({ amount: 40_000, currency: "EUR" });
  });

  it("a percent and a money figure side by side stay two amounts", () => {
    const [p, m] = findAmounts("ירדה ב-12% ל-3.4 מיליון ש״ח");
    expect(p).toMatchObject({ unit: "percent", amount: 12, currency: null });
    expect(m).toMatchObject({ unit: "money", amount: 3_400_000, currency: "ILS" });
  });

  it("an amount without a currency is not an amount", () => {
    expect(findAmounts("300")).toEqual([]);
    expect(findAmounts("2.5 מיליון")).toEqual([]);
    expect(parseAmount("300")).toBeNull();
    expect(parseAmount("25%")).toBeNull(); // a percent is not a money value
  });

  it("parseAmount takes a whole value, not an amount inside a sentence", () => {
    expect(parseAmount('בערך 5 ש"ח')?.precision).toBe("approx");
    expect(parseAmount('קנינו 3 תפוחים ב-20 ש"ח')).toBeNull();
    expect(findAmounts('קנינו 3 תפוחים ב-20 ש"ח')).toHaveLength(1);
  });

  it("offsets point at the matched text", () => {
    const text = 'השכר: 12,500 ש"ח לחודש';
    const [a] = findAmounts(text);
    expect(text.slice(a.start, a.end)).toBe(a.text);
    expect(a.amount).toBe(12_500);
  });
});

describe("addresses (as address_il)", () => {
  it("a street's key is the same in Hebrew and Latin letters", () => {
    expect(streetKey("רוטשילד")).toBe(streetKey("Rothschild"));
    expect(streetKey("הרצל")).toBe(streetKey("Herzl"));
    expect(streetKey("ז'בוטינסקי")).toBe(streetKey("Jabotinsky"));
    expect(streetKey("הרצל")).not.toBe(streetKey("רוטשילד"));
  });

  it("splits an address into its fields", () => {
    const n = parseAddress("שד' רוטשילד 45/3, ת\"א 6688101");
    expect(n && [n.street, n.streetType, n.number, n.apartment, n.postcode, n.city]).toEqual(["רוטשילד", "שדרות", "45", "3", "6688101", "תל אביב-יפו"]);
  });

  it("two spellings of one address share a key", () => {
    expect(sameAddress("שד' רוטשילד 45/3, ת\"א", "Rothschild Blvd 45/3, Tel Aviv")).toBe(true);
    expect(sameAddress("רחוב הרצל 12, רמת גן", "הרצל 12, ר\"ג")).toBe(true);
    expect(sameAddress("רחוב הרצל 12, רמת גן", "רחוב הרצל 14, רמת גן")).toBe(false);
  });

  it("PO boxes, and streets named for a city", () => {
    expect(parseAddress("ת.ד. 1234 ירושלים")).toMatchObject({ poBox: "1234", city: "ירושלים" });
    expect(parseAddress("P.O. Box 77, Haifa")).toMatchObject({ poBox: "77", city: "חיפה" });
    expect(parseAddress("שדרות ירושלים 5")).toMatchObject({ street: "ירושלים", streetType: "שדרות", number: "5", city: null });
    expect(parseAddress("רחוב יפו 97 ירושלים")).toMatchObject({ street: "יפו", number: "97", city: "ירושלים" });
  });

  it("ordinary text is not read as an address", () => {
    expect(parseAddress("פגישה ב-12")).toBeNull();
    expect(parseAddress("hello 12")).toBeNull();
    expect(parseAddress("פרק 3 בתל אביב")).toBeNull(); // no comma, no street type
    expect(parseAddress("ירושלים")).toBeNull();
  });
});

describe("property types and sorting (R12.17)", () => {
  it("text that reads as an amount or an address gets that type", () => {
    expect(inferValueType("₪300 אלף", "price")).toBe("amount");
    expect(inferValueType("רחוב הרצל 12, רמת גן", "where")).toBe("address");
    expect(inferValueType("hello", "x")).toBe("text");
    expect(inferValueType(300, "price")).toBe("number");
    expect(columnType(["", '2.5 מיליון ש"ח'], "price")).toBe("amount");
    expect(valueKind("300")).toBeNull();
    // The value stays the text the user wrote.
    expect(convertValue("₪300 אלף", "amount")).toBe("₪300 אלף");
  });

  it("amounts compare by number, addresses by city, street and house number", () => {
    expect(compareTyped("₪300 אלף", "₪5,000")).toBe(1);
    expect(compareTyped('כ-2 מיליון ש"ח', "₪300 אלף")).toBe(1);
    expect(compareTyped("רחוב הרצל 9, חיפה", "רחוב הרצל 12, חיפה")).toBe(-1); // 9 before 12, not as text
    expect(compareTyped("₪5", "רחוב הרצל 9, חיפה")).toBeNull();
    expect(typedSortKey('בין 2 ל-3 מיליון ש"ח')).toBe(2_000_000);
  });

  it("the database block sorts an amount column by value", () => {
    const rows: DatabaseRow[] = [
      { path: "a.md", basename: "a", fm: { price: "₪300 אלף" } },
      { path: "b.md", basename: "b", fm: { price: "₪5,000" } },
      { path: "c.md", basename: "c", fm: { price: '2.5 מיליון ש"ח' } },
      { path: "d.md", basename: "d", fm: {} },
    ];
    expect(applyQuery(rows, { sort: parseSort("price") }).map((r) => r.basename)).toEqual(["b", "a", "c", "d"]);
    expect(applyQuery(rows, { sort: parseSort("-price") }).map((r) => r.basename)).toEqual(["c", "a", "b", "d"]);
  });

  it("a Bases view sorts amounts and addresses by value", () => {
    const note = (path: string, fm: string) => basesFileFromText(path, `---\n${fm}\n---\nbody\n`);
    // Text order (even with numeric collation) would give c, b, a for price and a, b, c for where.
    const files = [
      note("a.md", 'price: "₪300 אלף"\nwhere: "רחוב אלנבי 5, חיפה"'),
      note("b.md", 'price: "₪5,000"\nwhere: "רחוב הרצל 3, אילת"'),
      note("c.md", 'price: "₪2 מיליון"\nwhere: "רחוב בלפור 1, תל אביב"'),
    ];
    const byPrice = parseBase("views:\n  - type: table\n    name: t\n    order: [note.price]\n    sort:\n      - property: note.price\n        direction: ASC\n");
    expect(byPrice.ok).toBe(true);
    if (!byPrice.ok) return;
    expect(runBase(byPrice.base, files).rows.map((r) => r.file.path)).toEqual(["b.md", "a.md", "c.md"]);
    const byWhere = parseBase("views:\n  - type: table\n    name: t\n    sort:\n      - property: note.where\n        direction: ASC\n");
    if (!byWhere.ok) throw new Error("parse");
    // By city: אילת, חיפה, תל אביב-יפו.
    expect(runBase(byWhere.base, files).rows.map((r) => r.file.path)).toEqual(["b.md", "a.md", "c.md"]);
  });

  it("describes how a value was read, with the caller's words", () => {
    const words = { approx: "about", lowerBound: "at least", upperBound: "at most", apartment: "apt", poBox: "PO Box" };
    expect(describeValue('כ-2.5 מיליון ש"ח', "en", words)).toMatch(/2,500,000.*about/);
    expect(describeValue("שד' רוטשילד 45/3, ת\"א", "he", words)).toBe("תל אביב-יפו · רוטשילד 45 · apt 3");
    expect(describeValue("hello", "en", words)).toBeNull();
  });
});
