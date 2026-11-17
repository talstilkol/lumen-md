# cite-gate — sources and licences (synthetic set)

The cite-or-delete gate (plan R12.9): src/research/citeGate eval (eval/synthetic/cite-gate/cases.json).

**Synthetic, not golden.** Nothing here is real data and nothing names a real person. gen.py: every source, question and answer was written for this eval; labels come from construction (a claim is `keep` only when it restates a source sentence, every other unit is an adversarial lie, `delete`). Every number measured on it is a development number: its eval card is tagged `dev`, and it can never back a ✅ (scripts/lib/evalCard.mjs). Rebuild it with `python3 eval/synthetic/cite-gate/gen.py > eval/synthetic/cite-gate/cases.json`.

## Parts

| Part | Items | Committed | Status | Source | Licence | Licence verified |
|---|---|---|---|---|---|---|
| cases | 30 | 30 (cases.json) | built | Written for this repository (gen.py) | MIT | own work |

It lives under eval/synthetic, not eval/golden (coordinator decision, W7.13): it has no CI-only test split, and the golden-set rules (scripts/lib/golden.mjs) do not apply to it.
