/**
 * A developer's preview scan of any branch, tag or commit (plan W13.L6), as
 * Obsidian Community gives its developers: the same review the registry runs
 * (src/plugins/runtime/review.ts, W11.S14), on a ref before it is submitted,
 * in three tiers:
 *   - failures    would keep the version out of the registry (review errors);
 *   - warnings    listed on the public scorecard (review warnings);
 *   - suggestions not scored: what makes a version better trusted or easier to keep
 *                 (an author signature, a target API version, a README, …).
 *
 * `resolveRef` takes a local folder, or `<git url>#<sha|branch|tag>` (cloned
 * shallowly into a temporary folder; `#<ref>:<subdir>` for a monorepo).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** The folder to review for a ref; throws with a clear message. */
export function resolveRef(ref, { git = "git" } = {}) {
  if (!ref) throw new Error("--ref needs a folder or <git url>#<sha>");
  const hash = ref.lastIndexOf("#");
  if (hash < 0) {
    const dir = resolve(ref);
    if (!existsSync(join(dir, "lumen-plugin.json"))) throw new Error(`${ref}: no lumen-plugin.json there`);
    return { dir, label: ref, commit: null };
  }
  const url = ref.slice(0, hash);
  const [rev, sub = ""] = ref.slice(hash + 1).split(":");
  if (!/^(https:\/\/|file:\/\/|\/)/.test(url)) throw new Error(`${url}: a git URL is https:// (or a local path for tests)`);
  if (!/^[A-Za-z0-9._/-]{1,200}$/.test(rev) || rev.startsWith("-")) throw new Error(`#${rev}: not a commit, branch or tag name`);
  const work = mkdtempSync(join(tmpdir(), "lumen-preview-"));
  const run = (...args) => {
    const r = spawnSync(git, args, { cwd: work, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args[0]}: ${(r.stderr || r.stdout).trim().split("\n").pop()}`);
    return r.stdout.trim();
  };
  run("init", "-q");
  run("remote", "add", "origin", url);
  // A shallow fetch of exactly the ref asked for: nothing of the plugin runs, nothing is installed.
  run("-c", "protocol.file.allow=always", "fetch", "-q", "--depth", "1", "origin", rev);
  run("-c", "advice.detachedHead=false", "checkout", "-q", "FETCH_HEAD");
  const commit = run("rev-parse", "HEAD");
  const dir = sub ? join(work, sub) : work;
  if (!resolve(dir).startsWith(work)) throw new Error(`${sub}: outside the checkout`);
  if (!existsSync(join(dir, "lumen-plugin.json"))) throw new Error(`${ref}: no lumen-plugin.json at ${sub || "the root"}`);
  return { dir, label: ref, commit };
}

/** What review.ts takes, from a plugin folder. */
export function reviewInput(dir, { previousManifest } = {}) {
  const read = (p) => (existsSync(join(dir, p)) ? readFileSync(join(dir, p), "utf8") : undefined);
  const manifest = read("lumen-plugin.json");
  const m = JSON.parse(manifest);
  return {
    manifest,
    main: read(m.main ?? "main.js") ?? "",
    ...(m.ui && read(m.ui) !== undefined ? { ui: read(m.ui) } : {}),
    ...(read("styles.css") !== undefined ? { css: read("styles.css") } : {}),
    ...((read("src/main.ts") ?? read("src/main.js")) !== undefined ? { source: read("src/main.ts") ?? read("src/main.js") } : {}),
    ...(previousManifest ? { previousManifest } : {}),
    hasLockfile: existsSync(join(dir, "package-lock.json")) || existsSync(join(dir, "pnpm-lock.yaml")),
    inRepo: false,
  };
}

/** Suggestions: not scored, never a failure. */
export function suggestions(dir, card) {
  const m = JSON.parse(readFileSync(join(dir, "lumen-plugin.json"), "utf8"));
  const out = [];
  if (!existsSync(join(dir, "author.sigstore.json"))) out.push({ rule: "author-signature", detail: "Sign each version keyless with Sigstore (node scripts/publish-plugin.mjs --sigstore <folder>) for the “verified author” mark." });
  if (!m.publisher?.github) out.push({ rule: "publisher", detail: "Name the GitHub account that signs your versions: \"publisher\": { \"github\": \"<login>\" }." });
  if (!m.targetApiVersion) out.push({ rule: "target-api", detail: "Say which plugin API you built against (\"targetApiVersion\"); without it Lumen runs the plugin in compatibility mode." });
  if (!existsSync(join(dir, "README.md"))) out.push({ rule: "readme", detail: "Add a README.md: what the plugin does and why it asks for each permission." });
  if (!existsSync(join(dir, "LICENSE")) && !existsSync(join(dir, "LICENSE.md"))) out.push({ rule: "license-file", detail: "Ship the licence text (LICENSE) next to the code." });
  if (/document\.setText\(/.test(readFileSync(join(dir, m.main ?? "main.js"), "utf8"))) out.push({ rule: "deprecated-api", detail: "lumen.document.setText is deprecated (plugin API 1.1.0); use lumen.document.applyEdits." });
  if (card.permissions.declared.length > 4) out.push({ rule: "permissions", detail: `It asks for ${card.permissions.declared.length} permissions; fewer make the install screen easier to accept.` });
  return out;
}

/** The three-tier preview of one reviewed version. */
export function preview(card, sugg, ref) {
  return {
    kind: "lumen-plugin-preview",
    v: 1,
    ref: ref.label,
    commit: ref.commit,
    id: card.id,
    version: card.version,
    passed: card.passed,
    grade: card.grade,
    score: card.score,
    failures: card.findings.filter((f) => f.severity === "error"),
    warnings: card.findings.filter((f) => f.severity === "warning"),
    suggestions: sugg,
    permissions: card.permissions,
    audit: card.audit,
    reviewer: card.reviewer,
  };
}

export function previewMarkdown(p) {
  const row = (f) => `| \`${f.rule}\` | ${String(f.detail).replace(/\|/g, "\\|")}${f.line ? ` (line ${f.line})` : ""} |`;
  const tier = (title, list, none) => [`### ${title} (${list.length})`, "", ...(list.length ? ["| rule | detail |", "| --- | --- |", ...list.map(row)] : [none]), ""];
  return [
    `## ${p.passed ? "✅" : "❌"} ${p.id}@${p.version} — ${p.passed ? `grade ${p.grade}, ${p.score}/100` : "would not be listed"}`,
    "",
    `Ref \`${p.ref}\`${p.commit ? ` at \`${p.commit.slice(0, 12)}\`` : ""} · reviewer ${p.reviewer} · permissions: ${p.permissions.declared.join(", ") || "none"} · dependency audit: ${p.audit}`,
    "",
    ...tier("Failures", p.failures, "None: the registry would accept this version."),
    ...tier("Warnings", p.warnings, "None."),
    ...tier("Suggestions", p.suggestions, "None."),
  ].join("\n");
}
