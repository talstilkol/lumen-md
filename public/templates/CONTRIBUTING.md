# Contributing a Template

The Lumen template gallery (γ.3) is community-driven — anyone can submit
a `.md` template that ships in the in-app picker. Submissions go through
a small PR review for malicious-content scanning + frontmatter validity.

## What's a "good" template?

- **Reusable** — solves a recurring writing task (daily journal, weekly
  review, meeting notes, book annotations). Project-specific writeups
  should live in your own workspace, not the registry.
- **Self-explanatory** — frontmatter, headings, and section comments
  are clear enough that a new user knows what to fill in without docs.
- **Database-friendly** — when applicable, ship YAML frontmatter (tags,
  type, status) so the note shows up in Lumen's database views out of
  the box.
- **Locale-neutral** — write the body in English; translators will
  localise the visible labels in a follow-up PR.

## File layout

```
public/templates/
├── registry.json          # curated index — your PR adds a new entry here
├── daily-journal-pro.md   # one .md per template
└── your-template.md       # your contribution
```

## Steps

1. Fork [`lumen-md/lumen`](https://github.com/lumen-md/lumen).
2. Create `public/templates/<your-id>.md`. The file is plain markdown
   plus optional YAML frontmatter:

   ```yaml
   ---
   type: book
   author:
   rating:
   status: backlog
   tags: [reading, books]
   ---

   # {{title}}

   ## Why I picked it up

   ## Big ideas

   ## Verdict
   ```

3. Append an entry to `public/templates/registry.json`:

   ```jsonc
   {
     "id": "your-template",
     "name": "Your Template",
     "category": "Reading",
     "author": "Your Name",
     "description": "One sentence describing what this template is for.",
     "icon": "📚",
     "version": "1.0.0",
     "url": "templates/your-template.md",
     "rating": 0,
     "downloads": 0,
     "tags": ["books", "reading"]
   }
   ```

4. Run validation locally:

   ```bash
   npm run i18n:extract        # sanity — regenerates the keys index
   npm test                    # the registry shape is checked by templates.test.ts
   ```

5. Open a PR. The CI workflow:
   - Validates the JSON against the registry schema.
   - Scans the body for `<script>`, `javascript:` URLs, and external
     iframe references (any one fails the PR).
   - Spell-checks the description (warning, not blocker).
   - Auto-merges when checks pass + a Lumen maintainer approves.

## Versioning

Bump `version` (semver) when you change the template's content. The
gallery shows installed-version vs. latest so users know to re-install
after a breaking change.

## What we reject

- Templates that fetch external resources at render time (fetch / src
  attributes pointing off-domain).
- Templates that include affiliate links or sponsored content without
  a clear `[sponsored]` tag.
- Duplicates — if your template overlaps 80 % with an existing one,
  open a PR against the existing template instead of submitting a new
  ID.
- Single-locale templates without an English source.

## License

By contributing, you agree your template is licensed MIT alongside the
rest of the Lumen repo. Attribution is preserved in the `author` field.
