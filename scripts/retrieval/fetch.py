#!/usr/bin/env python3
"""Plan W11.I13 — fetch the public retrieval sets for npm run eval:retrieval-public (W11.M5).

Needs network and `pip install datasets huggingface_hub`. Writes, per set,
eval/public-data/retrieval/<name>/{corpus.jsonl,queries.jsonl,qrels.tsv,source.json}
with the pinned dataset revision (commit sha) it read. The data stays out of git.
MAFAT HSRC is not fetched: it needs a registration (owner item W11.O4).
"""
import json, os, sys
from huggingface_hub import HfApi
from datasets import load_dataset

OUT = sys.argv[1] if len(sys.argv) > 1 else "eval/public-data/retrieval"
api = HfApi()

def rev(repo):
    return api.dataset_info(repo).sha

def write(name, corpus, queries, qrels, repo, license_):
    d = os.path.join(OUT, name); os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, "corpus.jsonl"), "w") as f:
        for _id, title, text in corpus: f.write(json.dumps({"_id": _id, "title": title, "text": text}, ensure_ascii=False) + "\n")
    with open(os.path.join(d, "queries.jsonl"), "w") as f:
        for _id, text in queries: f.write(json.dumps({"_id": _id, "text": text}, ensure_ascii=False) + "\n")
    with open(os.path.join(d, "qrels.tsv"), "w") as f:
        f.write("query-id\tcorpus-id\tscore\n")
        for q, c, s in qrels: f.write(f"{q}\t{c}\t{s}\n")
    json.dump({"source": f"https://huggingface.co/datasets/{repo}", "revision": rev(repo), "license": license_}, open(os.path.join(d, "source.json"), "w"))

def beir(name, repo, qrels_repo, split, license_, config=None):
    c = load_dataset(repo, "corpus" if config is None else f"{config}-corpus", split="corpus" if config is None else "test")
    q = load_dataset(repo, "queries" if config is None else f"{config}-queries", split="queries" if config is None else "test")
    r = load_dataset(qrels_repo, config, split=split) if config else load_dataset(qrels_repo, split=split)
    write(name, [(str(x["_id"]), x.get("title", ""), x["text"]) for x in c], [(str(x["_id"]), x["text"]) for x in q],
          [(str(x["query-id"]), str(x["corpus-id"]), x["score"]) for x in r], repo, license_)

def belebele(name, q_lang, d_lang):
    repo = "facebook/belebele"
    qs = load_dataset(repo, split=q_lang); ds = load_dataset(repo, split=d_lang)
    links = {}
    for x in ds: links.setdefault(x["link"], f"p{len(links)}")
    text = {links[x["link"]]: x["flores_passage"] for x in ds}
    write(name, [(i, "", t) for i, t in text.items()], [(f'{x["link"]}#{x["question_number"]}', x["question"]) for x in qs if x["link"] in links],
          [(f'{x["link"]}#{x["question_number"]}', links[x["link"]], 1) for x in qs if x["link"] in links], repo, "see the dataset card")

for n, r in [("beir-scifact", "BeIR/scifact"), ("beir-nfcorpus", "BeIR/nfcorpus"), ("beir-fiqa", "BeIR/fiqa")]:
    beir(n, r, f"{r}-qrels", "test", "see the dataset card")
beir("webfaq-heb", "mteb/WebFAQRetrieval", "mteb/WebFAQRetrieval", "test", "CC-BY-4.0", config="heb")
belebele("belebele-heb", "heb_Hebr", "heb_Hebr")
belebele("belebele-he-en", "heb_Hebr", "eng_Latn")
# W12.A3: HeQ v1.1 test in its upstream form, at the commit the golden sets pin (scripts/golden/defs.mjs).
import hashlib, urllib.request
HEQ_COMMIT = "f46d2ff1b796a95e897530f167ae0d5bed123fe1"
HEQ_SHA256 = "aa3c8107919bb04a95c8fc572121d07c38b23f35ac33630dea32a384d6aea5db"
heq_dir = os.path.join(os.path.dirname(OUT.rstrip("/")) or ".", "heq"); os.makedirs(heq_dir, exist_ok=True)
raw = urllib.request.urlopen(f"https://raw.githubusercontent.com/NNLP-IL/Hebrew-Question-Answering-Dataset/{HEQ_COMMIT}/data/data%20v1.1/test%20v1.1.json").read()
assert hashlib.sha256(raw).hexdigest() == HEQ_SHA256, "HeQ test v1.1: sha256 differs from the pinned file"
open(os.path.join(heq_dir, "test v1.1.json"), "wb").write(raw)
print("fetched into", OUT)
