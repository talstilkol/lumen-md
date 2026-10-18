#!/usr/bin/env bash
# Coordinator side of the lanes protocol (docs/dev/lanes.md): merge lane
# branches into a target, one --no-ff merge each, then check the result.
#
#   scripts/lane-merge.sh <target-branch> <branch...>
#
# Runs in the current checkout (it must be clean; <target> gets checked out).
# A conflict only in generated files — i18n/keys.json, package-lock.json — is
# resolved by regenerating them from the merged sources:
#   i18n/keys.json     node scripts/extract-i18n-keys.mjs
#   package-lock.json  npm install --package-lock-only   (from the merged package.json)
# Any other conflict stops the run with the merge left in progress, so you can
# resolve it by hand and rerun with the branches that are left. A keys.json that
# merged cleanly but no longer matches the strings is regenerated in the merge too.
#
# Afterwards: npx tsc --noEmit -p . and npx vitest run, then a summary.
#
# Environment:
#   LANE_TRAILER       text appended to every merge commit message (e.g. the
#                      Co-Authored-By / Claude-Session lines)
#   LANE_SKIP_TESTS=1  skip vitest (tsc still runs)
set -uo pipefail

# Checking out and merging can rewrite this very file: run from a copy.
if [ -z "${LANE_MERGE_SELF:-}" ]; then
  self=$(mktemp)
  cp "$0" "$self"
  LANE_MERGE_SELF=$self exec bash "$self" "$@"
fi
trap 'rm -f "$LANE_MERGE_SELF"' EXIT

die() { echo "lane-merge: $*" >&2; exit 1; }

[ $# -ge 2 ] || die "usage: scripts/lane-merge.sh <target-branch> <branch...>"
target=$1
shift
branches=("$@")

top=$(git rev-parse --show-toplevel 2>/dev/null) || die "run this inside a lumen-md checkout"
cd "$top" || exit 1
[ -z "$(git status --porcelain --untracked-files=no)" ] || die "working tree has uncommitted changes; commit them or move them away first"
git rev-parse -q --verify MERGE_HEAD >/dev/null && die "a merge is already in progress (finish it or git merge --abort)"
git rev-parse --verify --quiet "refs/heads/$target" >/dev/null || die "target branch '$target' does not exist (create it: git branch $target <base>)"
for b in "${branches[@]}"; do
  git rev-parse --verify --quiet "$b^{commit}" >/dev/null || die "branch '$b' not found"
done

if [ "$(git symbolic-ref --quiet --short HEAD 2>/dev/null)" != "$target" ]; then
  git checkout --quiet "$target" || die "could not check out $target"
fi

GENERATED=("i18n/keys.json" "package-lock.json")
is_generated() { local f; for f in "${GENERATED[@]}"; do [ "$1" = "$f" ] && return 0; done; return 1; }

regenerate() {
  case $1 in
    i18n/keys.json)
      node scripts/extract-i18n-keys.mjs >/dev/null 2>&1 || return 1 ;;
    package-lock.json)
      # Start from our side, then let npm fold in whatever the merged package.json needs.
      git checkout --ours -- package-lock.json &&
        npm install --package-lock-only --no-audit --no-fund >/dev/null 2>&1 || return 1 ;;
  esac
  git add -- "$1"
}

summary=()
i=0
for b in "${branches[@]}"; do
  i=$((i + 1))
  if git merge-base --is-ancestor "$b" HEAD; then
    summary+=("$b|-|already merged")
    continue
  fi
  msg="Merge branch '$b' into $target"
  notes=()
  # Stop before committing, so generated files can be fixed inside the merge itself.
  if ! git merge --quiet --no-ff --no-commit "$b" >/dev/null 2>&1; then
    mapfile -t conflicted < <(git diff --name-only --diff-filter=U)
    if [ ${#conflicted[@]} -eq 0 ]; then
      git merge --abort 2>/dev/null
      die "merging $b failed before any conflict (untracked files in the way?): run git merge --no-ff $b to see why"
    fi
    other=()
    for f in "${conflicted[@]}"; do is_generated "$f" || other+=("$f"); done
    if [ ${#other[@]} -gt 0 ]; then
      echo >&2
      echo "lane-merge: STOP — $b conflicts with $target in files a person has to resolve:" >&2
      printf '    %s\n' "${other[@]}" >&2
      echo "The merge is left in progress. Resolve those files (generated ones too: rerun" >&2
      echo "node scripts/extract-i18n-keys.mjs / npm install --package-lock-only), git add, git commit," >&2
      rest=("${branches[@]:$i}")
      if [ ${#rest[@]} -gt 0 ]; then
        echo "then continue with:  scripts/lane-merge.sh $target ${rest[*]}" >&2
      else
        echo "then rerun the checks: npx tsc --noEmit -p . && npx vitest run" >&2
      fi
      echo "Or give up on this branch: git merge --abort" >&2
      [ ${#summary[@]} -gt 0 ] && { echo "Merged before the stop:" >&2; printf '    %s\n' "${summary[@]%%|*}" >&2; }
      exit 1
    fi
    for f in "${conflicted[@]}"; do
      if ! regenerate "$f"; then
        echo "lane-merge: STOP — could not regenerate $f while merging $b (merge left in progress; git merge --abort to undo)" >&2
        exit 1
      fi
    done
    notes+=("regenerated ${conflicted[*]} (conflict)")
  fi
  # Both sides can make the same textual change (say, the same new "count")
  # and merge cleanly into a keys.json that no longer matches the strings.
  if ! node scripts/extract-i18n-keys.mjs --check >/dev/null 2>&1; then
    regenerate i18n/keys.json || die "could not regenerate i18n/keys.json while merging $b (merge left in progress)"
    notes+=("refreshed i18n/keys.json (stale after the merge)")
  fi

  msgfile=$(mktemp)
  {
    echo "$msg"
    if [ ${#notes[@]} -gt 0 ]; then echo; printf '%s\n' "${notes[@]/#/Generated files: }"; fi
    if [ -n "${LANE_TRAILER:-}" ]; then echo; echo "$LANE_TRAILER"; fi
  } >"$msgfile"
  if ! git commit --quiet --cleanup=strip -F "$msgfile" >/dev/null; then
    rm -f "$msgfile"
    die "commit of the merge of $b failed (merge left in progress)"
  fi
  rm -f "$msgfile"
  if [ ${#notes[@]} -gt 0 ]; then
    summary+=("$b|$(git rev-parse --short HEAD)|$(IFS=';'; echo "${notes[*]}")")
  else
    summary+=("$b|$(git rev-parse --short HEAD)|clean")
  fi
done

echo "== checks on $target @ $(git rev-parse --short HEAD)"
ok=1
log=$(mktemp)

if npx tsc --noEmit -p . >"$log" 2>&1; then
  tsc_result="clean"
else
  ok=0
  tsc_result="$(grep -c 'error TS' "$log" || true) error(s)"
  grep 'error TS' "$log" | head -10 | sed 's/^/    /'
fi

if node scripts/extract-i18n-keys.mjs --check >"$log" 2>&1; then
  i18n_result="up to date"
else
  ok=0
  i18n_result="stale — run npm run i18n:extract and commit"
fi

if [ "${LANE_SKIP_TESTS:-}" = 1 ]; then
  vitest_result="skipped (LANE_SKIP_TESTS=1)"
elif npx vitest run >"$log" 2>&1; then
  vitest_result="green — $(grep -E '^\s*Tests\s' "$log" | tail -1 | sed -E 's/^\s*Tests\s+//')"
else
  ok=0
  vitest_result="FAILED — $(grep -E '^\s*Tests\s' "$log" | tail -1 | sed -E 's/^\s*Tests\s+//')"
  grep -E '^\s*(FAIL|×)\s' "$log" | head -15 | sed 's/^/    /'
fi
rm -f "$log"

echo
echo "== lane-merge into $target"
printf '%-40s %-10s %s\n' "branch" "merge" "result"
for row in "${summary[@]}"; do
  IFS='|' read -r b sha res <<<"$row"
  printf '%-40s %-10s %s\n' "$b" "$sha" "$res"
done
echo
echo "tsc:     $tsc_result"
echo "i18n:    $i18n_result"
echo "vitest:  $vitest_result"
[ $ok = 1 ] && echo "result:  ready" || echo "result:  NOT ready — fix the failures above before pushing $target"
[ $ok = 1 ]
