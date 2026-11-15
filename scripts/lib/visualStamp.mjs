/**
 * Which environment rendered the visual baselines (plan 10.3; brought from
 * test/visual-ci's scripts/visual-stamp.mjs, 078f6777ae, without its removal
 * of the GitHub-rendered PNGs being undone: those belong to another machine).
 *
 * Pixels only compare within one environment (Chromium build, OS, fonts).
 * `npm run visual:approve -- visual` writes
 * visual/__baselines__/<platform>/ENVIRONMENT.json next to the PNGs it
 * approved; the Buildkite `visual` step checks it before comparing, so a run
 * with no baselines, or on another Chromium, fails with the reason instead
 * of with 44 pixel diffs.
 */
import { join } from "node:path";

export const BASELINES = "visual/__baselines__";
export const STAMP = "ENVIRONMENT.json";

/** The baselines folder for a platform (Playwright's `{platform}` in snapshotPathTemplate). */
export const baselineDir = (platform) => join(BASELINES, platform);

/**
 * @param {{ platform: string, chromium: string, os: string, where?: string, renderedAt: string }} env
 * @param {number} pngs  how many PNGs were approved
 */
export function makeStamp(env, pngs) {
  return {
    renderedAt: env.renderedAt,
    platform: env.platform,
    chromium: env.chromium,
    os: env.os,
    where: env.where ?? "a local machine",
    pngs,
    note: "Compare in this environment; elsewhere the fonts differ and every shot fails. Refresh with `npm run visual:approve -- visual` there first.",
  };
}

/**
 * Why the comparison can't run here, or [] when it can.
 * @param {{ platform: string, chromium: string }} here
 * @param {string[]} files  the names in baselineDir(here.platform), or null when it doesn't exist
 * @param {object | null} stamp  the parsed ENVIRONMENT.json, or null
 */
export function stampProblems(here, files, stamp) {
  const dir = baselineDir(here.platform);
  const approve = "a person runs `npm run visual:approve -- visual` on this machine, reviews every PNG and commits them";
  if (!files) return [`no baselines for ${here.platform}: ${dir}/ does not exist (${approve})`];
  const pngs = files.filter((f) => f.endsWith(".png"));
  if (!pngs.length) return [`no baselines for ${here.platform}: ${dir}/ has no PNG (${approve})`];
  if (!stamp) return [`${dir}/${STAMP} is missing: nothing says which Chromium rendered these ${pngs.length} PNGs (${approve})`];
  const out = [];
  if (stamp.platform && stamp.platform !== here.platform) out.push(`${dir}/${STAMP} was written on ${stamp.platform}, this is ${here.platform}`);
  if (stamp.chromium !== here.chromium) out.push(`the baselines were rendered by Chromium ${stamp.chromium}, this run has ${here.chromium}: the pixels are not comparable (${approve})`);
  return out;
}
