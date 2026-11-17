#!/usr/bin/env node
/**
 * The plugin API reference, generated from the types (plan W13.D3):
 * src/plugins/runtime/lumenApi.ts → docs/src/content/docs/plugins/api-v<N>.md
 * (and the Hebrew twin), one page per apiVersion in PLUGIN_API_VERSIONS.
 *
 * Read with the TypeScript compiler's own parser (the AST of tsc; TypeDoc is
 * for the Mac). Every method must have a doc comment, `@capability`,
 * `@since` and an `@example`; a missing one fails the build. A method with
 * `@deprecated … removed in apiVersion <N>` is marked as such and leaves the
 * pages of version N on.
 *
 *   node scripts/plugin-api-docs.mjs           write the pages
 *   node scripts/plugin-api-docs.mjs --check   fail when a method is undocumented or a page is stale
 */
import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const SOURCE = "src/plugins/runtime/lumenApi.ts";

function loadTs() {
  const req = createRequire(import.meta.url);
  for (const p of ["typescript", "/opt/npm-tools/node_modules/typescript"]) {
    try {
      return req(p);
    } catch {
      /* why: not installed here; try the next place */
    }
  }
  throw new Error("plugin-api-docs: the typescript package is needed");
}

const tagText = (t) => (typeof t.comment === "string" ? t.comment : (t.comment ?? []).map((c) => c.text ?? "").join("")).trim();

/** Parse the API source: { versions, members: [{ path, signature, doc, capability, since, example, deprecated, removedIn }] }. */
export function readApi(sourceText, ts = loadTs()) {
  const sf = ts.createSourceFile("lumenApi.ts", sourceText, ts.ScriptTarget.Latest, true);
  const ifaces = new Map();
  let versions = [];
  for (const st of sf.statements) {
    if (ts.isInterfaceDeclaration(st)) ifaces.set(st.name.text, st);
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (d.name.getText(sf) === "PLUGIN_API_VERSIONS") versions = [...d.initializer.getText(sf).matchAll(/\d+/g)].map((m) => Number(m[0]));
      }
    }
  }
  const members = [];
  const describe = (m, path) => {
    const docs = ts.getJSDocCommentsAndTags(m).filter(ts.isJSDoc);
    const jd = docs[docs.length - 1];
    const tags = jd?.tags ?? [];
    const tag = (n) => tags.find((t) => t.tagName.text === n);
    const doc = jd ? (typeof jd.comment === "string" ? jd.comment : (jd.comment ?? []).map((c) => c.text ?? "").join("")).trim() : "";
    const example = tag("example") ? tagText(tag("example")).replace(/^\n+|\n+$/g, "") : "";
    const deprecated = tag("deprecated") ? tagText(tag("deprecated")) : null;
    const removedIn = deprecated ? Number(/removed in apiVersion (\d+)/i.exec(deprecated)?.[1] ?? NaN) : NaN;
    let signature = m.getText(sf).replace(/\/\*\*[\s\S]*?\*\/\s*/g, "").replace(/\s+/g, " ").replace(/;$/, "").trim();
    members.push({ path, signature, doc, capability: tag("capability") ? tagText(tag("capability")) : "", since: tag("since") ? Number(tagText(tag("since"))) : NaN, example, deprecated, removedIn: Number.isNaN(removedIn) ? null : removedIn });
  };
  const root = ifaces.get("LumenApi");
  if (!root) throw new Error("plugin-api-docs: no interface LumenApi");
  for (const m of root.members) {
    const name = m.name?.getText(sf);
    const typeName = ts.isPropertySignature(m) && m.type && ts.isTypeReferenceNode(m.type) ? m.type.typeName.getText(sf) : null;
    if (typeName && ifaces.has(typeName)) {
      for (const mm of ifaces.get(typeName).members) describe(mm, `${name}.${mm.name.getText(sf)}`);
    } else describe(m, name);
  }
  return { versions, members };
}

/** Problems that fail the build: a member without its doc, capability, since or example. */
export function problems(api) {
  const out = [];
  for (const m of api.members) {
    if (!m.doc) out.push(`${m.path}: no doc comment`);
    if (!m.capability) out.push(`${m.path}: no @capability`);
    if (!Number.isFinite(m.since)) out.push(`${m.path}: no @since <apiVersion>`);
    if (!m.example) out.push(`${m.path}: no @example`);
    if (m.deprecated && m.removedIn === null) out.push(`${m.path}: @deprecated must say "removed in apiVersion <N>"`);
  }
  if (!api.versions.length) out.push("PLUGIN_API_VERSIONS is empty");
  return out;
}

const T = {
  en: {
    title: (v) => `Plugin API reference — apiVersion ${v}`,
    description: (v) => `Every method of the lumen object in apiVersion ${v}, generated from the types, with its capability and a tested example.`,
    intro: (v) => `This page is generated from \`${SOURCE}\` by \`scripts/plugin-api-docs.mjs\`; every example on it runs in the test suite. A plugin asks for apiVersion ${v} in its manifest. For events, limits and UI elements see [Plugin API](/plugins/api/).`,
    cap: "Capability",
    since: "Since apiVersion",
    dep: "Deprecated",
  },
  he: {
    title: (v) => `עיון ב-API של התוספים — apiVersion ${v}`,
    description: (v) => `כל מתודה של האובייקט lumen ב-apiVersion ${v}, שנוצרה מהטיפוסים, עם ההרשאה שלה ודוגמה שנבדקת.`,
    intro: (v) => `העמוד נוצר מ-\`${SOURCE}\` על ידי \`scripts/plugin-api-docs.mjs\`; כל דוגמה בו רצה בחבילת הבדיקות. תוסף מבקש apiVersion ${v} במניפסט שלו. אירועים, מגבלות ורכיבי ממשק: [Plugin API](/he/plugins/api/). התיאורים באנגלית, כפי שהם בקוד.`,
    cap: "הרשאה",
    since: "מאז apiVersion",
    dep: "יוצא משימוש",
  },
};

export function renderVersion(api, v, lang) {
  const t = T[lang];
  const live = api.members.filter((m) => m.since <= v && (m.removedIn === null || m.removedIn > v));
  const lines = ["---", `title: ${JSON.stringify(t.title(v))}`, `description: ${JSON.stringify(t.description(v))}`, "type: reference", 'tasks: ["W13.D3"]', "---", "", "<!-- Generated by scripts/plugin-api-docs.mjs — do not edit by hand. -->", "", t.intro(v), ""];
  for (const m of live) {
    lines.push(`## \`lumen.${m.path}\``, "", "```ts illustrative", m.signature, "```", "", m.doc, "");
    lines.push(`- ${t.cap}: \`${m.capability}\``, `- ${t.since}: ${m.since}`);
    if (m.deprecated) lines.push(`- **${t.dep}:** ${m.deprecated}`);
    lines.push("", "```js illustrative", m.example, "```", "");
  }
  return lines.join("\n");
}

export const pagePath = (v, lang) => `docs/src/content/docs/${lang === "he" ? "he/" : ""}plugins/api-v${v}.md`;

function main(argv) {
  const api = readApi(readFileSync(join(ROOT, SOURCE), "utf8"));
  const bad = problems(api);
  if (bad.length) {
    for (const b of bad) console.error(`✗ ${b}`);
    console.error(`✗ plugin-api-docs: ${bad.length} undocumented — every method needs a doc comment, @capability, @since and @example`);
    return 1;
  }
  const stale = [];
  for (const v of api.versions) {
    for (const lang of ["en", "he"]) {
      const p = join(ROOT, pagePath(v, lang));
      const text = renderVersion(api, v, lang);
      if (argv.includes("--check")) {
        if (!existsSync(p) || readFileSync(p, "utf8") !== text) stale.push(pagePath(v, lang));
      } else writeFileSync(p, text);
    }
  }
  if (stale.length) {
    console.error(`✗ plugin-api-docs: out of date: ${stale.join(", ")} — run node scripts/plugin-api-docs.mjs`);
    return 1;
  }
  console.log(`✓ plugin-api-docs: ${api.members.length} members documented, apiVersion ${api.versions.join(", ")}`);
  return 0;
}

if (import.meta.url.startsWith("file:") && process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
