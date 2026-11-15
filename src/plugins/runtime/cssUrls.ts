/**
 * What a stylesheet loads, read the way a browser reads it (review Z6-M1).
 *
 * A small tokenizer after CSS Syntax Level 3 (§4, "Tokenization"): comments,
 * strings (with their escapes and line continuations), escapes in names
 * (`u\72l(`, `@\69mport`), `url(` with an unquoted body, function names, and
 * at-keywords. A regular expression over the text cannot do this: a quoted
 * `url("…)…")` or `url("…'…")` holds the very characters a pattern stops at,
 * and an escape can spell any character.
 *
 * Every string a URL-taking function holds (`url()`, `src()`, `image()`,
 * `image-set()`, `-webkit-image-set()`, nested too, at any depth below one, such as a
 * `var()` fallback) and every unquoted `url(…)` body is a load target. A `var()`, `env()` or `attr()` anywhere
 * inside such a function is refused, because its value comes from elsewhere (review Z7-M1); `remoteTarget` then resolves it as the URL
 * parser does (it strips tab and newline anywhere, and leading/trailing C0
 * controls and spaces), against a base of the plugin's own origin.
 */

/**
 * A load target found in a stylesheet, decoded (escapes applied). `substitution` is a `var()`, `env()` or `attr()`
 * inside a URL-taking function (review Z7-M1): its value is only known after substitution, so the review cannot see
 * where it loads from and refuses it.
 */
export interface CssLoad {
  kind: "import" | "url" | "substitution";
  /** The decoded target; for an `@import`, its text up to the `;`; for a substitution, `var() in image-set()`. */
  target: string;
}

/** The functions whose strings are URLs (CSS Values 4 `url()`/`src()`, CSS Images 4 `image()`/`image-set()`). */
const URL_FUNCTIONS: ReadonlySet<string> = new Set(["url", "src", "image", "image-set", "-webkit-image-set"]);
/**
 * Functions whose value is substituted before the URL function reads it (CSS Variables 1 `var()`, CSS Environment
 * Variables `env()`, CSS Values 5 `attr()`). `image-set(var(--x) 1x)` with `--x:"https://…"` loads that string,
 * though no string sits inside the URL function (review Z7-M1).
 */
const SUBSTITUTION_FUNCTIONS: ReadonlySet<string> = new Set(["var", "env", "attr"]);

const isHex = (c: string) => /^[0-9a-fA-F]$/.test(c);
const isNewline = (c: string) => c === "\n" || c === "\r" || c === "\f";
const isWhitespace = (c: string) => c === " " || c === "\t" || isNewline(c);
const isNameChar = (c: string) => /^[A-Za-z0-9_-]$/.test(c) || (c !== "" && c.charCodeAt(0) >= 0x80);
/** CSS Syntax §4.3.8: a backslash starts an escape unless a newline follows it (or nothing). */
const validEscape = (a: string, b: string) => a === "\\" && b !== "" && !isNewline(b);

/**
 * The tokens this review needs, in order: at-keywords, function names, strings, unquoted url bodies, and the
 * parentheses that close a function. Everything else is skipped one code point at a time.
 */
type Tok = { t: "at"; name: string; start: number } | { t: "fn"; name: string } | { t: "str"; value: string } | { t: "url"; value: string; bad: boolean } | { t: "open" } | { t: "close" } | { t: "semi"; at: number };

export function tokenizeCss(css: string): Tok[] {
  // §3.3 preprocessing: CRLF, CR and FF are newlines; NUL and surrogates are U+FFFD.
  const s = css.replace(/\r\n?|\f/g, "\n").replace(/\0/g, "�");
  const out: Tok[] = [];
  let i = 0;
  const at = (k = 0) => s[i + k] ?? "";
  /** §4.3.7: consume an escape after its backslash; returns the code point's text. */
  const escape = (): string => {
    const c = at();
    if (c === "") return "�";
    if (isHex(c)) {
      let hex = "";
      while (hex.length < 6 && isHex(at())) hex += s[i++];
      if (isWhitespace(at())) i++;
      const cp = parseInt(hex, 16);
      return cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) ? "�" : String.fromCodePoint(cp);
    }
    i += c.length;
    return c;
  };
  const name = (): string => {
    let v = "";
    for (;;) {
      if (isNameChar(at())) v += s[i++];
      else if (validEscape(at(), at(1))) {
        i++;
        v += escape();
      } else return v;
    }
  };
  const string = (quote: string): string | null => {
    let v = "";
    for (;;) {
      const c = at();
      if (c === "" || c === quote) {
        i++;
        return v;
      }
      if (isNewline(c)) return null; // a bad string: the browser drops the declaration
      i++;
      if (c !== "\\") v += c;
      else if (at() === "") return v;
      else if (isNewline(at())) i++; // a line continuation
      else v += escape();
    }
  };
  /** §4.3.6: an unquoted url body, after `url(` and its whitespace. */
  const urlBody = (): { value: string; bad: boolean } => {
    let v = "";
    for (;;) {
      const c = at();
      if (c === ")" || c === "") {
        i++;
        return { value: v, bad: false };
      }
      if (isWhitespace(c)) {
        while (isWhitespace(at())) i++;
        if (at() === ")" || at() === "") {
          i++;
          return { value: v, bad: false };
        }
        break;
      }
      if (c === '"' || c === "'" || c === "(" || /[\0-\x08\x0b\x0e-\x1f\x7f]/.test(c)) break;
      if (c === "\\") {
        if (!validEscape(c, at(1))) break;
        i++;
        v += escape();
        continue;
      }
      v += c;
      i++;
    }
    // A bad url: consume its remnants (§4.3.14); the browser loads nothing, the review still sees what was there.
    while (at() !== "" && at() !== ")") {
      if (validEscape(at(), at(1))) {
        i++;
        escape();
      } else i++;
    }
    i++;
    return { value: v, bad: true };
  };
  while (i < s.length) {
    const c = at();
    if (c === "/" && at(1) === "*") {
      const end = s.indexOf("*/", i + 2);
      i = end < 0 ? s.length : end + 2;
    } else if (c === '"' || c === "'") {
      i++;
      const v = string(c);
      if (v !== null) out.push({ t: "str", value: v });
    } else if (c === "@" && (isNameChar(at(1)) || validEscape(at(1), at(2)))) {
      const start = i;
      i++;
      out.push({ t: "at", name: name().toLowerCase(), start });
    } else if (c === "#" && (isNameChar(at(1)) || validEscape(at(1), at(2)))) {
      i++;
      name(); // a hash token: `#url(` is not a function
    } else if (isNameChar(c) || validEscape(c, at(1))) {
      const startsNumber = /[0-9]/.test(c) || ((c === "-" || c === "+" || c === ".") && /[0-9]/.test(at(1)));
      const n = name().toLowerCase();
      if (at() !== "(" || startsNumber) continue;
      i++;
      if (n === "url") {
        // `url(` then whitespace: a quoted url is a function holding a string; otherwise the body is the url.
        let j = i;
        while (isWhitespace(s[j] ?? "")) j++;
        if (s[j] === '"' || s[j] === "'") {
          out.push({ t: "fn", name: n });
          continue;
        }
        i = j;
        out.push({ t: "url", ...urlBody() });
      } else out.push({ t: "fn", name: n });
    } else if (c === "\\") {
      i++; // a backslash before a newline: a delim
    } else {
      i += c.length;
      if (c === "(") out.push({ t: "open" });
      else if (c === ")") out.push({ t: "close" });
      else if (c === ";") out.push({ t: "semi", at: i });
    }
  }
  return out;
}

/** Every `@import` and every URL a stylesheet would load (decoded), in order. */
export function cssLoads(css: string): CssLoad[] {
  const toks = tokenizeCss(css);
  const out: CssLoad[] = [];
  // The open functions, innermost last ("" for a plain parenthesis).
  const stack: string[] = [];
  for (let k = 0; k < toks.length; k++) {
    const tk = toks[k];
    if (tk.t === "at") {
      if (tk.name === "import") {
        const semi = toks.slice(k).find((x) => x.t === "semi") as { at: number } | undefined;
        out.push({ kind: "import", target: css.slice(tk.start, semi ? semi.at : undefined).replace(/\s+/g, " ").trim() });
      }
    } else if (tk.t === "fn") {
      const sink = stack.find((f) => URL_FUNCTIONS.has(f));
      if (sink && SUBSTITUTION_FUNCTIONS.has(tk.name)) out.push({ kind: "substitution", target: `${tk.name}() in ${sink}()` });
      stack.push(tk.name);
    } else if (tk.t === "open") stack.push("");
    else if (tk.t === "close") stack.pop();
    else if (tk.t === "url") out.push({ kind: "url", target: tk.value });
    // Any URL function among the open ones (review Z7-M1): a string in a `var()` fallback inside one is loaded too.
    else if (tk.t === "str" && stack.some((f) => URL_FUNCTIONS.has(f))) out.push({ kind: "url", target: tk.value });
  }
  return out;
}

/** The plugin's own origin, as a base: a relative target resolves inside it. */
const BASE = "https://plugin.invalid/";
const BASE_ORIGIN = new URL(BASE).origin;

/**
 * The origin a target loads from when that is not the plugin's own (null for a relative, fragment or `data:`
 * target). The text is cleaned as the URL parser cleans it before it is read: leading and trailing C0 controls and
 * spaces go, and every tab and newline inside it (so `ht<TAB>tps://` is `https://`, `/<TAB>/host` is `//host`).
 * A target the parser refuses is reported as itself: the review cannot rule it out.
 */
export function remoteTarget(raw: string, allowed: readonly string[] = []): string | null {
  const target = raw.replace(/^[\0-\x20]+|[\0-\x20]+$/g, "").replace(/[\t\n\r]/g, "");
  let url: URL;
  try {
    url = new URL(target, BASE);
  } catch {
    return target || raw;
  }
  if (url.protocol === "data:") return null;
  if (url.origin === BASE_ORIGIN && url.protocol === "https:") return null;
  if (allowed.includes(url.origin)) return null;
  return url.origin === "null" ? `${url.protocol}…` : url.origin;
}
