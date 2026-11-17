#!/usr/bin/env python3
"""W13.W9 acceptance 2: our Flesch-Kincaid grade against a known library.

    python3 scripts/writing/fk-compare.py [eval/fixtures/writing/readability/fk-en.jsonl]

Each line of the file is {"id", "text", "grade"} where "grade" is lumen-md's
fleschKincaid() (written by src/__tests__/hebrewReadability.test.ts with
LUMEN_WRITE_CARDS=1). This script computes textstat.flesch_kincaid_grade
for every text and reports the largest difference.

Exit 0 when every text is within +-0.1, 1 when one is not, 2 when textstat
is not installed (this machine has no package index; run it on the Mac:
`pip install textstat`). No network is used by the script itself.
"""
import json
import sys

path = sys.argv[1] if len(sys.argv) > 1 else "eval/fixtures/writing/readability/fk-en.jsonl"
try:
    import textstat  # type: ignore
except ImportError:
    print("fk-compare: textstat is not installed here (pip install textstat) — not run")
    sys.exit(2)

rows = [json.loads(line) for line in open(path, encoding="utf-8") if line.strip()]
worst = (0.0, None)
bad = 0
for r in rows:
    ref = float(textstat.flesch_kincaid_grade(r["text"]))
    d = abs(ref - r["grade"])
    if d > worst[0]:
        worst = (d, r["id"])
    if d > 0.1:
        bad += 1
        print(f"  {r['id']}: lumen {r['grade']:.2f}  textstat {ref:.2f}  diff {d:.2f}")
print(f"fk-compare: {len(rows) - bad}/{len(rows)} within 0.1 of textstat {textstat.__version__}; largest diff {worst[0]:.2f} ({worst[1]})")
sys.exit(1 if bad else 0)
