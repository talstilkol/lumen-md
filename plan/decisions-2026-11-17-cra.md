# Lane g4-L2: does the EU Cyber Resilience Act apply to Lumen? (W13.X3, 17.11.2026)

**Who decided.** Claude, lane g4-L2, under the owner's delegation of 16.11.2026 (see decisions-2026-11-16-d1.md: "decide alone, without stopping"). This record is a reasoned position, not legal advice. The owner keeps two things:
- the bestpractices.dev registration (an account action);
- asking a lawyer before the paid relay ships.

**Sources.** The lane read these offline: research.md §X and W13.X2, which are in the train. The CRA texts cited in those, which this lane could not open again, are Regulation (EU) 2024/2847, recitals 15–19 and Articles 13–14. The OpenSSF "OSPS Baseline" note is in research.md §X too.

## The question
Free, non-commercial open-source software is outside the CRA. W5.25 and W11.P12 plan a paid relay: an optional service, for a fee, that carries sync and sharing for Lumen users. Does charging for it make Lumen a product "made available on the market in the course of a commercial activity", so that its maker is a manufacturer with the reporting duties of Article 14?

## Options
1. **Out of scope for good.** Lumen is free and open source, and the relay is a separate service. The risk: the recitals count monetising through related services (charging for support, or for a service the product needs) as commercial activity. A relay that the app offers in its own settings is close to that line.
2. **In scope once the relay charges its first customer.** Lumen is then treated as a commercial product. The manufacturer duties apply from that day: Article 14 reporting (24 h early warning, 72 h notification, 14-day final report), a support period, a vulnerability handling process, an SBOM, and from 11.12.2027 the essential requirements and conformity.
3. **In scope now, voluntarily.** Lumen follows the obligations before any money moves.

## Decision: option 2, prepared now
- **Until the paid relay takes a payment**, Lumen is free, non-commercial open source and outside the CRA.
  - It follows the W13.X2 disclosure process (security.txt, SECURITY.md, the 24 h / 72 h / 14 day timelines, GHSA/CVE, safe harbour) **voluntarily**, as written.
- **From the first paid relay invoice**, Lumen is treated as a product made available in the course of a commercial activity:
  - the W13.X2 timelines become binding;
  - the support period of D1 §3 (at least 5 years, never ending before 2031-12-31) is the declared support period;
  - the SBOM (scripts/supply-chain/sbom.mjs) is produced for every release;
  - the essential requirements are planned before 11.12.2027.
- **Why not option 1:** the relay is offered inside the app and paid for. That is the case the recitals name, and being wrong would leave reporting duties unmet.
- **Why not option 3:** the reporting duties need a reachable 24-hour contact and an ENISA single-reporting-platform account. Both cost money and owner time that a free project should not carry before there is income.

## Owed (owner)
1. **Register** the project on bestpractices.dev (Baseline series) with `.bestpractices.json` (W13.X4).
   - Confirm 2FA and the default collaborator role (OSPS-AC-01.01, AC-02.01).
   - Check the criterion ids against the published v2025.10.10 list.
   - Add the baseline-1 badge to the README when it is granted.
2. **Turn on** GitHub private vulnerability reporting, then point security.txt's Contact at it (W13.X2).
3. **Before the relay's first invoice:** a lawyer's check of this position, and the ENISA single-reporting-platform account.

## A finding about W13.X3's dod
`npm run owner:session -- status` exits 0 whatever the state of the CRA and badge steps: it lists the session's items and does not check them. A dod that passes with nothing done is a bug (audit r4). **Proposed:** `owner:session -- status --require W13.X3`, which exits 1 until the steps carry a signed receipt. This lane did not change it, because it belongs to the owner-session tool.
