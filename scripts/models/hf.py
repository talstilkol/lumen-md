#!/usr/bin/env python3
"""Hugging Face side of scripts/models/convert.mjs (plan 6.0, W1.17).

  hf.py info <id>            JSON: hf, task, revision, card licence, licence_ok
  hf.py mirror <id> <out>    SigLIP: download the first working ONNX mirror (q8 + q4f16 only);
                             JSON: mirror, revision, onnx files; exit 1 when none works

Reads models/convert-targets.json; needs `pip install "huggingface_hub>=0.25"`.
"""
import json
import os
import sys

TARGETS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "models", "convert-targets.json")


def target(model_id):
    t = json.load(open(TARGETS, encoding="utf8"))
    for m in t["models"]:
        if m["id"] == model_id or (model_id == "siglip" and m["id"].startswith("siglip")):
            return m
    sys.exit(f"unknown model id {model_id}")


def info(model_id):
    from huggingface_hub import model_info

    m = target(model_id)
    i = model_info(m["hf"])
    lic = str(getattr(i.card_data, "license", "") or "") if i.card_data else ""
    print(json.dumps({"hf": m["hf"], "task": m["task"], "revision": i.sha, "card": lic, "licence_ok": lic.lower() == m["cardLicense"].lower()}))


def mirror(model_id, out):
    from huggingface_hub import model_info, snapshot_download

    m = target(model_id)
    for repo in m.get("mirrors", []):
        try:
            i = model_info(repo)
        except Exception as e:  # noqa: BLE001 — any failure means: try the next mirror
            print(f"mirror {repo}: not reachable: {e}", file=sys.stderr)
            continue
        snapshot_download(repo, revision=i.sha, local_dir=out, allow_patterns=["*.json", "*.txt", "onnx/*_quantized.onnx", "onnx/*_q4f16.onnx"])
        onnx = sorted(os.listdir(os.path.join(out, "onnx"))) if os.path.isdir(os.path.join(out, "onnx")) else []
        if not onnx:
            print(f"mirror {repo}: no q8/q4f16 ONNX files", file=sys.stderr)
            continue
        print(json.dumps({"mirror": repo, "revision": i.sha, "onnx": onnx}))
        return
    sys.exit(1)


if __name__ == "__main__":
    cmd, *rest = sys.argv[1:] or [""]
    if cmd == "info" and len(rest) == 1:
        info(rest[0])
    elif cmd == "mirror" and len(rest) == 2:
        mirror(*rest)
    else:
        sys.exit(__doc__)
