#!/usr/bin/env python3
"""Chatterbox multilingual (Resemble AI, MIT) for the eval:public cmd engine
(LUMEN_TTS_CMD, W11.M2 / W11.H9): the text on stdin, a WAV written to --out.

  LUMEN_TTS_CMD='python3 tools/models/chatterbox_say.py --lang he --out {out}'

The weights come from the local Hugging Face cache (HF_HUB_OFFLINE=1 is set
unless --allow-download): the pack downloads them once, at a pinned revision,
in its setup step. Device: mps on a Mac, else cuda, else cpu.
"""
import argparse, os, sys


def device(torch):
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cuda" if torch.cuda.is_available() else "cpu"


def clean(text):
    """One line for the model: whitespace folded; empty input is an error, not silence."""
    t = " ".join(text.split())
    if not t:
        raise SystemExit("no text on stdin")
    return t


def say(text, lang, out, load, save):
    model = load()
    wav = model.generate(text, language_id=lang)
    save(out, wav, model.sr)
    return out


def selftest():
    assert clean("  שלום \n עולם ") == "שלום עולם"
    saved = {}

    class M:
        sr = 24000
        def generate(self, text, language_id): assert language_id == "he"; return ("wav", text)

    say("שלום", "he", "/tmp/x.wav", M, lambda o, w, sr: saved.update(o=o, w=w, sr=sr))
    assert saved == {"o": "/tmp/x.wav", "w": ("wav", "שלום"), "sr": 24000}
    try:
        clean("  ")
        raise AssertionError("empty text must fail")
    except SystemExit:
        pass
    print("selftest ok")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lang", default="he")
    ap.add_argument("--out")
    ap.add_argument("--allow-download", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    if not a.out:
        ap.error("--out <wav> is required")
    if not a.allow_download:
        os.environ.setdefault("HF_HUB_OFFLINE", "1")
    import torch, torchaudio
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS
    dev = device(torch)
    say(clean(sys.stdin.read()), a.lang, a.out, lambda: ChatterboxMultilingualTTS.from_pretrained(device=dev), lambda o, w, sr: torchaudio.save(o, w.cpu() if hasattr(w, "cpu") else w, sr))


if __name__ == "__main__":
    main()
