/**
 * SLSA 1.2 Source track (plan W13.T3): source provenance and a Verification
 * Summary Attestation (VSA) for a revision of a protected branch.
 *
 * Level 2 asks for (https://slsa.dev/spec/v1.2/source-requirements):
 *   - History: the branch's history is continuous and immutable — the
 *     source control system refuses force pushes and deletion — and every
 *     revision is reachable from the previous one;
 *   - Source provenance: the system records, for each revision, how it got
 *     onto the branch, and that record is retrievable.
 *
 * GitHub enforces the first through the repository rulesets (W11.S4,
 * security/github-ruleset.json: `non_fast_forward` and `deletion` on main
 * and verify/*), but publishes no source provenance. So the verifier here
 * writes it, from what can be checked: the ruleset as committed, the
 * ruleset as the server reports it (the drift check's input), the commit's
 * ancestry from the previous verified head, and the review receipts. The
 * VSA says what was verified, at which level, and is signed (DSSE, Ed25519)
 * with the source key listed in security/source-vsa.json.
 */
import { createHash } from "node:crypto";
import { signEnvelope, verifyEnvelope, INTOTO_PAYLOAD, STATEMENT_TYPE, REPO } from "./provenance-lib.mjs";

export const VSA_TYPE = "https://slsa.dev/verification_summary/v1";
export const SOURCE_PROVENANCE_TYPE = "https://slsa.dev/source_provenance/v1";
export const VERIFIER_ID = `https://github.com/${REPO}/blob/main/scripts/supply-chain/source-vsa.mjs`;
export const RESOURCE = `git+https://github.com/${REPO}`;
export const LEVELS = ["SLSA_SOURCE_LEVEL_1", "SLSA_SOURCE_LEVEL_2"];

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

/** Does a ref pattern of a ruleset ("refs/heads/verify/*") cover a ref? */
export function refMatches(pattern, ref) {
  if (pattern === "~ALL") return true;
  if (pattern === "~DEFAULT_BRANCH") return ref === "refs/heads/main";
  const re = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*")}$`);
  return re.test(ref);
}

/** The rule types that protect `ref` in a list of rulesets (the committed file's, or the server's). */
export function protections(rulesets, ref) {
  const types = new Set();
  for (const rs of rulesets ?? []) {
    if (rs.target !== "branch" || rs.enforcement !== "active") continue;
    const inc = rs.conditions?.ref_name?.include ?? [];
    const exc = rs.conditions?.ref_name?.exclude ?? [];
    if (!inc.some((p) => refMatches(p, ref)) || exc.some((p) => refMatches(p, ref))) continue;
    for (const r of rs.rules ?? []) types.add(r.type);
  }
  return types;
}

/**
 * What can be verified about one revision → { checks: [{ id, ok, detail }], level }.
 * facts: { ref, commit, previous (sha or null), isAncestor (bool or null),
 *          committed (rulesets in the file at `commit`), live (rulesets the server reported, or null),
 *          receipts (count of review receipts for the merge, or null) }
 */
export function evaluate(f) {
  const checks = [];
  const add = (id, ok, detail) => checks.push({ id, ok, detail });
  add("revision", /^[0-9a-f]{40}$/.test(f.commit ?? ""), `commit ${f.commit}`);
  add("ref", /^refs\/heads\/(main|verify\/[\w.-]+)$/.test(f.ref ?? ""), `ref ${f.ref}`);
  const declared = protections(f.committed, f.ref);
  add("declared-continuity", declared.has("non_fast_forward") && declared.has("deletion"), `committed ruleset for ${f.ref}: ${[...declared].sort().join(", ") || "none"}`);
  if (f.live) {
    const live = protections(f.live, f.ref);
    add("enforced-continuity", live.has("non_fast_forward") && live.has("deletion"), `server ruleset for ${f.ref}: ${[...live].sort().join(", ") || "none"}`);
  } else add("enforced-continuity", false, "the server's rulesets were not read (pass --live <gh api answer> or --fetch)");
  if (f.previous) add("history", f.isAncestor === true, `${f.previous.slice(0, 12)} is ${f.isAncestor ? "" : "NOT "}an ancestor of ${String(f.commit).slice(0, 12)}`);
  else add("history", true, "first verified revision of this ref (no previous VSA)");
  const level1 = checks.filter((c) => ["revision", "ref"].includes(c.id)).every((c) => c.ok);
  const level2 = level1 && checks.every((c) => c.ok);
  return { checks, level: level2 ? 2 : level1 ? 1 : 0 };
}

/** The source provenance statement for one revision (what the verifier observed). */
export function sourceProvenance(f, evaluation, { now = new Date() } = {}) {
  return {
    _type: STATEMENT_TYPE,
    subject: [{ uri: `${RESOURCE}@${f.ref}`, digest: { gitCommit: f.commit } }],
    predicateType: SOURCE_PROVENANCE_TYPE,
    predicate: {
      repository: RESOURCE,
      ref: f.ref,
      commit: f.commit,
      previousVerified: f.previous ?? null,
      observedAt: now.toISOString(),
      rulesetDigest: { sha256: sha256(JSON.stringify(f.committed ?? [])) },
      liveRulesetDigest: f.live ? { sha256: sha256(JSON.stringify(f.live)) } : null,
      reviewReceipts: f.receipts ?? null,
      checks: evaluation.checks,
    },
  };
}

/** The VSA statement. */
export function vsaStatement(f, evaluation, provenanceEnvelope, { now = new Date(), policyDigest } = {}) {
  const levels = LEVELS.slice(0, evaluation.level);
  return {
    _type: STATEMENT_TYPE,
    subject: [{ uri: `${RESOURCE}@${f.ref}`, digest: { gitCommit: f.commit }, annotations: { sourceRefs: [f.ref] } }],
    predicateType: VSA_TYPE,
    predicate: {
      verifier: { id: VERIFIER_ID },
      timeVerified: now.toISOString(),
      resourceUri: `${RESOURCE}@${f.ref}`,
      policy: { uri: `https://github.com/${REPO}/blob/main/security/github-ruleset.json`, digest: { sha256: policyDigest ?? sha256(JSON.stringify(f.committed ?? [])) } },
      inputAttestations: [{ uri: `source-provenance/${f.commit}.json`, digest: { sha256: sha256(JSON.stringify(provenanceEnvelope)) } }],
      verificationResult: evaluation.level >= 2 ? "PASSED" : "FAILED",
      verifiedLevels: levels,
    },
  };
}

/** Sign both statements → { provenance, vsa } DSSE envelopes. */
export function attest(f, privatePem, opts = {}) {
  const evaluation = evaluate(f);
  const provenance = signEnvelope(INTOTO_PAYLOAD, JSON.stringify(sourceProvenance(f, evaluation, opts)), privatePem);
  const vsa = signEnvelope(INTOTO_PAYLOAD, JSON.stringify(vsaStatement(f, evaluation, provenance, opts)), privatePem);
  return { evaluation, provenance, vsa };
}

/**
 * The consumer's check (release:verify): the VSA is signed by a trusted
 * source key, names this commit, PASSED at level 2, on a protected ref.
 * → { ok, problems, ref, levels }
 */
export function checkVsa(envelope, { commit, trustedPems, minLevel = "SLSA_SOURCE_LEVEL_2", refs = ["refs/heads/main", "refs/heads/verify/*"] }) {
  const problems = [];
  if (!trustedPems?.length) return { ok: false, problems: ["no trusted source key (security/source-vsa.json keys)"], ref: null, levels: [] };
  const v = verifyEnvelope(envelope, trustedPems);
  if (!v.ok) return { ok: false, problems: v.problems.map((p) => `source VSA: ${p}`), ref: null, levels: [] };
  let st;
  try {
    st = JSON.parse(v.payload.toString("utf8"));
  } catch {
    return { ok: false, problems: ["source VSA: the payload is not JSON"], ref: null, levels: [] };
  }
  if (st._type !== STATEMENT_TYPE || st.predicateType !== VSA_TYPE) problems.push(`source VSA: not an in-toto VSA (${st.predicateType})`);
  const subj = st.subject?.[0];
  if (subj?.digest?.gitCommit !== commit) problems.push(`source VSA is for ${subj?.digest?.gitCommit ?? "nothing"}, not the release commit ${commit}`);
  const ref = subj?.annotations?.sourceRefs?.[0] ?? null;
  if (!ref || !refs.some((p) => refMatches(p, ref))) problems.push(`source VSA ref ${ref} is not a protected branch`);
  if (st.predicate?.verifier?.id !== VERIFIER_ID) problems.push(`source VSA verifier ${st.predicate?.verifier?.id} is not ${VERIFIER_ID}`);
  if (st.predicate?.verificationResult !== "PASSED") problems.push(`source VSA result is ${st.predicate?.verificationResult}`);
  const levels = st.predicate?.verifiedLevels ?? [];
  if (!levels.includes(minLevel)) problems.push(`source VSA does not reach ${minLevel} (has ${levels.join(", ") || "none"})`);
  return { ok: problems.length === 0, problems, ref, levels };
}
