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
