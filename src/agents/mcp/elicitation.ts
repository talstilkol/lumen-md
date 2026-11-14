/**
 * Elicitation for the MCP client (plan W7.18, W10.C1/C2), per the 2026-07-28
 * spec (client/elicitation): a server asks the user through an
 * `input_required` result (MRTR); the client answers `accept`, `decline` or
 * `cancel` on the retry.
 *
 * What the client MUST do, and where it is done:
 *   • Show which server asks: `ElicitationAsk.server` (the dialog's title).
 *   • Offer decline and cancel: both buttons, and Escape is cancel.
 *   • Form mode: the user reviews and edits every answer before it is sent
 *     (the dialog's fields; `validateForm` checks them against the schema).
 *   • URL mode: show the full URL and its host (`describeUrl`), never fetch
 *     it or anything about it (no link, no image, no preview: the dialog shows
 *     text), never open it without consent, and open it where neither Lumen
 *     nor the model can read the page (the system browser: `mcp_open_url`
 *     on the desktop, a new top-level tab without an opener on the web).
 *   • Warn on Punycode and on look-alike hosts (`describeUrl().warnings`).
 *
 * Form mode may not ask for secrets (the spec forbids servers to). A field
 * that looks like a password, key or token is not shown as a field: the
 * dialog refuses to send it and says why (`secretFields`).
 */

export type ElicitationAction = "accept" | "decline" | "cancel";

export interface ElicitationResult {
  action: ElicitationAction;
  content?: Record<string, string | number | boolean | string[]>;
}

export interface FormField {
  key: string;
  type: "string" | "number" | "integer" | "boolean" | "enum" | "multi";
  title: string;
  description?: string;
  required: boolean;
  format?: "email" | "uri" | "date" | "date-time";
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  options?: Array<{ value: string; label: string }>;
  default?: string | number | boolean | string[];
}

export type ElicitationRequest =
  | { mode: "form"; message: string; fields: FormField[] }
  | { mode: "url"; message: string; url: string; elicitationId?: string };

export interface ElicitationAsk {
  /** The server's label as the user named it (never the server's own claim about itself). */
  server: string;
  /** The key of this request in `inputRequests`. */
  key: string;
  request: ElicitationRequest;
}

export type ElicitationHandler = (ask: ElicitationAsk) => Promise<ElicitationResult>;

export class ElicitationError extends Error {}

const MAX_TEXT = 2000;
const clip = (s: unknown, n = MAX_TEXT): string => (typeof s === "string" ? s : "").slice(0, n);

function optionsOf(list: unknown, key: "const"): Array<{ value: string; label: string }> | null {
  if (!Array.isArray(list)) return null;
  const out: Array<{ value: string; label: string }> = [];
  for (const o of list.slice(0, 100)) {
    if (o && typeof o === "object" && typeof (o as Record<string, unknown>)[key] === "string") {
      const v = (o as Record<string, unknown>)[key] as string;
      out.push({ value: v, label: clip((o as Record<string, unknown>).title, 200) || v });
    }
  }
  return out;
}

/** One property of a form schema (flat, primitive only), or null when the spec does not allow it. */
function fieldOf(key: string, raw: unknown, required: boolean): FormField | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const base = { key, title: clip(p.title, 200) || key, ...(typeof p.description === "string" ? { description: clip(p.description, 500) } : {}), required };
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  if (p.type === "boolean") return { ...base, type: "boolean", ...(typeof p.default === "boolean" ? { default: p.default } : {}) };
  if (p.type === "number" || p.type === "integer") {
    return { ...base, type: p.type, minimum: num(p.minimum), maximum: num(p.maximum), ...(num(p.default) !== undefined ? { default: num(p.default) } : {}) };
  }
  if (p.type === "string") {
    const options = Array.isArray(p.enum) ? p.enum.filter((x): x is string => typeof x === "string").slice(0, 100).map((v) => ({ value: v, label: v })) : optionsOf(p.oneOf, "const");
    if (options && options.length) return { ...base, type: "enum", options, ...(typeof p.default === "string" ? { default: p.default } : {}) };
    const format = p.format === "email" || p.format === "uri" || p.format === "date" || p.format === "date-time" ? p.format : undefined;
    return { ...base, type: "string", format, minLength: num(p.minLength), maxLength: num(p.maxLength), ...(typeof p.default === "string" ? { default: p.default } : {}) };
  }
  if (p.type === "array" && p.items && typeof p.items === "object") {
    const items = p.items as Record<string, unknown>;
    const options = Array.isArray(items.enum) ? items.enum.filter((x): x is string => typeof x === "string").map((v) => ({ value: v, label: v })) : optionsOf(items.anyOf, "const");
    if (!options || !options.length) return null;
    const def = Array.isArray(p.default) ? p.default.filter((x): x is string => typeof x === "string") : undefined;
    return { ...base, type: "multi", options, minItems: num(p.minItems), maxItems: num(p.maxItems), ...(def ? { default: def } : {}) };
  }
  return null;
}

/** Parse the `params` of an `elicitation/create` input request. Throws on what the spec does not allow. */
export function parseElicitation(params: unknown): ElicitationRequest {
  if (!params || typeof params !== "object") throw new ElicitationError("the request has no parameters");
  const p = params as Record<string, unknown>;
  const message = clip(p.message);
  const mode = p.mode === undefined ? "form" : p.mode; // a request without a mode is form mode (spec)
  if (mode === "url") {
    if (typeof p.url !== "string" || !describeUrl(p.url).valid) throw new ElicitationError("the request's url is not a valid http(s) address");
    return { mode: "url", message, url: p.url, ...(typeof p.elicitationId === "string" ? { elicitationId: p.elicitationId } : {}) };
  }
  if (mode !== "form") throw new ElicitationError(`unknown elicitation mode "${String(mode).slice(0, 40)}"`);
  const schema = (p.requestedSchema && typeof p.requestedSchema === "object" ? p.requestedSchema : { type: "object", properties: {} }) as Record<string, unknown>;
  const props = schema.properties && typeof schema.properties === "object" ? (schema.properties as Record<string, unknown>) : {};
  const required = new Set(Array.isArray(schema.required) ? schema.required.filter((x): x is string => typeof x === "string") : []);
  const fields: FormField[] = [];
  for (const [k, v] of Object.entries(props).slice(0, 40)) {
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(k)) throw new ElicitationError("a field name is not plain");
    const f = fieldOf(k, v, required.has(k));
    if (!f) throw new ElicitationError(`the field "${k}" is not a flat primitive (the spec allows only those)`);
    fields.push(f);
  }
  return { mode: "form", message, fields };
}

const SECRET = /(pass(word|phrase|code)?|secret|token|api[_-]?key|apikey|private[_-]?key|credential|otp|pin|cvv|cvc|card[_-]?number|iban|ssn)/i;

/** Form fields that ask for a secret (the spec forbids it in form mode): not shown, not sent. */
export function secretFields(fields: readonly FormField[]): string[] {
  return fields.filter((f) => SECRET.test(f.key) || SECRET.test(f.title)).map((f) => f.key);
}

/** The form's starting values: the schema's defaults (spec: clients SHOULD pre-populate them). */
export function initialValues(fields: readonly FormField[]): Record<string, string | number | boolean | string[]> {
  const out: Record<string, string | number | boolean | string[]> = {};
  for (const f of fields) {
    if (f.default !== undefined) out[f.key] = f.default;
    else if (f.type === "boolean") out[f.key] = false;
    else if (f.type === "multi") out[f.key] = [];
    else out[f.key] = "";
  }
  return out;
}

/** Errors by field key (empty when the answers may be sent), and the content to send. */
export function validateForm(fields: readonly FormField[], values: Record<string, unknown>): { errors: Record<string, string>; content: Record<string, string | number | boolean | string[]> } {
  const errors: Record<string, string> = {};
  const content: Record<string, string | number | boolean | string[]> = {};
  for (const f of fields) {
    const v = values[f.key];
    const empty = v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
    if (empty) {
      if (f.required && f.type !== "boolean") errors[f.key] = "required";
      if (f.type === "boolean") content[f.key] = false; // an unticked box is an answer: false
      continue;
    }
    if (f.type === "boolean") content[f.key] = v === true;
    else if (f.type === "number" || f.type === "integer") {
      const n = typeof v === "number" ? v : Number(String(v).trim());
      if (!Number.isFinite(n) || (f.type === "integer" && !Number.isInteger(n))) errors[f.key] = f.type === "integer" ? "integer" : "number";
      else if (f.minimum !== undefined && n < f.minimum) errors[f.key] = "min";
      else if (f.maximum !== undefined && n > f.maximum) errors[f.key] = "max";
      else content[f.key] = n;
    } else if (f.type === "enum") {
      if (!f.options?.some((o) => o.value === v)) errors[f.key] = "choice";
      else content[f.key] = String(v);
    } else if (f.type === "multi") {
      const list = Array.isArray(v) ? v.map(String) : [];
      if (list.some((x) => !f.options?.some((o) => o.value === x))) errors[f.key] = "choice";
      else if (f.minItems !== undefined && list.length < f.minItems) errors[f.key] = "min";
      else if (f.maxItems !== undefined && list.length > f.maxItems) errors[f.key] = "max";
      else content[f.key] = list;
    } else {
      const s = String(v);
      if (f.minLength !== undefined && s.length < f.minLength) errors[f.key] = "short";
      else if (f.maxLength !== undefined && s.length > f.maxLength) errors[f.key] = "long";
      else if (f.format === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) errors[f.key] = "email";
      else if (f.format === "uri" && !/^[a-z][a-z0-9+.-]*:\S+$/i.test(s)) errors[f.key] = "uri";
      else if (f.format === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(s)) errors[f.key] = "date";
      else if (f.format === "date-time" && Number.isNaN(Date.parse(s))) errors[f.key] = "date";
      else content[f.key] = s;
    }
  }
  return { errors, content };
}

export interface UrlView {
  valid: boolean;
  /** The URL exactly as the server sent it. */
  full: string;
  scheme: string;
  /** The host as written in the URL (lowercase; Punycode stays Punycode). */
  host: string;
  /** The part to highlight: the last two labels (three when the second-level label is a known one, like co.il). */
  domain: string;
  /** The host's labels before `domain`. */
  subdomain: string;
  warnings: Array<"punycode" | "not-https" | "ip-address" | "userinfo" | "mixed-script" | "long-host">;
}

const SECOND_LEVEL = new Set(["co", "ac", "org", "gov", "net", "com", "edu", "muni", "k12", "idf"]);

/** What the dialog shows about a URL. Never fetches anything. */
export function describeUrl(raw: string): UrlView {
  const empty: UrlView = { valid: false, full: String(raw ?? "").slice(0, 4000), scheme: "", host: "", domain: "", subdomain: "", warnings: [] };
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return empty;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { ...empty, scheme: u.protocol.replace(/:$/, "") };
  // URL() turns Unicode hosts into Punycode, so a look-alike shows as xn--: say so.
  const host = u.hostname.toLowerCase();
  const labels = host.split(".").filter(Boolean);
  const ip = /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.startsWith("[");
  let n = 2;
  if (!ip && labels.length >= 3 && SECOND_LEVEL.has(labels[labels.length - 2]!) && labels[labels.length - 1]!.length === 2) n = 3;
  const domain = ip ? host : labels.slice(-n).join(".");
  const subdomain = ip ? "" : labels.slice(0, Math.max(0, labels.length - n)).join(".");
  const warnings: UrlView["warnings"] = [];
  if (labels.some((l) => l.startsWith("xn--"))) warnings.push("punycode");
  if (u.protocol !== "https:") warnings.push("not-https");
  if (ip) warnings.push("ip-address");
  if (u.username || u.password || /^[a-z]+:\/\/[^/]*@/i.test(raw)) warnings.push("userinfo");
  // The raw text had non-ASCII letters in its host part (shown before URL() converted it).
  const rawHost = /^[a-z]+:\/\/([^/?#]*)/i.exec(raw)?.[1] ?? "";
  if (/[^\x00-\x7F]/.test(rawHost) && !warnings.includes("punycode")) warnings.push("mixed-script");
  if (host.length > 80 || labels.length > 6) warnings.push("long-host");
  return { valid: true, full: raw, scheme: u.protocol.replace(/:$/, ""), host, domain, subdomain, warnings };
}

/**
 * Open an elicitation URL where neither Lumen nor the model can read the
 * page: the system browser on the desktop; a new top-level browsing context
 * without an opener or referrer on the web. Call only after the user said yes.
 */
export async function openElicitationUrl(url: string, o: { invoke?: (cmd: string, args: Record<string, unknown>) => Promise<unknown>; open?: (url: string) => void } = {}): Promise<void> {
  const view = describeUrl(url);
  if (!view.valid) throw new ElicitationError("not an http(s) address");
  const tauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  if (o.invoke || tauri) {
    const inv = o.invoke ?? ((await import("@tauri-apps/api/core")).invoke as (cmd: string, args: Record<string, unknown>) => Promise<unknown>);
    await inv("mcp_open_url", { url });
    return;
  }
  (o.open ?? ((u: string) => void window.open(u, "_blank", "noopener,noreferrer")))(url);
}
