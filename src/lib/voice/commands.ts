import { STATES } from "@/lib/kb/regions";
import { toRoman } from "./translit";

/**
 * The Jarvis layer — spoken (or typed) commands that drive the interface
 * itself, resolved in the client with no model and no round trip.
 *
 * "Kerala kholo" should open Kerala's deck in the time it takes to say it.
 * Sending that to the agent costs a network turn to learn what three lines of
 * pattern matching already know — so the deck tries this router first and
 * falls through to the agent for everything that is a question rather than a
 * command.
 *
 * The dividing line is the verb. "Kerala kholo / show Kerala / zoom Kerala"
 * is a command; "Kerala mein kya chal raha hai" is a question and must reach
 * the agent — so nothing here matches without an action word.
 */

export type UiCommand =
  | { kind: "open_state"; state: string }
  | { kind: "close_all" }
  | { kind: "tab"; tab: "overview" | "intel" | "ops" | "orgs" }
  | { kind: "missions" }
  | { kind: "sos" };

const VERB = /\b(kholo|khol\s*do|kholiye|dikhao|dikha\s*do|open|show|zoom|le\s*chalo|chalao|launch)\b/i;
const CLOSE = /\b(band|close|clear|hatao|hata\s*do|saaf)\b/i;

/**
 * Subjects the agent has a tool for.
 *
 * Naming one of these turns a verb phrase back into a question: the person
 * wants an answer about the thing, not the interface opened at it. The list is
 * only the words that unambiguously name a lookup — "map", "deck" and "window"
 * stay out, because those really are the interface.
 */
const TOPIC =
  /\b(alerts?|risk|khatra|status|news|khabar|forecast|barish|rain|rainfall|flood|baadh|population|abadi|shelters?|incidents?|sos|teams?|weather|mausam|situation|report|discharge|river|nadi)\b/i;

/** What a command answers back with — short, speakable, in the asker's register. */
export function commandAck(cmd: UiCommand): string {
  switch (cmd.kind) {
    case "open_state":
      return `${cmd.state} ka deck khul raha hai.`;
    case "close_all":
      return "Saaf kar diya — sab windows band.";
    case "tab":
      return cmd.tab === "intel"
        ? "AI intelligence khul raha hai."
        : cmd.tab === "ops"
          ? "Operations khul raha hai."
          : cmd.tab === "orgs"
            ? "Organisations khul raha hai."
            : "Overview par wapas.";
    case "missions":
      return "Missions khul rahe hain.";
    case "sos":
      return "SOS khul raha hai — bataiye kya hua.";
  }
}

/**
 * Squash a word to something that survives being transliterated.
 *
 * Romanising Devanagari is phonetic, not reversible, so the same place comes
 * out spelled slightly differently from how the region file spells it:
 * केरल becomes "keral" against a canonical "Kerala", असम becomes "asam"
 * against "Assam", and दिखाओ becomes "dikhaao" against the verb "dikhao".
 * Matching those literally fails every time.
 *
 * Collapsing doubled letters and long vowels puts both spellings in the same
 * shape — "asam" and "assam" both become "asam" — without inventing a fuzzy
 * matcher whose false positives nobody could predict.
 */
const squash = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .replace(/aa/g, "a")
    .replace(/ee/g, "i")
    .replace(/oo/g, "u")
    .replace(/([a-z])\1/g, "$1");

/**
 * Find a state named anywhere in the words, tolerant of transliteration.
 *
 * Runs of one to three adjacent words are squashed and tested against each
 * state's squashed name, because "Uttar Pradesh" arrives as two words and
 * "Dadra and Nagar Haveli" as four. A run shorter than four characters must
 * match exactly — otherwise "goa" would be claimed by any word starting "go".
 */
function findState(words: string[]): string | null {
  const byLength = [...STATES].sort((a, b) => b.name.length - a.name.length);

  for (const state of byLength) {
    const target = squash(state.name);
    for (let i = 0; i < words.length; i++) {
      for (let n = 1; n <= 4 && i + n <= words.length; n++) {
        const run = squash(words.slice(i, i + n).join(""));
        if (!run) continue;
        if (run === target) return state.name;
        // A prefix is allowed because schwa deletion clips the final vowel —
        // "keral" for Kerala — but only when it is long enough to be that
        // state and nothing else.
        if (run.length >= 4 && target.startsWith(run)) return state.name;
      }
    }
  }
  return null;
}

export function uiCommand(raw: string): UiCommand | null {
  // Recognition runs on hi-IN, so a spoken command arrives in Devanagari:
  // "Kerala kholo" comes back as "केरल खोलो". Every pattern below is written in
  // Latin, so without this the entire spoken command layer matched nothing and
  // silently fell through to the agent — which then answered the command as
  // though it were a question. Typing worked; speaking never did.
  const t = toRoman(raw).toLowerCase().trim();
  if (!t || t.length > 90) return null;

  // Closing needs no target-verb pairing: "sab band karo", "clear deck".
  if (CLOSE.test(t) && /\b(sab|all|windows?|deck|panels?|everything)\b/i.test(t)) {
    return { kind: "close_all" };
  }

  // Squashed as well as literal: "dikhaao" out of the transliterator has to
  // reach the same verb as a typed "dikhao".
  const words = t.split(/[^a-z0-9]+/i).filter(Boolean);
  const flat = squash(t);
  const hasVerb = VERB.test(t) || words.some((w) => VERB.test(squash(w)));
  if (!hasVerb) return null;

  // Each alternative below is the actual output of the transliterator on the
  // spoken Hindi, not a guess at it — रिप्ले comes back "riple", मिशन्स comes
  // back "mishans", एसओएस comes back "esaoes".
  if (/\b(sos|emergency|madad)\b/.test(t) || /esaoes|madad/.test(flat)) return { kind: "sos" };
  if (/\bmissions?\b|mera\s+kaam/.test(t) || /mishans|merakam/.test(flat))
    return { kind: "missions" };
  // Tab names are English words, and a Hindi speaker saying them produces a
  // transliteration rather than the word — "ऑपरेशन्स" romanises to
  // "opareshans". Both spellings are checked.
  if (/\b(intel|intelligence|ai\s*(tab|brief|report)?)\b/.test(t) || /intel/.test(flat))
    return { kind: "tab", tab: "intel" };
  if (/\b(operations?|ops)\b/.test(t) || /opareshans|opreshans|opareshan/.test(flat))
    return { kind: "tab", tab: "ops" };
  if (/\b(organisations?|orgs?|sangathan)\b/.test(t) || /organaijeshans|sangatan/.test(flat))
    return { kind: "tab", tab: "orgs" };
  if (/\b(overview|board|home|ghar)\b/.test(t) || /ovaravyu|ovarvyu/.test(flat))
    return { kind: "tab", tab: "overview" };

  // A named state plus an action verb opens its deck — unless the sentence
  // also names something to look up.
  //
  // "Assam dikhao" is a command. "Assam ke alerts dikhao" is a question with a
  // polite verb on it, and treating it as a command made the assistant open a
  // deck and announce "Assam ka deck khul raha hai" — narrating its own action
  // back at someone who asked about alerts. A verb is not enough on its own;
  // what settles it is whether a subject was named.
  if (TOPIC.test(t)) return null;

  const named = findState(words);
  if (named) return { kind: "open_state", state: named };

  return null;
}
