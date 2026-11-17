# The education kit (plan W11.P14)

**Nothing here is sent or published.** These are materials for the owner, for schools, teachers and yeshivot (R6.13).

| File | What it is |
|---|---|
| [`teacher.he.md`](teacher.he.md) | The teacher's and principal's page. It goes clause by clause through the Ministry of Education circular *שימוש בכלים דיגיטליים במוסדות חינוך* (5 January 2022). It says plainly that Lumen is **not** on the approved list, so the principal decides (clause 8), and that the hosted service's terms set a minimum age of 13. Every claim cites a file in this repository. |
| `npm run edu:pdf` | Prints that page to `edu/dist/lumen-teacher.he.pdf` (A4, RTL) with headless Chromium. Nothing is fetched. |
| [`offline-pack.json`](offline-pack.json), `npm run edu:pack` | The offline drive: the Windows installer, the Hebrew OCR data and optional models (only those `allowed` in `models/registry.json`), `SHA256SUMS`, and a Hebrew read-me. It is built from local files and downloads nothing. |
| [`netfree-request.he.md`](netfree-request.he.md) | A draft request to NetFree to open the site, with what it does and doesn't load. |

**Jewish sources:** Sefaria is in the app already (`docs/workspace/jewish-sources`). An interface to **Otzaria** (sivan22/otzaria) is not built yet: it needs the format of its local library confirmed first (owed).

**Owed (W11.M13):** the real drive, built with a signed Windows installer and checked on a machine with the network cable out (search, OCR and read-aloud in Hebrew). Also MSIX packaging: the Tauri build gives `.msi` and `-setup.exe` today.
