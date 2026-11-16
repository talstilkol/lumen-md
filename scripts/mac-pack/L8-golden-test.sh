#!/usr/bin/env bash
# Wave g6 lane L8 — the held-out golden test split and its evals on the Mac,
# in one command: the "test" job of docs/archive/workflows/golden-sets.yml
# (GitHub Actions is retired, plan 15.9) run locally. It scores plan 6.1
# (asr-he), 6.3 (nikud), 6.4 (mt-he-en), 6.5 (langid), 6.7 (image-search),
# 2.6 (ner-pii), 6.15 (data-analysis) and every other set with a harness.
#
#   GOLDEN_SEED=… HF_TOKEN=… bash scripts/mac-pack/L8-golden-test.sh
#
# Optional, for the harnesses that need a converted model (plan 6.0,
# `npm run models:convert`); a harness without its model reports
# models_measured / layers_measured 0, never a made-up number:
#   NAKDIMON_ONNX (or LUMEN_NIKUD_MENAKED), MT_MODELS_DIR, IMAGE_SEARCH_MODELS_DIR
#   GOLDEN_OWNER_DIR  the owner's decrypted bundle (15.11), for the owner parts
#
# The split is built in $GOLDEN_TEST (default: a new folder under $TMPDIR),
# never in the checkout, and deleted at the end unless KEEP_GOLDEN_TEST=1.
# Writes reports/mac-pack/L8/golden-scores.json (numbers only) and
# reports/mac-pack/L8/golden-hashes.json. Exit: 0 when every set with a
# harness scored or was honestly not built; 1 when a set errored or a part
# differs from its recorded sha256; 2 when GOLDEN_SEED is missing.
set -uo pipefail
cd "$(dirname "$0")/../.."
OUT=reports/mac-pack/L8
mkdir -p "$OUT"
if [ -z "${GOLDEN_SEED:-}" ]; then
  echo "GOLDEN_SEED is not set: the held-out split cannot be built (owner item 15.9)." >&2
  exit 2
fi
GOLDEN_TEST=${GOLDEN_TEST:-$(mktemp -d "${TMPDIR:-/tmp}/lumen-golden-test.XXXXXX")}
export GOLDEN_CACHE=${GOLDEN_CACHE:-$HOME/.cache/lumen-golden}
mkdir -p "$GOLDEN_CACHE"
cleanup() { [ "${KEEP_GOLDEN_TEST:-}" = 1 ] || rm -rf "$GOLDEN_TEST"; }
trap cleanup EXIT

status=0
python3 -m pip install --quiet -r scripts/golden/requirements.txt || { echo "pip install failed: the Hugging Face parts will not build" >&2; }
command -v ffmpeg >/dev/null || echo "ffmpeg is missing (brew install ffmpeg): the asr-he audio will not decode" >&2

# The speech model for the asr-he harness (72 MB, sha256-checked).
export LUMEN_ASR_MODEL_DIR=${LUMEN_ASR_MODEL_DIR:-$HOME/.cache/lumen-asr/zipformer2-66m-streaming-he}
bash scripts/asr/fetch-model.sh "$LUMEN_ASR_MODEL_DIR" > /dev/null || echo "the asr-he model did not download: asr-he will error" >&2

# The split: the GitHub / npm / generated parts, then the Hugging Face, Tatoeba and Wikipedia jobs.
node scripts/golden/build.mjs --split test --out "$GOLDEN_TEST" || echo "warning: some GitHub / npm / generated parts failed" >&2
for job in fleurs common-voice flores belebele deepset gandalf tatoeba wikipedia-typos; do
  if { [ "$job" = common-voice ] || [ "$job" = flores ]; } && [ -z "${HF_TOKEN:-}" ]; then echo "warning: $job needs HF_TOKEN — skipped" >&2; continue; fi
  python3 -I scripts/golden/hf_build.py build --job "$job" --split test --out "$GOLDEN_TEST" || echo "warning: $job not built" >&2
done
if [ -n "${GOLDEN_OWNER_DIR:-}" ]; then node scripts/golden/owner.mjs --in "$GOLDEN_OWNER_DIR" --out "$GOLDEN_TEST" || status=1; fi

node scripts/golden.mjs hash-test --dir "$GOLDEN_TEST" --out "$OUT/golden-hashes.json" || status=1
node scripts/golden.mjs check-test --dir "$GOLDEN_TEST" || { echo "a test part differs from its recorded sha256" >&2; status=1; }
node scripts/golden/run-evals.mjs --dir "$GOLDEN_TEST" --out "$OUT/golden-scores.json" || status=1
exit $status
