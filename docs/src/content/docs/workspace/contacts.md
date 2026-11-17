---
title: Contacts (vCard)
description: Import a .vcf from your phone or Google into person notes, merge it with people already in the vault, and export people back as vCard 4.0.
type: how-to
tasks: ["W12.F6"]
---

**Import contacts (vCard)…** reads a `.vcf` file and makes a person note
for each contact.

- **Formats:** vCard 4.0 (RFC 6350), and the 3.0 and 2.1 files that Google
  Contacts, iPhone and older Android phones export. That includes Hebrew
  names in UTF-8 or quoted-printable.
- **Where the notes go:** to `ישויות/אנשים/`, the folder the entity graph
  uses for people.
- **What a note holds:**
  - `type: person` and `entity-type: person`, so it is the same object as a
    typed object and in the entity graph;
  - the name, phones, emails, organization, role, birthday, addresses and
    links as properties;
  - the contact's note as the body.
- **Skipped:** photos and other binary fields.
- **People already in the vault:** a person with the same name or alias is
  updated and not duplicated. **The vault's values win.** A property you
  already have is never overwritten, a missing one is added, and a new phone
  or email is appended to the list. Importing the same file twice adds
  nothing.

**Export people as vCard** writes every person note into one vCard 4.0
file, downloaded on this device. It goes through the same export step as
every other export, so `<redact>` passages are left out.

**Privacy:** both commands run on this device only. The file is read from
your disk and written to your vault or downloaded. Nothing is sent anywhere.
