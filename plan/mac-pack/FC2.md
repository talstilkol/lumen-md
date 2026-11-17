# FC2 Mac pack

Every step has a command and a check a machine runs (`npm run mac:pack -- --only FC2`). The full commands are in FC2.json.

> Base: the train head with FC2's PRs (#1192-#1201) checked out, npm ci done (W10.M1 first)

| id | task | PR | minutes | needs |
|---|---|---|---|---|
| `FC2-W11.M6-agentdojo` | W11.M6 | #1192 | 240 | Ollama running at http://127.0.0.1:11434 |
| `FC2-W4.19-onenote` | W4.19 | #1193 | 5 | — |
| `FC2-W5.23-zotero-file` | W5.23 | #1194 | 15 | Zotero 7 with the owner's library |
| `FC2-W11.M3-dictabert-ner` | W11.M3 | #1195 | 45 | ner-nemo pinned by hand (its manifest's open question); network for the one-time conversion download |
| `FC2-W12.M1-gliner` | W12.M1 | #1195 | 60 | the local NEMO copy (W12.O1: never committed); network for the clone and the checkpoint |
| `FC2-2.6-pii-names` | 2.6 | #1195 | 20 | FC2-W11.M3-dictabert-ner; LUMEN_GOLDEN_TEST_DIR: the test split built by the L8 golden step |
| `FC2-2.7-protectai` | 2.7 | #1195 | 25 | git-lfs; LUMEN_GOLDEN_TEST_DIR |
| `FC2-4.6-unlinked` | 4.6 | #1196 | 2 | — |
| `FC2-4.15-clipper` | 4.15 | #1196 | 3 | — |
| `FC2-6.6-caption-sheet` | 6.6 | #1196 | 30 | the caption engines' models (bench:models downloads with consent) |
| `FC2-6.15-data-analysis-model` | 6.15 | #1196 | 15 | Ollama running at http://127.0.0.1:11434 |
| `FC2-W5.5-real-pdfs` | W5.5 | #1196 | 60 | LUMEN_HEBREW_PDFS: a folder of real Hebrew PDFs (rulings, articles, forms; kept local) |
| `FC2-W5.13-lecture-timing` | W5.13 | #1196 | 30 | whisper.cpp + the ivrit turbo ggml; Ollama running at http://127.0.0.1:11434; LUMEN_LECTURE_AUDIO: a 90-minute Hebrew lecture recording |
| `FC2-W12.M3-office` | W12.M3 | #1196 | 10 | brew install --cask libreoffice; brew install typst poppler |
| `FC2-e2e-wave12` | W12.H2,W12.A1,W12.T2 | #1197 | 15 | npx playwright install chromium firefox webkit |
| `FC2-W11.H14-handwriting` | W11.H14 | #1198 | 40 | the ivrit.ai handwriting benchmark export (L5.pin); ffmpeg |
| `FC2-asr-sherpa` | W11.M1,W11.H7 | #1199 | 40 | the pinned sherpa-onnx files (registry: encoder/decoder/joiner int8 + tokens.txt) in models/zipformer2-66m-streaming-he/sherpa-onnx/; ffmpeg |
| `FC2-tts-chatterbox` | W11.M2,W11.H9 | #1199 | 60 | whisper.cpp + the ivrit turbo ggml |
| `FC2-nikud-nakdimon` | W11.M3 | #1199 | 20 | models/nakdimon/Nakdimon.onnx (the registry's pinned file) |
| `FC2-g2p-phonikud` | W11.M3,W11.H10 | #1199 | 20 | models/phonikud/phonikud-1.0.int8.onnx from Phonikud/phonikud-onnx at a pinned revision |
| `FC2-yiddish-ggml` | W11.M13,W11.H18 | #1199 | 60 | a whisper.cpp checkout at $HOME/src/whisper.cpp; git-lfs; python3 with torch and transformers |
| `FC2-shoshan-inventory` | W11.H12 | #1199 | 10 | git-lfs |
| `FC2-6.2-misaki-pack` | 6.2 | #1200 | 5 | — |
| `FC2-W12.F2-typst-vendor` | W12.F2 | #1201 | 30 | network for npm and the font |
| `FC2-W11.P13-origin-trials` | W11.P13 | #1202 | 30 | — |
