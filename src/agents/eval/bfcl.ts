/**
 * Plan W11.I15 — tool-call reliability on BFCL v4 (research R4.11) instead
 * of the scripted mock of W4.31, which stays a unit test only.
 *
 * The data is BFCL v4's own (Apache-2.0), copied unchanged to
 * eval/public/bfcl-v4 with its source commit and sha256 (manifest.json).
 * This module is the harness: a port of BFCL's Python AST checker
 * (bfcl_eval/eval_checker/ast_eval/ast_checker.py at that commit) for the
 * simple, multiple and parallel categories, a parser for the multi-turn
 * ground truth (Python call strings), and a runner that drives any engine
 * with and without Lumen's tool-call repair (toolRepair.ts), so the
 * repair's share of the score is reported on its own.
 *
 * Multi-turn: BFCL scores it by executing the calls against its Python
 * backends (a file system, a trading bot …) and comparing state and
 * responses. Those backends are not ported. The harness records the calls
 * with a stub result and scores the ordered calls of each turn against the
 * ground truth (`multi_turn_calls`). That number is ours, not the
 * leaderboard's multi-turn accuracy, and is reported under its own name.
 */

import type { AgentTool, JsonSchema } from "../types";
import { repairCall } from "../toolRepair";

// ───────────────────────────── data ─────────────────────────────

export interface BfclParam {
  type?: string;
  description?: string;
  items?: BfclParam;
  properties?: Record<string, BfclParam>;
  required?: string[];
  enum?: unknown[];
  default?: unknown;
}
export interface BfclFunction {
  name: string;
  description: string;
  parameters: { type: string; properties: Record<string, BfclParam>; required?: string[] };
}
export interface BfclMessage {
  role: string;
  content: string;
}
export interface BfclEntry {
  id: string;
  question: BfclMessage[][];
  function?: BfclFunction[];
  involved_classes?: string[];
  excluded_function?: string[];
}
/** BFCL's call shape: `{ name: { param: value } }`. */
export type BfclCall = Record<string, Record<string, unknown>>;
/** Possible answers: `{ name: { param: [allowed values] } }` ("" = may be omitted). */
export type BfclPossible = Record<string, Record<string, unknown[]>>;
export interface BfclAnswer {
  id: string;
  ground_truth: BfclPossible[] | string[][];
}
export type BfclCategory = "simple" | "multiple" | "parallel" | "multi_turn";
export const CATEGORIES: readonly BfclCategory[] = ["simple", "multiple", "parallel", "multi_turn"];

/** The vendored files per category (eval/public/bfcl-v4). */
export const FILES: Record<BfclCategory, string> = {
  simple: "BFCL_v4_simple_python.json",
  multiple: "BFCL_v4_multiple.json",
  parallel: "BFCL_v4_parallel.json",
  multi_turn: "BFCL_v4_multi_turn_base.json",
};
/** BFCL's MULTI_TURN_FUNC_DOC_FILE_MAPPING for the classes multi_turn_base uses. */
export const CLASS_DOCS: Record<string, string> = {
  GorillaFileSystem: "gorilla_file_system.json",
  MathAPI: "math_api.json",
  MessageAPI: "message_api.json",
  TwitterAPI: "posting_api.json",
  TicketAPI: "ticket_api.json",
  TradingBot: "trading_bot.json",
  TravelAPI: "travel_booking.json",
  VehicleControlAPI: "vehicle_control.json",
};

/** BFCL's files are JSON Lines with a .json name. */
export function parseJsonl<T = unknown>(text: string): T[] {
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as T);
}

export function categoryOf(id: string): BfclCategory {
  if (id.startsWith("multi_turn")) return "multi_turn";
  if (id.startsWith("parallel")) return "parallel";
  if (id.startsWith("multiple")) return "multiple";
  return "simple";
}

/** BFCL's types → JSON Schema, as its OpenAI-style handlers convert them (dict → object, float → number, tuple → array). */
export function toJsonSchema(p: BfclParam): JsonSchema {
  const map: Record<string, string> = { dict: "object", float: "number", tuple: "array", integer: "integer", string: "string", boolean: "boolean", array: "array" };
  const out: Record<string, unknown> = {};
  if (p.type && p.type !== "any" && map[p.type]) out.type = map[p.type];
  if (p.description) out.description = p.description;
  if (p.enum) out.enum = p.enum;
  if (p.items) out.items = toJsonSchema(p.items);
  if (p.properties) out.properties = Object.fromEntries(Object.entries(p.properties).map(([k, v]) => [k, toJsonSchema(v)]));
  if (p.required?.length) out.required = p.required;
  return out;
}

// ───────────────────────────── AST checker ─────────────────────────────

export interface CheckResult {
  valid: boolean;
  error?: string;
  errorType?: string;
}
const ok: CheckResult = { valid: true };
const fail = (errorType: string, error: string): CheckResult => ({ valid: false, errorType, error });

type PyType = "str" | "int" | "float" | "bool" | "list" | "dict" | "none";
const PY_TYPE: Record<string, PyType> = { string: "str", integer: "int", float: "float", boolean: "bool", array: "list", tuple: "list", dict: "dict", any: "str" };

/** Python's type() of a JSON value; a number is `float` where a float is expected (Python's int → float conversion). */
function pyType(v: unknown, expected?: PyType): PyType {
  if (v === null || v === undefined) return "none";
  if (typeof v === "boolean") return "bool";
  if (typeof v === "number") return expected === "float" ? "float" : Number.isInteger(v) ? "int" : "float";
  if (typeof v === "string") return "str";
  if (Array.isArray(v)) return "list";
  return "dict";
}

/** BFCL's standardize_string: drop spaces and ,./-_*^, lower-case, ' → ". */
export function standardizeString(s: string): string {
  return s.replace(/[ ,./\-_*^]/g, "").toLowerCase().replace(/'/g, '"');
}

/** Python ==: 1 == 1.0, lists and dicts element-wise. */
function pyEqual(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") return a === b;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => pyEqual(x, b[i]));
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => k in (b as object) && pyEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return a === b;
}
const pyIn = (v: unknown, list: unknown[]) => list.some((x) => pyEqual(v, x));
const stdIfString = (v: unknown) => (typeof v === "string" ? standardizeString(v) : v);

function possibleType(possible: unknown[], expected: PyType): PyType | null {
  for (const a of possible) if (a !== "") return pyType(a, expected);
  return null;
}

/** type_checker (one level of nesting, as BFCL's). Returns whether the value is a "variable" (a string standing in for the value). */
function typeChecker(param: string, value: unknown, possible: unknown[], expectedDesc: string, expected: PyType, nested: PyType | null): CheckResult & { isVariable?: boolean } {
  const pt = possibleType(possible, expected);
  const isVariable = pt !== null && pt !== expected;
  if (pyType(value, expected) === expected) {
    if (nested === null) return { valid: true, isVariable };
    for (const item of possible) {
      let flag = true;
      if (Array.isArray(item)) {
        for (const v of value as unknown[]) {
          if (!typeChecker(param, v, item, nested, nested, null).valid) {
            flag = false;
            break;
          }
        }
      }
      if (flag) return { valid: true, isVariable };
    }
    return { ...fail("type_error:nested", `Nested type checking failed for parameter '${param}'.`), isVariable };
  }
  if (pt !== null && pyType(value, expected) === pt) return { valid: true, isVariable: true };
  return { ...fail("type_error:simple", `Incorrect type for parameter '${param}'. Expected type ${expectedDesc}, got ${pyType(value)}.`), isVariable };
}

function stringChecker(param: string, value: string, possible: unknown[]): CheckResult {
  const want = possible.filter((p): p is string => typeof p === "string").map(standardizeString);
  return want.includes(standardizeString(value)) ? ok : fail("value_error:string", `Invalid value for parameter '${param}': ${JSON.stringify(value)}.`);
}

function listChecker(param: string, value: unknown[], possible: unknown[]): CheckResult {
  const v = value.map(stdIfString);
  const want = possible.map((p) => (Array.isArray(p) ? p.map(stdIfString) : p));
  return pyIn(v, want) ? ok : fail("value_error:list/tuple", `Invalid value for parameter '${param}': ${JSON.stringify(value)}.`);
}

function dictChecker(param: string, value: Record<string, unknown>, possibles: unknown[]): CheckResult {
  let result = fail("dict_checker:unclear", `Invalid value for parameter '${param}'.`);
  for (const pa of possibles) {
    if (pa === "") continue;
    const possible = pa as Record<string, unknown[]>;
    let flag = true;
    for (const [k, v] of Object.entries(value)) {
      if (!(k in possible)) {
        result = fail("value_error:dict_key", `Unexpected dict key parameter: '${k}'.`);
        flag = false;
        break;
      }
      if (!pyIn(stdIfString(v), possible[k].map(stdIfString))) {
        result = fail("value_error:dict_value", `Invalid value for parameter '${k}': ${JSON.stringify(v)}.`);
        flag = false;
        break;
      }
    }
    if (flag) {
      for (const [k, v] of Object.entries(possible)) {
        if (!(k in value) && !v.includes("")) {
          result = fail("value_error:dict_key", `Missing dict key parameter: '${k}'.`);
          flag = false;
          break;
        }
      }
    }
    if (flag) return ok;
  }
  return result;
}

function listDictChecker(param: string, value: unknown[], possibles: unknown[]): CheckResult {
  let result = fail("list_dict_checker:unclear", `Invalid value for parameter '${param}'.`);
  for (const pa of possibles) {
    if (!Array.isArray(pa) || value.length !== pa.length) {
      result = fail("value_error:list_dict_count", "Wrong number of dictionaries in the list.");
      continue;
    }
    let flag = true;
    for (let i = 0; i < value.length; i++) {
      result = dictChecker(param, value[i] as Record<string, unknown>, [pa[i]]);
      if (!result.valid) {
        flag = false;
        break;
      }
    }
    if (flag) return ok;
  }
  return result;
}

/** simple_function_checker for Python. */
export function simpleFunctionChecker(fd: BfclFunction, output: BfclCall, possibleAnswer: BfclPossible): CheckResult {
  const possible = Object.values(possibleAnswer)[0];
  const name = fd.name;
  if (!(name in output)) return fail("simple_function_checker:wrong_func_name", `Function name '${name}' not found in model output.`);
  const params = output[name] ?? {};
  const details = fd.parameters.properties;
  for (const r of fd.parameters.required ?? []) if (!(r in params)) return fail("simple_function_checker:missing_required", `Missing required parameter: '${r}'.`);
  for (const [param, raw] of Object.entries(params)) {
    if (!(param in details) || !(param in possible)) return fail("simple_function_checker:unexpected_param", `Unexpected parameter: '${param}'.`);
    const desc = details[param].type ?? "any";
    const expected = PY_TYPE[desc] ?? "str";
    const nested = desc === "array" || desc === "tuple" ? (PY_TYPE[details[param].items?.type ?? "any"] ?? "str") : null;
    const value = raw;
    const tc = typeChecker(param, value, possible[param], desc, expected, nested);
    if (!tc.valid) return { valid: false, error: tc.error, errorType: tc.errorType };
    if (!tc.isVariable) {
      if (expected === "dict") {
        const r = dictChecker(param, value as Record<string, unknown>, possible[param]);
        if (!r.valid) return r;
        continue;
      }
      if (expected === "list" && nested === "dict") {
        const r = listDictChecker(param, value as unknown[], possible[param]);
        if (!r.valid) return r;
        continue;
      }
      if (expected === "str") {
        const r = stringChecker(param, value as string, possible[param]);
        if (!r.valid) return r;
        continue;
      }
      if (expected === "list") {
        const r = listChecker(param, value as unknown[], possible[param]);
        if (!r.valid) return r;
        continue;
      }
    }
    if (!pyIn(value, possible[param])) return fail("value_error:others", `Invalid value for parameter '${param}': ${JSON.stringify(value)}.`);
  }
  for (const [param, values] of Object.entries(possible)) {
    if (!(param in params) && !values.includes("")) return fail("simple_function_checker:missing_optional", `Optional parameter '${param}' not provided and not marked as optional.`);
  }
  return ok;
}

const findDescription = (fds: BfclFunction[], name: string) => fds.find((f) => f.name === name);

/** ast_checker: simple, multiple, or parallel (no order). */
export function astCheck(category: Exclude<BfclCategory, "multi_turn">, fds: BfclFunction[], output: BfclCall[], possible: BfclPossible[]): CheckResult {
  if (category === "simple") {
    if (output.length !== 1) return fail("simple_function_checker:wrong_count", "Wrong number of functions.");
    return simpleFunctionChecker(fds[0], output[0], possible[0]);
  }
  if (output.length !== possible.length) return fail(`${category}_function_checker:wrong_count`, "Wrong number of functions.");
  if (category === "multiple") {
    const fd = findDescription(fds, Object.keys(possible[0])[0]);
    return fd ? simpleFunctionChecker(fd, output[0], possible[0]) : fail("multiple_function_checker:no_description", "No description for the expected function.");
  }
  const matched = new Set<number>();
  for (let i = 0; i < possible.length; i++) {
    const fd = findDescription(fds, Object.keys(possible[i])[0]);
    if (!fd) return fail("parallel_function_checker_no_order:no_description", "No description for an expected function.");
    let found = false;
    for (let j = 0; j < output.length; j++) {
      if (matched.has(j)) continue;
      if (simpleFunctionChecker(fd, output[j], possible[i]).valid) {
        matched.add(j);
        found = true;
        break;
      }
    }
    if (!found) return fail("parallel_function_checker_no_order:cannot_find_match", `Could not find a matching function for index ${i} of possible answers.`);
  }
  return ok;
}

// ───────────────────────────── Python calls (multi-turn ground truth) ─────────────────────────────

export interface PyCall {
  name: string;
  args: unknown[];
  kwargs: Record<string, unknown>;
}

/** Parses `name(arg, k=v, …)` with Python literals (str, int, float, True/False/None, list, tuple, dict). */
export function parsePyCall(src: string): PyCall {
  let i = 0;
  const s = src.trim();
  const ws = () => {
    while (i < s.length && /\s/.test(s[i])) i++;
  };
  const expect = (c: string) => {
    ws();
    if (s[i] !== c) throw new Error(`parsePyCall: expected ${c} at ${i} in ${s}`);
    i++;
  };
  const ident = () => {
    ws();
    const m = /^[A-Za-z_][\w.]*/.exec(s.slice(i));
    if (!m) throw new Error(`parsePyCall: expected a name at ${i} in ${s}`);
    i += m[0].length;
    return m[0];
  };
  const value = (): unknown => {
    ws();
    const c = s[i];
    if (c === "'" || c === '"') {
      const triple = s.startsWith(c.repeat(3), i);
      const q = triple ? c.repeat(3) : c;
      i += q.length;
      let out = "";
      while (i < s.length && !s.startsWith(q, i)) {
        if (s[i] === "\\") {
          const n = s[i + 1];
          out += n === "n" ? "\n" : n === "t" ? "\t" : n === "r" ? "\r" : n;
          i += 2;
        } else out += s[i++];
      }
      i += q.length;
      return out;
    }
    if (c === "[" || c === "(") {
      const close = c === "[" ? "]" : ")";
      i++;
      const out: unknown[] = [];
      ws();
      while (s[i] !== close) {
        out.push(value());
        ws();
        if (s[i] === ",") i++;
        ws();
      }
      i++;
      return out;
    }
    if (c === "{") {
      i++;
      const out: Record<string, unknown> = {};
      ws();
      while (s[i] !== "}") {
        const k = value();
        expect(":");
        out[String(k)] = value();
        ws();
        if (s[i] === ",") i++;
        ws();
      }
      i++;
      return out;
    }
    const num = /^-?(\d+\.?\d*(e[-+]?\d+)?|\.\d+)/i.exec(s.slice(i));
    if (num) {
      i += num[0].length;
      return Number(num[0]);
    }
    const word = ident();
    if (word === "True") return true;
    if (word === "False") return false;
    if (word === "None") return null;
    throw new Error(`parsePyCall: unknown literal ${word} in ${s}`);
  };
  const name = ident();
  expect("(");
  const args: unknown[] = [];
  const kwargs: Record<string, unknown> = {};
  ws();
  while (s[i] !== ")") {
    const kw = /^([A-Za-z_]\w*)\s*=(?!=)/.exec(s.slice(i));
    if (kw) {
      i += kw[0].length;
      kwargs[kw[1]] = value();
    } else args.push(value());
    ws();
    if (s[i] === ",") i++;
    ws();
    if (i >= s.length) throw new Error(`parsePyCall: unterminated call ${s}`);
  }
  return { name, args, kwargs };
}

/** A ground-truth call as named arguments, positional ones mapped in the order of the function doc's parameters. */
export function namedCall(c: PyCall, fds: BfclFunction[]): { name: string; args: Record<string, unknown> } {
  const fd = findDescription(fds, c.name);
  const order = fd ? Object.keys(fd.parameters.properties) : [];
  const args: Record<string, unknown> = {};
  c.args.forEach((v, k) => (args[order[k] ?? `$${k}`] = v));
  return { name: c.name, args: { ...args, ...c.kwargs } };
}

/** Our multi-turn score for one turn: the same calls in the same order, strings compared as BFCL standardizes them. */
export function turnMatches(got: { name: string; args: Record<string, unknown> }[], want: { name: string; args: Record<string, unknown> }[]): boolean {
  const norm = (v: unknown): unknown => (typeof v === "string" ? standardizeString(v) : Array.isArray(v) ? v.map(norm) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, norm(x)])) : v);
  return got.length === want.length && got.every((g, i) => g.name === want[i].name && pyEqual(norm(g.args), norm(want[i].args)));
}

// ───────────────────────────── runner ─────────────────────────────

export interface OfferedTool {
  name: string;
  description: string;
  parameters: JsonSchema;
}
export interface EngineMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: { name: string; args: unknown }[];
}
export interface TurnContext {
  id: string;
  category: BfclCategory;
  turn: number;
  step: number;
}
/** What an engine returns: the calls of one assistant step (empty = it answered in text, the turn ends). */
export interface BfclEngine {
  id: string;
  step(messages: EngineMessage[], tools: OfferedTool[], ctx: TurnContext): Promise<{ name: string; args: unknown }[]>;
}
export interface BfclRow {
  id: string;
  category: BfclCategory;
  valid: boolean;
  errorType?: string;
  error?: string;
  /** The repair changed at least one call (only in repair mode). */
  repaired?: boolean;
}
export interface RunOptions {
  /** Run each call through toolRepair.repairCall before checking. */
  repair: boolean;
  /** Offer names with "." as "_" (some engines reject dots); calls are mapped back before checking. */
  underscoreToDot?: boolean;
  /** Steps an engine may take in one multi-turn turn (BFCL: 20). */
  maxSteps?: number;
  /** Multi-turn tool result. The default records the call and says it was not executed. */
  execute?: (call: { name: string; args: Record<string, unknown> }) => string;
}
export const STUB_RESULT = JSON.stringify({ note: "recorded by the Lumen BFCL harness; BFCL's Python backends are not ported, so the call was not executed" });

export interface BfclData {
  entries: BfclEntry[];
  answers: Map<string, BfclAnswer>;
  classDocs: Record<string, BfclFunction[]>;
}

/** The functions offered for an entry: its own, or (multi-turn) those of its classes minus the excluded ones. */
export function functionsOf(e: BfclEntry, classDocs: Record<string, BfclFunction[]>): BfclFunction[] {
  if (e.function) return e.function;
  const excluded = new Set(e.excluded_function ?? []);
  return (e.involved_classes ?? []).flatMap((c) => classDocs[c] ?? []).filter((f) => !excluded.has(f.name));
}

const asArgs = (raw: unknown, repair: boolean): Record<string, unknown> | null => {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === "string" && !repair) {
    try {
      const v = JSON.parse(raw);
      return v && typeof v === "object" && !Array.isArray(v) ? v : null;
    } catch {
      return null;
    }
  }
  return null;
};

/** Normalizes the engine's calls: names mapped back to BFCL's, arguments parsed, and repaired when asked. */
function normalize(calls: { name: string; args: unknown }[], fds: BfclFunction[], o: RunOptions): { calls: { name: string; args: Record<string, unknown> }[]; repaired: boolean; bad: boolean } {
  const offered = fds.map((f) => ({ f, name: o.underscoreToDot ? f.name.replace(/\./g, "_") : f.name }));
  const tools = offered.map(({ f, name }) => ({ name, description: f.description, parameters: toJsonSchema(f.parameters as BfclParam), scope: "read", run: async () => null }) as AgentTool);
  let repaired = false;
  let bad = false;
  const out = calls.map((c, k) => {
    let name = c.name;
    let args = asArgs(c.args, o.repair);
    if (o.repair) {
      const r = repairCall({ id: `c${k}`, name, args: (args ?? c.args) as Record<string, unknown> }, tools);
      if (r.repairs.length) repaired = true;
      name = r.call.name;
      args = asArgs(r.call.args, true);
    }
    if (!args) bad = true;
    const back = offered.find((x) => x.name === name)?.f.name ?? name;
    return { name: back, args: args ?? {} };
  });
  return { calls: out, repaired, bad };
}

/** One entry against an engine. */
export async function runEntry(e: BfclEntry, answer: BfclAnswer, classDocs: Record<string, BfclFunction[]>, engine: BfclEngine, o: RunOptions): Promise<BfclRow> {
  const category = categoryOf(e.id);
  const fds = functionsOf(e, classDocs);
  const tools: OfferedTool[] = fds.map((f) => ({ name: o.underscoreToDot ? f.name.replace(/\./g, "_") : f.name, description: f.description, parameters: toJsonSchema(f.parameters as BfclParam) }));
  const row: BfclRow = { id: e.id, category, valid: false };
  try {
    if (category !== "multi_turn") {
      const messages: EngineMessage[] = e.question[0].map((m) => ({ role: m.role as EngineMessage["role"], content: m.content }));
      const got = normalize(await engine.step(messages, tools, { id: e.id, category, turn: 0, step: 0 }), fds, o);
      if (o.repair) row.repaired = got.repaired;
      if (got.bad) return { ...row, errorType: "decode:args", error: "arguments are not a JSON object" };
      const output: BfclCall[] = got.calls.map((c) => ({ [c.name]: c.args }));
      const r = astCheck(category, fds, output, answer.ground_truth as BfclPossible[]);
      return { ...row, valid: r.valid, errorType: r.errorType, error: r.error };
    }
    const want = (answer.ground_truth as string[][]).map((turn) => turn.map((s) => namedCall(parsePyCall(s), fds)));
    const messages: EngineMessage[] = [];
    const exec = o.execute ?? (() => STUB_RESULT);
    let repairedAny = false;
    for (let t = 0; t < e.question.length; t++) {
      for (const m of e.question[t]) messages.push({ role: m.role as EngineMessage["role"], content: m.content });
      const gotTurn: { name: string; args: Record<string, unknown> }[] = [];
      for (let step = 0; step < (o.maxSteps ?? 20); step++) {
        const raw = await engine.step(messages, tools, { id: e.id, category, turn: t, step });
        if (!raw.length) break;
        const got = normalize(raw, fds, o);
        repairedAny ||= got.repaired;
        messages.push({ role: "assistant", content: "", toolCalls: raw });
        for (const c of got.calls) {
          gotTurn.push(c);
          messages.push({ role: "tool", content: exec(c) });
        }
      }
      if (!turnMatches(gotTurn, want[t] ?? [])) {
        return { ...row, repaired: o.repair ? repairedAny : undefined, errorType: "multi_turn:turn_mismatch", error: `turn ${t}: got ${gotTurn.map((c) => c.name).join(", ") || "no call"}, want ${(want[t] ?? []).map((c) => c.name).join(", ")}` };
      }
    }
    return { ...row, valid: true, repaired: o.repair ? repairedAny : undefined };
  } catch (err) {
    return { ...row, errorType: "engine:error", error: String((err as Error)?.message ?? err) };
  }
}

/** Every entry, in order. */
export async function runBfcl(data: BfclData, engine: BfclEngine, o: RunOptions, onRow?: (r: BfclRow) => void): Promise<BfclRow[]> {
  const rows: BfclRow[] = [];
  for (const e of data.entries) {
    const a = data.answers.get(e.id);
    if (!a) throw new Error(`bfcl: no possible answer for ${e.id}`);
    const r = await runEntry(e, a, data.classDocs, engine, o);
    rows.push(r);
    onRow?.(r);
  }
  return rows;
}

/** Per-item scores (1/0) per category, the input of a bootstrap interval. */
export function scoresByCategory(rows: BfclRow[]): Partial<Record<BfclCategory, number[]>> {
  const out: Partial<Record<BfclCategory, number[]>> = {};
  for (const r of rows) (out[r.category] ??= []).push(r.valid ? 1 : 0);
  return out;
}

/** The metric names in a card: BFCL's AST accuracy, and our multi-turn call match under its own name. */
export const METRIC: Record<BfclCategory, string> = { simple: "ast_simple", multiple: "ast_multiple", parallel: "ast_parallel", multi_turn: "multi_turn_calls" };

/** One concrete value from possible answers: the first allowed value per key, optional keys left out, nested dicts likewise. */
function materialize(possible: Record<string, unknown[]>): Record<string, unknown> {
  const pick = (v: unknown): unknown => (Array.isArray(v) ? v.map(pick) : v && typeof v === "object" ? materialize(v as Record<string, unknown[]>) : v);
  const out: Record<string, unknown> = {};
  for (const [k, vs] of Object.entries(possible)) {
    const first = vs.find((v) => v !== "");
    if (first !== undefined) out[k] = pick(first);
  }
  return out;
}

/**
 * An oracle engine from the possible answers (the first allowed value of
 * each parameter, omitting optional ones): the harness's self-test. It must
 * score 100 %, or the port disagrees with BFCL's own ground truth.
 */
export function oracleEngine(data: BfclData, mangle?: (call: { name: string; args: Record<string, unknown> }) => { name: string; args: unknown }): BfclEngine {
  const byId = new Map(data.entries.map((e) => [e.id, e]));
  return {
    id: "oracle",
    async step(_m, tools, ctx) {
      const a = data.answers.get(ctx.id) as BfclAnswer;
      const e = byId.get(ctx.id) as BfclEntry;
      const offered = (n: string) => tools.find((t) => t.name === n || t.name === n.replace(/\./g, "_"))?.name ?? n;
      let calls: { name: string; args: Record<string, unknown> }[];
      if (ctx.category === "multi_turn") {
        if (ctx.step > 0) return [];
        const fds = functionsOf(e, data.classDocs);
        calls = ((a.ground_truth as string[][])[ctx.turn] ?? []).map((s) => namedCall(parsePyCall(s), fds));
      } else {
        calls = (a.ground_truth as BfclPossible[]).map((g) => {
          const [name, params] = Object.entries(g)[0];
          return { name, args: materialize(params) as Record<string, unknown> };
        });
      }
      return calls.map((c) => (mangle ? mangle({ name: offered(c.name), args: c.args }) : { name: offered(c.name), args: c.args }));
    },
  };
}
