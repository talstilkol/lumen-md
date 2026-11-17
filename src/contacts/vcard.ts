/**
 * vCard (RFC 6350, and the 3.0 / 2.1 files phones still export) for people
 * in the vault, plan W12.F6. Pure: no network, no device APIs. A contact
 * becomes a "person" note, `type: person` (W12.T1) and `entity-type: person`
 * (the entity graph, W12.E1), so it is the same object either way. The notes
 * can be exported back as vCard 4.0.
 *
 * Read: line unfolding (§3.2), group prefixes (`item1.EMAIL`), parameters,
 * value escaping (`\,` `\;` `\n` `\\`), quoted-printable with a CHARSET
 * (2.1 and old 3.0 exports, which is how many Hebrew names arrive), and
 * FN, N, TEL, EMAIL, ORG, TITLE, BDAY, NOTE, ADR, URL, UID. Photos and other
 * binary values are skipped.
 */

export interface Contact {
  fn: string;
  n?: { family: string; given: string; additional: string; prefix: string; suffix: string };
  tel: { value: string; types: string[] }[];
  email: { value: string; types: string[] }[];
  org?: string;
  title?: string;
  /** ISO date (YYYY-MM-DD, or --MM-DD without a year). */
  bday?: string;
  note?: string;
  adr: { value: string; types: string[] }[];
  url: string[];
  uid?: string;
}

interface Prop {
  name: string;
  params: Record<string, string[]>;
  value: string;
}

/** Unfold (a line starting with a space or tab continues the previous one), and the 2.1 soft line breaks of quoted-printable. */
function unfold(text: string): string[] {
  const raw = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of raw) {
    const prev = out[out.length - 1];
    if (/^[ \t]/.test(line) && prev !== undefined) out[out.length - 1] = prev + line.slice(1);
    else if (prev !== undefined && /QUOTED-PRINTABLE/i.test(prev.split(":")[0]) && prev.endsWith("=")) out[out.length - 1] = prev.slice(0, -1) + line;
    else out.push(line);
  }
  return out.filter((l) => l.trim() !== "");
}

/** Split at `sep` outside double quotes. */
function splitOutside(s: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (const ch of s) {
    if (ch === '"') q = !q;
    if (ch === sep && !q) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function parseLine(line: string): Prop | null {
  // The value starts at the first ':' outside a quoted parameter value.
  let q = false;
  let at = -1;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') q = !q;
    else if (line[i] === ":" && !q) {
      at = i;
      break;
    }
  }
  if (at < 0) return null;
  const [nameWithGroup, ...paramParts] = splitOutside(line.slice(0, at), ";");
  const name = nameWithGroup.replace(/^[^.]*\./, "").toUpperCase();
  const params: Record<string, string[]> = {};
  for (const p of paramParts) {
    const eq = p.indexOf("=");
    // vCard 2.1: a bare parameter is a TYPE (`TEL;CELL;VOICE:`) or an encoding.
    const key = eq < 0 ? (/^(QUOTED-PRINTABLE|BASE64|8BIT|7BIT|B)$/i.test(p) ? "ENCODING" : "TYPE") : p.slice(0, eq).toUpperCase();
    const vals = (eq < 0 ? p : p.slice(eq + 1)).split(",").map((v) => v.replace(/^"|"$/g, ""));
    params[key] = [...(params[key] ?? []), ...vals];
  }
  return { name, params, value: line.slice(at + 1) };
}

function decodeQuotedPrintable(s: string, charset: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) {
      bytes.push(parseInt(s.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(...new TextEncoder().encode(s[i]));
  }
  try {
    return new TextDecoder(charset || "utf-8").decode(new Uint8Array(bytes));
  } catch {
    return new TextDecoder("utf-8").decode(new Uint8Array(bytes));
  }
}

const unescapeValue = (s: string) => s.replace(/\\([\\,;nN])/g, (_m, c: string) => (c === "n" || c === "N" ? "\n" : c));

/** Split a structured value at unescaped `;` and unescape each part. */
function components(v: string): string[] {
  const parts: string[] = [];
  let cur = "";
  for (let i = 0; i < v.length; i++) {
    if (v[i] === "\\" && i + 1 < v.length) {
      cur += v[i] + v[i + 1];
      i++;
    } else if (v[i] === ";") {
      parts.push(cur);
      cur = "";
    } else cur += v[i];
  }
  parts.push(cur);
  return parts.map(unescapeValue);
}

const typesOf = (p: Prop) =>
  (p.params.TYPE ?? [])
    .flatMap((t) => t.split(","))
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t && t !== "internet" && t !== "pref" && t !== "voice");

function isoBirthday(v: string): string | undefined {
  const s = v.trim();
  let m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^--(\d{2})-?(\d{2})$/.exec(s);
  if (m) return `--${m[1]}-${m[2]}`;
  return undefined;
}

/** Every contact in a .vcf file (one or many BEGIN:VCARD … END:VCARD). */
export function parseVCards(text: string): Contact[] {
  const out: Contact[] = [];
  let cur: Contact | null = null;
  for (const line of unfold(text)) {
    const p = parseLine(line);
    if (!p) continue;
    if (p.name === "BEGIN" && /^vcard$/i.test(p.value.trim())) {
      cur = { fn: "", tel: [], email: [], adr: [], url: [] };
      continue;
    }
    if (!cur) continue;
    if (p.name === "END") {
      if (!cur.fn && cur.n) cur.fn = [cur.n.prefix, cur.n.given, cur.n.additional, cur.n.family, cur.n.suffix].filter(Boolean).join(" ");
      if (!cur.fn) cur.fn = cur.org ?? cur.email[0]?.value ?? cur.tel[0]?.value ?? "";
      if (cur.fn) out.push(cur);
      cur = null;
      continue;
    }
    const enc = (p.params.ENCODING ?? [])[0]?.toUpperCase();
    if (enc === "B" || enc === "BASE64" || p.name === "PHOTO" || p.name === "LOGO" || p.name === "SOUND" || p.name === "KEY") continue;
    const raw = enc === "QUOTED-PRINTABLE" ? decodeQuotedPrintable(p.value, (p.params.CHARSET ?? [])[0] ?? "utf-8") : p.value;
    switch (p.name) {
      case "FN":
        cur.fn = unescapeValue(raw).trim();
        break;
      case "N": {
        const [family = "", given = "", additional = "", prefix = "", suffix = ""] = components(raw).map((x) => x.trim());
        cur.n = { family, given, additional, prefix, suffix };
        break;
      }
      case "TEL":
        cur.tel.push({ value: unescapeValue(raw).replace(/^tel:/i, "").trim(), types: typesOf(p) });
        break;
      case "EMAIL":
        cur.email.push({ value: unescapeValue(raw).trim(), types: typesOf(p) });
        break;
      case "ORG":
        cur.org = components(raw).map((x) => x.trim()).filter(Boolean).join(", ");
        break;
      case "TITLE":
        cur.title = unescapeValue(raw).trim();
        break;
      case "BDAY":
        cur.bday = isoBirthday(raw);
        break;
      case "NOTE":
        cur.note = unescapeValue(raw).trim();
        break;
      case "ADR":
        cur.adr.push({ value: components(raw).map((x) => x.trim()).filter(Boolean).join(", "), types: typesOf(p) });
        break;
      case "URL":
        cur.url.push(unescapeValue(raw).trim());
        break;
      case "UID":
        cur.uid = unescapeValue(raw).trim();
        break;
    }
  }
  return out;
}

/* ─── Notes ──────────────────────────────────────────────────────────── */

/** A file name for the person: the name, with characters no file system accepts removed. */
export const personFileName = (c: Pick<Contact, "fn">) => `${c.fn.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim() || "contact"}.md`;

const labelled = (xs: { value: string; types: string[] }[]) => xs.map((x) => (x.types.length ? `${x.value} (${x.types.join(", ")})` : x.value));
const unlabel = (s: string): { value: string; types: string[] } => {
  const m = /^(.*?)\s*\(([^()]*)\)$/.exec(s);
  return m ? { value: m[1], types: m[2].split(",").map((t) => t.trim()).filter(Boolean) } : { value: s, types: [] };
};

/** The note's properties for a contact (W12.T1 `type`, W12.E1 `entity-type`). Empty fields are left out. */
export function contactProperties(c: Contact): Record<string, unknown> {
  const p: Record<string, unknown> = { type: "person", "entity-type": "person" };
  if (c.n?.given) p.given = c.n.given;
  if (c.n?.family) p.family = c.n.family;
  if (c.tel.length) p.phones = labelled(c.tel);
  if (c.email.length) p.emails = labelled(c.email);
  if (c.org) p.organization = c.org;
  if (c.title) p.role = c.title;
  if (c.bday) p.birthday = c.bday;
  if (c.adr.length) p.addresses = labelled(c.adr);
  if (c.url.length) p.links = [...c.url];
  if (c.uid) p.vcard_uid = c.uid;
  return p;
}

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === "string" && v ? [v] : []);

/** A contact from a person note's name, properties and body (the body is the NOTE). */
export function contactFromNote(name: string, props: Record<string, unknown>, body: string): Contact {
  const given = typeof props.given === "string" ? props.given : "";
  const family = typeof props.family === "string" ? props.family : "";
  const note = body.replace(/^\s*#\s+.*\n?/, "").trim();
  return {
    fn: name,
    n: given || family ? { family, given, additional: "", prefix: "", suffix: "" } : undefined,
    tel: list(props.phones).map(unlabel),
    email: list(props.emails).map(unlabel),
    org: typeof props.organization === "string" ? props.organization : undefined,
    title: typeof props.role === "string" ? props.role : undefined,
    bday: typeof props.birthday === "string" ? props.birthday : props.birthday instanceof Date ? props.birthday.toISOString().slice(0, 10) : undefined,
    note: note || undefined,
    adr: list(props.addresses).map(unlabel),
    url: list(props.links),
    uid: typeof props.vcard_uid === "string" ? props.vcard_uid : undefined,
  };
}

/* ─── Writing vCard 4.0 ──────────────────────────────────────────────── */

const escapeValue = (s: string) => s.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\r?\n/g, "\\n");
const escapeComponent = escapeValue;

/** Fold at 75 octets (§3.2), never inside a UTF-8 character. */
function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let size = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (size + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = "";
      size = 0;
    }
    cur += ch;
    size += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

const typeParam = (types: string[]) => (types.length ? `;TYPE=${types.map((t) => (/[,;:]/.test(t) ? `"${t}"` : t)).join(",")}` : "");

/** Contacts as one vCard 4.0 file (CRLF line ends, as the RFC requires). */
export function toVCard(contacts: readonly Contact[]): string {
  const cards = contacts.map((c) => {
    const lines = ["BEGIN:VCARD", "VERSION:4.0", `FN:${escapeValue(c.fn)}`];
    const n = c.n ?? { family: "", given: "", additional: "", prefix: "", suffix: "" };
    lines.push(`N:${[n.family, n.given, n.additional, n.prefix, n.suffix].map(escapeComponent).join(";")}`);
    // Free text, which RFC 6350 allows for TEL, so the number keeps the spacing it was saved with.
    for (const t of c.tel) lines.push(`TEL${typeParam(t.types)}:${escapeValue(t.value)}`);
    for (const e of c.email) lines.push(`EMAIL${typeParam(e.types)}:${escapeValue(e.value)}`);
    if (c.org) lines.push(`ORG:${escapeComponent(c.org)}`);
    if (c.title) lines.push(`TITLE:${escapeValue(c.title)}`);
    if (c.bday) lines.push(`BDAY:${c.bday.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$1$2$3").replace(/^--(\d{2})-(\d{2})$/, "--$1$2")}`);
    for (const a of c.adr) lines.push(`ADR${typeParam(a.types)}:;;${escapeComponent(a.value)};;;;`);
    for (const u of c.url) lines.push(`URL:${u}`);
    if (c.note) lines.push(`NOTE:${escapeValue(c.note)}`);
    if (c.uid) lines.push(`UID:${escapeValue(c.uid)}`);
    lines.push("END:VCARD");
    return lines.map(fold).join("\r\n");
  });
  return cards.join("\r\n") + "\r\n";
}
