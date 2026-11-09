/**
 * Code Doctor, layers 1 and 2: the shared types, the tolerant tokenizer and
 * the structural JSON diagnosis. Pure. Split out of ./codeDoctor.ts
 * (plan 12.1), which re-exports everything here.
 */

// ── Types ────────────────────────────────────────────────────────────

export type Confidence = "high" | "medium" | "low";

export interface SourceSpan {
  /** Start offset (UTF-16 chars) in the original input. */
  start: number;
  /** End offset, exclusive. */
  end: number;
}

export type DiagnosticCode =
  | "smart-quote"
  | "single-quote-string"
  | "trailing-comma"
  | "missing-comma"
  | "unquoted-key"
  | "unclosed-brace"
  | "unclosed-bracket"
  | "stray-token"
  | "empty-input"
  | "ok";

export interface Diagnostic {
  code: DiagnosticCode;
  span: SourceSpan;
  message: string;
  confidence: Confidence;
}

export interface RepairPatch {
  span: SourceSpan;
  replacement: string;
  reason: DiagnosticCode;
  confidence: Confidence;
}

export interface RepairResult {
  /** The repaired text (best-effort). Equal to input if nothing applied. */
  output: string;
  /** Patches applied, in original-text order. */
  patches: RepairPatch[];
  /** Diagnostics that survived the repair (if any). */
  remaining: Diagnostic[];
  /** True iff `JSON.parse(output)` succeeds. */
  parses: boolean;
}

// ── Smart-quote map (deterministic, high confidence) ────────────────

export const SMART_QUOTE_MAP: Record<string, string> = {
  "“": '"', // “
  "”": '"', // ”
  "„": '"', // „
  "‟": '"', // ‟
  "‘": "'", // ‘
  "’": "'", // ’
  "‚": "'", // ‚
  "‛": "'", // ‛
  "«": '"', // «
  "»": '"', // »
};
export const SMART_QUOTE_RE = new RegExp(
  `[${Object.keys(SMART_QUOTE_MAP).join("")}]`,
  "g",
);

// ── Tolerant tokenizer ──────────────────────────────────────────────

export type TokenKind =
  | "lbrace"
  | "rbrace"
  | "lbracket"
  | "rbracket"
  | "colon"
  | "comma"
  | "string"
  | "number"
  | "bool"
  | "null"
  | "ident"
  | "newline"
  | "ws"
  | "comment"
  | "error";

export interface Token {
  kind: TokenKind;
  start: number;
  end: number;
  /** Raw text of the token, untouched. */
  raw: string;
  /** Quote style for strings: '"' | "'" | "smart" | undefined. */
  quote?: '"' | "'" | "smart";
  /** Whether the string was properly terminated. */
  terminated?: boolean;
}

const NUM_RE = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const IDENT_RE = /[A-Za-z_$][A-Za-z0-9_$]*/y;

/**
 * Walks the input once and returns every meaningful token. Skips
 * whitespace except for newlines (which JSONL detection cares about).
 * Survives any input — never throws.
 */
export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text.charCodeAt(i);

    // Newline (\n or \r\n)
    if (c === 10 || c === 13) {
      const start = i;
      if (c === 13 && text.charCodeAt(i + 1) === 10) i += 2;
      else i += 1;
      out.push({ kind: "newline", start, end: i, raw: text.slice(start, i) });
      continue;
    }
    // Whitespace
    if (c === 9 || c === 32) {
      const start = i;
      while (i < n && (text.charCodeAt(i) === 9 || text.charCodeAt(i) === 32)) i++;
      out.push({ kind: "ws", start, end: i, raw: text.slice(start, i) });
      continue;
    }
    // Comments (JSON5-style — // line, /* block */). Surface as `comment`
    // so the repairer can strip them in JSON-strict mode.
    if (c === 47 /* / */ && text.charCodeAt(i + 1) === 47) {
      const start = i;
      while (i < n && text.charCodeAt(i) !== 10) i++;
      out.push({ kind: "comment", start, end: i, raw: text.slice(start, i) });
      continue;
    }
    if (c === 47 && text.charCodeAt(i + 1) === 42) {
      const start = i;
      i += 2;
      while (i < n && !(text.charCodeAt(i) === 42 && text.charCodeAt(i + 1) === 47))
        i++;
      if (i < n) i += 2;
      out.push({ kind: "comment", start, end: i, raw: text.slice(start, i) });
      continue;
    }
    // Structural punctuation
    if (c === 123) {
      out.push({ kind: "lbrace", start: i, end: i + 1, raw: "{" });
      i++;
      continue;
    }
    if (c === 125) {
      out.push({ kind: "rbrace", start: i, end: i + 1, raw: "}" });
      i++;
      continue;
    }
    if (c === 91) {
      out.push({ kind: "lbracket", start: i, end: i + 1, raw: "[" });
      i++;
      continue;
    }
    if (c === 93) {
      out.push({ kind: "rbracket", start: i, end: i + 1, raw: "]" });
      i++;
      continue;
    }
    if (c === 58) {
      out.push({ kind: "colon", start: i, end: i + 1, raw: ":" });
      i++;
      continue;
    }
    if (c === 44) {
      out.push({ kind: "comma", start: i, end: i + 1, raw: "," });
      i++;
      continue;
    }
    // Strings — handle "...", '...', and smart quotes ".." / '..'
    const isStraightDouble = c === 34;
    const isStraightSingle = c === 39;
    const smartOpen = SMART_QUOTE_MAP[text[i]];
    if (isStraightDouble || isStraightSingle || smartOpen) {
      const start = i;
      const opener = text[i];
      const isDouble =
        isStraightDouble || smartOpen === '"';
      const quote: Token["quote"] = smartOpen
        ? "smart"
        : isStraightDouble
          ? '"'
          : "'";
      i++;
      let terminated = false;
      while (i < n) {
        const ch = text[i];
        if (ch === "\\" && i + 1 < n) {
          i += 2;
          continue;
        }
        // Match closing — accept either the same opener, the matching
        // smart-quote pair, or for smart-open the canonical ASCII pair.
        if (
          ch === opener ||
          (smartOpen && SMART_QUOTE_MAP[ch] === smartOpen) ||
          (smartOpen && ch === (isDouble ? '"' : "'"))
        ) {
          i++;
          terminated = true;
          break;
        }
        // String content includes newlines under tolerant mode (we
        // surface unterminated strings via `terminated:false`).
        i++;
      }
      out.push({
        kind: "string",
        start,
        end: i,
        raw: text.slice(start, i),
        quote,
        terminated,
      });
      continue;
    }
    // Numbers
    NUM_RE.lastIndex = i;
    const numMatch = NUM_RE.exec(text);
    if (numMatch && numMatch.index === i) {
      out.push({
        kind: "number",
        start: i,
        end: i + numMatch[0].length,
        raw: numMatch[0],
      });
      i += numMatch[0].length;
      continue;
    }
    // Identifiers (keywords true/false/null + unquoted keys / NaN / Infinity)
    IDENT_RE.lastIndex = i;
    const idMatch = IDENT_RE.exec(text);
    if (idMatch && idMatch.index === i) {
      const word = idMatch[0];
      const kind: TokenKind =
        word === "true" || word === "false"
          ? "bool"
          : word === "null"
            ? "null"
            : "ident";
      out.push({ kind, start: i, end: i + word.length, raw: word });
      i += word.length;
      continue;
    }
    // Anything else — surface as a single-char error token so the
    // diagnoser can highlight it. We do NOT throw.
    out.push({
      kind: "error",
      start: i,
      end: i + 1,
      raw: text[i],
    });
    i++;
  }
  return out;
}

// ── Structural diagnoser ────────────────────────────────────────────

/** Returns tokens minus whitespace/newlines (for the parser). */
export function meaningful(tokens: Token[]): Token[] {
  return tokens.filter(
    (t) => t.kind !== "ws" && t.kind !== "newline" && t.kind !== "comment",
  );
}

/**
 * Walks the meaningful tokens and emits diagnostics for:
 *   - smart-quote strings
 *   - single-quote strings
 *   - unquoted object keys
 *   - trailing commas before `]` / `}`
 *   - missing commas between adjacent values
 *   - unclosed `{` / `[` (stack underflow / unconsumed)
 *   - stray characters (error tokens)
 *
 * Pure: just returns Diagnostic[]. Repair is a separate pass.
 */
export function diagnoseJson(text: string): Diagnostic[] {
  if (!text.trim()) {
    return [
      {
        code: "empty-input",
        span: { start: 0, end: text.length },
        message: "Input is empty.",
        confidence: "high",
      },
    ];
  }

  const tokens = tokenize(text);
  const out: Diagnostic[] = [];

  // Token-level diagnostics
  for (const t of tokens) {
    if (t.kind === "error") {
      out.push({
        code: "stray-token",
        span: { start: t.start, end: t.end },
        message: `Unexpected character ${JSON.stringify(t.raw)} — not valid JSON.`,
        confidence: "high",
      });
    } else if (t.kind === "string" && t.quote === "smart") {
      out.push({
        code: "smart-quote",
        span: { start: t.start, end: t.end },
        message:
          "Curly / smart quotes detected. JSON requires straight double quotes.",
        confidence: "high",
      });
    } else if (t.kind === "string" && t.quote === "'") {
      out.push({
        code: "single-quote-string",
        span: { start: t.start, end: t.end },
        message:
          "Single-quoted strings aren't valid JSON. Use double quotes.",
        confidence: "high",
      });
    }
  }

  // Structural pass
  const ms = meaningful(tokens);
  const stack: Array<{ kind: "obj" | "arr"; open: Token }> = [];
  const expectingKey: boolean[] = []; // parallel to stack — true when next obj token must be a key
  for (let k = 0; k < ms.length; k++) {
    const t = ms[k];
    const prev = k > 0 ? ms[k - 1] : null;
    const next = k + 1 < ms.length ? ms[k + 1] : null;

    if (t.kind === "lbrace") {
      stack.push({ kind: "obj", open: t });
      expectingKey.push(true);
    } else if (t.kind === "lbracket") {
      stack.push({ kind: "arr", open: t });
      expectingKey.push(false);
    } else if (t.kind === "rbrace" || t.kind === "rbracket") {
      // Trailing comma before close?
      if (prev?.kind === "comma") {
        out.push({
          code: "trailing-comma",
          span: { start: prev.start, end: prev.end },
          message: "Trailing comma before " + (t.kind === "rbrace" ? "}" : "]") + ".",
          confidence: "high",
        });
      }
      stack.pop();
      expectingKey.pop();
    } else if (t.kind === "ident") {
      // An identifier that isn't true/false/null in a key position is
      // an unquoted key (JSON5-style). Diagnose.
      const inObj = stack.length > 0 && stack[stack.length - 1].kind === "obj";
      const isKeyPos =
        inObj &&
        (prev?.kind === "lbrace" || prev?.kind === "comma");
      if (isKeyPos && next?.kind === "colon") {
        out.push({
          code: "unquoted-key",
          span: { start: t.start, end: t.end },
          message: `Object key "${t.raw}" is not quoted. JSON requires quoted keys.`,
          confidence: "high",
        });
      }
    } else if (t.kind === "comma") {
      // Diagnose double-comma → likely missing value, but we treat
      // double-comma as a missing-value (keep simple; the repairer
      // will resolve).
    }

    // Missing-comma detection: two value-tokens in a row with no
    // separator between them is illegal in arrays, and key-value pairs
    // in objects must also be separated. We only flag the simple case
    // where prev and t are both "values" and the parent is array/obj
    // and prev was not a structural token.
    if (prev) {
      const prevIsValue =
        prev.kind === "string" ||
        prev.kind === "number" ||
        prev.kind === "bool" ||
        prev.kind === "null" ||
        prev.kind === "rbrace" ||
        prev.kind === "rbracket";
      const thisIsValue =
        t.kind === "string" ||
        t.kind === "number" ||
        t.kind === "bool" ||
        t.kind === "null" ||
        t.kind === "lbrace" ||
        t.kind === "lbracket";
      if (prevIsValue && thisIsValue && stack.length > 0) {
        out.push({
          code: "missing-comma",
          span: { start: prev.end, end: t.start },
          message: "Missing comma between values.",
          confidence: "medium",
        });
      }
    }
  }

  // Anything left on the stack is unclosed.
  for (const open of stack) {
    out.push({
      code: open.kind === "obj" ? "unclosed-brace" : "unclosed-bracket",
      span: { start: open.open.start, end: open.open.end },
      message:
        open.kind === "obj"
          ? "Object opened with `{` is never closed."
          : "Array opened with `[` is never closed.",
      confidence: "low",
    });
  }

  return out;
}
