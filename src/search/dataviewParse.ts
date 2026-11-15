/**
 * Dataview queries: the tokenizer and the parser (W10.E30). Moved verbatim
 * out of dataview.ts for the 800-line limit (W6.25); dataview.ts re-exports
 * the parser's public names.
 */
import type { Value } from "./dataview";

/* ─── Tokens ─────────────────────────────────────────────────────── */

export type Tok =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "id"; v: string }
  | { t: "tag"; v: string }
  | { t: "link"; v: string }
  | { t: "op"; v: string };

export class DataviewError extends Error {}

export function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let s = "";
      while (j < src.length && src[j] !== c) {
        if (src[j] === "\\" && j + 1 < src.length) {
          s += src[j + 1];
          j += 2;
          continue;
        }
        s += src[j++];
      }
      if (j >= src.length) throw new DataviewError("unterminated string");
      out.push({ t: "str", v: s });
      i = j + 1;
      continue;
    }
    if (src.startsWith("[[", i)) {
      const j = src.indexOf("]]", i);
      if (j < 0) throw new DataviewError("unterminated link");
      out.push({ t: "link", v: src.slice(i + 2, j).split("|")[0].trim() });
      i = j + 2;
      continue;
    }
    if (c === "#") {
      const m = /^#([\p{L}\p{M}\p{N}_/-]+)/u.exec(src.slice(i));
      if (m) {
        out.push({ t: "tag", v: m[1] });
        i += m[0].length;
        continue;
      }
    }
    const num = /^\d+(?:\.\d+)?/.exec(src.slice(i));
    if (num) {
      out.push({ t: "num", v: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (["<=", ">=", "!=", "==", "&&", "||"].includes(two)) {
      out.push({ t: "op", v: two === "==" ? "=" : two === "&&" ? "and" : two === "||" ? "or" : two });
      i += 2;
      continue;
    }
    if ("()[],.=<>!+-*/%".includes(c)) {
      out.push({ t: "op", v: c });
      i++;
      continue;
    }
    const id = /^[\p{L}_][\p{L}\p{N}_-]*/u.exec(src.slice(i));
    if (id) {
      // Field names may hold dashes ("due-date"); subtraction needs spaces ("a - b").
      out.push({ t: "id", v: id[0] });
      i += id[0].length;
      continue;
    }
    throw new DataviewError(`unexpected "${c}"`);
  }
  return out;
}

/* ─── Syntax ─────────────────────────────────────────────────────── */

export type Expr =
  | { k: "lit"; v: Value }
  | { k: "field"; path: string[] }
  | { k: "call"; fn: string; args: Expr[] }
  | { k: "un"; op: "!" | "-"; e: Expr }
  | { k: "bin"; op: string; a: Expr; b: Expr }
  | { k: "list"; items: Expr[] };

export type Source =
  | { k: "tag"; v: string }
  | { k: "folder"; v: string }
  | { k: "link"; v: string }
  | { k: "not"; s: Source }
  | { k: "and" | "or"; a: Source; b: Source };

export interface DvQuery {
  type: "list" | "table";
  /** LIST's value, or TABLE's columns. */
  fields: Array<{ e: Expr; name: string }>;
  withoutId: boolean;
  from: Source | null;
  where: Expr | null;
  sort: Array<{ e: Expr; desc: boolean }>;
  limit: number | null;
}

export const KEYWORDS = new Set(["from", "where", "sort", "limit", "flatten", "group"]);

export class Parser {
  i = 0;
  constructor(readonly toks: Tok[]) {}
  peek(): Tok | undefined {
    return this.toks[this.i];
  }
  isKw(word: string): boolean {
    const p = this.peek();
    return !!p && p.t === "id" && p.v.toLowerCase() === word;
  }
  isOp(op: string): boolean {
    const p = this.peek();
    return !!p && p.t === "op" && p.v === op;
  }
  eatOp(op: string): void {
    if (!this.isOp(op)) throw new DataviewError(`expected "${op}"`);
    this.i++;
  }
  atClauseEnd(): boolean {
    const p = this.peek();
    return !p || (p.t === "id" && KEYWORDS.has(p.v.toLowerCase()));
  }

  expr(): Expr {
    return this.or();
  }
  or(): Expr {
    let a = this.and();
    while (this.isKw("or") || this.isOp("or")) {
      this.i++;
      a = { k: "bin", op: "or", a, b: this.and() };
    }
    return a;
  }
  and(): Expr {
    let a = this.cmp();
    while (this.isKw("and") || this.isOp("and")) {
      this.i++;
      a = { k: "bin", op: "and", a, b: this.cmp() };
    }
    return a;
  }
  cmp(): Expr {
    const a = this.add();
    const p = this.peek();
    if (p && p.t === "op" && ["=", "!=", "<", ">", "<=", ">="].includes(p.v)) {
      this.i++;
      return { k: "bin", op: p.v, a, b: this.add() };
    }
    return a;
  }
  add(): Expr {
    let a = this.mul();
    for (let p = this.peek(); p && p.t === "op" && (p.v === "+" || p.v === "-"); p = this.peek()) {
      this.i++;
      a = { k: "bin", op: p.v, a, b: this.mul() };
    }
    return a;
  }
  mul(): Expr {
    let a = this.unary();
    for (let p = this.peek(); p && p.t === "op" && (p.v === "*" || p.v === "/" || p.v === "%"); p = this.peek()) {
      this.i++;
      a = { k: "bin", op: p.v, a, b: this.unary() };
    }
    return a;
  }
  unary(): Expr {
    if (this.isOp("!")) {
      this.i++;
      return { k: "un", op: "!", e: this.unary() };
    }
    if (this.isOp("-")) {
      this.i++;
      return { k: "un", op: "-", e: this.unary() };
    }
    return this.postfix(this.primary());
  }
  postfix(e: Expr): Expr {
    let out = e;
    for (;;) {
      if (this.isOp(".") && out.k === "field") {
        this.i++;
        const p = this.peek();
        if (!p || p.t !== "id") throw new DataviewError("expected a field name after .");
        this.i++;
        out = { k: "field", path: [...out.path, p.v] };
        continue;
      }
      if (this.isOp("[")) {
        this.i++;
        const idx = this.expr();
        this.eatOp("]");
        out = { k: "call", fn: "__index", args: [out, idx] };
        continue;
      }
      return out;
    }
  }
  primary(): Expr {
    const p = this.peek();
    if (!p) throw new DataviewError("unexpected end of query");
    this.i++;
    switch (p.t) {
      case "num":
        return { k: "lit", v: p.v };
      case "str":
        return { k: "lit", v: p.v };
      case "link":
        return { k: "lit", v: { link: p.v, display: p.v } };
      case "tag":
        return { k: "lit", v: "#" + p.v };
      case "op":
        if (p.v === "(") {
          const e = this.expr();
          this.eatOp(")");
          return e;
        }
        if (p.v === "[") {
          const items: Expr[] = [];
          while (!this.isOp("]")) {
            items.push(this.expr());
            if (!this.isOp("]")) this.eatOp(",");
          }
          this.eatOp("]");
          return { k: "list", items };
        }
        throw new DataviewError(`unexpected "${p.v}"`);
      case "id": {
        const low = p.v.toLowerCase();
        if (low === "true" || low === "false") return { k: "lit", v: low === "true" };
        if (low === "null") return { k: "lit", v: null };
        if (this.isOp("(") && (low === "date" || low === "dur") && this.toks[this.i + 1]?.t !== "str") {
          // date(today), dur(1 day): Dataview takes these as bare words, not expressions.
          this.i++;
          const words: string[] = [];
          while (this.peek() && !this.isOp(")")) {
            const w = this.peek()!;
            words.push(w.t === "tag" ? "#" + w.v : String(w.v));
            this.i++;
          }
          this.eatOp(")");
          const raw = words.join(low === "dur" ? " " : "");
          // date(file.name) and the like: a real expression after all.
          if (low === "date" && /^[A-Za-z_][\w]*\.[\w.]+$/.test(raw)) {
            return { k: "call", fn: "date", args: [{ k: "field", path: raw.split(".") }] };
          }
          return { k: "call", fn: low, args: [{ k: "lit", v: raw }] };
        }
        if (this.isOp("(")) {
          this.i++;
          const args: Expr[] = [];
          while (!this.isOp(")")) {
            args.push(this.expr());
            if (!this.isOp(")")) this.eatOp(",");
          }
          this.eatOp(")");
          return { k: "call", fn: low, args };
        }
        return { k: "field", path: [p.v] };
      }
    }
  }

  source(): Source {
    let a = this.sourceAnd();
    while (this.isKw("or")) {
      this.i++;
      a = { k: "or", a, b: this.sourceAnd() };
    }
    return a;
  }
  sourceAnd(): Source {
    let a = this.sourceAtom();
    while (this.isKw("and")) {
      this.i++;
      a = { k: "and", a, b: this.sourceAtom() };
    }
    return a;
  }
  sourceAtom(): Source {
    const p = this.peek();
    if (!p) throw new DataviewError("expected a source after FROM");
    if (p.t === "op" && (p.v === "-" || p.v === "!")) {
      this.i++;
      return { k: "not", s: this.sourceAtom() };
    }
    if (p.t === "op" && p.v === "(") {
      this.i++;
      const s = this.source();
      this.eatOp(")");
      return s;
    }
    this.i++;
    if (p.t === "tag") return { k: "tag", v: p.v.toLowerCase() };
    if (p.t === "str") return { k: "folder", v: p.v.replace(/^\/+|\/+$/g, "") };
    if (p.t === "link") return { k: "link", v: p.v };
    throw new DataviewError("FROM takes #tags, \"folders\" and [[links]]");
  }
}

/** Parse a ```dataview block. Throws DataviewError on what it does not support. */
export function parseDataview(src: string): DvQuery {
  const text = src.replace(/\/\/[^\n]*$/gm, "").trim();
  const p = new Parser(tokenize(text));
  const head = p.peek();
  if (!head || head.t !== "id") throw new DataviewError("a query starts with LIST or TABLE");
  const kind = head.v.toLowerCase();
  if (kind !== "list" && kind !== "table") throw new DataviewError(`${head.v} queries are not supported (LIST and TABLE are)`);
  p.i++;
  const q: DvQuery = { type: kind, fields: [], withoutId: false, from: null, where: null, sort: [], limit: null };
  if (p.isKw("without")) {
    p.i++;
    if (!p.isKw("id")) throw new DataviewError("expected WITHOUT ID");
    p.i++;
    q.withoutId = true;
  }
  if (!p.atClauseEnd()) {
    for (;;) {
      const start = p.i;
      const e = p.expr();
      let name = p.toks
        .slice(start, p.i)
        .map((tk) => (tk.t === "str" ? JSON.stringify(tk.v) : tk.t === "tag" ? "#" + tk.v : tk.t === "link" ? `[[${tk.v}]]` : String(tk.v)))
        .join("")
        .replace(/\s+/g, "");
      if (p.isKw("as")) {
        p.i++;
        const n = p.peek();
        if (!n || (n.t !== "str" && n.t !== "id")) throw new DataviewError("expected a name after AS");
        p.i++;
        name = String(n.v);
      }
      q.fields.push({ e, name });
      if (kind === "list" || !p.isOp(",")) break;
      p.i++;
    }
  }
  while (p.peek()) {
    const kw = p.peek()!;
    if (kw.t !== "id") throw new DataviewError(`unexpected "${String(kw.v)}"`);
    const low = kw.v.toLowerCase();
    p.i++;
    if (low === "from") q.from = p.source();
    else if (low === "where") q.where = q.where ? { k: "bin", op: "and", a: q.where, b: p.expr() } : p.expr();
    else if (low === "sort") {
      for (;;) {
        const e = p.expr();
        let desc = false;
        if (p.isKw("desc") || p.isKw("descending")) {
          desc = true;
          p.i++;
        } else if (p.isKw("asc") || p.isKw("ascending")) p.i++;
        q.sort.push({ e, desc });
        if (!p.isOp(",")) break;
        p.i++;
      }
    } else if (low === "limit") {
      const n = p.peek();
      if (!n || n.t !== "num") throw new DataviewError("LIMIT takes a number");
      p.i++;
      q.limit = n.v;
    } else throw new DataviewError(`${kw.v} is not supported`);
  }
  return q;
}
