/**
 * The licence a listed plugin or theme version may carry (review Z6-M2):
 * an SPDX licence expression (SPDX 2.3, annex D) over OSI-approved ids.
 *
 *   expression := and-expr ( "OR" and-expr )*
 *   and-expr   := with-expr ( "AND" with-expr )*
 *   with-expr  := licence-id [ "WITH" exception-id ]  |  "(" expression ")"
 *
 * Every licence id in the expression must be on OPEN_SOURCE_LICENSES, even
 * under OR (a choice of licences is open only if each choice is). An
 * exception is valid only right after `WITH`, only after a licence id from
 * that list (not after a parenthesis), and only from OPEN_SOURCE_EXCEPTIONS
 * (each grants extra permissions, so the licence stays open). Operators are
 * upper case; anything else (`+`, `LicenseRef-…`, a bare `…-exception`, a
 * dangling operator) fails.
 */

/** OSI-approved licences a listed version may use (SPDX ids), from #714. Never add one that is not OSI-approved. */
export const OPEN_SOURCE_LICENSES: ReadonlySet<string> = new Set(["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "MPL-2.0", "GPL-2.0-only", "GPL-2.0-or-later", "GPL-3.0-only", "GPL-3.0-or-later", "LGPL-2.1-only", "LGPL-2.1-or-later", "LGPL-3.0-only", "LGPL-3.0-or-later", "AGPL-3.0-only", "AGPL-3.0-or-later", "0BSD", "Unlicense", "Zlib", "EUPL-1.2"]);

/** SPDX licence exceptions (spdx.org/licenses/exceptions-index) that add permissions to a copyleft licence. */
export const OPEN_SOURCE_EXCEPTIONS: ReadonlySet<string> = new Set([
  "Autoconf-exception-2.0",
  "Autoconf-exception-3.0",
  "Bison-exception-2.2",
  "Bootloader-exception",
  "Classpath-exception-2.0",
  "eCos-exception-2.0",
  "Font-exception-2.0",
  "GCC-exception-2.0",
  "GCC-exception-3.1",
  "GPL-3.0-linking-exception",
  "LGPL-3.0-linking-exception",
  "Libtool-exception",
  "Linux-syscall-note",
  "LLVM-exception",
  "OCaml-LGPL-linking-exception",
  "openvpn-openssl-exception",
  "Qt-GPL-exception-1.0",
  "Qt-LGPL-exception-1.1",
  "Swift-exception",
  "u-boot-exception-2.0",
  "Universal-FOSS-exception-1.0",
  "WxWindows-exception-3.1",
]);

const OPERATORS = new Set(["AND", "OR", "WITH"]);

/** `MIT OR Apache-2.0`, `(MIT AND Zlib)`, `GPL-2.0-or-later WITH Classpath-exception-2.0`: every id must be open source. */
export function isOpenSourceLicense(spdx: unknown): boolean {
  if (typeof spdx !== "string") return false;
  const toks = spdx.match(/\(|\)|[^\s()]+/g) ?? [];
  if (!toks.length) return false;
  let i = 0;
  const peek = () => toks[i];
  // Each returns false on anything it cannot read; the whole expression must be read.
  const expression = (): boolean => {
    if (!andExpr()) return false;
    while (peek() === "OR") {
      i++;
      if (!andExpr()) return false;
    }
    return true;
  };
  const andExpr = (): boolean => {
    if (!withExpr()) return false;
    while (peek() === "AND") {
      i++;
      if (!withExpr()) return false;
    }
    return true;
  };
  const withExpr = (): boolean => {
    const t = peek();
    if (t === undefined || t === ")" || OPERATORS.has(t)) return false;
    i++;
    if (t === "(") {
      if (!expression() || peek() !== ")") return false;
      i++;
      // No WITH after a parenthesis: an exception belongs to one licence.
      return peek() !== "WITH";
    }
    if (!OPEN_SOURCE_LICENSES.has(t)) return false;
    if (peek() !== "WITH") return true;
    i++;
    const ex = peek();
    if (ex === undefined || !OPEN_SOURCE_EXCEPTIONS.has(ex)) return false;
    i++;
    return true;
  };
  return expression() && i === toks.length;
}
