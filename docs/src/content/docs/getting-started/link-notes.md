---
title: "Tutorial: link two notes"
description: Make two notes, link one to the other with [[, and see the link from the other side in the backlinks panel.
type: tutorial
---

Notes become more useful when they point to each other. In this tutorial you
make two notes in a vault, link them, and follow the link both ways. You need
a vault open (the file tree on the side shows it).

1. **Make the first note.** Press `⌘N`, type `# נתניה` and a line about the
   city, and save it as `נתניה.md` with `⌘S`.
2. **Make the second note.** Press `⌘N` again and type `# טיול בחוף`.
3. **Link to the first one.** On a new line type `נסענו ל-[[נת`. A list of
   notes opens under the cursor, with `נתניה` at the top. Press `Enter`: the
   link `[[נתניה]]` is in place. Save this note as `טיול.md`.
4. **Follow the link.** Hold `⌘` and click `נתניה` (or open it from the
   file tree). The first note opens.
5. **See who links here.** Open the backlinks panel (`⌘K` → *Backlinks*).
   `טיול` is listed with the sentence that links to `נתניה`.
6. **Filter the backlinks.** Type `נסענו` in the panel's search box: the link
   stays, because its sentence has the word. Type `זזז`: nothing is left, and
   the panel says so.

You linked two notes and saw the link from both sides. The graph view
(`⌘K` → *Graph*) shows the same links as a picture.
