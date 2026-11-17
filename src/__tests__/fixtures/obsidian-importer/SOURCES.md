# Sources: obsidian-importer test fixtures

Copied unchanged from the public repository of Obsidian Importer, for the
importer tests of plan W11.P1. They are the importer project's own sample
exports (made by its authors, not real users' data), so they are
**public examples, not real exports**: the real exports are W10.O9.

- Repository: https://github.com/obsidianmd/obsidian-importer
- Tag: `3.1.15`, commit `2b483d0b351c99efa8e2dd94baa8563c83d01c38` (2026-10-16)
- Path: `tests/keep/notes/*.json` → `keep/`
- Path: `tests/keep/notes/expected/<note>/<note>.md` → `keep-expected/<note>.md` (Obsidian Importer's own output for each note: the oracle of `import:diff`, plan W11.P2)
- Licence: MIT, © 2023 Obsidian (`LICENSE` in this folder, copied from the repository root)
- Copied: 2026-11-15

| file | bytes | sha256 |
|---|---|---|
| `keep/2023-08-01T14_29_43.842+10_00.json` | 303 | `ecf4cb6247780b5b1748f8dd3e7e988b05d68505ebaa3cee90ecdec0d3d4bb45` |
| `keep/Annotated note.json` | 626 | `5620cd1050c980e6f93b454939be244ae7ed859635ba56f23fd6e937d4b70f5d` |
| `keep/Archived note.json` | 248 | `9148459bc20a2c31620d4da3f3c57e23101c6e088563e20886380ea52f1b4ea1` |
| `keep/Background colour note.json` | 218 | `a91d84de50747d699cd6b73fde52b89d4b4840412a0fb4b67cbdec176bd30d57` |
| `keep/Checklist note.json` | 495 | `4c903990e6caab5e4c138d034b2dc59eab3e6c2ae9e15b0ae16853ea14e32402` |
| `keep/Deleted note.json` | 246 | `de677253a9e2afb076b5023c8c348e06c633e12c03a56fed90a07366801d8ffd` |
| `keep/Drawings (multiple) note.json` | 380 | `f8a77e32e08336006d0ee81c3a899ceb9838953353069460f756d3c298083ed1` |
| `keep/Hashtags _ labels note.json` | 1227 | `a06e08e663f80ff88dd5a8da03eda625faad662cc16c3d98beb77eedc38070f1` |
| `keep/Image, label, and body text note.json` | 344 | `12fde074f0d2b5f9b5c0b2529ecc5404b6e34ae692ceeb7876b049ac431c749b` |
| `keep/Invalid title characters note !@#$_^_()_+~`{}[]_.json` | 405 | `a2ada6fa330de8ea700502dfa3374db134753324ba4e7176793fa1d865ec3f79` |
| `keep/Labelled note.json` | 552 | `3738e40f3e51996fcb3c24935cb4f2ccce0223ad8bef1b37f65e4ed462c82842` |
| `keep/Multiline title note_Second line.json` | 262 | `d4159d76aaf777d1bf3759e13c6ca2e7771a5fec90502d62e9eedb3ac4a25e85` |
| `keep/Pinned text note.json` | 257 | `8c8f692e124f5de564588d358d72a5cd4481b2e07d19f1ebed7c724bcef460fa` |
| `keep/Rich checklist note.json` | 549 | `66b0eb7a056079d1b15edef9a5b4dd8e6903d89291735cf941e9cc90c3d04816` |
| `keep/Rich text note.json` | 1225 | `1f1c71af91f28d5af578c318b041c4e575737604dbba6aa0ae8f3d8cdb1bceb0` |
| `keep/Voice recording.json` | 338 | `f092c2905ffde80584ffee8ccef4da93b94681ef24072dca5a041950b3340e5c` |

| file (oracle output) | bytes | sha256 |
|---|---|---|
| `keep-expected/2023-08-01T14_29_43.842+10_00.md` | 106 | `08e51b3a2a2e194b928e5ba7d4fa98f63917500a0c74350984719d5bc67c154e` |
| `keep-expected/Annotated note.md` | 353 | `28129e9362d695c1c2f11807d8f946b73586fabaedf502d03b64f97252a4c3d2` |
| `keep-expected/Archived note.md` | 85 | `98f0ea0cc31e41072d11a5f11049fc888eea12114147ea28e8fcfe47ce91bc40` |
| `keep-expected/Background colour note.md` | 50 | `789a0887d1ff8e24469d82535818b64f999945312d20895b5428d56283fcd2c0` |
| `keep-expected/Checklist note.md` | 177 | `2f863432d47cbda801a52562854ac12d963d51b5a3926fafa8defc7889619dfe` |
| `keep-expected/Deleted note.md` | 83 | `2b85d2caecf53a0d777f1f5030a4793e59d023be40e0de86d401a3d4c5ed79db` |
| `keep-expected/Drawings (multiple) note.md` | 125 | `847a6a5a70eb193a4375c145d694cacb94fc0ae43d367da9c50892e6618c007c` |
| `keep-expected/Hashtags _ labels note.md` | 1040 | `e3a91e8a4fcdf95fcf57590022e7bc7ee732d212e0035bbf3b2c7a1878e9fb3e` |
| `keep-expected/Image, label, and body text note.md` | 131 | `b370b32c1ccb41848cc98f361619cd18865d3826f6f985c029a0442184669ccf` |
| `keep-expected/Invalid title characters note !@$__()_+~`{}_.md` | 238 | `01368059e770c078f9ab24327344e2466ad3324acfde1ad1997119a43c9a0e7c` |
| `keep-expected/Labelled note.md` | 373 | `e8727de6541a52ced4eabd626d3b4a89eb0fff7728b123430089cd90c8aee9b0` |
| `keep-expected/Multiline title note_Second line.md` | 104 | `f5aa98e7fe132c0f4dd4b56694bd9d1e5235d36aecc739652c8d62e644402c8c` |
| `keep-expected/Pinned text note.md` | 89 | `dfd4c19be0f8f1ff5adfee6575a0d897db9ef84925f239f09d51c7dee2fe4941` |
| `keep-expected/Rich checklist note.md` | 73 | `c3e44faa1d07654160d3f65103a84282f517241a1f05065c80f70abc8dc8b385` |
| `keep-expected/Rich text note.md` | 89 | `1153f2eeb2d0c5faf5eeb93e1eee3611c2bb17151f73006cd0ba119893f1afd0` |
| `keep-expected/Voice recording.md` | 126 | `48bcbfd4e86a14e8580743f08763a81c99b3c1b7785e079a9ea90ed7088a01f6` |

## Roam and TextBundle (plan W13.F1)

Copied unchanged from the same repository, for the Roam and TextBundle
importers and the golden table of `npm run import:diff`
(scripts/lib/importDiffCases.mjs). Public examples written or excerpted by
the importer's authors (the Roam Help-graph excerpt is anonymised by them;
see their `tests/roam/README.md`), not real users' exports.

- Repository: https://github.com/obsidianmd/obsidian-importer
- Version `3.2.0`, commit `fa9444a188459f227b07ec121ad03d26bd6b301a` (2026-11-12)
- `tests/roam/*.json` → `roam/`; `tests/roam/expected/<graph>/` → `roam-expected/<graph>/` (the importer's output with `roamDefaults`)
- `tests/textbundle/` (the two bundles, the two .textpack files, `Ulysses Export.zip`) → `textbundle/`; `tests/textbundle/expected/` → `textbundle-expected/`
  (the importer's own recording names one Ulysses note `Search ΓÇô and Find.md`, the en dash read as CP437; kept as it is)
- Licence: MIT, © 2023 Obsidian (`LICENSE` in this folder)
- Copied: 2026-11-17. No code of the importer is copied into lumen-md; its outputs are the oracle only.

| file | bytes | sha256 |
|---|---|---|
| `roam-expected/help-graph-excerpt/2021-02-01.md` | 109 | `bf038027875a0e77a03f1ed36a7057c93739687a10cc72a4666caab0737211be` |
| `roam-expected/help-graph-excerpt/2021-03-02.md` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `roam-expected/help-graph-excerpt/2021-10-07.md` | 24 | `c794d6b1541d1fcd0ef3f699b955eb1d8fbac5bc4ee121c02df171dd68f6504a` |
| `roam-expected/help-graph-excerpt/2023-02-10.md` | 5102 | `5b06cb9088fdc913500b492343b34985d8e42f4f95cd029a7f2aee6a7720a9ba` |
| `roam-expected/help-graph-excerpt/Code Block.md` | 686 | `82d90ba80d8a8d14fee7090989468d810823e6eb482105e363b825324cdf35d9` |
| `roam-expected/help-graph-excerpt/Community Videos.md` | 177 | `008ecf417f6d2331efcf0ab3b57102906d246edf403d2dc001fadd7dd887710a` |
| `roam-expected/help-graph-excerpt/Customizable Hotkeys.md` | 152 | `5792d5bdd6bbdf7fbae6b90ea58d1ac4ff168321b7917b0bb1406e24bc848f20` |
| `roam-expected/help-graph-excerpt/H/L Temp.md` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `roam-expected/help-graph-excerpt/How to write a 21st Century Proof.md` | 65 | `13391c4b6628c65608bb18fdaac7b8954fc8ee6c2d2eb0c346c626c2457b6bd9` |
| `roam-expected/help-graph-excerpt/Latex.md` | 291 | `d40a2d227d35fc00c7b3265411ffba6418fc82b666ac00335f254cef456368a8` |
| `roam-expected/help-graph-excerpt/Plugins.md` | 207 | `a23a868c0d4b83c2a0520c24b2eb44d0969df9425212ba0835b8af7feb613145` |
| `roam-expected/help-graph-excerpt/Query.md` | 2234 | `abe5c9d83cc008f7c35492598122be71f3bf93ab64e993f56660f4172a9602ef` |
| `roam-expected/help-graph-excerpt/Secret Feature.md` | 70 | `c32423fa41d8d92ad177b152ce87c25ce3ebc9201f00ea1889a42faf54b61fc1` |
| `roam-expected/help-graph-excerpt/TODO.md` | 115 | `6f0f5091b5b35c266e543b9164d1b271f2c7bb58ca0c231f343c9e02fe280952` |
| `roam-expected/help-graph-excerpt/Table.md` | 563 | `c489fcba042e034893ec99b287032893ce88d3f388dd8085dfaf21705e052406` |
| `roam-expected/help-graph-excerpt/Unlinked References.md` | 69 | `45b0119b2cafae3105889a48777a00858c4172589729f5dbae6b5986b58963d7` |
| `roam-expected/help-graph-excerpt/Welcome to Roam v2.md` | 1534 | `a974194d3ea3fcfbce1be53926924c12259fc1494cffd90f920beef5a78e85f2` |
| `roam-expected/shapes-outline/2021-01-01.md` | 110 | `50bbaa8e903ff728b4451d29417d876c41034de523f2b8ce73744f3337508578` |
| `roam-expected/shapes-outline/Colliding name 1.md` | 58 | `4e41cacf37d0a66af71cfe1ff67fa7fb9005c1b89d3f0c1b1654e7cc598bbeff` |
| `roam-expected/shapes-outline/Colliding name.md` | 57 | `8efae87d679433bc429721ebd87b2f6c67e179bb9d1d7a5b3feb77197808f2f9` |
| `roam-expected/shapes-outline/Dune.md` | 52 | `4879137d8ab93005325847cd12e3167d066d179682ca6c5c2407efd3cd65245a` |
| `roam-expected/shapes-outline/Embeds.md` | 137 | `5c8dbff7e0eb170a9958108ef960e47d02c4e2dc46276043ed6db971cc84972e` |
| `roam-expected/shapes-outline/Headings.md` | 240 | `bf0bb0cfd71eefecb3023c98df036de00050ddc681859c73e3b11e59e36d5f4a` |
| `roam-expected/shapes-outline/Queries.md` | 317 | `46c5886d86924356d1c8ec5f9fdcaf55b586aadd3232e2bd2c4949d851dad5aa` |
| `roam-expected/shapes-outline/References.md` | 562 | `4d30316429fccd55a8ae041b2e6417747eb94de89b57edd0d46c89ebcce05055` |
| `roam-expected/shapes-outline/Sapiens.md` | 265 | `6e23b31cd336ddacaf358a893a5c781f90db1080fc0fc358f6354e2c6850e5de` |
| `roam-expected/shapes-outline/Source.md` | 173 | `348b4b115531e273b9f56364a0be13ab30bd651b41ae20818918c95a25a0437e` |
| `roam-expected/shapes-outline/Tables.md` | 435 | `b600770b0afa295ab961c9e1c15a4ad0774098bfb9daed360586cca828698519` |
| `roam-expected/shapes-outline/roam/css.md` | 130 | `d7de241aa9a85cc112752b19e0ed178d965abc7c04a9072b154e1a3dd216b4fc` |
| `roam-expected/shapes/2021-01-01.md` | 107 | `dc0ea6cc699d6b2055336e66ab79b9c80ac50fbd67130f1c393c5819f851a88b` |
| `roam-expected/shapes/Colliding name 1.md` | 56 | `46da9736cb296236924d6874ae71816973febf19b84cfc0c989e66649669908c` |
| `roam-expected/shapes/Colliding name.md` | 55 | `f8f9c610c416595d27d16926a77c23ec50f6d4c5604882c261fba327c0063323` |
| `roam-expected/shapes/Dune.md` | 52 | `4879137d8ab93005325847cd12e3167d066d179682ca6c5c2407efd3cd65245a` |
| `roam-expected/shapes/Embeds.md` | 131 | `27b09d2d564226da32444546a78a1b3056017ec090fdc9c372d33db8612f1d87` |
| `roam-expected/shapes/Headings.md` | 210 | `315ac878ad6c55ae5f7f9c47a8b350d486ceb745c31ce6c6255080d19c262a0d` |
| `roam-expected/shapes/Queries.md` | 294 | `03cc91e0a1a462f8b3f6c8b5b91f27791d7efe2a93978c89f4e1c007489396df` |
| `roam-expected/shapes/References.md` | 554 | `84db4dd91da96a85515e917eaa2515333c42194f3a8d53a9626c490c02261f75` |
| `roam-expected/shapes/Sapiens.md` | 246 | `658741bffb0703e3e9504e9a357def3ab6f4ea353f04aba4ad5e6935406f1111` |
| `roam-expected/shapes/Source.md` | 155 | `2b4161a0ca2f7019ecfedff0f8ff61b50aefcc8c80d121dae886764ca5372523` |
| `roam-expected/shapes/Tables.md` | 414 | `017f27eed5c0eb13d9745844ea682812950688bd16d06d37d17ff55e53997c75` |
| `roam-expected/shapes/roam/css.md` | 127 | `9f41543aa917104ee28eef82a41cbaffc23c7e341f4e72e612ad5d21a5622d4a` |
| `roam-expected/small-test-graph/Theme Tester.md` | 3590 | `1bc9960aefd6117cf53ab75ff44ff63c460dd55ad2877abf476f8cd0c9c52c8e` |
| `roam/help-graph-excerpt.json` | 71403 | `33133a6a1a553b513bfe15c39984858d3d07499085f6399a95e830d84e23f59e` |
| `roam/shapes.json` | 8884 | `f6c3cf969e3c4f29bbd01f9ab2eaa988b319f0767fd273373ae922c1914e2638` |
| `roam/small-test-graph.json` | 114060 | `d92ec3a3b438cffdbd6bc2a354ea6c7edfb503d2a430ee71f4b390ed98039fbf` |
| `textbundle-expected/Textbundle Example v1/Textbundle Example v1.md` | 243 | `8b06425496362ec4c8a69dcbd73fd5663fe8360233cdbfac874f75a474580c53` |
| `textbundle-expected/Textbundle Example v2/Textbundle Example v2.md` | 243 | `8b06425496362ec4c8a69dcbd73fd5663fe8360233cdbfac874f75a474580c53` |
| `textbundle-expected/Ulysses Export/A Super-Quick Markup Primer.md` | 5758 | `f12c23e7e6b348a17bc3cf16509abc3112eb51a7af043c130c3ac9eea39bdf7e` |
| `textbundle-expected/Ulysses Export/Search ΓÇô and Find.md` | 831 | `e7276f400d63a779c79be57543b67e795e5edbc223e6bbecb44cc6055a3a0bc3` |
| `textbundle-expected/example 2/Textpack Example.md` | 243 | `f3ffb5c4fcf41407741c298e7fb9eee451f0502a3790bfbaa855001d5b6820fc` |
| `textbundle-expected/example/Textbundle Example.md` | 243 | `8b06425496362ec4c8a69dcbd73fd5663fe8360233cdbfac874f75a474580c53` |
| `textbundle/Textbundle Example v1.textbundle/assets/textbundle.png` | 3319 | `5897c340d6f0a2fcd404359629e4b6e21f4eed16b023fdaa8775ce96a94f8c6e` |
| `textbundle/Textbundle Example v1.textbundle/info.json` | 146 | `fc3be58481781d81234e853eae0e1b2397e4b7ec2e80e618b59e8457acde1b6a` |
| `textbundle/Textbundle Example v1.textbundle/text.md` | 221 | `ef466c9508c494047144b2a1941d760afbb8e16a592e7de518f9702ea91d1915` |
| `textbundle/Textbundle Example v2.textbundle/assets/textbundle.png` | 3319 | `5897c340d6f0a2fcd404359629e4b6e21f4eed16b023fdaa8775ce96a94f8c6e` |
| `textbundle/Textbundle Example v2.textbundle/info.json` | 262 | `cd6e78904e1dcb79678159c9d6d246481fcc370733af8e11ef1ad6d99c5e228f` |
| `textbundle/Textbundle Example v2.textbundle/text.markdown` | 221 | `ef466c9508c494047144b2a1941d760afbb8e16a592e7de518f9702ea91d1915` |
| `textbundle/Ulysses Export.zip` | 7236 | `b00934917f4e9b701036caa680ee08182c3194dfcd9590635f01c6ab2093cd4a` |
| `textbundle/example 2.textpack` | 4163 | `6daf48e529afaf77872058c6770ef012e584b74033458870ae3f921d40c4aae1` |
| `textbundle/example.textpack` | 4569 | `9a359488031cb2ca6ec074ecda3948047974a0125ac2a433a62d23490b8efc61` |

## Tomboy, Apple Journal, CSV and Airtable (plan W13.F2)

Copied unchanged from the same commit (`fa9444a188459f227b07ec121ad03d26bd6b301a`, v3.2.0), for the
Tomboy, Apple Journal and Airtable importers and their rows in `npm run import:diff`. Public examples
written by the importer's authors (the Airtable base is hand-written to the API's shape, its values made
up; see its `_comment`), not real users' data. MIT, © 2023 Obsidian.

- `tests/tomboy/*.note` → `tomboy/`; `tests/tomboy/expected/` → `tomboy-expected/`
- `tests/journal/*.html` → `journal/`; `tests/journal/expected/` → `journal-expected/`
- `tests/csv/*.csv` → `csv/`; `tests/csv/expected/` → `csv-expected/` (Obsidian's CSV import: how it takes an Airtable CSV)
- `tests/airtable/example-base.json` → `airtable/`; `tests/airtable/expected/example-base/` → `airtable-expected/example-base/`
- Copied: 2026-11-17. Samsung Notes' `.sdocx` fixtures are not copied: lumen-md does not read `.sdocx` (see the importer's notes in src/storage/import/samsungNotes.ts).

| file | bytes | sha256 |
|---|---|---|
| `airtable-expected/example-base/Airtable/Example base/Authors.base` | 327 | `50b6ff8d5818feb11ea98aec747e3404a0cf92656dc0765b75e7db0e8089f0f1` |
| `airtable-expected/example-base/Airtable/Example base/Authors/Ada Lovelace.md` | 89 | `65b9852440c11715bfb285a2b74e40e0324a37dc6a1cbc1b66d2a8e6dc95d168` |
| `airtable-expected/example-base/Airtable/Example base/Authors/Grace Hopper.md` | 64 | `7ccbce35ac2fb0299851281e820812b5f38a669546236147494d3879f5a57075` |
| `airtable-expected/example-base/Airtable/Example base/Books.base` | 3208 | `e49d102db1d784c5beeb14fa680752e350ef911fbe05365783f79ad1ff12e0bb` |
| `airtable-expected/example-base/Airtable/Example base/Books/Notes on quoting - naming.md` | 292 | `f9e8e20b9bdbdf90e82a1b2d3e9bb74347cb87a8cbc99b78277ccaf13492f20e` |
| `airtable-expected/example-base/Airtable/Example base/Books/The Long Way 1.md` | 179 | `c076c1e1d2b4c4ebaecf95f31ebd43cfc928cad8202b82fb5927eb552be910c1` |
| `airtable-expected/example-base/Airtable/Example base/Books/The Long Way.md` | 735 | `fd3ca6c860511e385fbcd3737d1505865e21eb8e0c79def57c1b8a4ceda1596f` |
| `airtable/example-base.json` | 11284 | `4d987554c35ef92759ae66a271f50e6bb46ff0a16115c0842573d11247f3698f` |
| `csv-expected/comprehensive-test/Boolean Test.md` | 226 | `c2406234e91b5d9e23d23320db09d96069a960304e973f343d846be6679768ab` |
| `csv-expected/comprehensive-test/Empty Fields Test.md` | 175 | `8941809fa06010d734d601003a195ffef8c02bd1567ce1fde0a2dcc4044c38b8` |
| `csv-expected/comprehensive-test/Meeting Notes.md` | 325 | `9a132b6ed965dfc94a751d633bac9a23885aa379f0d1291f64ecaa86e6adc8b7` |
| `csv-expected/comprehensive-test/Multi-line Content.md` | 291 | `540893b2584f43a8c148a5854ee6274ab5f1c90e41eec3c4b12ab7b3fc689ed4` |
| `csv-expected/comprehensive-test/Note with quotes.md` | 251 | `21a88ff2471c3a1fd7f842e261daf5530cac3a4bb410da578f341e4a829d3438` |
| `csv-expected/comprehensive-test/Numbers Test.md` | 222 | `6fb1c66865edb50e1f8245bff5cdfed09b4dd903accfa9ebafe56a2a5f25b9a1` |
| `csv-expected/comprehensive-test/Project Plan.md` | 343 | `6dc77ecbf78372e1fcf623f5560de61f71062e9d79f68a349120abdb149bba83` |
| `csv-expected/comprehensive-test/Simple Note.md` | 220 | `23a02de41a42985c2b174a2e242f91b0abb249859a0553de2b651ff47bd556d4` |
| `csv-expected/comprehensive-test/Special Chars.md` | 254 | `e48d1d8260ebf8f8429732906b4cea5215dc6ca5e56e71b09907d40ae38bbdb9` |
| `csv-expected/comprehensive-test/Unicode Test.md` | 231 | `c05d51c48828b520b060b48e48792299498f02b1f3b1e6c6f8fc9e6493057df2` |
| `csv-expected/sample/My First Note.md` | 166 | `bd46b9bfb7a4dd4fcbe71c94c0cb6f87d9d4b23059be69c4ee877c81f6fdc4f3` |
| `csv-expected/sample/Note with, comma.md` | 154 | `a5e29954800a30eba9659b2ad8955e64c31af514a32521425535709fddd349f2` |
| `csv-expected/sample/Planning Document.md` | 178 | `4a0a1cc43f465c5fb81f742cd2b4a81dc9e4413f0c3a066eddea92d2c671f672` |
| `csv-expected/sample/Second Note.md` | 173 | `ad17198387d333131c6ef5c384a628e24e6cd2260255aa0a0feb4870b3a19671` |
| `csv-expected/sample/Simple Note.md` | 141 | `adcd32b5e3af6be5da7622e0413db0d1b060b8f2e80a7de08d75cc61593fd061` |
| `csv-expected/semicolon/Apple.md` | 82 | `9206b5357603c2ce2b0af6241fcef01203a32d173db60861d6bfd8bc98487807` |
| `csv-expected/semicolon/Bread.md` | 98 | `67281c4834516149f28dbe906ef935ebc40abda54d1a525253927ac96c152a29` |
| `csv-expected/semicolon/Cheese.md` | 84 | `f44579668b20b0dd088ca566e46b09f83b853eb410a2ce631bb3ec8f5904bdfc` |
| `csv/comprehensive-test.csv` | 1498 | `12926d70134947312fe974321e679460276aabc56c833492d6fc3ec5ee7fc34e` |
| `csv/sample.csv` | 489 | `e7b72b2996ef0e13aa7bba02524008c47b6286cda7b84198bdfa576a20c7693f` |
| `csv/semicolon.csv` | 146 | `9d79617417e4cc74f93e9b3a19ab8cbf319f3068fd93e67a116219f2bef46222` |
| `journal-expected/entry-complex-metadata.md` | 213 | `676d217f71b41455034d9310ae2c9d38796d75b349171485c4b3725d39279a86` |
| `journal-expected/entry-with-assets.md` | 122 | `a7f36a39d0e845967329d7eeb870bd20add1932daa76f87346406c006c8c517a` |
| `journal/entry-complex-metadata.html` | 1356 | `6d8889b9f432ad73dae5953dd59c19432a42eae6ba9fb66b22ea932accf29eb3` |
| `journal/entry-with-assets.html` | 1178 | `a48a2579e3db2018da704ae5066226eb6987bc022bef7fa15407132d15905370` |
| `tomboy-expected/2769c249-6cbb-4263-ae03-7c0a5be89ac1/TODO Liste.md` | 276 | `0666ee10c2a2a07cc02dcff9e79ac385b8a3238803c2962d9e4f2aadfd27048c` |
| `tomboy-expected/410f9acd-09c9-4c19-8b27-29b69ef450d0/Neue Notizbuchvorlage.md` | 123 | `e3feac2adc412c6cd2a4792f66f0666d8b1bb5486f5045b20613d90158ba204a` |
| `tomboy-expected/7300325c-9f4e-4eef-8686-1e905136a3a3/Einfache Beispielnotiz.md` | 104 | `3abb124c8c372d7e8684a756cccda03ca1e2ad7d6d752c09459569bd1365bdaf` |
| `tomboy-expected/759b94f3-6587-4464-b24f-ebdd12f6e75c/Spätere Checkpunkte.md` | 181 | `4843501cde18c2917df7d892e931126eee02698c70ae53b650f9efec199f02a0` |
| `tomboy-expected/84cd9ff6-ad59-4072-8f6e-9ce1952a9f4d/Böse Zeichen im Titel 1.md` | 382 | `3becfbd704d21c853698624a071752d209102b1e528a3344e7b9af9f936bd122` |
| `tomboy-expected/8a97cb92-34fa-427e-ba01-b8dbf4dae71f/Aufzählung.md` | 303 | `bede46832e39356b0553e882c577a9378785bb807e0fad363be8dbda9d150efd` |
| `tomboy-expected/919418ca-8d97-4722-8d62-85e6e17cef14/Unerlaubte Zeichen.md` | 241 | `8d5b921f04db38346bbc0216c90f925266e85e4cf6ef341e0c116f134c598802` |
| `tomboy-expected/9322a3d0-0758-48ed-9d8b-342986d0bfdf/Formatierter Text.md` | 415 | `422edd1f1682455615e0b4701ba7bfc268ab946bd2df9af758ab096947eaecb1` |
| `tomboy-expected/95750e8a-fd86-4966-a87b-12ac45de4b3a/Kleine Schrift.md` | 248 | `1c2bd1fd0f676bf082e635cd9678385672fc081f4839f7b221413ca916db5e47` |
| `tomboy-expected/95f6e84f-d824-4194-a175-e8a9edbb97a4/Notiz mit internem Link.md` | 207 | `95ecae3e8bd304ed0760b1c1fd4824082aebf108ccfdca65d22ba4cb0bdd14cd` |
| `tomboy-expected/d76cb57b-d566-4c2d-bd5e-41a866b25b11/ZugFerd - factur-x integration 4343.md` | 357 | `1c8a272b7d1c2e470760e2842a54f640502d8d8e320dab239275cbf089ac4889` |
| `tomboy-expected/ee3b1318-b917-4aef-a0a9-237b8fe089f3/Überschriften.md` | 537 | `84aec22c7e6e024aa78e7ed88ae3fb0553570da5e5b4fd0af52fa78a0a54d203` |
| `tomboy/2769c249-6cbb-4263-ae03-7c0a5be89ac1.note` | 1231 | `0205a068d713bca33b1d3242b2bf380ef542e27f83e23fbd6a718a62b47b6e7b` |
| `tomboy/410f9acd-09c9-4c19-8b27-29b69ef450d0.note` | 877 | `3db8f330613d15a32b0131e375f7bafc71583eafcc7a99a5ca3946cd41253bd5` |
| `tomboy/7300325c-9f4e-4eef-8686-1e905136a3a3.note` | 831 | `d384cfbd208b00c747dbb51033516aa6271a4897334012b1400fdc665c18f02e` |
| `tomboy/759b94f3-6587-4464-b24f-ebdd12f6e75c.note` | 1020 | `808b6e1c5f902771674b0bc091d4925cb6e03b07c62a903cee037279c46db172` |
| `tomboy/84cd9ff6-ad59-4072-8f6e-9ce1952a9f4d.note` | 1197 | `f3753270ad5a13a290ecefad429d1f6daf1458cf009f3d3d3c2624a2f11826bf` |
| `tomboy/8a97cb92-34fa-427e-ba01-b8dbf4dae71f.note` | 1287 | `4dcaf8f7abeaf129b2496bffb08fdb7d3c3d21322016e9320d77aba0a701f4a1` |
| `tomboy/919418ca-8d97-4722-8d62-85e6e17cef14.note` | 930 | `960acfec9adde1cefdea62239ed19d87a0c0f5df03a3f0574c7c473cdd9e3429` |
| `tomboy/9322a3d0-0758-48ed-9d8b-342986d0bfdf.note` | 1566 | `3c5b1faf1ebf73991b98cce45bd0c5480672653fed4982001bb3f9f8143a580f` |
| `tomboy/95750e8a-fd86-4966-a87b-12ac45de4b3a.note` | 986 | `925e7aad7a98de93ffddaeceba0a371ef07e641eda20fb2459181fe41d2b29df` |
| `tomboy/95f6e84f-d824-4194-a175-e8a9edbb97a4.note` | 991 | `9f8e3229436faa564b6c7ca405e3a10be16e2e29e7fdbd460a2db38a5a4e2b3c` |
| `tomboy/d76cb57b-d566-4c2d-bd5e-41a866b25b11.note` | 1244 | `4db878500f94a5232dd4646fb9d893a2f22875125ce50400416b63ba78631811` |
| `tomboy/ee3b1318-b917-4aef-a0a9-237b8fe089f3.note` | 1475 | `4f81363e2cb80763a5c95ddd78ac1d15986c20edb3980d87e2e8061e1218a368` |
