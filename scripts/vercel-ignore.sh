#!/usr/bin/env bash
# Vercel "ignoreCommand" for the web app project.
#
#   exit 0 → skip this deployment (nothing the web build consumes changed)
#   exit 1 → build
#
# Vercel limits `ignoreCommand` to 256 characters, so the logic lives here
# and vercel.json only calls this script. Usage:
#
#   scripts/vercel-ignore.sh [BASE] [HEAD]      (defaults: HEAD^ HEAD)
#
# Rules:
#   • Markdown outside public/ and src/ never triggers a build.
#   • Directories that are deployed elsewhere (docs site, edge workers, the
#     signaling server, MCP/API/marketplace servers, packages, the browser
#     extension, Tauri/iOS/Android shells, e2e, CI) do not trigger a build —
#     EXCEPT for files inside them that src/ (non-test code) imports; those
#     are web build inputs even though they live outside src/.
#   • Anything else (src/, public/, index.html, package*.json, vite/tsconfig,
#     vercel.json, scripts/, …) triggers a build.
#   • When history is unavailable (shallow clone, first commit), build.
set -u
cd "$(dirname "$0")/.." || exit 1

BASE="${1:-HEAD^}"
HEAD_REF="${2:-HEAD}"

git rev-parse --verify -q "$BASE" >/dev/null 2>&1 || exit 1
changed="$(git diff --name-only "$BASE" "$HEAD_REF" 2>/dev/null)" || exit 1
[ -z "$changed" ] && exit 0

NON_APP='^(docs|edge-workers|sync-server|mcp-server|api-server|marketplace-server|packages|extension|src-tauri|ios|android|e2e|\.github)/'

# Repo-relative stems (no extension) of modules outside src/ that src/ imports,
# e.g. "edge-workers/research/extract". Test files are ignored: they are not
# part of the production bundle.
shared="$(grep -rhoE --include='*.ts' --include='*.tsx' --exclude-dir=__tests__ \
  "from [\"']\.\./(\.\./)+[^\"']+" src 2>/dev/null \
  | sed -E "s/^from [\"']//; s#^(\.\./)+##; s/\.(ts|tsx|js|mjs)$//" | sort -u)"

while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in
    public/*|src/*) exit 1 ;;            # always app inputs
    *.md|*.MD) continue ;;               # docs-only change
  esac
  if printf '%s\n' "$f" | grep -qE "$NON_APP"; then
    stem="${f%.*}"
    for s in $shared; do
      if [ "$stem" = "$s" ] || [ "$f" = "$s" ]; then exit 1; fi
    done
    continue
  fi
  exit 1
done <<EOF
$changed
EOF
exit 0
