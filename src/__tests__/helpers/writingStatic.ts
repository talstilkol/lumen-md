/**
 * The one static check of every writing agent (plan W13.W1; joined by INT7
 * for W13.W6–W15): every file under src/agents/writing only proposes —
 * no write to a document, the store or a file, no storage, no network —
 * whichever lane wrote it. writingSuggestions.test.ts (writes) and
 * writingNoNetwork.test.ts (network) run it over the whole folder.
 *
 * W13.W1's rule, restored by F13 after review 13 (H1): an agent may import
 * its own folder (never the two editor bridges) and the modules named in
 * IMPORT_ALLOW, by full path; ANY other import is rejected. A pure helper an
 * agent needs is added to IMPORT_ALLOW by name, and `allowListProblems`
 * holds every listed module to the same rules, with its own imports also
 * listed — so the whole reachable set is named here and reviewed, never
 * inferred by walking the import graph.
 *
 * Besides write calls and the network API, the rules flag the ways around a
 * name match: `self`, `Image`, `Reflect`, `.bind`/`.call`/`.apply`, `caches`,
 * `postMessage`, `BroadcastChannel`, a computed call, and `export … from`.
 */
import ts from "typescript";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix, relative } from "node:path";

export const ROOT = join(__dirname, "../..");
export const WRITING = join(ROOT, "agents/writing");

/** The editor bridges, by full path: the only files here that change a document, and only on the user's accept. */
export const APPLIERS = new Set(["agents/writing/cmBridge.ts", "agents/writing/pmBridge.ts"]);
/** What only the bridges may import (the editors' authorship marks). Held to the network rules. */
const APPLIER_ALLOW = ["editor/aiAuthorship", "editor/wysiwygAiAuthorship", "ai/authorship", "ai/aiWrites"];
/** W13.W1's model door and types: trusted, never judged by these rules (the runtime is the AI layer). */
const TRUSTED = ["agents/types", "agents/runtime"];
/**
 * What a writing agent may import besides its own folder, by full path (src-relative, no extension).
 * W13.W1's list, then the pure helpers W13.W6–W16 need (F13). Every entry but TRUSTED passes
 * `allowListProblems`; a JSON file is data.
 */
export const IMPORT_ALLOW = [
  ...TRUSTED,
  "ai/hebrewGrammar",
  "collab/wordDiff",
  "text/hebrew",
  "book/wordCount",
  // F13: the pure helpers the W6–W16 agents import (each vetted below), and what they import in turn.
  "text/arabic",
  "text/hebrewMorph",
  "text/hebrewPrefix",
  "text/outlineCore",
  "text/translit",
  "ai/hebrewFreqKnown",
  "ai/paragraphAnchors",
  "ai/summarizeCore",
  "renderer/remarkBlockIds",
  "argument/argumentMap",
  "entities/resolve",
  "reading/wordDiffBidi",
  "agents/registry",
  "agents/defs/shared",
  "agents/defs/claimExtractor",
  "agents/cite/gate",
  "agents/cite/align",
  "ai/modelCatalog",
  "ai/defaults",
  "ai/defaultSelection",
];
/** Calls that change a document, the store or a file. */
const WRITE_CALLS = new Set(["dispatch", "update", "setContent", "writeAiContent", "insertText", "replaceWith", "replaceRangeWith", "writeFile", "writeTextFile", "writeBinaryFile", "saveFile", "saveNote", "writeNote", "createFile", "openTab", "invoke", "updateDoc", "setState", "appendFile", "rename", "remove", "unlink", "mkdir"]);
/** Globals and escapes no agent names, for either rule: storage, the store, a way to call by alias or reach a global. */
const GLOBAL_IDS = ["useAppStore", "globalThis", "window", "self", "document", "localStorage", "sessionStorage", "indexedDB", "caches", "require", "Reflect", "Function", "eval"];
/**
 * Review 14 M1: the window's other names and what reaches the network or a page from them (`top.fetch`,
 * `parent.localStorage`, `frames[0]`, `opener`, `location.assign`, `open(…)`, `new Audio(url)`, `new Option`).
 * They are ordinary words too (`const top = …`), so a name declared in an enclosing scope is the local, not the global.
 */
const WINDOW_IDS = new Set(["top", "parent", "frames", "opener", "location", "open", "Audio", "Option"]);
/** Methods whose bare read is a write by alias (`const d = v.dispatch; d(t)`). */
const WRITE_READS = new Set(["dispatch", "update"]);
/** Calling a function by alias: `.bind`, `.call`, `.apply`. */
const ALIAS_CALLS = new Set(["bind", "call", "apply"]);

const NET_IDS = new Set(["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "sendBeacon", "Worker", "SharedWorker", "importScripts", "RTCPeerConnection", "navigator", "Image", "postMessage", "BroadcastChannel", "self", "globalThis", "window", "caches", "Reflect"]);
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

/** The modules of src on disk. */
export const diskModules: ModuleLoader = (mod) => {
  for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    const p = join(ROOT, mod + ext);
    if (existsSync(p) && statSync(p).isFile()) return { file: relative(ROOT, p), text: readFileSync(p, "utf8") };
  }
  return null;
};

const parse = (file: string, src: string) => ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

/** A relative import's target, src-relative without extension or /index. */
function targetOf(file: string, spec: string): string {
  return posix.normalize(posix.join(posix.dirname(file), spec)).replace(/\.tsx?$/, "").replace(/\/index$/, "");
}

/** Is this import allowed for `file`? Returns why not, or null. */
function importProblem(file: string, spec: string, typeOnly: boolean): string | null {
  // Review 14 M1: `../ai/llm.ts?x.json` is code, whatever its suffix says; a query or a fragment is never a plain module.
  if (/[?#]/.test(spec)) return `imports ${spec} (a query or fragment in the spec)`;
  if (!spec.startsWith(".")) return typeOnly ? null : `imports the package ${spec}`;
  const target = targetOf(file, spec);
  if (/\.json$/.test(target)) return null; // data: nothing to run
  if (APPLIERS.has(`${target}.ts`)) return APPLIERS.has(file) || typeOnly ? null : `imports the editor bridge ${spec}`;
  if (target.startsWith("agents/writing/") && file.startsWith("agents/writing/")) return null;
  if (typeOnly) return null;
  if (IMPORT_ALLOW.includes(target)) return null;
  if (APPLIERS.has(file) && APPLIER_ALLOW.includes(target)) return null;
  return `imports ${spec} (not in the allow-list)`;
}

/** Every import declaration, re-export and dynamic import in a file, with whether it is type-only. */
function importsOf(sf: ts.SourceFile): { spec: string; node: ts.Node; typeOnly: boolean }[] {
  const out: { spec: string; node: ts.Node; typeOnly: boolean }[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) out.push({ spec: n.moduleSpecifier.text, node: n, typeOnly: !!n.importClause?.isTypeOnly });
    if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) out.push({ spec: n.moduleSpecifier.text, node: n, typeOnly: n.isTypeOnly });
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) out.push({ spec: n.arguments[0].text, node: n, typeOnly: false });
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** Every direct write, forbidden global or forbidden import in these sources (path → text), as `file:line what`. */
export function directWritesIn(sources: ReadonlyMap<string, string>): string[] {
  const out: string[] = [];
  for (const [file, src] of sources) {
    if (APPLIERS.has(file)) continue;
    const sf = parse(file, src);
    const at = (n: ts.Node) => `${file}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
    for (const { spec, node, typeOnly } of importsOf(sf)) {
      const why = importProblem(file, spec, typeOnly);
      if (why) out.push(`${at(node)} ${why}`);
    }
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) {
        const e = n.expression;
        if (e.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && !ts.isStringLiteral(n.arguments[0])) out.push(`${at(n)} dynamic import of a computed module`);
        const name = ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : ts.isElementAccessExpression(e) ? "[computed]" : null;
        if (name && WRITE_CALLS.has(name)) out.push(`${at(n)} ${name}(…)`);
        if (name === "[computed]") out.push(`${at(n)} computed call`);
        // Review 14 M1: `(0, v.dispatch)(t)`, `(a || b)(t)`: a call whose callee is not a name, a property or a function written there (an IIFE).
        if (ts.isParenthesizedExpression(e) && !ts.isIdentifier(stripped(e)) && !ts.isPropertyAccessExpression(stripped(e)) && !ts.isArrowFunction(stripped(e)) && !ts.isFunctionExpression(stripped(e))) out.push(`${at(n)} indirect call`);
      }
      if (ts.isPropertyAccessExpression(n) && WRITE_READS.has(n.name.text) && !(ts.isCallExpression(n.parent) && n.parent.expression === n)) out.push(`${at(n)} reads .${n.name.text}`);
      if (ts.isMetaProperty(n) && n.keywordToken === ts.SyntaxKind.ImportKeyword) out.push(`${at(n)} import.meta`);
      if (ts.isPropertyAccessExpression(n) && ALIAS_CALLS.has(n.name.text)) out.push(`${at(n)} .${n.name.text}`);
      if (ts.isIdentifier(n) && GLOBAL_IDS.includes(n.text) && !isPropertyName(n)) out.push(`${at(n)} uses ${n.text}`);
      if (ts.isIdentifier(n) && isWindowGlobal(n)) out.push(`${at(n)} uses ${n.text}`);
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}

/** The expression inside parentheses, `as`, `!` and `satisfies`. */
function stripped(e: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e) || ts.isSatisfiesExpression(e) || ts.isTypeAssertionExpression(e)) e = e.expression;
  return e;
}

/** Is `name` declared by this node itself (a parameter, a variable, a function, a class, an import or a catch binding)? */
function declares(node: ts.Node, name: string): boolean {
  const inBinding = (b: ts.BindingName): boolean => (ts.isIdentifier(b) ? b.text === name : b.elements.some((el) => !ts.isOmittedExpression(el) && inBinding(el.name)));
  const inList = (l: ts.VariableDeclarationList) => l.declarations.some((d) => inBinding(d.name));
  if (ts.isFunctionLike(node)) {
    if (node.parameters.some((p) => inBinding(p.name))) return true;
    if ((ts.isFunctionExpression(node) || ts.isClassExpression(node as ts.Node)) && node.name && ts.isIdentifier(node.name) && node.name.text === name) return true;
  }
  if (ts.isCatchClause(node) && node.variableDeclaration && inBinding(node.variableDeclaration.name)) return true;
  if ((ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node)) && node.initializer && ts.isVariableDeclarationList(node.initializer) && inList(node.initializer)) return true;
  if (ts.isSourceFile(node) || ts.isBlock(node) || ts.isModuleBlock(node) || ts.isCaseClause(node) || ts.isDefaultClause(node)) {
    for (const st of node.statements) {
      if (ts.isVariableStatement(st) && inList(st.declarationList)) return true;
      if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isEnumDeclaration(st)) && st.name?.text === name) return true;
      if (ts.isImportDeclaration(st) && st.importClause) {
        const c = st.importClause;
        if (c.name?.text === name) return true;
        const nb = c.namedBindings;
        if (nb && (ts.isNamespaceImport(nb) ? nb.name.text === name : nb.elements.some((el) => el.name.text === name))) return true;
      }
    }
  }
  return false;
}

/** One of WINDOW_IDS used as the global: not a property name, not a declaration's own name, not declared in an enclosing scope. */
function isWindowGlobal(n: ts.Identifier): boolean {
  if (!WINDOW_IDS.has(n.text) || isPropertyName(n)) return false;
  const p = n.parent;
  if ((ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isBindingElement(p) || ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p)|| ts.isImportSpecifier(p)) && (p as { name?: ts.Node }).name === n) return false;
  if (ts.isBindingElement(p) && p.propertyName === n) return false;
  for (let a: ts.Node | undefined = p; a; a = a.parent) if (declares(a, n.text)) return false;
  return true;
}

/** `x.window` or `{ window: 1 }`: a property name, not the global. */
function isPropertyName(n: ts.Identifier): boolean {
  const p = n.parent;
  return (ts.isPropertyAccessExpression(p) && p.name === n) || (ts.isPropertyAssignment(p) && p.name === n) || (ts.isPropertySignature(p) && p.name === n);
}

/** Every network use in these sources (path → text), as `file:line what`. Imports outside the allow-list are reported too. */
export function networkUsesIn(sources: ReadonlyMap<string, string>): string[] {
  const out: string[] = [];
  for (const [file, src] of sources) {
    const sf = parse(file, src);
    const at = (n: ts.Node) => `${file}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
    for (const { spec, node, typeOnly } of importsOf(sf)) {
      if (typeOnly) continue;
      if (NET_MODULES.some((re) => re.test(spec))) out.push(`${at(node)} imports ${spec}`);
      else if (spec.startsWith(".") && !APPLIER_ALLOW.includes(targetOf(file, spec))) {
        const why = importProblem(file, spec, false);
        if (why && !why.startsWith("imports the editor bridge")) out.push(`${at(node)} ${why}`);
      }
    }
    const visit = (n: ts.Node): void => {
      if (ts.isIdentifier(n) && NET_IDS.has(n.text) && !isPropertyName(n)) out.push(`${at(n)} ${n.text}`);
      if (ts.isIdentifier(n) && isWindowGlobal(n)) out.push(`${at(n)} ${n.text}`);
      if (ts.isMetaProperty(n) && n.keywordToken === ts.SyntaxKind.ImportKeyword) out.push(`${at(n)} import.meta`);
      if (ts.isPropertyAccessExpression(n) && ["sendBeacon", "postMessage"].includes(n.name.text)) out.push(`${at(n)} .${n.name.text}`);
      if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n)) && /\b(?:https?|wss?):\/\/|^\/\/[\w.-]/.test(n.text)) out.push(`${at(n)} URL ${n.text.slice(0, 40)}`);
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}

/**
 * Every listed module (IMPORT_ALLOW but TRUSTED, and the bridges' APPLIER_ALLOW for the network rule)
 * held to the rules, with its own imports also listed. [] = the allow-list is closed and clean.
 */
export function allowListProblems(load: ModuleLoader = diskModules): string[] {
  const out = new Set<string>();
  for (const mod of [...IMPORT_ALLOW, ...APPLIER_ALLOW]) {
    if (TRUSTED.includes(mod)) continue;
    const m = load(mod);
    if (!m) {
      out.add(`${mod}: not found`);
      continue;
    }
    const one = new Map([[m.file, m.text]]);
    if (IMPORT_ALLOW.includes(mod)) {
      // A listed helper is judged as if it sat in the agents' folder: the same imports, calls and globals.
      for (const p of [...directWritesIn(one), ...networkUsesIn(one)]) out.add(p);
    } else {
      // What the bridges import: the network rule, and its own imports listed too.
      for (const p of networkUsesIn(one)) out.add(p);
      for (const { spec, typeOnly } of importsOf(parse(m.file, m.text))) {
        const t = spec.startsWith(".") ? targetOf(m.file, spec) : null;
        if (t && !typeOnly && !IMPORT_ALLOW.includes(t) && !APPLIER_ALLOW.includes(t)) out.add(`${m.file} imports ${spec} (not in the allow-list)`);
      }
    }
  }
  return [...out];
}
