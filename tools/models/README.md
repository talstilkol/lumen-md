# Model wrappers for the Mac run

Each wrapper is a few lines around one model, with the input and output
contract of `scripts/eval-public/engines/cmd.mjs`. The model runs on this
machine from files you give it by path or from a pinned local cache.

| wrapper | variable | model | in → out |
|---|---|---|---|
| `sherpa_asr.py --dir D {in}` | `LUMEN_ASR_CMD` | ivrit.ai Zipformer2 66M int8 (sherpa-onnx) | audio file → transcript |
| `chatterbox_say.py --lang he --out {out}` | `LUMEN_TTS_CMD` | Chatterbox multilingual | stdin text → WAV |
| `nakdimon_dot.mjs --model F` | `LUMEN_NIKUD_CMD` | Nakdimon ONNX (the app's own decoding) | stdin text → dotted text |
| `phonikud_g2p.py --model F` | `LUMEN_G2P_CMD` | phonikud-onnx + phonikud | stdin sentence → IPA words, one a line |
| `yi_whisper_ggml.sh OUT` | (builds the ggml for `whisper-cli`) | ivrit-ai/yi-whisper-large-v3-turbo | → ggml file, its sha256 |

These need no wrapper. They are engine modules in `scripts/eval-public/engines/`:
`dictabert-ner.mjs` and `gliner.mjs` (NER), `handwriting-tesseract.mjs`
(handwriting) and `protectai.mjs` (prompt injection).

Shoshan (lemmas) has no wrapper yet. Its model card does not give the
format of its edit-script inventory (`src/search/lemma/shoshan.ts`), so
the Mac pack reads `model/` at the pinned revision first
(`FC2.shoshan-inventory`).

`python3 tools/models/<x>.py --selftest` checks each Python wrapper's
contract with stand-ins for the model. `src/__tests__/modelWrappers.test.ts`
runs them.
