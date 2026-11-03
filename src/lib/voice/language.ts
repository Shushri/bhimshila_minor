/**
 * Which language to speak back in — decided from the words, never from a toggle.
 *
 * The app used to make you pick Hindi or English from a switch before talking.
 * That is the wrong shape for how people here actually speak: a single sentence
 * runs "Kerala mein red alert hai, kitne log affected hain?" and switching modes
 * mid-thought is exactly the friction that makes voice feel like a machine.
 *
 * So nothing is selected. Recognition always runs on hi-IN, because it handles
 * embedded English far better than en-IN handles embedded Hindi, and the reply
 * voice is chosen from what the reply actually contains.
 */

export type VoiceLang = "hi-IN" | "en-IN";

/**
 * Any Indic script, not just Devanagari.
 *
 * This started as a Devanagari-only check and it was wrong in a way that
 * produced silence rather than an error. NDMA writes each warning in the local
 * language — the Kerala SDMA's alerts arrive in Malayalam, Andhra's in Telugu,
 * Odisha's in Odia — and this app relays that text verbatim. An English voice
 * handed Malayalam reads nothing at all, so the person under a red alert hears
 * a pause and assumes the app is broken.
 *
 * Covers Devanagari through Malayalam: U+0900–U+0D7F.
 */
const INDIC = /[ऀ-ൿ]/;

/**
 * Hindi words that survive romanisation, which is how most people type and how
 * the recogniser often returns them. Deliberately common function words rather
 * than nouns: "alert", "team" and "district" are said in both languages, but
 * nobody says "kitne" in an English sentence.
 */
const ROMAN_HINDI = [
  "hai", "hain", "kya", "kaise", "kahan", "kaha", "kitne", "kitna", "kyun", "kyu",
  "abhi", "bhejo", "karo", "karun", "karein", "chahiye", "nahi", "nahin", "haan",
  "mujhe", "mera", "meri", "hum", "humein", "aur", "lekin", "phir", "wala", "wali",
  "batao", "bata", "dikhao", "dikha", "jaldi", "turant", "log", "paani", "pani",
  "baadh", "barish", "khatra", "madad", "bachao", "sab", "sabse", "zyada", "kam",
  "raha", "rahi", "rahe", "gaya", "gayi", "hua", "hui", "koi", "kuch", "yeh", "woh",
];

const words = (s: string) => s.toLowerCase().split(/[^a-zऀ-ॿ]+/).filter(Boolean);

/**
 * How Indic a piece of text is, 0 to 1.
 *
 * Any Indic script at all returns 1 — a mixed-script sentence should be spoken
 * by the Indic voice, which pronounces embedded English acceptably, where the
 * English voice reads the script as silence.
 *
 * A known limit: this routes Malayalam and Telugu to the hi-IN voice, which
 * pronounces them poorly. Poorly is still better than not at all, and a proper
 * fix means per-script voices rather than the two this app has.
 */
export function hindiness(text: string): number {
  if (!text.trim()) return 0;
  if (INDIC.test(text)) return 1;

  const w = words(text);
  if (!w.length) return 0;
  const hits = w.filter((x) => ROMAN_HINDI.includes(x)).length;
  return hits / w.length;
}

/**
 * The voice to answer in.
 *
 * The threshold is low on purpose. Two Hindi function words in a fifteen-word
 * sentence means the speaker is Hinglish, and the Hindi voice reads Hinglish
 * far more naturally than the English one does — the failure is asymmetric, so
 * the default leans Hindi.
 */
export function replyLanguage(text: string): VoiceLang {
  return hindiness(text) >= 0.12 ? "hi-IN" : "en-IN";
}

/**
 * Recognition language.
 *
 * Always hi-IN, and this is not a placeholder. Chrome's hi-IN model transcribes
 * "Kerala mein red alert hai" correctly; en-IN returns "Kerala may red alert
 * he". Whichever way it is wrong, it is less wrong this way.
 */
export const RECOGNITION_LANG: VoiceLang = "hi-IN";
