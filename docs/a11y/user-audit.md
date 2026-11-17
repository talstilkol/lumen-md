# Accessibility audit with disabled users (plan W13.Y6, owner)

**Why:** an ACR written in-house (`docs/acr/`) next to Apple and Microsoft,
who publish testing with users. WAI's guidance: involve users early and
throughout (w3.org/WAI/test-evaluate/involving-users/).

**Who:** five sessions through an Israeli organisation that runs accessibility
user testing (for example an accessibility centre or a non-profit of blind
and low-vision people), paid at their rate:

- two blind screen-reader users (one JAWS or NVDA on Windows, one VoiceOver on iPhone);
- one low-vision user (magnification, high contrast or large system text);
- one user with a motor disability (keyboard only, switch or speech input);
- one more from whichever group the first four sessions show most problems for.

**Each session (60–90 minutes, Hebrew):** consent; the ten journey steps of
W11.Q6 on the participant's own setup; three free tasks (write a note with a
heading and a link, find a note from last week, restore a deleted one); a short
debrief. Record with consent; never record the screen of anything outside
the app.

**Output:** a findings list (severity: blocker / serious / moderate / minor),
each serious or blocker finding opened as a task in the plan, and the
summary published in the repository and on the accessibility page (in Hebrew
and English, without participants' names). The receipt goes through
`npm run owner:session`.
