# Mobile battery and heat (plan W13.V4)

A local app with on-device models can drain a phone; that is what store reviews
complain about. This report holds the measurement: the same 30-minute script on
an iPhone and a Pixel, Lumen against the phone's own notes app, in airplane mode
and with sync on. `npm run mobile:check` reads the table below and fails until
every row is filled and Lumen uses at most 1.5 × what the notes app uses.

## The script (30 minutes, the same for both apps)

1. Charge to 100 %, unplug, screen brightness 50 %, auto-lock off, other apps closed.
2. Open a Hebrew note of about 2,000 words (the repo's `e2e/rtl-note.ts` text, pasted twice).
3. Minutes 0–10: type continuously (a paragraph a minute, from a printed sheet).
4. Minutes 10–20: scroll through the note top to bottom and back, once a minute.
5. Minutes 20–25: search for three words, open two results, switch between them.
6. Minutes 25–30: leave the app open on screen, idle.
7. Read the energy used: on iPhone, Xcode → Debug Navigator → Energy Impact for
   Lumen (and Settings → Battery for both apps over the window); on Pixel,
   `adb bugreport` → Battery Historian, the app's estimated mAh.
8. Repeat with sync on (Lumen's encrypted sync to a second device; Notes with iCloud / Keep sync).

Also run once with the app in the background for 10 minutes after step 6: the
energy used must be near zero (no wake lock, no timer running in the background —
`src/__tests__/backgroundTimers.test.ts` checks the code side).

## Results

| device | OS | mode | Lumen (mAh / 30 min) | system notes (mAh / 30 min) | ratio | measured on | by |
|---|---|---|---|---|---|---|---|
| iPhone | | airplane | | | | | |
| iPhone | | sync on | | | | | |
| Pixel | | airplane | | | | | |
| Pixel | | sync on | | | | | |
