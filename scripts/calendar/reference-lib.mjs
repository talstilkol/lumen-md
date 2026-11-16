/**
 * The Hebrew calendar against an outside table (plan W2.10, W10.E76).
 *
 * src/daily/hebrewCalendar.ts is our own arithmetic (no GPL library), and
 * its tests check it against ICU and against hand-checked rules. This adds a
 * third check: a public table of 2010–2030, converted into a fixture
 * (src/__tests__/fixtures/hebcal-reference/2010-2030.json), and a report of
 * every difference. The conversion is for Hebcal's JSON export
 * (https://www.hebcal.com/home/195/jewish-calendar-rest-api: the dates are
 * facts; the fixture keeps only dates and our ids, never Hebcal's text). It
 * is run on the Mac (network): scripts/calendar/reference-from-hebcal.mjs.
 *
 * Fixture: { source, retrieved, range: [from, to], israel: { holidays: [[date, id]], readings: [[date, [parasha ids]]] }, diaspora: { … } }
 */

/** Hebcal titles → our holiday ids (src/daily/hebrewCalendar.ts). A title not here is reported as unmapped, never guessed. */
export const TITLE_TO_ID = {
  "Erev Rosh Hashana": "erev-rosh-hashana",
  "Rosh Hashana I": "rosh-hashana-1",
  "Rosh Hashana II": "rosh-hashana-2",
  "Tzom Gedaliah": "tzom-gedaliah",
  "Erev Yom Kippur": "erev-yom-kippur",
  "Yom Kippur": "yom-kippur",
  "Erev Sukkot": "erev-sukkot",
  "Sukkot I": "sukkot-1",
  "Sukkot II": "sukkot-2",
  "Sukkot VII (Hoshana Raba)": "hoshana-raba",
  "Shmini Atzeret": "shemini-atzeret",
  "Simchat Torah": "simchat-torah",
  "Asara B'Tevet": "asara-btevet",
  "Tu BiShvat": "tu-bishvat",
  "Purim Katan": "purim-katan",
  "Ta'anit Esther": "taanit-esther",
  Purim: "purim",
  "Shushan Purim": "shushan-purim",
  "Ta'anit Bechorot": "taanit-bechorot",
  "Erev Pesach": "erev-pesach",
  "Pesach I": "pesach-1",
  "Pesach II": "pesach-2",
  "Pesach VII": "pesach-7",
  "Pesach VIII": "pesach-8",
  "Yom HaShoah": "yom-hashoah",
  "Yom HaZikaron": "yom-hazikaron",
  "Yom HaAtzma'ut": "yom-haatzmaut",
  "Pesach Sheni": "pesach-sheni",
  "Lag BaOmer": "lag-baomer",
  "Yom Yerushalayim": "yom-yerushalayim",
  "Erev Shavuot": "erev-shavuot",
  "Shavuot I": "shavuot-1",
  "Shavuot II": "shavuot-2",
  "Tzom Tammuz": "tzom-tammuz",
  "Erev Tish'a B'Av": "erev-tisha-bav",
  "Tish'a B'Av": "tisha-bav",
  "Tu B'Av": "tu-bav",
};

/** Hebcal's "Shmini Atzeret" in Israel is our "shemini-atzeret-simchat-torah" (one day). */
const ISRAEL_ONLY = { "Shmini Atzeret": "shemini-atzeret-simchat-torah" };

/** Parasha names in Hebcal's spelling → our PARASHOT ids, by a normalised key. */
const norm = (s) => s.toLowerCase().replace(/[^a-z]/g, "");
const PARASHA_ALIASES = {
  "lech-lecha": ["lechlecha"],
  "chayei-sara": ["chayeisara"],
  "achrei-mot": ["achreimot"],
  shmini: ["shmini", "shemini"],
  nasso: ["nasso", "naso"],
  behaalotcha: ["behaalotcha", "beha'alotcha"],
  "ki-tisa": ["kitisa", "kitissa"],
  "ki-teitzei": ["kiteitzei", "kiteitze"],
  "ki-tavo": ["kitavo", "kisavo"],
  vaetchanan: ["vaetchanan"],
  "vezot-haberakhah": ["vezothaberakhah", "vezothabracha"],
};

export function parashaIdOf(name, ids) {
  const k = norm(name);
  for (const id of ids) if (norm(id) === k || (PARASHA_ALIASES[id] ?? []).some((a) => norm(a) === k)) return id;
  return null;
}

/**
 * Hebcal's items (category "holiday" with subcat major/minor/fast/modern,
 * "roshchodesh", "parashat") → { holidays: [[date, id]], readings: [[date, ids]], unmapped }.
 * Chanukah, Chol HaMoed and Rosh Chodesh are numbered by day, as ours are.
 */
export function fromHebcal(items, { israel, parashaIds }) {
  const holidays = [];
  const readings = [];
  const unmapped = new Set();
  for (const it of items) {
    const date = String(it.date).slice(0, 10);
    const title = String(it.title ?? "");
    if (it.category === "parashat") {
      const names = title.replace(/^Parashat\s+/, "").split("-");
      // A double portion is "Vayakhel-Pekudei"; a single name with a hyphen (Lech-Lecha) is one.
      const single = parashaIdOf(title.replace(/^Parashat\s+/, ""), parashaIds);
      const ids = single ? [single] : names.map((n) => parashaIdOf(n, parashaIds));
      if (ids.some((x) => !x)) unmapped.add(title);
      else readings.push([date, ids]);
      continue;
    }
    if (it.category === "roshchodesh") {
      holidays.push([date, "rosh-chodesh"]);
      continue;
    }
    if (it.category !== "holiday") continue;
    // Hebcal dates the candle: candle n is lit on the evening that starts day n, so its date is day n − 1
    // (candle 1 is on the eve, not a day of Chanukah); "8th Day" is day 8.
    const ch = /^Chanukah: (\d) Candles?$/.exec(title);
    if (ch) {
      if (Number(ch[1]) >= 2) holidays.push([date, `chanukah-${Number(ch[1]) - 1}`]);
      continue;
    }
    if (/^Chanukah: 8th Day$/.test(title)) {
      holidays.push([date, "chanukah-8"]);
      continue;
    }
    const chm = /^(Pesach|Sukkot) (II|III|IV|V|VI) \(CH''M\)$/.exec(title);
    if (chm) {
      holidays.push([date, `${chm[1].toLowerCase()}-chm`]);
      continue;
    }
    const id = (israel && ISRAEL_ONLY[title]) || TITLE_TO_ID[title];
    if (id) holidays.push([date, id]);
    else unmapped.add(title);
  }
  return { holidays, readings, unmapped: [...unmapped].sort() };
}

/**
 * Ours against the reference → { missing, extra, readings: { mismatched, missing } }.
 * Ids that are numbered by day on one side (rosh-chodesh-N, chanukah-N,
 * …-chm-N) are compared by their family, so the numbering need not agree.
 */
export function compareCalendars(ours, ref) {
  const family = (id) => id.replace(/-\d+$/, "");
  const key = ([d, id]) => `${d} ${family(id)}`;
  const comparable = new Set(ref.holidays.map(([, id]) => family(id)));
  const o = new Set(ours.holidays.filter(([, id]) => comparable.has(family(id))).map(key));
  const r = new Set(ref.holidays.map(key));
  const missing = [...r].filter((k) => !o.has(k)).sort();
  const extra = [...o].filter((k) => !r.has(k)).sort();
  const ourReadings = new Map(ours.readings.map(([d, ids]) => [d, ids.join("+")]));
  const mismatched = [];
  const absent = [];
  for (const [d, ids] of ref.readings) {
    const mine = ourReadings.get(d);
    if (mine === undefined) absent.push(`${d} ${ids.join("+")}`);
    else if (mine !== ids.join("+")) mismatched.push(`${d} ours ${mine || "(a holiday)"}, reference ${ids.join("+")}`);
  }
  return { missing, extra, readings: { mismatched, missing: absent } };
}

/** The gap report as Markdown. */
export function gapReport(results) {
  const lines = ["# The Hebrew calendar against the reference table", ""];
  for (const [where, r] of Object.entries(results)) {
    const n = r.missing.length + r.extra.length + r.readings.mismatched.length + r.readings.missing.length;
    lines.push(`## ${where}: ${n ? `${n} difference(s)` : "no differences"}`, "");
    for (const k of r.missing) lines.push(`- missing here: ${k}`);
    for (const k of r.extra) lines.push(`- only here: ${k}`);
    for (const k of r.readings.mismatched) lines.push(`- reading: ${k}`);
    for (const k of r.readings.missing) lines.push(`- reading missing here: ${k}`);
    lines.push("");
  }
  return lines.join("\n");
}
