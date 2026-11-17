# Windows screen-reader matrix (plan W13.Y1, owner)

**Why:** WebAIM's survey #10: JAWS is the primary desktop reader for 40.5 %
of respondents and JAWS + Chrome the most common pair (24.7 %); NVDA is 37.7 %.
Lumen's automated runs cover VoiceOver (macOS) and NVDA through Guidepup
(`sr/`, W6.30, W11.Q6). JAWS and Narrator were in no plan.

**Matrix (once per release):**

| Reader | Browser | Cost |
|---|---|---|
| JAWS 2026 | Chrome | 40-minute demo mode is enough for one round |
| NVDA (current) | Firefox | free |
| Narrator | Edge | built into Windows 11 |

**Script:** the ten steps of the W11.Q6 product journey (`sr/productJourney.ts`:
open the vault, a new note, a heading, the command palette, search, Settings
opened and closed with Escape, WYSIWYG, a link to another note, export), in
Hebrew and in English. Hebrew: JAWS with Vocalizer Expressive Hebrew
(Carmit), NVDA with eSpeak NG Hebrew or a SAPI Hebrew voice, Narrator with
the Hebrew (Asaf) voice.

**Record:** for each reader × language × step: pass, or the sentence the
reader said instead (copy it from the speech viewer: JAWS Speech History,
NVDA Speech Viewer, Narrator's developer mode). Save the log next to the
receipt.

**Result:** 10/10 steps in all three pairs, or an open finding per failed
step (an issue, linked from the ACR, `docs/acr/wcag22.json`). The signed
receipt goes through `npm run owner:session` (never by an agent).
