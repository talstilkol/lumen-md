# claims — sources and licences (synthetic set)

The claim extractor (plan R12.11): the claim extractor eval (eval/synthetic/claims/cases.json).

**Synthetic, not golden.** Nothing here is real data and nothing names a real person. gen.py: invented names, scripted model drafts, labels by construction. Every number measured on it is a development number: its eval card is tagged `dev`, and it can never back a ✅ (scripts/lib/evalCard.mjs). Rebuild it with `python3 eval/synthetic/claims/gen.py > eval/synthetic/claims/cases.json`.

## Parts

| Part | Items | Committed | Status | Source | Licence | Licence verified |
|---|---|---|---|---|---|---|
| cases | 20 | 20 (cases.json) | built | Written for this repository (gen.py) | MIT | own work |

It lives under eval/synthetic, not eval/golden (coordinator decision, W7.13): it has no CI-only test split, and the golden-set rules (scripts/lib/golden.mjs) do not apply to it.
