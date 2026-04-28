/**
 * Pure helpers extracted from `publish-plugin.mjs` so they can be
 * unit-tested without spawning the CLI.
 *
 * Anything in this file is side-effect-free: no fs, no fetch, no
 * process.exit. The CLI script imports + uses these helpers.
 */

import { createHash } from "node:crypto";

/**
 * Parse `--key=value` / `--flag` / `--key value` argv into a flat
 * object. Repeats overwrite. Bare positional args are dropped.
 */
export function parseArgs(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (!flag.startsWith("--")) continue;
    const eq = flag.indexOf("=");
    if (eq >= 0) {
      const k = flag.slice(2, eq);
      out[k] = flag.slice(eq + 1);
    } else {
      const k = flag.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        out[k] = next;
        i++;
      } else {
        out[k] = true;
      }
    }
  }
  return out;
}

/**
 * Compute the SHA-256 hex digest of a Buffer-like value. Used for
 * the `sha256` field in registry entries.
 */
export function sha256Hex(bundle) {
  return createHash("sha256").update(bundle).digest("hex");
}

/**
 * Build the registry entry JSON shape from a parsed package.json
 * + signature material. Keeps the CLI tiny and the contract testable.
 */
export function buildRegistryEntry(pkg, opts) {
  return {
    id: pkg.name.replace(/^@[^/]+\//, ""),
    name: pkg.lumen?.displayName ?? pkg.name,
    description: pkg.description ?? "",
    author: pkg.author ?? "Unknown",
    version: pkg.version,
    bundle: opts.bundleUrl,
    sha256: opts.sha256,
    signature: opts.signature,
    permissions: pkg.lumen?.permissions ?? [],
    keywords: pkg.keywords ?? [],
    homepage: pkg.homepage,
    repository: pkg.repository?.url ?? pkg.repository,
  };
}
