/**
 * Parts of speech for English, on this device (plan W13.R5): noun, verb,
 * adjective or other — a small rule tagger (closed-class lexicon, common
 * verbs and adjectives, suffixes, and the word before), no model and no
 * download. The forms of be / have / do count as verbs, as Immersive
 * Reader colours them. Accuracy on a held-out 300-word set:
 * src/__tests__/immersivePos.test.ts.
 */
import type { Pos } from "./hebrewPos";

const words = (s: string) => new Set(s.split(/\s+/).filter(Boolean));

const OTHER = words(`
a an the this that these those my your his her its our their whose which who whom what whatever whichever some any no every each either neither
all both few many much more most less least several such own i me you he him she it we us they them myself yourself himself herself itself
ourselves themselves mine yours hers ours theirs and or but nor so yet for if then than because although though while whereas unless until
since as whether once when where why how whenever wherever there here now today tomorrow yesterday not never always often sometimes usually
also too very quite rather just only even still already again ever almost perhaps maybe yes no not of in on at by with from to into onto
upon about above below over under between among through during before after against without within along across behind beyond near around
toward towards off out up down per via like unlike despite except inside outside beside besides one two three four five six seven eight nine
ten eleven twelve thirteen fifteen twenty thirty forty fifty hundred hundreds thousand thousands million millions billion dozen ago can could will would shall should may might must ought cannot can't won't don't
doesn't didn't isn't aren't wasn't weren't hasn't haven't hadn't wouldn't couldn't shouldn't mustn't let's there's it's that's what's i'm
you're we're they're he's she's i've you've we've they've i'll you'll we'll they'll i'd you'd we'd they'd away back however therefore
thus indeed instead otherwise else soon later well anyway together forward
`);

const VERBS = words(`
be is am are was were been being have has had having do does did done doing go goes went gone going say says said make makes made making get
gets got gotten getting know knows knew known think thinks thought take takes took taken see sees saw seen come comes came coming want wants
wanted look looks looked use uses used using find finds found give gives gave given tell tells told work works worked call calls called try
tries tried ask asks asked need needs needed feel feels felt become becomes became leave leaves left put puts mean means meant keep keeps kept
begin begins began begun seem seems seemed help helps helped show shows showed shown hear hears heard play plays played run runs ran move moves
moved live lives lived believe believes believed bring brings brought happen happens happened write writes wrote written sit sits sat stand
stands stood lose loses lost pay pays paid meet meets met include includes included continue continues continued set learn learns learned
change changes changed lead leads led understand understands understood watch watches watched follow follows followed stop stops stopped
create creates created speak speaks spoke spoken read reads allow allows allowed add adds added spend spends spent grow grows grew grown open
opens opened walk walks walked win wins won offer offers offered remember remembers remembered love loves loved consider considers considered
appear appears appeared buy buys bought wait waits waited serve serves served die dies died send sends sent expect expects expected build
builds built stay stays stayed fall falls fell fallen reach reaches reached kill kills killed remain remains remained suggest suggests
suggested raise raises raised pass passes passed sell sells sold require requires required report reports reported decide decides decided
pull pulls pulled explain explains explained hope hopes hoped develop develops developed carry carries carried break breaks broke broken
receive receives received agree agrees agreed support supports supported hit hits produce produces produced eat eats ate eaten cover covers
covered catch catches caught draw draws drew drawn choose chooses chose chosen cause causes caused point points pointed listen listens
listened realize realizes realized jump jumps jumped fix fixes fixed ran shows found falls drop drops dropped finish finishes finished
study studies studied worry worries worried visit visits visited relax relaxes relaxed install installs installed click clicks clicked revise revises revised
publish publishes published tire tires tired cut cuts close closes closed enter enters entered lend lends lent extend extends extended sing
sings sang sung sleep sleeps slept water waters watered bake bakes baked grow kick kicks kicked attract attracts attracted test tests tested
remain approve approves approved welcome welcomes welcomed restart restarts restarted appear stand strengthen strengthens strengthened turn
turns turned print prints printed send drive drives drove driven ride rides rode cook cooks cooked clean cleans cleaned wash washes washed
fill fills filled return returns returned arrive arrives arrived travel travels travelled traveled describe describes described discuss
discusses discussed prepare prepares prepared improve improves improved protect protects protected prefer prefers preferred mention
mentions mentioned notice notices noticed answer answers answered measure measures measured compare compares compared contain contains
contained produce manage manages managed enjoy enjoys enjoyed imagine imagines imagined belong belongs belonged forget forgets forgot
forgotten hold holds held fight fights fought throw throws threw thrown wear wears wore worn sell hide hides hid hidden shake shook
start starts started save saves saved check checks checked plan plans planned share shares shared fly flies flew teach teaches taught
`);

const ADJS = words(`
sweet narrow northern southern eastern western light deep thin thick round flat sharp gentle loud silent tall
good new first last next long great little own other old right big high different small large next early young important few public bad same able
real best better free full sure clear hard easy possible whole recent strong low late general simple true hot cold short dark white black red
blue green yellow happy sad beautiful nice fine kind quiet loud fast slow rich poor safe dangerous wide deep open close ready quick final main
major local social national human common similar huge tiny certain special likely difficult available popular serious natural modern cheap
expensive heavy light empty busy tired hungry wrong left wonderful terrible famous favorite ancient brief calm clean dirty dry wet fresh warm
cool soft bright brave proud angry afraid alive alone alike aware entire foreign further obvious perfect previous rare single sudden various
`);

const NOUN_SUFFIX = /(tion|sion|ment|ness|ity|ism|ship|hood|dom|ance|ence|er|or|ist|ure|age|ery|cy|th)s?$/;
const ADJ_SUFFIX = /(ous|ful|ive|able|ible|al|ic|less|ish|ary|ory|ant|ent|ian|ese|est|ier)$/;
const DETERMINERS = words("a an the this that these those my your his her its our their some any no every each another which what whose");
const SUBJECTS = words("i you he she it we they who that");
const FLAT_ADVERBS = words("fast hard late early high low straight right long well");
const INTENSIFIERS = words("very so too more most less least quite really extremely rather pretty fairly");
/** -ing words that are nouns. */
const NOUN_ING = words("evening morning building meeting painting wedding ceiling king thing things ring spring string nothing something anything everything feeling beginning ending setting meaning clothing");
const MODALS = words("can could will would shall should may might must to don't doesn't didn't won't can't cannot");

/** The class of one word, with the word and class before it. */
export function tagEnglishWord(raw: string, prev?: { plain: string; pos: Pos }, next?: string): Pos {
  const w = raw.toLowerCase().replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, "").replace(/’/g, "'");
  if (!w) return "other";
  if (/^\d/.test(w)) return "other";
  if (OTHER.has(w)) {
    // "that" / "like" are the closed-class reading here; "back", "well" too.
    return "other";
  }
  const p = prev?.plain;
  // Proper names mid-sentence are nouns.
  if (prev && /^[A-Z]/.test(raw.replace(/^[^A-Za-z]+/, ""))) return "noun";
  // After a modal the base form is a verb (will run); after "to" too when it is a verb we know (to go), else "to" is the preposition (to school).
  if (p === "to") return VERBS.has(w) ? "verb" : ADJS.has(w) ? "adj" : NOUN_ING.has(w) || !/(ate|ize|ise|ify|en)$/.test(w) ? "noun" : "verb";
  if (p && MODALS.has(p)) return ADJS.has(w) ? "adj" : "verb";
  // An -ing or -ed word after an intensifier describes (very interesting, so tired).
  if (p && INTENSIFIERS.has(p) && /(ing|ed)$/.test(w)) return "adj";
  if (NOUN_ING.has(w)) return "noun";
  // Adjectives that work as adverbs right after a verb (ran fast, kicked hard, stayed late).
  if (FLAT_ADVERBS.has(w) && prev?.pos === "verb" && !/^(is|are|was|were|be|been|am|seem|seems|seemed|look|looks|looked|become|became|feel|feels|felt|get|got)$/.test(p ?? "")) return "other";
  if (VERBS.has(w)) {
    // Before a modal or an auxiliary the word is the subject (Work will begin).
    if (next && /^(will|would|can|could|should|must|may|might|is|was|has|had)$/.test(next)) return "noun";
    // After an adjective the word is the noun it describes (a new plan, careful thought).
    if (prev?.pos === "adj" && !/(ed|ing)$/.test(w)) return "noun";
    // "a walk", "the change", "my work": after a determiner it is the noun.
    if (p && DETERMINERS.has(p) && !/(ed|ing)$/.test(w) && !["is", "are", "was", "were", "be", "been", "has", "have", "had"].includes(w)) return next && /^[a-z]/.test(next) && !OTHER.has(next) && !VERBS.has(next) ? "adj" : "noun";
    return "verb";
  }
  if (ADJS.has(w)) return "adj";
  if (/ly$/.test(w) && w.length > 4) return "other";
  if (/ing$/.test(w) && w.length > 5) return p && DETERMINERS.has(p) ? "noun" : "verb";
  if (/ed$/.test(w) && w.length > 4) {
    // "the printed page": between a determiner and a noun, a participle describes.
    if (p && DETERMINERS.has(p)) return "adj";
    return "verb";
  }
  // An adjective-looking word that ends its phrase is a noun (the library, a journal, memory).
  if (ADJ_SUFFIX.test(w) && !NOUN_SUFFIX.test(w) && w.length > 4) return !next || OTHER.has(next) ? "noun" : "adj";
  if (NOUN_SUFFIX.test(w)) return "noun";
  // -s after a subject is the verb (she reads, the sun rises); otherwise a plural noun.
  if (/[^s]s$/.test(w) && p && prev?.pos !== "adj" && (SUBJECTS.has(p) || (prev?.pos === "noun" && !/s$/.test(p)))) return "verb";
  if (p && SUBJECTS.has(p) && prev?.pos === "other" && !/s$/.test(w) && ["i", "you", "we", "they"].includes(p)) return "verb";
  return "noun";
}

/** Tag every word of `text`. */
export function tagEnglish(text: string): Array<{ word: string; from: number; to: number; pos: Pos }> {
  const ms = [...text.matchAll(/[A-Za-z0-9][A-Za-z0-9'’-]*/g)];
  const out: Array<{ word: string; from: number; to: number; pos: Pos }> = [];
  let prev: { plain: string; pos: Pos } | undefined;
  ms.forEach((m, i) => {
    const pos = tagEnglishWord(m[0], prev, ms[i + 1]?.[0]?.toLowerCase());
    out.push({ word: m[0], from: m.index ?? 0, to: (m.index ?? 0) + m[0].length, pos });
    // A sentence boundary resets the context.
    const between = text.slice((m.index ?? 0) + m[0].length, ms[i + 1]?.index ?? text.length);
    prev = /[.!?;:]/.test(between) ? undefined : { plain: m[0].toLowerCase().replace(/’/g, "'"), pos };
  });
  return out;
}
