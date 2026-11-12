#!/bin/sh
# PROBE (verify/e2e-probe-N only, never merged): the failing e2e spec files
# of the full chromium run, without vitest, with the compact failure block
# also written to dist/__e2e/report.txt. Always exits 0 so dist/ deploys.
export LUMEN_E2E_SPECS="e2e/a11y.spec.ts e2e/ai-doctor.spec.ts e2e/canvas-excalidraw.spec.ts e2e/collab-persist.spec.ts e2e/data-safety.spec.ts e2e/image-search.spec.ts e2e/live-exec.spec.ts e2e/pdf-reader.spec.ts e2e/perf-vault.spec.ts e2e/properties.spec.ts e2e/pwa-offline.spec.ts e2e/pwa.spec.ts e2e/rtl-matrix.spec.ts e2e/rtl-parity.spec.ts e2e/sync-providers.spec.ts e2e/touch.spec.ts e2e/vault-encryption.spec.ts e2e/vault-tasks.spec.ts e2e/wiki-autocomplete.spec.ts"
export LUMEN_E2E_MINUTES=30
export LUMEN_E2E_REPORT_FILE=dist/__e2e/report.txt
node scripts/vercel-build.mjs --e2e-only
echo "probe: vercel-build exited $?"
exit 0
