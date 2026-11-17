/**
 * The structural rules of GEDCOM 7.0 (FamilySearch, gedcom.io) that an
 * export from the entity graph touches: HEAD first with `GEDC.VERS 7.0`,
 * TRLR last; every line `level [xref] TAG [payload]` with levels rising by
 * at most one; xrefs `@[A-Z0-9_]+@`, unique; every pointer resolves to a
 * record of the right kind (FAMC/FAMS → FAM, HUSB/WIFE/CHIL → INDI); FAMC
 * and CHIL agree, FAMS and HUSB/WIFE agree; no CONC (removed in 7.0); a
 * payload starting with `@` that is not a pointer is escaped as `@@`.
 *
 * Not the official validator (the session has no network to the GEDCOM 7
 * tools); the check with an external tool is owed (W13.G7 evidence).
 */
export function gedcom7Problems(text: string): string[] {
  const p: string[] = [];
  const lines = text.replace(/\n$/, "").split("\n");
  type L = { level: number; xref?: string; tag: string; value: string };
  const parsed: L[] = [];
  lines.forEach((raw, i) => {
    const m = /^(0|[1-9]\d*) (?:(@[A-Z0-9_]+@) )?([A-Z0-9_]+)(?: (.*))?$/.exec(raw);
    if (!m) return void p.push(`line ${i + 1} is not a GEDCOM 7 line`);
    parsed.push({ level: Number(m[1]), xref: m[2], tag: m[3], value: m[4] ?? "" });
  });
  parsed.forEach((l, i) => {
    if (i && l.level > parsed[i - 1].level + 1) p.push(`line ${i + 1}: level jumps`);
    if (l.tag === "CONC") p.push("CONC is not GEDCOM 7");
    if (/^@[^@]/.test(l.value) && !/^@[A-Z0-9_]+@$/.test(l.value)) p.push(`line ${i + 1}: unescaped @`);
  });
  if (parsed[0]?.tag !== "HEAD" || parsed[0].level !== 0) p.push("HEAD is not first");
  if (parsed[parsed.length - 1]?.tag !== "TRLR") p.push("TRLR is not last");
  // HEAD.GEDC.VERS
  const gi = parsed.findIndex((l) => l.level === 1 && l.tag === "GEDC");
  if (gi < 0 || parsed[gi + 1]?.tag !== "VERS" || parsed[gi + 1].value !== "7.0") p.push("HEAD.GEDC.VERS is not 7.0");
  // Records.
  const kind = new Map<string, string>();
  const recs: Array<{ xref: string; tag: string; subs: L[] }> = [];
  for (const l of parsed) {
    if (l.level === 0) {
      if (l.xref) {
        if (kind.has(l.xref)) p.push(`duplicate xref ${l.xref}`);
        kind.set(l.xref, l.tag);
        recs.push({ xref: l.xref, tag: l.tag, subs: [] });
      } else recs.push({ xref: "", tag: l.tag, subs: [] });
    } else recs[recs.length - 1]?.subs.push(l);
  }
  const want: Record<string, string> = { FAMC: "FAM", FAMS: "FAM", HUSB: "INDI", WIFE: "INDI", CHIL: "INDI" };
  for (const r of recs)
    for (const s of r.subs)
      if (s.level === 1 && want[s.tag]) {
        if (kind.get(s.value) !== want[s.tag]) p.push(`${r.xref}: ${s.tag} ${s.value} points nowhere`);
      }
  const has = (x: string, tag: string, v: string) => recs.find((r) => r.xref === x)?.subs.some((s) => s.level === 1 && s.tag === tag && s.value === v);
  for (const r of recs.filter((x) => x.tag === "FAM"))
    for (const s of r.subs.filter((x) => x.level === 1)) {
      if (s.tag === "CHIL" && kind.get(s.value) === "INDI" && !has(s.value, "FAMC", r.xref)) p.push(`${s.value} lacks FAMC ${r.xref}`);
      if ((s.tag === "HUSB" || s.tag === "WIFE") && kind.get(s.value) === "INDI" && !has(s.value, "FAMS", r.xref)) p.push(`${s.value} lacks FAMS ${r.xref}`);
    }
  for (const r of recs.filter((x) => x.tag === "INDI"))
    for (const s of r.subs.filter((x) => x.level === 1)) {
      if (s.tag === "FAMC" && kind.get(s.value) === "FAM" && !has(s.value, "CHIL", r.xref)) p.push(`${s.value} lacks CHIL ${r.xref}`);
      if (s.tag === "FAMS" && kind.get(s.value) === "FAM" && !has(s.value, "HUSB", r.xref) && !has(s.value, "WIFE", r.xref)) p.push(`${s.value} lacks ${r.xref} as a partner`);
    }
  return p;
}
