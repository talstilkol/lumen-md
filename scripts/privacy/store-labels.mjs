#!/usr/bin/env node
/**
 * The store privacy labels against the privacy ledger (plan W11.S13,
 * research R6.9): a label that doesn't match the ledger is a store risk.
 *
 *   node scripts/privacy/store-labels.mjs           write the two drafts
 *   node scripts/privacy/store-labels.mjs --check   exit 1 when a ledger route has no
 *                                                   label entry, or a draft is out of date
 *
 * The rule: every route the ledger can record (scripts/privacy/ledgerRoutes.mjs)
 * is listed under exactly one feature's `routes` in store/privacy-labels.json,
 * or under `onDevice` (it never leaves the user's own machines). pr:check runs
 * the same check, so a new network call in the ledger can't ship without its
 * label entry.
 *
 * The drafts (store/app-store-privacy.draft.md, store/play-data-safety.draft.md)
 * are what the owner copies into App Store Connect and the Play Console at
 * submission (W11.O7). They are built from the labels file, so they never
 * say more or less than it.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ledgerRoutes, unknownRecorders } from "./ledgerRoutes.mjs";

export const LABELS = "store/privacy-labels.json";
export const DRAFTS = { apple: "store/app-store-privacy.draft.md", google: "store/play-data-safety.draft.md" };

/** Problems between the labels and the ledger's routes (empty: they match). */
export function labelProblems(labels, routes, unknown = []) {
  const out = unknown.map((f) => `${f} records into the privacy ledger but scripts/privacy/ledgerRoutes.mjs doesn't know it: add it to RECORDERS`);
  const where = new Map();
  const place = (route, at) => {
    if (where.has(route)) out.push(`"${route}" is listed twice: under ${where.get(route)} and ${at}`);
    else where.set(route, at);
  };
  for (const f of labels.optionalFeatures ?? []) for (const r of f.routes ?? []) place(r, `"${f.feature}"`);
  for (const r of labels.onDevice?.routes ?? []) place(r, "onDevice");
  for (const r of routes) if (!where.has(r)) out.push(`the ledger route "${r}" has no store label entry: list it under a feature's routes (or onDevice) in ${LABELS}`);
  for (const r of where.keys()) if (!routes.includes(r)) out.push(`${LABELS} names "${r}", which is not a ledger route`);
  return out;
}

const yes = (b) => (b ? "Yes" : "No");

/** The two drafts, as Markdown. */
export function renderDrafts(labels) {
  const features = labels.optionalFeatures ?? [];
  const leaving = features.filter((f) => f.ledgerCategory !== null || (f.routes ?? []).length);
  const apple = [
    "# App Store privacy label — draft (W11.S13)",
    "",
    `<!-- Written by scripts/privacy/store-labels.mjs from ${LABELS}. Do not edit by hand. Submission: W11.O7. -->`,
    "",
    `**Data used to track you:** ${labels.apple.tracking ? "Yes" : "None"}`,
    "",
    `**Data collected:** ${labels.apple.dataNotCollected ? "**Data Not Collected**" : "see below"}. The developer receives nothing with the default settings: ${labels.default.summary}`,
    "",
    "## The one optional collection",
    "",
    "| Category | Type | Linked to you | Tracking | Only when |",
    "|---|---|---|---|---|",
    ...labels.apple.dataTypes.map((d) => `| ${d.category} | ${d.type} | ${yes(d.linkedToUser)} | ${yes(d.usedForTracking)} | ${d.condition.replace(/\|/g, "\\|")} |`),
    "",
    "If the build is made without `VITE_SENTRY_DSN`, the label is \"Data Not Collected\" with no exceptions.",
    "",
    "## What the user can send, by their own choice, to a service they chose",
    "",
    labels.apple.note,
    "",
    "| Feature | Sends | Turned on by | Ledger routes |",
    "|---|---|---|---|",
    ...leaving.map((f) => `| ${f.feature} | ${f.sends} | ${f.turnedOnBy} | ${(f.routes ?? []).map((r) => `\`${r.trimEnd()}\``).join(", ") || "—"} |`),
    "",
  ].join("\n");
  const google = [
    "# Google Play Data safety — draft (W11.S13)",
    "",
    `<!-- Written by scripts/privacy/store-labels.mjs from ${LABELS}. Do not edit by hand. Submission: W11.O7. -->`,
    "",
    `**Does your app collect or share any of the required user data types?** ${labels.google.dataCollected || labels.google.dataShared ? "Yes" : "**No data collected or shared**"}`,
    "",
    `**Is all of the user data collected by your app encrypted in transit?** ${yes(labels.google.encryptedInTransit)}`,
    "",
    `**Deletion:** ${labels.google.userCanRequestDeletion}`,
    "",
    "## Optional collection",
    "",
    "| Data type | Optional | Only when |",
    "|---|---|---|",
    ...labels.google.conditionalCollection.map((c) => `| ${c.type} | ${yes(c.optional)} | ${c.condition.replace(/\|/g, "\\|")} |`),
    "",
    "## To confirm at submission",
    "",
    "Play counts data the app sends off the device. The routes below are each started by the user, go to a service the user chose (often with their own key or account), and send nothing to the developer. Whether each falls under Play's exceptions for user-initiated transfers to a third party the user chose is for the owner to confirm in the Play Console (W11.O7). If one doesn't, its row moves to \"collected\" or \"shared\" there.",
    "",
    "| Feature | Sends | Turned on by |",
    "|---|---|---|",
    ...leaving.filter((f) => f.ledgerCategory !== "monitoring").map((f) => `| ${f.feature} | ${f.sends} | ${f.turnedOnBy} |`),
    "",
  ].join("\n");
  return { apple, google };
}

function main(argv) {
  const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
  const labels = JSON.parse(readFileSync(join(root, LABELS), "utf8"));
  const problems = labelProblems(labels, ledgerRoutes(root), unknownRecorders(root));
  const drafts = renderDrafts(labels);
  if (argv.includes("--check")) {
    for (const [k, p] of Object.entries(DRAFTS)) if (!existsSync(join(root, p)) || readFileSync(join(root, p), "utf8") !== drafts[k]) problems.push(`${p} is out of date: run node scripts/privacy/store-labels.mjs`);
    for (const p of problems) console.error(`✖ ${p}`);
    if (problems.length) return 1;
    console.log(`✓ store labels: every ledger route (${ledgerRoutes(root).length}) has a label entry; both drafts current`);
    return 0;
  }
  if (problems.length) {
    for (const p of problems) console.error(`✖ ${p}`);
    return 1;
  }
  for (const [k, p] of Object.entries(DRAFTS)) writeFileSync(join(root, p), drafts[k]);
  console.log(`wrote ${Object.values(DRAFTS).join(", ")}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
