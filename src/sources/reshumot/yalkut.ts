/**
 * Reshumot, the official gazette (plan R12.19): a reference to an issue of
 * Yalkut HaPirsumim (ילקוט הפרסומים) becomes a link to the issue's PDF on
 * gov.il. Nothing is fetched: gov.il has no published search API for it, and
 * its terms of use allow a link and a short quote (sources/open/rights,
 * REGISTER_TERMS.reshumot: amber, link-only, never in a commercial bundle).
 *
 *   parseYalkutRef("י״פ 11234")      → { issue: 11234, page: null }
 *   parseYalkutRef("ילקוט הפרסומים 11234, עמ' 5678") → { issue: 11234, page: 5678 }
 *   yalkutUrl(11234)                 → the issue's PDF on gov.il
 */
import { REGISTER_TERMS } from "../open/rights";

export interface YalkutRef {
  issue: number;
  page: number | null;
}

const REF = /^(?:ילקוט\s+(?:ה)?פרסומים|י["״']?פ|yalkut(?:\s+hapirsumim)?|yp)\s*(?:מס(?:פר|['׳])?\s*|no\.?\s*)?(\d{3,6})(?:\s*,?\s*(?:עמ(?:וד|['׳])?|p(?:age|\.)?)\s*(\d{1,6}))?$/i;

/** An issue (and page) of Yalkut HaPirsumim, or null. */
export function parseYalkutRef(q: string): YalkutRef | null {
  const m = REF.exec(q.trim().replace(/\s+/g, " "));
  if (!m) return null;
  return { issue: Number(m[1]), page: m[2] ? Number(m[2]) : null };
}

/** The issue's PDF on gov.il (the gazette's own address pattern). */
export function yalkutUrl(issue: number): string {
  return `https://www.gov.il/BlobFolder/dynamiccollectorresultitem/yalkut-${issue}/he/yalkut-${issue}.pdf`;
}

/** The link a note gets for a reference: issue, page, where it is, and the terms. */
export function yalkutCitation(ref: YalkutRef): string {
  const terms = REGISTER_TERMS.reshumot;
  const label = `ילקוט הפרסומים ${ref.issue}${ref.page ? `, עמ׳ ${ref.page}` : ""}`;
  return `[${label}](${yalkutUrl(ref.issue)}) — מקור: ${terms.he} · [תנאי השימוש](${terms.termsUrl})`;
}
