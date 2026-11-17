/**
 * The one static check of every writing agent (plan W13.W1; joined by INT7
 * for W13.W6–W15): every file under src/agents/writing only proposes —
 * no write to a document, the store or a file, no storage, no network —
 * whichever lane wrote it. writingSuggestions.test.ts (writes) and
 * writingNoNetwork.test.ts (network) run it over the whole folder.
 *
 * An agent may import its own folder and the modules in IMPORT_ALLOW. Any
 * other module of the app is accepted only when it, and everything it
 * imports in turn (to the bottom, with the same rules: no package, no
 * write call, no global), passes the same check — so a pure helper such as
 * ai/paragraphAnchors is fine and anything that reaches storage, the store
 * or the network is reported with the chain that leads there. IMPORT_ALLOW
 * itself is unchanged from W13.W1.
 */
import ts from "typescript";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix, relative } from "node:path";

export const ROOT = join(__dirname, "../..");
export const WRITING = join(ROOT, "agents/writing");

/** The editor bridges: the only files here that change a document, and only on the user's accept. */
const APPLIERS = new Set(["cmBridge.ts", "pmBridge.ts"]);
/** What a writing agent may import (besides its own folder, minus the appliers). */
const IMPORT_ALLOW = ["agents/types", "agents/runtime", "ai/hebrewGrammar", "collab/wordDiff", "text/hebrew", "book/wordCount"];
/** Calls that change a document, the store or a file. */
const WRITE_CALLS = new Set(["dispatch", "setContent", "writeAiContent", "insertText", "replaceWith", "replaceRangeWith", "writeFile", "writeTextFile", "writeBinaryFile", "saveFile", "saveNote", "writeNote", "createFile", "openTab", "invoke", "updateDoc", "setState", "appendFile", "rename", "remove", "unlink", "mkdir"]);

const NET_IDS = new Set(["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "sendBeacon", "Worker", "SharedWorker", "importScripts", "RTCPeerConnection", "navigator"]);
const NET_MODULES = [/(^|\/)ai\/llm$/, /(^|\/)ai\/(?:anthropic|gemini|mistral|openai)Provider$/, /^node:(?:http|https|net|dgram|tls)$/, /^(?:axios|ky|got|node-fetch|undici)$/, /(^|\/)lib\/net/, /(^|\/)plugin-http$/];

export function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? tsFiles(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
}

/** Every file of the writing agents, as path (relative to src) → text. */
export function writingSources(): Map<string, string> {
  return new Map(tsFiles(WRITING).map((f) => [relative(ROOT, f), readFileSync(f, "utf8")]));
}

/** Reads a module of src by its path without extension (`ai/paragraphAnchors`): its file and text, or null. */
export type ModuleLoader = (mod: string) => { file: string; text: string } | null;

/** The modules of src on disk. JSON is data (nothing to run): read as an empty module. */
export const diskModules: ModuleLoader = (mod) => {
  for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx", ""]) {
    const p = join(ROOT, mod + ext);
    if (existsSync(p) && statSync(p).isFile()) return { file: relative(ROOT, p), text: /\.json$/.test(p) ? "" : /\.tsx?$/.test(p) ? readFileSync(p, "utf8") : "<not code>" };
  }
  return null;
};

function typeOnlyImport(n: ts.Node): boolean {
  return ts.isImportDeclaration(n) && !!n.importClause?.isTypeOnly;
}

const verdicts = new Map<string, string | null>();

/**
 * Why a module imported from a writing agent fails the check (null = it and all it imports pass).
 * `what` = "writes": the direct-write rules; "network": the network rules. Cycles count as passing.
 */
export function moduleProblem(mod: string, load: ModuleLoader, what: "writes" | "network", seen = new Set<string>()): string | null {
  const key = `${what}:${mod}`;
  if (verdicts.has(key) && load === diskModules) return verdicts.get(key)!;
  if (seen.has(mod)) return null;
  seen.add(mod);
  const m = load(mod);
  let why: string | null;
  if (!m) why = `${mod}: not found`;
  else if (m.text === "<not code>") why = `${mod}: not a module`;
  else {
    const own = what === "writes" ? directWritesIn(new Map([[m.file, m.text]]), undefined, true) : networkUsesIn(new Map([[m.file, m.text]]));
    const first = own.find((p) => !/ imports \.|\(chain\)$/.test(p));
    why = first ? `${first}` : null;
    if (!why) {
      for (const spec of relativeImports(m.file, m.text)) {
        const target = posix.normalize(posix.join(posix.dirname(m.file), spec)).replace(/\.tsx?$/, "").replace(/\/index$/, "");
        if (IMPORT_ALLOW.includes(target)) continue;
        const sub = moduleProblem(target, load, what, seen);
        if (sub) {
          why = `${mod} → ${sub}`;
          break;
        }
      }
    }
  }
  if (load === diskModules) verdicts.set(key, why);
  return why;
}

/** The relative modules a file imports at run time (type-only imports left out). */
function relativeImports(file: string, src: string): string[] {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && !n.importClause?.isTypeOnly) out.push(n.moduleSpecifier.text);
    if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier) && !n.isTypeOnly) out.push(n.moduleSpecifier.text);
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) out.push(n.arguments[0].text);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out.filter((s) => s.startsWith("."));
}

/**
 * Every direct write or forbidden import in these sources (path → text), as `file:line what`.
 * With `dep`, the sources are a module an agent imports: its relative imports are followed by `moduleProblem`, not judged here.
 */
export function directWritesIn(sources: ReadonlyMap<string, string>, load?: ModuleLoader, dep = false): string[] {
  const out: string[] = [];
  for (const [file, src] of sources) {
    const base = file.split("/").pop()!;
    if (APPLIERS.has(base)) continue;
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const at = (n: ts.Node) => `${file}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
    const checkSpec = (spec: string, n: ts.Node, typeOnly: boolean) => {
      if (spec.startsWith(".")) {
        if (dep) return;
        const target = posix.normalize(posix.join(posix.dirname(file), spec));
        if (target.startsWith("agents/writing/")) {
          if (APPLIERS.has(`${posix.basename(target).replace(/\.tsx?$/, "")}.ts`) && !typeOnly) out.push(`${at(n)} imports the editor bridge ${spec}`);
          return;
        }
        if (typeOnly) return;
        if (IMPORT_ALLOW.includes(target)) return;
        // Outside the allow-list: accepted only when the module and all it imports pass the same check (read from `load`).
        const why = load ? moduleProblem(target, load, "writes") : "not in the allow-list";
        if (why) out.push(`${at(n)} imports ${spec} (${why})`);
        return;
      }
      if (!typeOnly) out.push(`${at(n)} imports the package ${spec}`);
    };
    const visit = (n: ts.Node): void => {
      if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) checkSpec(n.moduleSpecifier.text, n, !!n.importClause?.isTypeOnly);
      if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) checkSpec(n.moduleSpecifier.text, n, n.isTypeOnly);
      if (ts.isCallExpression(n)) {
        const e = n.expression;
        if (e.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) checkSpec(n.arguments[0].text, n, false);
        if (e.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && !ts.isStringLiteral(n.arguments[0])) out.push(`${at(n)} dynamic import of a computed module`);
        const name = ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : ts.isElementAccessExpression(e) ? "[computed]" : null;
        if (name && WRITE_CALLS.has(name)) out.push(`${at(n)} ${name}(…)`);
        if (name === "[computed]") out.push(`${at(n)} computed call`);
      }
      if (ts.isIdentifier(n) && ["useAppStore", "globalThis", "window", "document", "localStorage", "indexedDB", "require"].includes(n.text)) out.push(`${at(n)} uses ${n.text}`);
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}

/** Every network use in these sources (path → text), as `file:line what`. */
export function networkUsesIn(sources: ReadonlyMap<string, string>, load?: ModuleLoader): string[] {
  const out: string[] = [];
  for (const [file, src] of sources) {
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const at = (n: ts.Node) => `${file}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
    const visit = (n: ts.Node): void => {
      if (ts.isIdentifier(n) && NET_IDS.has(n.text)) out.push(`${at(n)} ${n.text}`);
      if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n)) && /\b(?:https?|wss?):\/\//.test(n.text)) out.push(`${at(n)} URL ${n.text.slice(0, 40)}`);
      const spec = ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && !n.importClause?.isTypeOnly ? n.moduleSpecifier.text : ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteral(n.arguments[0]) ? n.arguments[0].text : null;
      if (spec && NET_MODULES.some((re) => re.test(spec))) out.push(`${at(n)} imports ${spec}`);
      else if (spec && load && spec.startsWith(".") && !typeOnlyImport(n)) {
        const target = posix.normalize(posix.join(posix.dirname(file), spec));
        const why = target.startsWith("agents/writing/") || IMPORT_ALLOW.includes(target) ? null : moduleProblem(target, load, "network");
        if (why) out.push(`${at(n)} imports ${spec} (${why})`);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}
