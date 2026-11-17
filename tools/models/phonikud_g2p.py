#!/usr/bin/env python3
"""Phonikud (MIT) Hebrew G2P for the eval:public cmd engine (LUMEN_G2P_CMD,
W11.M3 / W11.H10): the sentence on stdin, one IPA word per line on stdout.

  LUMEN_G2P_CMD='python3 tools/models/phonikud_g2p.py --model models/phonikud/phonikud-1.0.int8.onnx'

Niqqud, stress and vocal shva come from the phonikud ONNX model
(phonikud-onnx), the IPA from the phonikud package's phonemizer. Both run
here; nothing is downloaded (the model file is given by path).
"""
import argparse, sys


def ipa_words(ipa):
    """The phonemizer's output split into words (punctuation dropped)."""
    out = []
    for w in ipa.split():
        w = w.strip(".,;:!?\"'()[]-–—")
        if w:
            out.append(w)
    return out


def g2p(sentence, add_diacritics, phonemize):
    return ipa_words(phonemize(add_diacritics(sentence)))


def selftest():
    assert ipa_words("ʃalˈom, olˈam. ") == ["ʃalˈom", "olˈam"]
    assert g2p("שלום עולם", lambda s: s + "!", lambda s: "ʃalˈom olˈam!") == ["ʃalˈom", "olˈam"]
    print("selftest ok")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    if not a.model:
        ap.error("--model <phonikud .onnx> is required")
    from phonikud_onnx import Phonikud
    from phonikud import phonemize
    m = Phonikud(a.model)
    print("\n".join(g2p(" ".join(sys.stdin.read().split()), m.add_diacritics, phonemize)))


if __name__ == "__main__":
    main()
