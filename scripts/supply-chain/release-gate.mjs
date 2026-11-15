/**
 * The release's provenance gate (plan W7.22 in W4.5's release-run.mjs).
 * Runs after the files are built and SHA256SUMS is signed, before anything
 * is pushed or uploaded:
 *
 *   --publish  0. Witness (plan W7.22 step 3, W10.E54): a published release is attested with
 *                 Witness by default. Without `witness` on PATH, LUMEN_WITNESS_KEY and the
 *                 committed security/witness-policy.signed.json the release stops here. The
 *                 repo's own Node attester alone is only the explicit fallback:
 *                 LUMEN_PROVENANCE_ENGINE=node, and the release log says so.
 *              1. attest.mjs --no-run: SLSA provenance over the exact files about to be
 *                 published, signed with this machine's build key (LUMEN_BUILD_KEY, else
 *                 LUMEN_NIGHTLY_KEY), builder LUMEN_FACTORY_HOST; with Witness, this step runs
 *                 under `witness run` (SLSA attestor, products = the release folder), which
 *                 writes provenance.witness.json
 *              2. sign.sh: a keyless Sigstore bundle per file (Tal's browser login)
 *              3. verify.mjs --commit <the tag's commit>: both proofs for every file,
 *                 against the committed policy, key and identity, and with Witness
 *                 `witness verify` for every file too (--witness). Not 0 → no publish.
 *   dry run    the same three steps with throwaway TEST material: a TEST build key, a
 *              TEST policy key and policy, and the local Sigstore stand-in
 *              (sigstore-local.mjs) instead of Fulcio and Rekor. The dry run's tree has
 *              the version bump uncommitted, so its TEST policy allows a dirty tree; the
 *              real policy never does.
 */
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { NOT_SUBJECT, POLICY_PAYLOAD, makePolicy, signEnvelope, witnessRunArgs } from "./provenance-lib.mjs";

const here = (f) => join(import.meta.dirname, f);

/** Release files that get a bundle: the products and the provenance (not signatures, not dotfiles). */
export function signable(out) {
  const list = [];
  const walk = (d) => {
    for (const n of readdirSync(d).sort()) {
      const f = join(d, n);
      if (statSync(f).isDirectory()) walk(f);
      else {
        const r = relative(out, f).split("\\").join("/");
        if ((!NOT_SUBJECT.test(r) && r !== "build.log") || r === "provenance.intoto.jsonl") list.push(f);
      }
    }
  };
  walk(out);
  return list;
}

/** The variable that picks the engine of a published release's provenance. */
export const ENGINE_ENV = "LUMEN_PROVENANCE_ENGINE";
/** The committed Witness policy (signed with the policy key, security/provenance-policy.pub). */
export const WITNESS_POLICY = "security/witness-policy.signed.json";

/** The engine of a published release: Witness, unless the Node attester is asked for by name. */
export function releaseEngine(env = process.env) {
  const e = env[ENGINE_ENV] || "witness";
  if (e !== "witness" && e !== "node") throw new Error(`${ENGINE_ENV}=${e}: use witness (the default) or node (the explicit fallback)`);
  return e;
}

/**
 * What a Witness-attested release needs on this machine → [] or one line per
 * missing part. `hasWitness` and `exists` are seams for the tests.
 */
export function witnessProblems({ env = process.env, root, hasWitness = () => spawnSync("witness", ["version"], { stdio: "ignore" }).status === 0, exists = existsSync }) {
  const out = [];
  if (!hasWitness()) out.push("`witness` is not on PATH (scripts/supply-chain/install-tools.sh installs the pinned release)");
  if (!env.LUMEN_WITNESS_KEY) out.push("LUMEN_WITNESS_KEY is not set (the Witness signing key, not the policy key: docs security/provenance)");
  else if (!exists(env.LUMEN_WITNESS_KEY)) out.push(`LUMEN_WITNESS_KEY: ${env.LUMEN_WITNESS_KEY} does not exist`);
  if (!exists(join(root, WITNESS_POLICY))) out.push(`${WITNESS_POLICY} is not committed (the Witness policy, signed with the policy key)`);
  return out;
}

/** The refusal when Witness is the engine and not ready: what is missing, and the explicit way out. */
export const witnessRefusal = (problems) =>
  `provenance gate: a published release is attested with Witness (plan W7.22), and Witness is not ready here:\n${problems.map((p) => `  - ${p}`).join("\n")}\nNothing was published. To release with the repo's Node attester only, set ${ENGINE_ENV}=node (the explicit fallback; the release log records it).`;

const node = (args, opts = {}) => spawnSync(process.execPath, args, { encoding: "utf8", ...opts });
const tail = (r) => `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split("\n").slice(-6).join("\n");

/**
 * @param {{ out: string, root: string, commit: string, publish: boolean, env?: NodeJS.ProcessEnv }} a
 * @returns {{ ok: boolean, test: boolean, files: number, log: string }}
 */
export function provenanceGate({ out, root, commit, publish, env = process.env, hasWitness }) {
  if (publish) {
    // Step 0: Witness is the default engine; the Node attester alone only when asked for by name.
    const engine = releaseEngine(env);
    if (engine === "witness") {
      const problems = witnessProblems({ env, root, ...(hasWitness ? { hasWitness } : {}) });
      if (problems.length) throw new Error(witnessRefusal(problems));
    } else console.warn(`provenance gate: ${ENGINE_ENV}=node: the Node attester only, without Witness (the explicit fallback)`);
    const key = env.LUMEN_BUILD_KEY || env.LUMEN_NIGHTLY_KEY;
    if (!key || !existsSync(key)) throw new Error("provenance gate: no build key (LUMEN_BUILD_KEY or LUMEN_NIGHTLY_KEY): see docs security/provenance");
    const attest = [here("attest.mjs"), "--out", out, "--no-run", "--key", key, "--engine", "node", ...(env.LUMEN_FACTORY_HOST ? ["--host", env.LUMEN_FACTORY_HOST] : [])];
    const a =
      engine === "witness"
        ? spawnSync("witness", witnessRunArgs({ key: env.LUMEN_WITNESS_KEY, out: join(out, "provenance.witness.json"), productGlob: `${relative(root, out) || "."}/*`, command: [process.execPath, ...attest] }), { cwd: root, encoding: "utf8" })
        : node(attest, { cwd: root });
    if (a.status !== 0) throw new Error(`provenance gate: attest${engine === "witness" ? " under witness run" : ""} failed\n${tail(a)}`);
    if (engine === "witness" && !existsSync(join(out, "provenance.witness.json"))) throw new Error("provenance gate: witness run wrote no provenance.witness.json");
    const s = spawnSync("bash", [here("sign.sh"), out], { cwd: root, stdio: "inherit" });
    if (s.status !== 0) throw new Error("provenance gate: sign.sh failed (cosign keyless signing, or its check)");
    const v = node([here("verify.mjs"), out, "--commit", commit, ...(engine === "witness" ? ["--witness"] : [])], { cwd: root });
    if (v.status !== 0) throw new Error(`provenance gate: the release does not verify; nothing is published\n${tail(v)}`);
    return { ok: true, test: false, engine, files: signable(out).length, log: tail(v) };
  }
  const t = mkdtempSync(join(tmpdir(), "lumen-provenance-"));
  try {
    const pair = () => {
      const { privateKey, publicKey } = generateKeyPairSync("ed25519");
      return { priv: privateKey.export({ type: "pkcs8", format: "pem" }).toString(), pub: publicKey.export({ type: "spki", format: "pem" }).toString() };
    };
    const build = pair();
    const policyKey = pair();
    writeFileSync(join(t, "build.pem"), build.priv, { mode: 0o600 });
    writeFileSync(join(t, "policy.pub"), policyKey.pub);
    const policy = makePolicy({ buildKeys: [build.pub], expires: new Date(Date.now() + 86400_000).toISOString(), builders: ["dry-run-TEST"], requireCleanTree: false });
    writeFileSync(join(t, "policy.json"), JSON.stringify(signEnvelope(POLICY_PAYLOAD, JSON.stringify(policy), policyKey.priv)));
    writeFileSync(join(t, "identity.json"), JSON.stringify({ identity: "release-TEST@example.com", issuer: "https://example.com/TEST-issuer" }));
    const a = node([here("attest.mjs"), "--out", out, "--no-run", "--key", join(t, "build.pem"), "--host", "dry-run-TEST"], { cwd: root });
    if (a.status !== 0) return { ok: false, test: true, files: 0, log: `attest failed\n${tail(a)}` };
    const sign = node(
      [
        "--input-type=module",
        "-e",
        `import { localSigstore } from ${JSON.stringify(here("sigstore-local.mjs"))};
         import { readFileSync, writeFileSync } from "node:fs";
         const s = localSigstore();
         writeFileSync(${JSON.stringify(join(t, "trusted_root.json"))}, JSON.stringify(s.trustedRoot));
         for (const f of ${JSON.stringify(signable(out))}) writeFileSync(f + ".sigstore.json", JSON.stringify(s.signBlob(readFileSync(f), { email: "release-TEST@example.com", issuer: "https://example.com/TEST-issuer" })));`,
      ],
      { cwd: root },
    );
    if (sign.status !== 0) return { ok: false, test: true, files: 0, log: `TEST signing failed\n${tail(sign)}` };
    const v = node([here("verify.mjs"), out, "--commit", commit, "--policy", join(t, "policy.json"), "--policy-key", join(t, "policy.pub"), "--identity", join(t, "identity.json"), "--trusted-root", join(t, "trusted_root.json"), "--with", "sigstore-js"], { cwd: root });
    return { ok: v.status === 0, test: true, files: signable(out).length, log: tail(v), unavailable: v.status === 2 };
  } finally {
    rmSync(t, { recursive: true, force: true });
  }
}

/** For the dry run's report: what --publish adds. */
export const PUBLISH_STEPS = [
  "witness run --step build -a slsa,git,environment … -k \"$LUMEN_WITNESS_KEY\" -o release/provenance.witness.json -- node scripts/supply-chain/attest.mjs --out release --no-run --key \"$LUMEN_BUILD_KEY\" --engine node",
  "bash scripts/supply-chain/sign.sh release/",
  "node scripts/supply-chain/verify.mjs release/ --commit <the tag's commit> --witness",
];
