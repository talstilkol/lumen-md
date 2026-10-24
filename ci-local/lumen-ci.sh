#!/usr/bin/env bash
# Local CI for lumen-md worktrees — replaces GitHub Actions (minutes exhausted, 24.10.2026).
#
#   /home/claude/ci/lumen-ci.sh <worktree> [--e2e all|related|smoke|none] [--base <ref>] [--skip step,step] [--only step,step]
#
# Steps (same as the `check` job + e2e on Chromium): typecheck, hygiene, test (full vitest), licenses, i18n, build+budget, e2e.
# Heavy steps run under one machine-wide lock (/home/claude/ci/lock): 7 GB RAM, one build at a time.
# Writes /home/claude/ci/reports/<branch>__<sha>.md and prints the summary table (paste it into the PR body).
# Deletes <worktree>/dist at the end (only when the path is a worktree under /home/claude).
set -u
WT="${1:?worktree path}"; shift
E2E="related"; BASE=""; SKIP=""; ONLY=""
while [ $# -gt 0 ]; do case "$1" in
  --e2e) E2E="$2"; shift 2;; --base) BASE="$2"; shift 2;; --skip) SKIP="$2"; shift 2;; --only) ONLY="$2"; shift 2;;
  *) echo "unknown arg $1"; exit 2;; esac; done
case "$WT" in /home/claude/*) ;; *) echo "worktree must be under /home/claude"; exit 2;; esac
[ -e "$WT/.git" ] || { echo "$WT is not a git worktree"; exit 2; }
cd "$WT" || exit 2
BR=$(git rev-parse --abbrev-ref HEAD); SHA=$(git rev-parse --short HEAD)
mkdir -p /home/claude/ci/reports /home/claude/ci/logs
REP="/home/claude/ci/reports/${BR//\//_}__${SHA}.md"; LOG="/home/claude/ci/logs/${BR//\//_}__${SHA}"
export NODE_OPTIONS="--max-old-space-size=3072" CI=1 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 FORCE_COLOR=0
[ -L node_modules ] || [ -d node_modules ] || ln -s /home/claude/wa4/node_modules node_modules
want() { local s=$1; [ -n "$ONLY" ] && { echo ",$ONLY," | grep -q ",$s," || return 1; }; echo ",$SKIP," | grep -q ",$s," && return 1; return 0; }
declare -a ROWS; FAIL=0
row() { ROWS+=("| $1 | $2 | $3 | $4 |"); [ "$2" = "❌ fail" ] && FAIL=1; }
runstep() { # id title cmd...
  local id=$1 title=$2; shift 2; local t0=$(date +%s)
  if "$@" > "$LOG.$id.log" 2>&1; then st="✅ pass"; else st="❌ fail"; fi
  local t=$(( $(date +%s) - t0 )); row "$title" "$st" "${t}s" "$(tail -c 300 "$LOG.$id.log" | tr '\n' ' ' | sed 's/|/¦/g' | cut -c1-160)"
}
T0=$(date +%s)
# light steps outside the lock (one small lock so at most one tsc runs at a time)
exec 8>/home/claude/ci/lock-light; flock 8
want typecheck && runstep typecheck "typecheck (tsc --noEmit)" npx tsc --noEmit
want hygiene && [ -f scripts/check-code-hygiene.mjs ] && runstep hygiene "hygiene" node scripts/check-code-hygiene.mjs
want licenses && [ -f scripts/licenses.mjs ] && runstep licenses "licence gate" node scripts/licenses.mjs
if want i18n; then
  [ -f scripts/extract-i18n-keys.mjs ] && runstep i18n "i18n keys (--check)" node scripts/extract-i18n-keys.mjs --check
  [ -f scripts/check-i18n-hardcoded.mjs ] && runstep i18nhc "i18n hard-coded strings" node scripts/check-i18n-hardcoded.mjs
fi
flock -u 8
if [ "$FAIL" = 1 ] && [ -z "$ONLY" ]; then echo "ci-local: a light step failed — skipping the heavy steps (fix and rerun)"; SKIP="$SKIP,test,build,e2e,cargo"; fi
echo "ci-local: $WT ($BR @ $SHA) — waiting for the machine lock…"
exec 9>/home/claude/ci/lock; flock 9; echo "ci-local: lock acquired $(date +%H:%M:%S)"
want test && runstep test "test (vitest run, full)" npx vitest run --maxWorkers=2 --reporter=dot
if want build; then
  runstep build "build (tsc -b && vite build)" npm run -s build
  [ -f scripts/bundle-budget.mjs ] && runstep budget "startup bundle budget" node scripts/bundle-budget.mjs
fi
if want e2e && [ "$E2E" != "none" ]; then
  if [ ! -d dist ]; then runstep build2 "build (for e2e)" npm run -s build; fi
  SPECS=""
  if [ "$E2E" = "related" ]; then
    base="${BASE:-$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null || echo origin/main)}"
    mb=$(git merge-base HEAD "$base" 2>/dev/null || echo "")
    changed=$( { git diff --name-only "$mb" HEAD 2>/dev/null; git status --porcelain | cut -c4-; } | sort -u)
    SPECS=$(echo "$changed" | grep -E '^e2e/.*\.spec\.ts$' | tr '\n' ' ')
    if echo "$changed" | grep -qE '^e2e/(fixtures|helpers|utils|global|.*\.ts$)' && ! echo "$changed" | grep -qE '^e2e/.*\.spec\.ts$'; then SPECS=""; E2E=all; fi
    [ -z "$SPECS" ] && [ "$E2E" = "related" ] && SPECS="$(ls e2e/smoke.spec.ts e2e/surfaces-smoke.spec.ts e2e/rtl.spec.ts e2e/csp-violations.spec.ts 2>/dev/null | tr "\n" " ")"
  elif [ "$E2E" = "smoke" ]; then SPECS="$(ls e2e/smoke*.spec.ts e2e/rtl.spec.ts 2>/dev/null | tr '\n' ' ')"; fi
  PORT=$(node -e 'const s=require("net").createServer();s.listen(0,()=>{console.log(s.address().port);s.close()})')
  npx vite preview --port "$PORT" --strictPort --host 127.0.0.1 > "$LOG.preview.log" 2>&1 &
  PV=$!; for i in $(seq 1 60); do curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break; sleep 1; done
  # Playwright in the shared node_modules wants a newer headless shell than the one installed under /opt/pw-browsers;
  # a throwaway config (never committed: listed in .git/info/exclude) points the chromium project at the installed binary.
  cat > playwright.ci-local.config.ts <<'PWC'
import base from "./playwright.config";
import { defineConfig, devices } from "@playwright/test";
export default defineConfig({ ...base, projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], launchOptions: { executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" } } }], webServer: undefined });
PWC
  ex=$(git rev-parse --git-path info/exclude); mkdir -p "$(dirname "$ex")"; grep -qx 'playwright.ci-local.config.ts' "$ex" 2>/dev/null || echo 'playwright.ci-local.config.ts' >> "$ex"
  # shellcheck disable=SC2086
  runstep e2e "e2e chromium (${E2E}${SPECS:+: $(echo $SPECS | wc -w) spec files})" env PLAYWRIGHT_BASE_URL="http://127.0.0.1:$PORT" npx playwright test -c playwright.ci-local.config.ts --project=chromium --workers=1 --retries=1 --reporter=line $SPECS
  rm -f "$WT/playwright.ci-local.config.ts"
  kill "$PV" 2>/dev/null; wait "$PV" 2>/dev/null
  PASSED=$(grep -oE '[0-9]+ passed' "$LOG.e2e.log" | tail -1); FAILED=$(grep -oE '[0-9]+ failed' "$LOG.e2e.log" | tail -1); FLAKY=$(grep -oE '[0-9]+ flaky' "$LOG.e2e.log" | tail -1)
  ROWS[${#ROWS[@]}-1]="${ROWS[${#ROWS[@]}-1]%|*}| ${PASSED:-?} ${FAILED:+· $FAILED} ${FLAKY:+· $FLAKY} |"
fi
if [ -d src-tauri ] && want cargo; then
  if git diff --name-only "$(git merge-base HEAD "${BASE:-origin/main}" 2>/dev/null || echo HEAD~1)" HEAD | grep -q '^src-tauri/'; then
    for d in $(find src-tauri -name Cargo.toml -maxdepth 3 -not -path '*/target/*' | xargs -n1 dirname); do runstep "cargo_$(basename "$d")" "cargo test ($d)" bash -c "cd '$d' && cargo test --quiet"; done
  fi
fi
T=$(( $(date +%s) - T0 ))
case "$WT" in /home/claude/w*) [ -d "$WT/dist" ] && rm -rf "$WT/dist";; esac
{
  echo "## Local CI — \`$BR\` @ \`$SHA\` — $(date '+%d.%m %H:%M') — ${T}s — $([ $FAIL = 0 ] && echo '**PASS**' || echo '**FAIL**')"
  echo; echo "GitHub Actions minutes are exhausted; this is the same \`check\` job run on the coordinator's machine (7 GB RAM, serialized). Firefox and WebKit e2e are **not run** locally (browsers unavailable)."
  echo; echo "| step | result | time | note |"; echo "|---|---|---|---|"; printf '%s\n' "${ROWS[@]}"
  echo; echo "Logs: \`$LOG.*.log\`"
} > "$REP"
cat "$REP"
exit $FAIL
