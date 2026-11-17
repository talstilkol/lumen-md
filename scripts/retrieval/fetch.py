#!/usr/bin/env python3
"""Plan W11.I13 — fetch the public retrieval sets for npm run eval:retrieval-public (W11.M5).

Needs network and `pip install datasets huggingface_hub`. Writes, per set,
eval/public-data/retrieval/<name>/{corpus.jsonl,queries.jsonl,qrels.tsv,source.json}
with the pinned dataset revision (commit sha) it read. The data stays out of git.
MAFAT HSRC is not fetched: it needs a registration (owner item W11.O4).

W10.B18 licence gate: WebFAQ-heb (mteb/WebFAQRetrieval) and Belebele
(facebook/belebele) are written only when the dataset card's `license:` is
the one the plan accepts (LICENCE_GATE; the same table as
scripts/golden/evals/rerank.mjs PUBLIC_RERANK_SETS). A mismatch refuses that
set (exit 3 at the end) and writes nothing for it. source.json records the
revision read, the card's licence and the sha256 of every file written; the
rerank eval uses a set only when all of that still holds.

Pins: with --pins FILE (eval/retrieval-public.pins.json), the revision and
sha256 of each gated set are written to FILE the first time; once FILE
exists, the pinned revision is the one read, and a sha256 that differs
refuses the set. The pins file holds no data and may be committed.
"""
import hashlib, json, os, sys

args = [a for a in sys.argv[1:] if not a.startswith("--")]
PINS = next((sys.argv[i + 1] for i, a in enumerate(sys.argv[:-1]) if a == "--pins"), None)
if PINS:
    args = [a for a in args if a != PINS]
OUT = args[0] if args else "eval/public-data/retrieval"

# Keep in step with scripts/golden/evals/rerank.mjs PUBLIC_RERANK_SETS.
LICENCE_GATE = {"webfaq-heb": ("mteb/WebFAQRetrieval", "cc-by-4.0"), "belebele-heb": ("facebook/belebele", "cc-by-sa-4.0"), "belebele-he-en": ("facebook/belebele", "cc-by-sa-4.0")}


class Refused(Exception):
    pass


def card_license(info):
    """The dataset card's `license:` (a value or a list), lower-case."""
    cd = getattr(info, "card_data", None) or getattr(info, "cardData", None) or {}
    lic = cd.get("license") if hasattr(cd, "get") else getattr(cd, "license", None)
    if lic is None:
        return []
    return [str(x).strip().lower() for x in (lic if isinstance(lic, list) else [lic])]


def licence_problem(name, card_licences):
    """None when `name` may be written, else why not (sets outside the gate are not gated)."""
    if name not in LICENCE_GATE:
        return None
    repo, want = LICENCE_GATE[name]
    if want not in card_licences:
        return f"{name}: the card of {repo} says license {card_licences or 'none'}, the plan accepts {want} — not written"
    return None


def load_pins():
    if PINS and os.path.exists(PINS):
        with open(PINS, encoding="utf-8") as f:
            return json.load(f)
    return {}


pins = load_pins()
refused = []

if __name__ == "__main__":
    from huggingface_hub import HfApi
    from datasets import load_dataset

    api = HfApi()

def info_of(repo):
    pinned = next((p["revision"] for p in pins.get("sets", {}).values() if p.get("repo") == repo), None)
    return api.dataset_info(repo, revision=pinned) if pinned else api.dataset_info(repo)

def rev(repo):
    return info_of(repo).sha

def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()

def write(name, corpus, queries, qrels, repo, license_):
    d = os.path.join(OUT, name); os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, "corpus.jsonl"), "w") as f:
        for _id, title, text in corpus: f.write(json.dumps({"_id": _id, "title": title, "text": text}, ensure_ascii=False) + "\n")
    with open(os.path.join(d, "queries.jsonl"), "w") as f:
        for _id, text in queries: f.write(json.dumps({"_id": _id, "text": text}, ensure_ascii=False) + "\n")
    with open(os.path.join(d, "qrels.tsv"), "w") as f:
        f.write("query-id\tcorpus-id\tscore\n")
        for q, c, s in qrels: f.write(f"{q}\t{c}\t{s}\n")
    info = info_of(repo)
    lic = card_license(info)
    shas = {f: sha256_file(os.path.join(d, f)) for f in ("corpus.jsonl", "queries.jsonl", "qrels.tsv")}
    pin = pins.get("sets", {}).get(name)
    if pin and pin.get("sha256") != shas:
        for f in shas:
            os.remove(os.path.join(d, f))
        raise Refused(f"{name}: the files differ from the pinned sha256 in {PINS}")
    json.dump({"source": f"https://huggingface.co/datasets/{repo}", "revision": info.sha, "license": license_, "cardLicense": lic[0] if len(lic) == 1 else lic, "sha256": shas}, open(os.path.join(d, "source.json"), "w"))
    if PINS and name in LICENCE_GATE and not pin:
        pins.setdefault("sets", {})[name] = {"repo": repo, "revision": info.sha, "cardLicense": lic[0] if len(lic) == 1 else lic, "sha256": shas}

def gate(name, repo):
    why = licence_problem(name, card_license(info_of(repo)))
    if why:
        raise Refused(why)

def beir(name, repo, qrels_repo, split, license_, config=None):
    gate(name, repo)
    rv = rev(repo)
    c = load_dataset(repo, "corpus" if config is None else f"{config}-corpus", split="corpus" if config is None else "test", revision=rv)
    q = load_dataset(repo, "queries" if config is None else f"{config}-queries", split="queries" if config is None else "test", revision=rv)
    r = load_dataset(qrels_repo, config, split=split, revision=rev(qrels_repo)) if config else load_dataset(qrels_repo, split=split, revision=rev(qrels_repo))
    write(name, [(str(x["_id"]), x.get("title", ""), x["text"]) for x in c], [(str(x["_id"]), x["text"]) for x in q],
          [(str(x["query-id"]), str(x["corpus-id"]), x["score"]) for x in r], repo, license_)

def belebele(name, q_lang, d_lang):
    repo = "facebook/belebele"
    gate(name, repo)
    rv = rev(repo)
    qs = load_dataset(repo, split=q_lang, revision=rv); ds = load_dataset(repo, split=d_lang, revision=rv)
    links = {}
    for x in ds: links.setdefault(x["link"], f"p{len(links)}")
    text = {links[x["link"]]: x["flores_passage"] for x in ds}
    write(name, [(i, "", t) for i, t in text.items()], [(f'{x["link"]}#{x["question_number"]}', x["question"]) for x in qs if x["link"] in links],
          [(f'{x["link"]}#{x["question_number"]}', links[x["link"]], 1) for x in qs if x["link"] in links], repo, "CC-BY-SA-4.0")

def run(fn, *a, **kw):
    try:
        fn(*a, **kw)
    except Refused as e:
        refused.append(str(e))
        print(f"refused: {e}", file=sys.stderr)

if __name__ != "__main__":
    raise SystemExit  # imported for its pure parts (licence_problem, card_license): nothing is fetched

for n, r in [("beir-scifact", "BeIR/scifact"), ("beir-nfcorpus", "BeIR/nfcorpus"), ("beir-fiqa", "BeIR/fiqa")]:
    run(beir, n, r, f"{r}-qrels", "test", "see the dataset card")
run(beir, "webfaq-heb", "mteb/WebFAQRetrieval", "mteb/WebFAQRetrieval", "test", "CC-BY-4.0", config="heb")
run(belebele, "belebele-heb", "heb_Hebr", "heb_Hebr")
run(belebele, "belebele-he-en", "heb_Hebr", "eng_Latn")
if PINS and pins:
    with open(PINS, "w", encoding="utf-8") as f:
        json.dump(pins, f, indent=2, sort_keys=True)
        f.write("\n")
# W12.A3: HeQ v1.1 test in its upstream form, at the commit the golden sets pin (scripts/golden/defs.mjs).
import hashlib, urllib.request
HEQ_COMMIT = "f46d2ff1b796a95e897530f167ae0d5bed123fe1"
HEQ_SHA256 = "aa3c8107919bb04a95c8fc572121d07c38b23f35ac33630dea32a384d6aea5db"
heq_dir = os.path.join(os.path.dirname(OUT.rstrip("/")) or ".", "heq"); os.makedirs(heq_dir, exist_ok=True)
raw = urllib.request.urlopen(f"https://raw.githubusercontent.com/NNLP-IL/Hebrew-Question-Answering-Dataset/{HEQ_COMMIT}/data/data%20v1.1/test%20v1.1.json").read()
assert hashlib.sha256(raw).hexdigest() == HEQ_SHA256, "HeQ test v1.1: sha256 differs from the pinned file"
open(os.path.join(heq_dir, "test v1.1.json"), "wb").write(raw)
print("fetched into", OUT)
if refused:
    sys.exit(3)
