/**
 * W13.W9 — 50 English texts for the Flesch–Kincaid comparison against a
 * known library (scripts/writing/fk-compare.py): one to three sentences,
 * from a first reader's line to a regulation's. Written for lumen-md (MIT).
 */
const S = [
  "The cat sat on the mat.",
  "We went to the shop and bought bread, milk and eggs for the week.",
  "Photosynthesis converts light energy into chemical energy stored in sugars.",
  "The committee recommends a phased implementation, subject to periodic evaluation of outcomes.",
  "Tom has a red ball.",
  "It is hot today, so we will swim in the sea.",
  "The library opens at nine and closes at six on weekdays.",
  "Bees live together in a hive and make honey from nectar.",
  "Our train was late because of the storm last night.",
  "Please hand in your essay by Thursday afternoon.",
  "The museum's new wing displays sculptures from the ancient world.",
  "Researchers observed a strong correlation between sleep duration and memory consolidation.",
  "Notwithstanding the foregoing, the licensee shall remain liable for all obligations incurred prior to termination.",
  "The moon goes around the earth once a month.",
  "She planted tomatoes, peppers and basil in the small garden behind the house.",
  "Public transport has improved greatly in the last decade.",
  "The algorithm's computational complexity grows quadratically with the number of input variables.",
  "Dogs like to run and play in the park.",
  "The council will vote on the new budget next Tuesday evening.",
  "Climate variability increasingly influences precipitation patterns across the Mediterranean basin.",
  "I read the book last week and enjoyed it very much.",
  "Interdisciplinary collaboration facilitates methodological innovation in epidemiological research.",
  "The kids built a sandcastle and then jumped into the waves.",
  "Each employee must complete the security training before accessing sensitive information.",
  "The theory was later refined by subsequent experimental investigations.",
  "Wash your hands before you eat.",
  "A balanced diet includes fruit, vegetables, grains and protein.",
  "The defendant's counsel argued that the evidence had been obtained unlawfully.",
  "Rain fell all day, and the streets turned into rivers.",
  "Quantitative analyses revealed statistically significant heterogeneity among the subgroups.",
];

export const FK_TEXTS: Array<{ id: string; text: string }> = [
  ...S.map((text, i) => ({ id: `fk-${i + 1}`, text })),
  ...Array.from({ length: 20 }, (_, i) => ({ id: `fk-${S.length + i + 1}`, text: `${S[i]} ${S[(i * 7 + 3) % S.length]}${i % 3 === 0 ? ` ${S[(i * 11 + 5) % S.length]}` : ""}` })),
];
