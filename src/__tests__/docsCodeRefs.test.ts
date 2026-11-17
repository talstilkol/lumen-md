/**
 * Plan 13.1 — the docs say what the code is: every repository file a docs
 * page names in inline code (`src/…`, `scripts/…`, `e2e/…`, `src-tauri/…`,
 * `security/…`, `plan/…`, `stryker/…`) exists, in both languages. The
 * docs-complete and docs-sync gates check that pages exist and that the
 * commands they name are real; this checks the files a reader is sent to.
 *
 * Not checked: paths with a wildcard or a <placeholder>, the PR-triage
 * table (its code spans are branch names), and the files below that the
 * owner or a command makes — each listed with the page that says so.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(__dirname, "..", "..");
const DOCS = join(ROOT, "docs/src/content/docs");
const PREFIX = /^(src|scripts|e2e|src-tauri|security|plan|stryker)\//;

/** Files the docs name that do not exist until someone makes them, and where the docs say who. */
const MADE_LATER: Record<string, string> = {
  "scripts/mutation/calibration.json": "written by `node scripts/mutation/calibrate.mjs` (security/mutation-testing)",
  "security/release-key.pub": "the owner commits it after `scripts/supply-chain/keys.mjs` (project/releasing, security/supply-chain)",
  "security/updater-key.pub": "the owner commits it with the updater key (project/releasing)",
  "security/provenance-policy.pub": "the owner's signing key for the provenance policy (security/supply-chain)",
  "security/provenance-policy.dsse.json": "signed by the owner (security/supply-chain)",
  "security/witness-policy.signed.json": "signed by the owner (security/supply-chain)",
  "security/e2e-receipt-keys": "the owner's receipt keys (contributing/checks)",
};
/** Pages whose code spans are not repository paths. */
const SKIP_PAGES = /(^|\/)project\/pr-triage\.mdx?$/;
/** Pages that describe a plugin made from the template: their paths are inside the template. */
const TEMPLATE_PAGES: Record<string, string> = { "plugins/develop": "packages/create-lumen-plugin/template" };

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? pages(p) : /\.mdx?$/.test(f) ? [p] : [];
  });
}

/** Every repository path a page names in inline code, outside fenced code blocks. */
function codeRefs(markdown: string): string[] {
  const text = markdown.replace(/^([ \t]*)(```|~~~)[^\n]*\n[\s\S]*?\n\1\2[^\n]*$/gm, "");
  const out = new Set<string>();
  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    const span = m[1].trim();
    if (!PREFIX.test(span) || /\s/.test(span) || /[*<>{}$…]/.test(span)) continue;
    out.add(span.replace(/[/.,:;)]+$/, "").replace(/:\d+(?:-\d+)?$/, ""));
  }
  return [...out];
}

function missing(): string[] {
  const out: string[] = [];
  for (const file of pages(DOCS)) {
    const rel = relative(DOCS, file);
    if (SKIP_PAGES.test(rel)) continue;
    const slug = rel.replace(/^he\//, "").replace(/\.mdx?$/, "");
    const base = TEMPLATE_PAGES[slug];
    for (const ref of codeRefs(readFileSync(file, "utf8"))) {
      if (ref in MADE_LATER) continue;
      if (existsSync(join(ROOT, ref)) || (base && existsSync(join(ROOT, base, ref)))) continue;
      out.push(`${rel}: \`${ref}\``);
    }
  }
  return out.sort();
}

describe("docs name files that exist (13.1)", () => {
  it("reads inline-code paths, not fenced code, globs or placeholders", () => {
    const md = ["See `src/a.ts` and `scripts/b.mjs:12`, `src/*.ts`, `src/<x>.ts`, `npm run x`.", "```", "`src/in-fence.ts`", "```", "`e2e/c.spec.ts`."].join("\n");
    expect(codeRefs(md).sort()).toEqual(["e2e/c.spec.ts", "scripts/b.mjs", "src/a.ts"]);
  });

  it("every file a page names exists (or is one the owner or a command makes)", () => {
    expect(missing()).toEqual([]);
  });

  it("the made-later list holds only files that are really not there yet", () => {
    // Once one exists, it leaves the list and the ordinary check covers it.
    expect(Object.keys(MADE_LATER).filter((p) => existsSync(join(ROOT, p)))).toEqual([]);
  });
});
