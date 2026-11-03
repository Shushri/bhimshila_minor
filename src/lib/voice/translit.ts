/**
 * Devanagari to Roman, for what the microphone heard.
 *
 * Recognition runs on hi-IN because that model handles embedded English far
 * better than en-IN handles embedded Hindi — see language.ts. The cost is that
 * Chrome returns Devanagari, so "madhya pradesh ka data kholo" came back on
 * screen as "मध्य प्रदेश का डेटा खोलो". That is a correct transcript and the
 * wrong thing to show: people here type and read Hinglish in Roman letters, and
 * reading back a script you did not write feels like the machine misheard you
 * even when it did not.
 *
 * This is deliberately phonetic rather than a reversible scheme. ITRANS and
 * IAST are exact and unreadable — "मुझे" becomes "mujhe", not "mujhE" or
 * "mujhē". Nobody is round-tripping this; they are reading it off a screen at
 * a glance, so it is optimised for looking like something a person would type.
 *
 * Only the display is transliterated. What travels to the agent stays as the
 * recogniser produced it, because the model reads Devanagari perfectly well and
 * a lossy romanisation is not something to make it work from.
 */

const INDEPENDENT: Record<string, string> = {
  अ: "a", आ: "aa", इ: "i", ई: "ee", उ: "u", ऊ: "oo", ऋ: "ri",
  ए: "e", ऐ: "ai", ओ: "o", औ: "au", ऍ: "e", ऑ: "o",
};

/** Vowel signs (matras) that follow a consonant. */
const MATRA: Record<string, string> = {
  "ा": "aa", "ि": "i", "ी": "ee", "ु": "u", "ू": "oo",
  "ृ": "ri", "े": "e", "ै": "ai", "ो": "o", "ौ": "au",
  "ॅ": "e", "ॉ": "o",
};

/**
 * Consonants, without their inherent "a" — that is added by the caller only
 * when no matra and no virama follows.
 */
const CONSONANT: Record<string, string> = {
  क: "k", ख: "kh", ग: "g", घ: "gh", ङ: "n",
  च: "ch", छ: "chh", ज: "j", झ: "jh", ञ: "n",
  ट: "t", ठ: "th", ड: "d", ढ: "dh", ण: "n",
  त: "t", थ: "th", द: "d", ध: "dh", न: "n",
  प: "p", फ: "ph", ब: "b", भ: "bh", म: "m",
  य: "y", र: "r", ल: "l", व: "v", ळ: "l",
  श: "sh", ष: "sh", स: "s", ह: "h",
  // Nukta forms, which the recogniser does emit for Urdu-origin words.
  क़: "q", ख़: "kh", ग़: "gh", ज़: "z", ड़: "r", ढ़: "rh", फ़: "f",
};

const VIRAMA = "्";
const ANUSVARA = "ं";
const CHANDRABINDU = "ँ";
const VISARGA = "ः";
const NUKTA = "़";

const DIGIT: Record<string, string> = {
  "०": "0", "१": "1", "२": "2", "३": "3", "४": "4",
  "५": "5", "६": "6", "७": "7", "८": "8", "९": "9",
};

/** True when the string contains any Devanagari at all. */
export const hasDevanagari = (s: string) => /[ऀ-ॿ]/.test(s);

/**
 * Romanise Devanagari, leaving everything else untouched.
 *
 * Mixed input is the normal case — "Kerala में red alert" — so Latin
 * characters, digits and punctuation pass straight through.
 */
export function toRoman(input: string): string {
  if (!hasDevanagari(input)) return input;

  // Compose nukta pairs first: क + ़ is the same letter as क़, and the
  // recogniser emits both forms depending on the word.
  const s = input.normalize("NFC");

  /**
   * Schwa deletion — the difference between "pradesha" and "pradesh".
   *
   * Hindi drops the inherent vowel at the end of a word: मध्य प्रदेश is
   * "madhya pradesh", never "madhya pradesha". Writing every inherent "a" is
   * what makes naive transliteration instantly recognisable as machine output.
   *
   * Two exceptions, both of which sound wrong without the vowel:
   *   - semivowel endings — गया is "gaya", not "gay"
   *   - single-syllable words — क्या is "kya", not "ky"
   */
  const SEMIVOWEL = new Set(["य", "व"]);
  const isLetter = (c?: string) => !!c && /[ऀ-ॿ]/.test(c);

  let out = "";
  /** Vowels emitted in the current word, to spot the single-syllable case. */
  let syllables = 0;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const next = s[i + 1];
    if (!isLetter(ch)) syllables = 0;

    if (DIGIT[ch]) {
      out += DIGIT[ch];
      continue;
    }
    if (INDEPENDENT[ch]) {
      out += INDEPENDENT[ch];
      syllables++;
      continue;
    }
    if (CONSONANT[ch]) {
      out += CONSONANT[ch];
      // The inherent "a" is only real when nothing else claims the slot.
      if (next === VIRAMA) {
        i++; // consume it; the next consonant follows immediately
      } else if (next && MATRA[next]) {
        out += MATRA[next];
        syllables++;
        i++;
      } else if (next === NUKTA) {
        i++;
        // Re-examine what follows the nukta for a matra.
        const after = s[i + 1];
        if (after && MATRA[after]) {
          out += MATRA[after];
          i++;
        } else if (after !== VIRAMA) {
          out += "a";
        } else {
          i++;
        }
      } else {
        // The inherent vowel. Dropped at the end of a word — see above.
        const wordEnds = !isLetter(next);
        if (wordEnds && syllables >= 1 && !SEMIVOWEL.has(ch)) {
          // schwa deleted
        } else {
          out += "a";
          syllables++;
        }
      }
      continue;
    }
    if (MATRA[ch]) {
      // A stray matra with no consonant before it — rare, but never drop input.
      out += MATRA[ch];
      continue;
    }
    if (ch === ANUSVARA || ch === CHANDRABINDU) {
      // में is written "mein", not "men" — the nasal after an e reads as "in".
      out += out.endsWith("e") ? "in" : "n";
      continue;
    }
    if (ch === VISARGA) {
      out += "h";
      continue;
    }
    if (ch === "।" || ch === "॥") {
      out += ".";
      continue;
    }
    if (ch === VIRAMA || ch === NUKTA) continue;

    out += ch;
  }

  // "kaa" and "kii" read worse than "ka" and "ki" at the end of a word, which
  // is where most of them land, and is how people type them.
  return out
    .replace(/aa\b/g, "a")
    .replace(/ee\b/g, "i")
    .replace(/oo\b/g, "u")
    .replace(/\s+/g, " ")
    .trim();
}
