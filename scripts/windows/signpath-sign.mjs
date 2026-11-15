#!/usr/bin/env node
/**
 * Tauri's Windows signCommand (plan W11.S15): sign one file through
 * SignPath Foundation's REST API and put the signed file in its place.
 *
 *   node scripts/windows/signpath-sign.mjs <file>      (tauri.conf.json: bundle.windows.signCommand)
 *
 * Needs, from the SignPath organisation (W11.O1; never committed):
 *   SIGNPATH_API_TOKEN, SIGNPATH_ORGANIZATION_ID, SIGNPATH_PROJECT_SLUG,
 *   SIGNPATH_SIGNING_POLICY_SLUG; optional SIGNPATH_ARTIFACT_CONFIGURATION_SLUG,
 *   SIGNPATH_API_URL (default https://app.signpath.io/Api/v1).
 *
 * The API (SignPath's documented "submit a signing request" flow):
 *   POST {api}/{org}/SigningRequests   multipart: ProjectSlug, SigningPolicySlug,
 *                                      [ArtifactConfigurationSlug], Description, Artifact
 *     → 201, Location: the signing request
 *   GET  Location                       → { status, isFinalStatus, signedArtifactLink }
 *   GET  signedArtifactLink             → the signed file
 * With the Foundation's policy, a person at SignPath or the project approves
 * each request; the script waits for that (SIGNPATH_TIMEOUT_MS, default 30 min).
 *
 * Exit 2 without the SignPath details (nothing is signed, nothing is
 * claimed), 1 when the request fails or the result isn't signed.
 */
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { peSignature, windowsSigningPlan } from "../lib/windowsSigning.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Sign `file` in place. Returns { status, url }. Throws on failure. */
export async function signWithSignPath(file, env = process.env, fetchImpl = fetch) {
  const plan = windowsSigningPlan(env);
  if (!plan.configured) {
    const e = new Error(`SignPath is not configured: ${plan.missing.join(", ")} not set. The file is left unsigned.`);
    e.code = "NOT_CONFIGURED";
    throw e;
  }
  const api = (env.SIGNPATH_API_URL || "https://app.signpath.io/Api/v1").replace(/\/$/, "");
  const auth = { Authorization: `Bearer ${env.SIGNPATH_API_TOKEN}` };
  const form = new FormData();
  form.set("ProjectSlug", env.SIGNPATH_PROJECT_SLUG);
  form.set("SigningPolicySlug", env.SIGNPATH_SIGNING_POLICY_SLUG);
  if (env.SIGNPATH_ARTIFACT_CONFIGURATION_SLUG) form.set("ArtifactConfigurationSlug", env.SIGNPATH_ARTIFACT_CONFIGURATION_SLUG);
  form.set("Description", `Lumen ${basename(file)}`);
  form.set("Artifact", new Blob([readFileSync(file)]), basename(file));
  const submit = await fetchImpl(`${api}/${encodeURIComponent(env.SIGNPATH_ORGANIZATION_ID)}/SigningRequests`, { method: "POST", headers: auth, body: form });
  if (submit.status !== 201 && submit.status !== 202) throw new Error(`SignPath refused the request: HTTP ${submit.status} ${(await submit.text()).slice(0, 300)}`);
  const url = submit.headers.get("location");
  if (!url) throw new Error("SignPath answered without the signing request's Location");
  const poll = Number(env.SIGNPATH_POLL_MS ?? 5000);
  const deadline = Date.now() + Number(env.SIGNPATH_TIMEOUT_MS ?? 30 * 60_000);
  let state;
  for (;;) {
    const r = await fetchImpl(url, { headers: auth });
    if (!r.ok) throw new Error(`SignPath status: HTTP ${r.status}`);
    state = await r.json();
    if (state.isFinalStatus) break;
    if (Date.now() > deadline) throw new Error(`SignPath: still ${state.status} after the timeout (an approval is waiting?)`);
    await sleep(poll);
  }
  if (state.status !== "Completed" || !state.signedArtifactLink) throw new Error(`SignPath: the request ended ${state.status}`);
  const signed = await fetchImpl(state.signedArtifactLink, { headers: auth });
  if (!signed.ok) throw new Error(`SignPath: downloading the signed file: HTTP ${signed.status}`);
  const bytes = Buffer.from(await signed.arrayBuffer());
  const check = peSignature(bytes);
  if (check.pe && !check.signed) throw new Error(`SignPath returned a file that isn't signed: ${check.why}`);
  // Replace atomically: Tauri reads the file right after this exits.
  writeFileSync(`${file}.signpath-tmp`, bytes);
  renameSync(`${file}.signpath-tmp`, file);
  return { status: state.status, url };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: signpath-sign.mjs <file>");
    process.exit(2);
  }
  signWithSignPath(file).then(
    (r) => console.log(`✓ signed through SignPath (${r.status}): ${file}`),
    (e) => {
      console.error(`✗ ${e.message}`);
      process.exit(e.code === "NOT_CONFIGURED" ? 2 : 1);
    },
  );
}
