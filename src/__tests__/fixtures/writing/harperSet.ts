/**
 * W13.W10 — 150 English sentences with one known error each (50 base
 * sentences × 3 errors: a repeated word, a misspelling, "a" before a vowel
 * sound), and the 50 base sentences clean, for false alarms. The label is
 * the error's span. Written for lumen-md (MIT); dev set.
 */
const BASE = [
  "She ate an apple after the long walk home.",
  "We waited an hour for the delayed train to arrive.",
  "He told an interesting story about his grandfather.",
  "The museum opened an exhibition of modern sculpture.",
  "They found an old map hidden inside the wooden box.",
  "Our teacher gave an example that everyone understood.",
  "I need an umbrella because it looks like rain today.",
  "The company hired an engineer to fix the network.",
  "You will receive an email with the meeting details.",
  "My sister bought an orange coat for the cold winter.",
  "The children saw an elephant at the city zoo.",
  "It was an honest mistake that nobody noticed at first.",
  "The council approved an increase in the parks budget.",
  "We stayed at an inn near the edge of the forest.",
  "He wrote an essay about the history of the river.",
  "Please send an update before the end of the week.",
  "The doctor gave an injection to the frightened patient.",
  "She is an expert in early medieval manuscripts.",
  "The town built an airport on the old farmland.",
  "There was an error in the final report we submitted.",
  "They planted an oak tree in the middle of the square.",
  "I read an article about solar power last night.",
  "The board held an emergency meeting on Sunday morning.",
  "He opened an account at the bank near his office.",
  "The storm caused an outage across the northern district.",
  "We ordered an extra blanket for the guest room.",
  "She gave an answer that surprised the whole class.",
  "The scientists ran an experiment with three groups.",
  "He made an offer that the owners could not refuse.",
  "The library added an archive of local newspapers.",
  "My brother is an artist who paints large murals.",
  "We heard an announcement about the cancelled flight.",
  "The team needs an editor for the weekly newsletter.",
  "She took an early bus to reach the office on time.",
  "The farmer keeps an eye on the weather every morning.",
  "They rented an apartment close to the university.",
  "The report includes an overview of the main findings.",
  "He found an envelope with no name on the front.",
  "We visited an island famous for its white beaches.",
  "The judge issued an order to stop the construction.",
  "Our neighbour has an idea for the community garden.",
  "The class went on an outing to the science centre.",
  "She plays an instrument in the school orchestra.",
  "The website shows an estimate of the delivery time.",
  "He keeps an album of photos from every trip.",
  "The nurse wrote an entry in the patient's record.",
  "They held an auction to raise money for the shelter.",
  "I saw an owl sitting on the fence last evening.",
  "The city opened an office for new residents.",
  "We had an argument about where to go for dinner.",
];

/** Misspell the longest word of at least five letters by swapping two inner letters. */
function misspell(s: string): { text: string; from: number; to: number } {
  const words = [...s.matchAll(/[A-Za-z]{5,}/g)].sort((a, b) => b[0].length - a[0].length || (a.index ?? 0) - (b.index ?? 0));
  const m = words[0];
  const w = m[0];
  const i = Math.floor(w.length / 2) - 1;
  const bad = w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2);
  const from = m.index ?? 0;
  return { text: s.slice(0, from) + bad + s.slice(from + w.length), from, to: from + w.length };
}

export interface HarperItem {
  id: string;
  text: string;
  kind: "repetition" | "spelling" | "article" | "clean";
  error: { from: number; to: number } | null;
}

export function harperSet(): HarperItem[] {
  const out: HarperItem[] = [];
  BASE.forEach((s, n) => {
    // A repeated word: the word after the first space, doubled ("ate ate").
    const sp = s.indexOf(" ");
    const w = /^\S+/.exec(s.slice(sp + 1))![0].replace(/[.,]$/, "");
    const rep = s.slice(0, sp + 1) + `${w} ` + s.slice(sp + 1);
    out.push({ id: `rep-${n + 1}`, text: rep, kind: "repetition", error: { from: sp + 1, to: sp + 1 + w.length * 2 + 1 } });
    const ms = misspell(s);
    out.push({ id: `spell-${n + 1}`, text: ms.text, kind: "spelling", error: { from: ms.from, to: ms.to } });
    const at = s.indexOf(" an ");
    out.push({ id: `art-${n + 1}`, text: s.slice(0, at) + " a " + s.slice(at + 4), kind: "article", error: { from: at + 1, to: at + 2 } });
    out.push({ id: `clean-${n + 1}`, text: s, kind: "clean", error: null });
  });
  return out;
}
