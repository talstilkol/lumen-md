/**
 * W12.F6: vCard import into person notes and export back as vCard 4.0.
 *
 * The 50 .vcf files are SYNTHETIC, generated here in the shapes the real
 * exporters write: Google Contacts (vCard 3.0, `item1.` groups, TYPE lists),
 * iOS Contacts (3.0, `CHARSET=utf-8`, folded lines, a base64 PHOTO, X-
 * fields) and old Android/Outlook (2.1, quoted-printable Hebrew). Every one
 * must survive vcf → note → vcf → contact with its fields intact.
 */
import { describe, expect, it } from "vitest";
import { parseVCards, toVCard, type Contact } from "../contacts/vcard";
import { contactOfNote, findPerson, isPersonNote, mergeIntoPerson, newPersonNote, PEOPLE_FOLDER } from "../contacts/personNotes";
import { prepareForExportSync } from "../lib/redaction";

const GIVEN = ["דנה", "יוסי", "מרים", "אבי", "נועה", "Sarah", "David", "רחל", "עומר", "ליאת"];
const FAMILY = ["כהן", "לוי", "מזרחי", "פרץ", "ביטון", "Cohen", "Levi", "אברהם", "פרידמן", "שפירא"];
const ORGS = ["האוניברסיטה העברית", "משרד החינוך", "Acme, Inc.", "קופת חולים כללית", "עיריית חיפה"];

/** Quoted-printable of UTF-8 text, as vCard 2.1 writes it. */
const qp = (s: string) => Array.from(new TextEncoder().encode(s)).map((b) => (b >= 33 && b <= 126 && b !== 61 ? String.fromCharCode(b) : `=${b.toString(16).toUpperCase().padStart(2, "0")}`)).join("");
/** Fold a line at 75 characters, as iOS does. */
const fold = (line: string) => line.match(/.{1,74}/g)!.join("\r\n ");

function synthetic(i: number): { vcf: string; want: Pick<Contact, "fn" | "org" | "bday" | "note"> & { tel: string[]; email: string[] } } {
  const g = GIVEN[i % 10];
  const f = FAMILY[(i * 3) % 10];
  const fn = `${g} ${f}`;
  const tel = [`+972 5${i % 10}-${String(1000000 + i * 7919).slice(-7)}`];
  const email = [`user${i}@example.org`];
  const org = ORGS[i % 5];
  const bday = i % 4 === 0 ? `19${70 + (i % 30)}-0${1 + (i % 9)}-1${i % 9}` : undefined;
  const note = i % 3 === 0 ? `נפגשנו בכנס ${i}; היא מתעניינת בהיסטוריה, ובספרות` : undefined;
  const kind = i % 3;
  const lines: string[] = ["BEGIN:VCARD"];
  if (kind === 0) {
    // Google Contacts export
    lines.push("VERSION:3.0", `FN:${fn}`, `N:${f};${g};;;`, `TEL;TYPE=CELL:${tel[0]}`, `item1.EMAIL;TYPE=INTERNET:${email[0]}`, "item1.X-ABLabel:Work", `ORG:${org.replace(/,/g, "\\,")}`);
    if (bday) lines.push(`BDAY:${bday}`);
    if (note) lines.push(`NOTE:${note.replace(/;/g, "\\;").replace(/,/g, "\\,")}`);
  } else if (kind === 1) {
    // iOS Contacts export
    lines.push("VERSION:3.0", "PRODID:-//Apple Inc.//iPhone OS 18.0//EN", `N;CHARSET=utf-8:${f};${g};;;`, `FN;CHARSET=utf-8:${fn}`, `ORG;CHARSET=utf-8:${org.replace(/,/g, "\\,")};`, `EMAIL;type=INTERNET;type=HOME;type=pref:${email[0]}`, `TEL;type=CELL;type=VOICE;type=pref:${tel[0]}`);
    lines.push(fold(`PHOTO;ENCODING=b;TYPE=JPEG:${"/9j/4AAQSkZJRgABAQAAAQABAAD".repeat(6)}`));
    if (bday) lines.push(`BDAY;value=date:${bday}`);
    if (note) lines.push(fold(`NOTE;CHARSET=utf-8:${note.replace(/;/g, "\\;").replace(/,/g, "\\,")}`));
    lines.push("X-SOCIALPROFILE;type=twitter:https://twitter.com/x");
  } else {
    // vCard 2.1 (old Android / Outlook), quoted-printable Hebrew
    lines.push("VERSION:2.1", `N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:${qp(f)};${qp(g)};;;`, `FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:${qp(fn)}`, `TEL;CELL:${tel[0]}`, `EMAIL;INTERNET:${email[0]}`, `ORG;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:${qp(org.replace(/,/g, "\\,"))}`);
    if (bday) lines.push(`BDAY:${bday.replace(/-/g, "")}`);
    if (note) lines.push(`NOTE;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:${qp(note.replace(/;/g, "\\;").replace(/,/g, "\\,"))}`);
  }
  lines.push("END:VCARD");
  return { vcf: lines.join("\r\n") + "\r\n", want: { fn, tel, email, org, bday, note } };
}

const corpus = Array.from({ length: 50 }, (_, i) => synthetic(i));

describe("reading vCard", () => {
  it("50 synthetic files (Google, iOS, 2.1 quoted-printable) give the right contact", () => {
    for (const [i, { vcf, want }] of corpus.entries()) {
      const [c] = parseVCards(vcf);
      expect(c, `#${i}`).toBeDefined();
      expect({ fn: c.fn, tel: c.tel.map((x) => x.value), email: c.email.map((x) => x.value), org: c.org, bday: c.bday, note: c.note }, `#${i}`).toEqual(want);
    }
  });

  it("many cards in one file, folding, groups, escapes and types", () => {
    const vcf = ["BEGIN:VCARD", "VERSION:4.0", "FN:דנה כהן", "TEL;TYPE=cell,work:+972-50-1234567", "ADR;TYPE=home:;;רחוב הרצל 1\\, דירה 2;תל אביב;;6100000;ישראל", "NOTE:שורה\\nשנייה", "END:VCARD", "BEGIN:VCARD", "VERSION:3.0", "N:Levi;Yossi;;Dr.;", "END:VCARD"].join("\r\n");
    const [a, b] = parseVCards(vcf);
    expect(a.tel).toEqual([{ value: "+972-50-1234567", types: ["cell", "work"] }]);
    expect(a.adr[0].value).toBe("רחוב הרצל 1, דירה 2, תל אביב, 6100000, ישראל");
    expect(a.note).toBe("שורה\nשנייה");
    expect(b.fn).toBe("Dr. Yossi Levi");
  });
});

describe("person notes", () => {
  it("a contact becomes a person note: type and entity-type person, fields in the frontmatter, NOTE in the body", () => {
    const [c] = parseVCards(corpus[0].vcf);
    const n = newPersonNote(c);
    expect(n.path).toBe(`${PEOPLE_FOLDER}/${c.fn}.md`);
    expect(isPersonNote(n.text)).toBe(true);
    expect(n.text).toMatch(/^---\n/);
    expect(n.text).toContain("type: person");
    expect(n.text).toContain("entity-type: person");
    expect(n.text).toContain(`# ${c.fn}`);
    expect(n.text).toContain(c.note!);
  });

  it("all 50 round-trip: vcf → note → vCard 4.0 → contact, fields intact", () => {
    for (const [i, { vcf, want }] of corpus.entries()) {
      const [c] = parseVCards(vcf);
      const n = newPersonNote(c);
      const out = toVCard([contactOfNote(n.path, n.text)]);
      expect(out.startsWith("BEGIN:VCARD\r\nVERSION:4.0\r\n"), `#${i}`).toBe(true);
      for (const line of out.split("\r\n")) expect(new TextEncoder().encode(line).length, `#${i} ${line}`).toBeLessThanOrEqual(75);
      const [back] = parseVCards(out);
      expect({ fn: back.fn, tel: back.tel.map((x) => x.value), email: back.email.map((x) => x.value), org: back.org, bday: back.bday, note: back.note }, `#${i}`).toEqual(want);
      expect(back.n?.given, `#${i}`).toBe(c.n?.given);
    }
  });

  it("an imported contact merges into the person the entity graph already has (by name or alias), the vault's values winning", () => {
    const entity = "---\nentity-type: person\naliases:\n  - ד. כהן\nrole: חוקרת\n---\n\n# דנה כהן\n\nמופיעה בשלושה מאמרים.\n";
    const notes = [{ path: "ישויות/אנשים/דנה כהן.md", text: entity }, { path: "אחר.md", text: "# דנה כהן\n" }];
    const [byName] = parseVCards("BEGIN:VCARD\r\nVERSION:3.0\r\nFN:דנה כהן\r\nTITLE:מנהלת\r\nTEL:+972-50-1111111\r\nNOTE:פגישה בכנס\r\nEND:VCARD\r\n");
    expect(findPerson(byName, notes)).toBe("ישויות/אנשים/דנה כהן.md");
    const [byAlias] = parseVCards("BEGIN:VCARD\r\nVERSION:3.0\r\nFN:ד. כהן\r\nEND:VCARD\r\n");
    expect(findPerson(byAlias, notes)).toBe("ישויות/אנשים/דנה כהן.md");
    const merged = mergeIntoPerson(entity, byName);
    expect(merged).toContain("entity-type: person");
    expect(merged).toContain("role: חוקרת"); // kept: the vault wins
    expect(merged).not.toContain("מנהלת");
    expect(merged).toContain("+972-50-1111111");
    expect(merged).toContain("מופיעה בשלושה מאמרים.\n");
    expect(merged.trimEnd().endsWith("פגישה בכנס")).toBe(true);
    expect(mergeIntoPerson(merged, byName)).toBe(merged); // a second import adds nothing
  });

  it("export goes through the export door: a <redact> passage never reaches the vCard", () => {
    const text = "---\ntype: person\nphones:\n  - +972-50-2222222\n---\n# יוסי\n\nפרטי: <redact>סוד רפואי</redact> וזהו.\n";
    const vcf = toVCard([contactOfNote("יוסי.md", prepareForExportSync(text))]);
    expect(vcf).not.toContain("סוד רפואי");
    expect(vcf).toContain("TEL:+972-50-2222222");
  });
});
