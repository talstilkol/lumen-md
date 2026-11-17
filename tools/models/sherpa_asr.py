#!/usr/bin/env python3
"""ivrit.ai Zipformer2 streaming (CC BY 4.0) through sherpa-onnx, for the
eval:public cmd engine (LUMEN_ASR_CMD, W11.M1 / W11.H7): one audio file in,
the transcript only on stdout.

  LUMEN_ASR_CMD='python3 tools/models/sherpa_asr.py --dir models/zipformer2-he {in}'

--dir holds the pinned files (models/registry.json: sherpa-onnx/encoder.int8.onnx,
decoder.int8.onnx, joiner.int8.onnx, and tokens.txt). Any audio ffmpeg reads
is resampled to 16 kHz mono. Local only: sherpa-onnx loads files, nothing more.
"""
import argparse, os, subprocess, sys

FILES = ("encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt")


def model_files(d):
    sub = os.path.join(d, "sherpa-onnx")
    base = sub if os.path.isdir(sub) else d
    paths = {f: os.path.join(base, f) for f in FILES}
    missing = [f for f, p in paths.items() if not os.path.exists(p)]
    if missing:
        raise SystemExit("missing in %s: %s" % (base, ", ".join(missing)))
    return paths


def pcm16k(path):
    """ffmpeg → 16 kHz mono float32 samples (a list of floats via array)."""
    import array
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", path, "-ar", "16000", "-ac", "1", "-f", "f32le", "-"], check=True, capture_output=True).stdout
    a = array.array("f")
    a.frombytes(raw)
    return a


def transcribe(paths, samples, sherpa_onnx):
    rec = sherpa_onnx.OnlineRecognizer.from_transducer(
        tokens=paths["tokens.txt"], encoder=paths["encoder.int8.onnx"], decoder=paths["decoder.int8.onnx"], joiner=paths["joiner.int8.onnx"],
        num_threads=4, sample_rate=16000, feature_dim=80, decoding_method="greedy_search")
    s = rec.create_stream()
    s.accept_waveform(16000, samples)
    s.accept_waveform(16000, [0.0] * 8000)  # tail padding: the last word is decoded
    s.input_finished()
    while rec.is_ready(s):
        rec.decode_stream(s)
    r = rec.get_result(s)
    return (r if isinstance(r, str) else getattr(r, "text", str(r))).strip()


def selftest():
    import tempfile
    d = tempfile.mkdtemp()
    os.makedirs(os.path.join(d, "sherpa-onnx"))
    for f in FILES:
        open(os.path.join(d, "sherpa-onnx", f), "w").close()
    p = model_files(d)
    assert p["joiner.int8.onnx"].endswith("sherpa-onnx/joiner.int8.onnx")

    class Stream:
        def __init__(self): self.n = 0; self.done = False
        def accept_waveform(self, sr, x): assert sr == 16000; self.n += len(x)
        def input_finished(self): self.done = True

    class Rec:
        calls = 0
        @staticmethod
        def from_transducer(**kw):
            assert kw["decoding_method"] == "greedy_search" and kw["sample_rate"] == 16000
            return Rec()
        def create_stream(self): return Stream()
        def is_ready(self, s): Rec.calls += 1; return Rec.calls < 3
        def decode_stream(self, s): pass
        def get_result(self, s): assert s.done and s.n == 16000 + 8000; return " שלום עולם "

    class Fake: OnlineRecognizer = Rec
    assert transcribe(p, [0.0] * 16000, Fake) == "שלום עולם"
    print("selftest ok")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("audio", nargs="?")
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    if not a.dir or not a.audio:
        ap.error("--dir <model folder> <audio> are required")
    import sherpa_onnx
    print(transcribe(model_files(a.dir), pcm16k(a.audio), sherpa_onnx))


if __name__ == "__main__":
    main()
