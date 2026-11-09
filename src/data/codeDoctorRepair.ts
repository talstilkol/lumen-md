/**
 * Code Doctor, layer 3: `repairJson()` and its deterministic strategies,
 * each with a confidence score. Pure. Split out of ./codeDoctor.ts
 * (plan 12.1), which re-exports everything here.
 */
import { SMART_QUOTE_RE, SMART_QUOTE_MAP, meaningful, diagnoseJson, tokenize } from "./codeDoctorCore";
import type { RepairResult, RepairPatch, Token } from "./codeDoctorCore";

// ── Repair engine ───────────────────────────────────────────────────

/**
 * Applies repairs in a fixed order. Each strategy is independent and
 * idempotent. We re-tokenize between strategies because earlier fixes
 * change offsets.
 *
 * Order:
 *   1. Smart quotes  → straight quotes
 *   2. Single quotes → double quotes (string literals only)
 *   3. Unquoted keys → quoted keys
 *   4. Trailing commas removed
 *   5. Missing commas inserted
 *   6. Unclosed brace/bracket appended
 */
export function repairJson(input: string): RepairResult {
  let text = input;
  const patches: RepairPatch[] = [];

  // Pass 1: smart quotes — global single-character replacements.
  if (SMART_QUOTE_RE.test(text)) {
    SMART_QUOTE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    const local: RepairPatch[] = [];
    while ((m = SMART_QUOTE_RE.exec(text)) !== null) {
      const replacement = SMART_QUOTE_MAP[m[0]] ?? m[0];
      local.push({
        span: { start: m.index, end: m.index + m[0].length },
        replacement,
        reason: "smart-quote",
        confidence: "high",
      });
    }
    text = applyPatches(text, local);
    patches.push(...local);
  }

  // Pass 2: single-quoted strings → double-quoted.
  text = retokenizeAndPatch(text, patches, (toks) => {
    const local: RepairPatch[] = [];
    for (const t of toks) {
      if (t.kind === "string" && t.quote === "'") {
        // Re-emit as JSON string: read the inner content, re-encode safely.
        const inner = t.raw.slice(1, t.raw.length - (t.terminated ? 1 : 0));
        const decoded = decodeJsLooseString(inner);
        const reencoded = JSON.stringify(decoded);
        local.push({
          span: { start: t.start, end: t.end },
          replacement: reencoded,
          reason: "single-quote-string",
          confidence: "high",
        });
      }
    }
    return local;
  });

  // Pass 3: unquoted keys → quoted.
  text = retokenizeAndPatch(text, patches, (toks) => {
    const ms = meaningful(toks);
    const local: RepairPatch[] = [];
    const stack: Array<"obj" | "arr"> = [];
    for (let k = 0; k < ms.length; k++) {
      const t = ms[k];
      const prev = k > 0 ? ms[k - 1] : null;
      const next = k + 1 < ms.length ? ms[k + 1] : null;
      if (t.kind === "lbrace") stack.push("obj");
      else if (t.kind === "lbracket") stack.push("arr");
      else if (t.kind === "rbrace" || t.kind === "rbracket") stack.pop();
      else if (
        t.kind === "ident" &&
        stack.length > 0 &&
        stack[stack.length - 1] === "obj" &&
        (prev?.kind === "lbrace" || prev?.kind === "comma") &&
        next?.kind === "colon"
      ) {
        local.push({
          span: { start: t.start, end: t.end },
          replacement: JSON.stringify(t.raw),
          reason: "unquoted-key",
          confidence: "high",
        });
      }
    }
    return local;
  });

  // Pass 4: trailing commas — drop the comma when the next meaningful
  // token is `}` or `]`.
  text = retokenizeAndPatch(text, patches, (toks) => {
    const ms = meaningful(toks);
    const local: RepairPatch[] = [];
    for (let k = 0; k < ms.length - 1; k++) {
      const cur = ms[k];
      const next = ms[k + 1];
      if (
        cur.kind === "comma" &&
        (next.kind === "rbrace" || next.kind === "rbracket")
      ) {
        local.push({
          span: { start: cur.start, end: cur.end },
          replacement: "",
          reason: "trailing-comma",
          confidence: "high",
        });
      }
    }
    return local;
  });

  // Pass 5: missing commas — between two adjacent value-tokens that
  // share a parent. Insert at the boundary; medium confidence.
  text = retokenizeAndPatch(text, patches, (toks) => {
    const ms = meaningful(toks);
    const local: RepairPatch[] = [];
    const stack: Array<"obj" | "arr"> = [];
    for (let k = 0; k < ms.length - 1; k++) {
      const cur = ms[k];
      const nxt = ms[k + 1];
      if (cur.kind === "lbrace") stack.push("obj");
      else if (cur.kind === "lbracket") stack.push("arr");
      else if (cur.kind === "rbrace" || cur.kind === "rbracket") stack.pop();
      const prevIsValue =
        cur.kind === "string" ||
        cur.kind === "number" ||
        cur.kind === "bool" ||
        cur.kind === "null" ||
        cur.kind === "rbrace" ||
        cur.kind === "rbracket";
      const nxtIsValue =
        nxt.kind === "string" ||
        nxt.kind === "number" ||
        nxt.kind === "bool" ||
        nxt.kind === "null" ||
        nxt.kind === "lbrace" ||
        nxt.kind === "lbracket";
      if (prevIsValue && nxtIsValue && stack.length > 0) {
        local.push({
          span: { start: cur.end, end: cur.end },
          replacement: ",",
          reason: "missing-comma",
          confidence: "medium",
        });
      }
    }
    return local;
  });

  // Pass 6: unclosed structures — append matching closers in reverse
  // order. Low confidence: we don't know if the structure was supposed
  // to extend further or end here. If the last meaningful token before
  // EOF is a comma, drop it first so we don't create `..,}` / `..,]`.
  text = retokenizeAndPatch(text, patches, (toks) => {
    const ms = meaningful(toks);
    const stack: Array<"obj" | "arr"> = [];
    for (const t of ms) {
      if (t.kind === "lbrace") stack.push("obj");
      else if (t.kind === "lbracket") stack.push("arr");
      else if (t.kind === "rbrace" || t.kind === "rbracket") stack.pop();
    }
    if (stack.length === 0) return [];
    const closers = stack
      .reverse()
      .map((k) => (k === "obj" ? "}" : "]"))
      .join("");
    const local: RepairPatch[] = [];
    const last = ms[ms.length - 1];
    if (last?.kind === "comma") {
      local.push({
        span: { start: last.start, end: last.end },
        replacement: "",
        reason: "trailing-comma",
        confidence: "high",
      });
    }
    local.push({
      span: { start: text.length, end: text.length },
      replacement: closers,
      reason:
        stack[stack.length - 1] === "obj"
          ? "unclosed-brace"
          : "unclosed-bracket",
      confidence: "low",
    });
    return local;
  });

  // Pass 7: final sweep for any trailing commas that emerged after
  // unclosed-bracket repairs added the closing token.
  text = retokenizeAndPatch(text, patches, (toks) => {
    const ms = meaningful(toks);
    const local: RepairPatch[] = [];
    for (let k = 0; k < ms.length - 1; k++) {
      const cur = ms[k];
      const next = ms[k + 1];
      if (
        cur.kind === "comma" &&
        (next.kind === "rbrace" || next.kind === "rbracket")
      ) {
        local.push({
          span: { start: cur.start, end: cur.end },
          replacement: "",
          reason: "trailing-comma",
          confidence: "high",
        });
      }
    }
    return local;
  });

  let parses = false;
  try {
    JSON.parse(text);
    parses = true;
  } catch {
    /* why: leave parses=false; remaining[] surfaces what's left */
  }

  return {
    output: text,
    patches,
    remaining: parses ? [] : diagnoseJson(text),
    parses,
  };
}

function applyPatches(text: string, patches: RepairPatch[]): string {
  if (patches.length === 0) return text;
  // Apply right-to-left so earlier offsets stay valid.
  const sorted = [...patches].sort((a, b) => b.span.start - a.span.start);
  let out = text;
  for (const p of sorted) {
    out =
      out.slice(0, p.span.start) +
      p.replacement +
      out.slice(p.span.end);
  }
  return out;
}

function retokenizeAndPatch(
  text: string,
  accumulator: RepairPatch[],
  produce: (toks: Token[]) => RepairPatch[],
): string {
  const toks = tokenize(text);
  const local = produce(toks);
  if (local.length === 0) return text;
  accumulator.push(...local);
  return applyPatches(text, local);
}

function decodeJsLooseString(inner: string): string {
  // Decode JS-loose string body (single-quoted).
  // Handles \', \", \\, \n, \r, \t, \uXXXX, \xHH.
  let out = "";
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c !== "\\") {
      out += c;
      continue;
    }
    const next = inner[i + 1];
    if (next === undefined) {
      out += "\\";
      continue;
    }
    i++;
    switch (next) {
      case "n":
        out += "\n";
        break;
      case "t":
        out += "\t";
        break;
      case "r":
        out += "\r";
        break;
      case "b":
        out += "\b";
        break;
      case "f":
        out += "\f";
        break;
      case "0":
        out += "\0";
        break;
      case "'":
      case '"':
      case "\\":
      case "/":
        out += next;
        break;
      case "u": {
        const hex = inner.slice(i + 1, i + 5);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16));
          i += 4;
        } else {
          out += "u";
        }
        break;
      }
      case "x": {
        const hex = inner.slice(i + 1, i + 3);
        if (/^[0-9a-fA-F]{2}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16));
          i += 2;
        } else {
          out += "x";
        }
        break;
      }
      default:
        out += next;
    }
  }
  return out;
}
