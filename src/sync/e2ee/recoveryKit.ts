/**
 * The printable recovery kit (plan W11.S9): a one-page PDF with the 24
 * words, made on this device and handed to the browser as a download. It
 * is never written into the vault, never put in sync storage and never
 * sent anywhere: `downloadRecoveryKit` makes a blob URL, clicks it and
 * revokes it.
 *
 * The PDF is written by hand (PDF 1.4, one page, the standard Helvetica
 * font, no embedded font, no images, no metadata beyond what is drawn), so
 * the kit needs no PDF library in the app. The standard fonts have no
 * Hebrew glyphs, so the page is in English; the words are BIP-39's English
 * words in any case.
 */
import { RECOVERY_WORDS } from "./bip39";

export interface RecoveryKitInput {
  words: readonly string[];
  /** The vault's id, so a kit can be matched to its vault. */
  vaultId: string;
  /** When the key was made (ISO date, YYYY-MM-DD). */
  created: string;
}

/** Only printable ASCII reaches the page (the words and vault ids are ASCII). */
const ascii = (s: string) => s.replace(/[^\x20-\x7e]/g, "?");
const esc = (s: string) => ascii(s).replace(/[\\()]/g, (c) => `\\${c}`);

/** The page's drawing operators. */
function content({ words, vaultId, created }: RecoveryKitInput): string {
  const ops: string[] = [];
  const text = (x: number, y: number, size: number, s: string, bold = false) => ops.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${x} ${y} Td (${esc(s)}) Tj ET`);
  text(56, 780, 22, "Lumen recovery kit", true);
  text(56, 756, 10, `Vault ${vaultId}  -  made ${created}`);
  const lines = [
    "These 24 words open your encrypted vault if you forget its passphrase.",
    "Anyone who has them can read your notes. Keep this page somewhere safe and offline.",
    "Lumen cannot recover them for you: nobody but you has ever seen them.",
  ];
  lines.forEach((l, i) => text(56, 724 - i * 15, 11, l));
  // Three columns of eight, numbered 1-24 top to bottom.
  ops.push("0.6 w 56 660 m 539 660 l S");
  for (let i = 0; i < words.length; i++) {
    const col = Math.floor(i / 8);
    const row = i % 8;
    const x = 56 + col * 165;
    const y = 630 - row * 30;
    text(x, y, 10, `${i + 1}.`);
    text(x + 24, y, 15, words[i], true);
  }
  ops.push("0.6 w 56 400 m 539 400 l S");
  const how = [
    "To restore: open Lumen, choose Encrypted sync, then \"Restore with recovery words\",",
    "type the 24 words (the first four letters of each are enough), then choose a new passphrase.",
    "The words are the BIP-39 English list. Do not type them into any other website or app.",
  ];
  how.forEach((l, i) => text(56, 376 - i * 15, 10, l));
  return ops.join("\n");
}

/** The kit as PDF bytes. */
export function recoveryKitPdf(input: RecoveryKitInput): Uint8Array<ArrayBuffer> {
  if (input.words.length !== RECOVERY_WORDS) throw new Error(`A recovery kit has ${RECOVERY_WORDS} words`);
  const stream = content(input);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // Everything above is ASCII, so string length = byte length.
  return new TextEncoder().encode(pdf);
}

/**
 * Hand the kit to the browser as a download (the user prints it or keeps it
 * offline). Nothing is written to the vault or sent: a blob URL, a click,
 * then the URL is revoked.
 */
export function downloadRecoveryKit(input: RecoveryKitInput, doc: Document = document): void {
  const url = URL.createObjectURL(new Blob([recoveryKitPdf(input)], { type: "application/pdf" }));
  try {
    const a = doc.createElement("a");
    a.href = url;
    a.download = `lumen-recovery-kit-${input.created}.pdf`;
    a.rel = "noopener";
    doc.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
