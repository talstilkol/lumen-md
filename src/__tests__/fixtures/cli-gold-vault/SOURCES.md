# cli-gold-vault (plan W13.K1)

origin: synthetic — written for this test (CC0).

`vault/` is a small Hebrew-first vault with every kind of link a move must
update: wiki links with folder, heading and alias, embeds, Markdown links
with a heading, an angle-bracket link, a reference definition, a
percent-encoded link, links inside code (must stay), and a short `[[עוגה]]`
that opens a *different* note with the same name (must stay).

`expected-after-move/` is the same vault after
`lumen move "מתכונים/עוגה.md" "אפייה/לחם/עוגת שמרים.md"`, edited by hand,
not generated: the test compares the CLI's result to it byte for byte.
