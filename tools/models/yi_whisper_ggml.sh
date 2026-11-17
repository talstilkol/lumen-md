#!/bin/sh
# ivrit-ai/yi-whisper-large-v3-turbo (Apache-2.0) → a whisper.cpp ggml file
# (W11.M13, W11.H18), pinned: the Hugging Face repo at REV, OpenAI's whisper
# repo for the mel filters, and whisper.cpp's own converter. Prints the
# file's sha256 and size for models/registry.json.
#
#   REV=<hub commit> WHISPER_CPP=~/src/whisper.cpp sh tools/models/yi_whisper_ggml.sh models/
#
# Needs git-lfs, python3 with torch and transformers (the converter's).
set -eu
OUT=${1:?usage: yi_whisper_ggml.sh <out dir>}
: "${REV:?set REV to the pinned commit of ivrit-ai/yi-whisper-large-v3-turbo}"
: "${WHISPER_CPP:?set WHISPER_CPP to a whisper.cpp checkout}"
WORK=$(mktemp -d)
git clone --quiet https://huggingface.co/ivrit-ai/yi-whisper-large-v3-turbo "$WORK/hf"
git -C "$WORK/hf" checkout --quiet "$REV"
git -C "$WORK/hf" lfs pull
git clone --quiet --depth 1 https://github.com/openai/whisper "$WORK/openai-whisper"
python3 "$WHISPER_CPP/models/convert-h5-to-ggml.py" "$WORK/hf" "$WORK/openai-whisper" "$WORK"
mkdir -p "$OUT"
mv "$WORK/ggml-model.bin" "$OUT/ggml-yi-whisper-large-v3-turbo.bin"
F="$OUT/ggml-yi-whisper-large-v3-turbo.bin"
printf '{"path":"%s","revision":"%s","sha256":"%s","bytes":%s}\n' "$F" "$REV" "$(shasum -a 256 "$F" | cut -d' ' -f1)" "$(wc -c < "$F" | tr -d ' ')"
