# The M3 launch kit (plan W11.L3)

**Nothing in this folder is published or sent.** These are drafts for the owner, for the global launch (M3: Show HN, then Product Hunt a week later; R6.11), after the Hebrew beta's gates.

| File | What it is |
|---|---|
| [`show-hn.md`](show-hn.md) | The Show HN title (at most 80 characters), link and text, with the specific angle: sandboxed plugins, MIT, Hebrew/RTL, local AI |
| [`product-hunt.md`](product-hunt.md) | Name, tagline (at most 60), description (at most 260), topics, the first comment (at most 800), the gallery |
| [`press-kit.en.md`](press-kit.en.md), [`press-kit.he.md`](press-kit.he.md) | One line, one paragraph, facts, and what to say about security |
| [`demo-60s.md`](demo-60s.md) | The 60-second demo script, shot by shot, in both languages (the recording is W10.M9) |
| [`claims.json`](claims.json) | Every claim the kit makes, with its receipt: a file in this repository and a quote that file contains |

**The rules, which `npm run launch:kit` (scripts/launch-kit.mjs) checks:**

1. Every claim in the kit carries a `[^id]` marker from `claims.json`. A sentence with a number or a checkable word (licence, offline, account, encrypted, sandbox, plugin, AI, import, …) without a marker fails.
2. Each receipt's file exists and still contains its quote, so a claim fails when the docs behind it change.
3. **No "audited" claim about the cryptography**, in any language, and the security section says that there has been no external audit. The words are banned except in a sentence that says it is *not* audited.
4. The stores' and sites' limits: the HN title, the PH tagline, description and first comment, and the demo adds up to 60 seconds.
5. Each file's "Sources" list is generated from the markers (between `launch-kit:sources` comments), and `--write` refreshes it.
6. The site address is `lumen-md.vercel.app`.
