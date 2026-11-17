#!/usr/bin/env node
/**
 * Reads Chrome origin-trial tokens (plan W11.P13) and says whether each one
 * fits Lumen: the origin, the feature, the expiry. A token is public (it is
 * sent to every visitor), so this only decodes; it verifies no signature.
 *
 *   node scripts/pwa/origin-trial-token.mjs --origin https://lumen-md.vercel.app [--warn-days 30] <token>…
 *
 * Token layout (Chrome's format, version 2/3): base64 of
 *   1 byte version | 64 bytes Ed25519 signature | 4 bytes payload length (big-endian) | payload JSON
 * with { origin, feature, expiry (seconds), isSubdomain?, isThirdParty?, usage? }.
 * Exit 1 when a token is for another origin, has expired, or expires within
 * --warn-days (so the Mac pack and the owner's checklist see it in time).
 */

export function decodeToken(token) {
  const buf = Buffer.from(String(token).trim(), "base64");
  if (buf.length < 69) throw new Error("not an origin-trial token: too short");
  const version = buf[0];
  if (version !== 2 && version !== 3) throw new Error(`origin-trial token version ${version}: only 2 and 3 are known`);
  const len = buf.readUInt32BE(65);
  if (69 + len !== buf.length) throw new Error("origin-trial token: payload length does not match");
  const payload = JSON.parse(buf.subarray(69).toString("utf8"));
  return { version, ...payload };
}

const originOf = (o) => {
  const u = new URL(o);
  return `${u.protocol}//${u.hostname}${u.port && u.port !== (u.protocol === "https:" ? "443" : "80") ? `:${u.port}` : ""}`;
};

/** Whether a decoded token fits `origin` at `now` (ms); a warning when it ends within `warnDays`. */
export function checkToken(t, origin, now = Date.now(), warnDays = 30) {
  const problems = [];
  if (originOf(t.origin) !== originOf(origin)) problems.push(`for ${t.origin}, not ${origin}`);
  if (t.isThirdParty) problems.push("a third-party token: the app serves its own");
  const ms = Number(t.expiry) * 1000;
  const days = Math.floor((ms - now) / 86_400_000);
  if (!Number.isFinite(ms) || ms <= now) problems.push("expired");
  else if (days < warnDays) problems.push(`expires in ${days} day(s)`);
  return { feature: t.feature, origin: t.origin, expires: Number.isFinite(ms) ? new Date(ms).toISOString() : null, days, ok: problems.length === 0, problems };
}

if (process.argv[1]?.endsWith("pwa/origin-trial-token.mjs")) {
  const args = process.argv.slice(2);
  const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
  const origin = opt("--origin", "https://lumen-md.vercel.app");
  const warn = Number(opt("--warn-days", 30));
  const tokens = args.filter((a, i) => !a.startsWith("--") && !["--origin", "--warn-days"].includes(args[i - 1]));
  if (!tokens.length) (console.error("usage: origin-trial-token.mjs [--origin URL] [--warn-days N] <token>…"), process.exit(2));
  const out = tokens.map((t) => {
    try {
      return checkToken(decodeToken(t), origin, Date.now(), warn);
    } catch (e) {
      return { ok: false, problems: [String(e.message)] };
    }
  });
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.every((r) => r.ok) ? 0 : 1);
}
