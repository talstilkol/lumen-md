/**
 * Tiny line-level 3-way diff for the conflict-resolution dialog.
 *
 * The cloud-sync engine (P2-04) uses this when local and remote
 * versions of a file have both diverged from the last sync. We
 * compute an LCS over lines and yield a sequence of three-way hunks
 * the UI can render side-by-side.
 *
 * The algorithm is `O((n+m)·d)` Myers diff over LINES (not chars) —
 * fast enough for any human-edited markdown doc (~10k lines runs in
 * a few ms on a laptop).
 */

export type DiffOp = "equal" | "local" | "remote" | "both" | "conflict";

export interface DiffHunk {
  op: DiffOp;
  /** Lines from the local side; empty for `remote`-only hunks. */
  local: string[];
  /** Lines from the remote side; empty for `local`-only hunks. */
  remote: string[];
  /** Lines from the common ancestor — useful to show "what was here before". */
  base: string[];
}

const THREE_WAY_DIFF_MAX_LINES = 3_000;
const THREE_WAY_DIFF_CONTEXT_LINES = 120;

/* ─── 2-way LCS-based line diff ──────────────────────────────────────── */

interface Edit {
  type: "equal" | "ins" | "del";
  a?: string;
  b?: string;
}

function lcsDiff(a: string[], b: string[]): Edit[] {
  // Classic dynamic-programming LCS — O(n*m) memory; fine up to ~10k×10k.
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const edits: Edit[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      edits.push({ type: "equal", a: a[i - 1], b: b[j - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      edits.push({ type: "ins", b: b[j - 1] });
      j--;
    } else {
      edits.push({ type: "del", a: a[i - 1] });
      i--;
    }
  }
  return edits.reverse();
}

interface TrimmedDiffInput {
  base: string[];
  local: string[];
  remote: string[];
  prefix: number;
  suffix: number;
}

function trimCommonEdges(
  baseLines: string[],
  localLines: string[],
  remoteLines: string[],
): TrimmedDiffInput {
  let prefix = 0;
  const maxPrefix = Math.min(baseLines.length, localLines.length, remoteLines.length);
  while (prefix < maxPrefix) {
    if (
      baseLines[prefix] === localLines[prefix] &&
      baseLines[prefix] === remoteLines[prefix]
    ) {
      prefix += 1;
    } else {
      break;
    }
  }

  let suffix = 0;
  while (
    suffix + prefix < baseLines.length &&
    suffix + prefix < localLines.length &&
    suffix + prefix < remoteLines.length
  ) {
    const b = baseLines[baseLines.length - 1 - suffix];
    const l = localLines[localLines.length - 1 - suffix];
    const r = remoteLines[remoteLines.length - 1 - suffix];
    if (b === l && b === r) {
      suffix += 1;
    } else {
      break;
    }
  }

  const maxSuffix = Math.min(
    THREE_WAY_DIFF_CONTEXT_LINES,
    suffix,
    baseLines.length - prefix,
    localLines.length - prefix,
    remoteLines.length - prefix,
  );

  const maxPrefixLines = Math.min(prefix, THREE_WAY_DIFF_CONTEXT_LINES);

  return {
    base: baseLines.slice(maxPrefixLines, baseLines.length - maxSuffix),
    local: localLines.slice(maxPrefixLines, localLines.length - maxSuffix),
    remote: remoteLines.slice(maxPrefixLines, remoteLines.length - maxSuffix),
    prefix: maxPrefixLines,
    suffix: maxSuffix,
  };
}

/* ─── 3-way merge ────────────────────────────────────────────────────── */

/**
 * Compute a 3-way merge view of `local` vs `remote` against the common
 * `base`. Each output hunk is one of:
 *   - `equal`     — identical on all three sides
 *   - `local`     — local changed, remote didn't (auto-take local)
 *   - `remote`    — remote changed, local didn't (auto-take remote)
 *   - `both`      — both sides made the same change (auto-take, no conflict)
 *   - `conflict`  — both sides made *different* changes — needs user pick
 */
export function threeWayDiff(
  base: string,
  local: string,
  remote: string,
): DiffHunk[] {
  const baseLines = base.split("\n");
  const localLines = local.split("\n");
  const remoteLines = remote.split("\n");
  const totalLines = baseLines.length + localLines.length + remoteLines.length;
  if (totalLines <= THREE_WAY_DIFF_MAX_LINES) {
    return buildThreeWayHunks(baseLines, localLines, remoteLines);
  }

  const trimmed = trimCommonEdges(baseLines, localLines, remoteLines);
  const trimmedTotal = trimmed.base.length + trimmed.local.length + trimmed.remote.length;
  if (trimmedTotal > THREE_WAY_DIFF_MAX_LINES) {
    return [
      {
        op: "conflict",
        local: localLines,
        remote: remoteLines,
        base: baseLines,
      },
    ];
  }

  const out: DiffHunk[] = [];
  if (trimmed.prefix > 0) {
    const p = trimmed.prefix;
    const prefixLines = baseLines.slice(0, p);
    out.push({ op: "equal", local: [...prefixLines], remote: [...prefixLines], base: [...prefixLines] });
  }
  const body = buildThreeWayHunks(trimmed.base, trimmed.local, trimmed.remote);
  out.push(...body);
  if (trimmed.suffix > 0) {
    const s = trimmed.suffix;
    const suffixLines = baseLines.slice(baseLines.length - s);
    out.push({ op: "equal", local: [...suffixLines], remote: [...suffixLines], base: [...suffixLines] });
  }
  return mergeAdjacent(out);
}

function buildThreeWayHunks(
  baseLines: string[],
  localLines: string[],
  remoteLines: string[],
): DiffHunk[] {

  const localEdits = lcsDiff(baseLines, localLines);
  const remoteEdits = lcsDiff(baseLines, remoteLines);

  // Walk both edit sequences in lock-step. Each "step" advances one base
  // line at a time; we look at what each side did with that base line.
  const out: DiffHunk[] = [];
  let li = 0;
  let ri = 0;
  let baseIdx = 0;
  while (baseIdx < baseLines.length || li < localEdits.length || ri < remoteEdits.length) {
    // Inserts from local (no base line consumed yet)
    while (li < localEdits.length && localEdits[li].type === "ins") {
      const localIns: string[] = [];
      while (li < localEdits.length && localEdits[li].type === "ins") {
        localIns.push(localEdits[li].b!);
        li++;
      }
      // If remote also inserts the same lines at this point → both.
      const remoteIns: string[] = [];
      while (ri < remoteEdits.length && remoteEdits[ri].type === "ins") {
        remoteIns.push(remoteEdits[ri].b!);
        ri++;
      }
      const sameInsert =
        remoteIns.length === localIns.length &&
        remoteIns.every((l, i) => l === localIns[i]);
      if (sameInsert) {
        out.push({ op: "both", local: localIns, remote: remoteIns, base: [] });
      } else if (remoteIns.length === 0) {
        out.push({ op: "local", local: localIns, remote: [], base: [] });
      } else {
        out.push({ op: "conflict", local: localIns, remote: remoteIns, base: [] });
      }
    }
    while (ri < remoteEdits.length && remoteEdits[ri].type === "ins") {
      const remoteIns: string[] = [];
      while (ri < remoteEdits.length && remoteEdits[ri].type === "ins") {
        remoteIns.push(remoteEdits[ri].b!);
        ri++;
      }
      out.push({ op: "remote", local: [], remote: remoteIns, base: [] });
    }
    if (baseIdx >= baseLines.length) break;

    const localOp = li < localEdits.length ? localEdits[li] : null;
    const remoteOp = ri < remoteEdits.length ? remoteEdits[ri] : null;
    const baseLine = baseLines[baseIdx];

    const localKept = localOp?.type === "equal";
    const remoteKept = remoteOp?.type === "equal";

    if (localKept && remoteKept) {
      out.push({ op: "equal", local: [baseLine], remote: [baseLine], base: [baseLine] });
      li++; ri++; baseIdx++;
    } else if (!localKept && remoteKept) {
      // Local deleted this line, remote kept it.
      out.push({ op: "local", local: [], remote: [baseLine], base: [baseLine] });
      li++; ri++; baseIdx++;
    } else if (localKept && !remoteKept) {
      out.push({ op: "remote", local: [baseLine], remote: [], base: [baseLine] });
      li++; ri++; baseIdx++;
    } else {
      // Both deleted the same line — `both`.
      out.push({ op: "both", local: [], remote: [], base: [baseLine] });
      li++; ri++; baseIdx++;
    }
  }

  return mergeAdjacent(out);
}

/** Merge consecutive hunks of the same op so the UI doesn't paint a row per line. */
function mergeAdjacent(hunks: DiffHunk[]): DiffHunk[] {
  const out: DiffHunk[] = [];
  for (const h of hunks) {
    const prev = out[out.length - 1];
    if (prev && prev.op === h.op) {
      prev.local.push(...h.local);
      prev.remote.push(...h.remote);
      prev.base.push(...h.base);
    } else {
      out.push({ ...h, local: [...h.local], remote: [...h.remote], base: [...h.base] });
    }
  }
  return out;
}

/**
 * Apply a user's per-conflict picks to produce the merged document.
 * `picks[i]` is "local" / "remote" / "both" for the i-th hunk that has
 * `op === "conflict"`. Non-conflict hunks are merged automatically.
 */
export function applyMerge(hunks: DiffHunk[], picks: Array<"local" | "remote" | "both">): string {
  const out: string[] = [];
  let conflictIdx = 0;
  for (const h of hunks) {
    switch (h.op) {
      case "equal":
        out.push(...h.local);
        break;
      case "local":
        out.push(...h.local);
        break;
      case "remote":
        out.push(...h.remote);
        break;
      case "both":
        out.push(...h.local); // by construction local === remote (or both deleted)
        break;
      case "conflict": {
        const pick = picks[conflictIdx++] ?? "local";
        if (pick === "local") out.push(...h.local);
        else if (pick === "remote") out.push(...h.remote);
        else {
          // "both" → keep local then remote, separated by a marker line.
          out.push(...h.local, ">>> remote >>>", ...h.remote, "<<< end remote <<<");
        }
        break;
      }
    }
  }
  return out.join("\n");
}
