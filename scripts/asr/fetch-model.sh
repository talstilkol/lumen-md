#!/usr/bin/env bash
# Download the ivrit.ai Zipformer2 streaming model (CC BY 4.0, int8, sherpa-onnx export) into $1
# (default ~/.cache/lumen-asr/zipformer2-66m-streaming-he). Used by CI and by developers; never bundled.
set -euo pipefail
dir="${1:-$HOME/.cache/lumen-asr/zipformer2-66m-streaming-he}"
rev="${LUMEN_ASR_MODEL_REV:-ee769a2a13b887f91572eec349458bfb0fe79e7a}" # pinned, as in src/ai/dictation/models.ts
mkdir -p "$dir"
for f in encoder.int8.onnx decoder.int8.onnx joiner.int8.onnx tokens.txt; do
  [ -s "$dir/$f" ] || curl -fsSL --retry 3 -o "$dir/$f" "https://huggingface.co/ivrit-ai/zipformer2-66m-streaming-he/resolve/$rev/sherpa-onnx/$f"
done
ls -l "$dir"
echo "$dir"
