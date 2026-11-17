/**
 * Staged rollout, the release side (plan W13.T1). A stable release goes out
 * to 5% of devices, then 25%, then everyone; a beta goes to every tester at
 * once (they are the canary). `halt: true` stops a release at once, for
 * everyone who has not installed it yet. The rule each device applies is
 * src/update/stagedRollout.ts (imported here, so the two cannot drift); the
 * desktop shell's copy (src-tauri/src/rollout.rs) is checked against the
 * same vectors.
 */
import { parseRollout, threshold, BUCKETS } from "../../src/update/stagedRollout.ts";
import { stampManifest } from "./tauriSigning.mjs";

export const STAGES = [5, 25, 100];

/** The first stage for a version: 100 for a beta, 5 for a stable release. */
export function firstStage(version) {
  return /-beta\.\d+$/.test(String(version)) ? 100 : STAGES[0];
}

/** The stage after `percent` (100 stays 100). */
export function nextStage(percent) {
  return STAGES.find((s) => s > percent) ?? 100;
}

/** The salt for a release: its tag, so each release reshuffles who goes first. */
export const saltOf = (tag) => String(tag);

/**
 * latest.json with this rollout. 100% drops the field (a full release, as
 * before W13.T1); `halt` is kept only when true. Validated with the app's
 * own parser, so the release never signs a manifest the app would hold as
 * malformed.
 */
export function withRollout(latest, { percent, salt, halt = latest.halt === true }) {
  const next = { ...latest };
  delete next.rollout;
  delete next.halt;
  if (percent < 100) next.rollout = { percent, salt };
  if (halt) next.halt = true;
  parseRollout(next);
  return next;
}

/** What a manifest's rollout means, in words, for the release log. */
export function describeRollout(latest) {
  const { rollout, halt } = parseRollout(latest);
  if (halt) return `HALTED: no device is offered ${latest.version}`;
  if (!rollout) return `${latest.version} is offered to every device`;
  return `${latest.version} is offered to ${rollout.percent}% of devices (≈${threshold(rollout.percent)} of ${BUCKETS} buckets, salt ${JSON.stringify(rollout.salt)})`;
}

/**
 * The next manifest for a rollout command on a downloaded, verified one:
 * { percent } sets a stage, { next: true } moves to the next, { halt: true }
 * stops it, { resume: true } lifts a halt at the stage it had. Every change
 * gets a fresh expiry (T6-I2) on the same channel, and must be signed again.
 */
export function rolloutCommand(latest, cmd, { tag, now = new Date() } = {}) {
  const cur = parseRollout(latest);
  const salt = cur.rollout?.salt ?? saltOf(tag ?? `v${latest.version}`);
  const percent = cur.rollout ? cur.rollout.percent : 100;
  let next;
  if (cmd.halt) next = withRollout(latest, { percent, salt, halt: true });
  else if (cmd.resume) next = withRollout(latest, { percent, salt, halt: false });
  else if (cmd.next) next = withRollout(latest, { percent: nextStage(percent), salt, halt: cur.halt });
  else if (typeof cmd.percent === "number") {
    if (cmd.percent < percent && !cmd.allowShrink) throw new Error(`${cmd.percent}% is below the current ${percent}%: devices that already installed it keep it; pass --shrink to offer it to fewer from now on`);
    next = withRollout(latest, { percent: cmd.percent, salt, halt: cur.halt });
  } else throw new Error("nothing to do: --percent N, --next, --halt or --resume");
  return stampManifest(next, { channel: latest.channel, now });
}

/** `--percent N | --next | --halt | --resume [--shrink] [--dry-run]`. */
export function parseRolloutArgs(argv) {
  const [tag, ...rest] = argv;
  if (!tag || tag.startsWith("--")) throw new Error("usage: npm run release:rollout -- <tag|beta-channel> --percent N | --next | --halt | --resume [--dry-run]");
  const has = (f) => rest.includes(f);
  const cmd = { tag, halt: has("--halt"), resume: has("--resume"), next: has("--next"), allowShrink: has("--shrink"), dryRun: has("--dry-run") };
  const i = rest.indexOf("--percent");
  if (i >= 0) {
    const p = Number(rest[i + 1]);
    if (!Number.isFinite(p) || p < 0 || p > 100) throw new Error("--percent takes a number from 0 to 100");
    cmd.percent = p;
  }
  const picked = [cmd.halt, cmd.resume, cmd.next, cmd.percent !== undefined].filter(Boolean).length;
  if (picked !== 1) throw new Error("pick exactly one of --percent N, --next, --halt, --resume");
  return cmd;
}
