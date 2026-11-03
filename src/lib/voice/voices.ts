import { hindiness } from "./language";

/**
 * Choosing the browser voice — the part that decides whether this sounds like a
 * person or like a 2004 satnav.
 *
 * The Web Speech API exposes no quality field. Every voice on the machine looks
 * identical in the list, and the difference between the best and the worst is
 * the difference between a demo people lean into and one they wince at. So the
 * ranking is by name, deliberately, in the open.
 *
 * The thing that made the old picker pick badly was that it matched on the
 * language tag alone. Two separate problems came out of that:
 *
 *   1. Actual Devanagari — and Malayalam, Telugu, Odia, which NDMA alerts
 *      arrive in — cannot go to an English voice at all. That is silence, not
 *      an accent, and it is what a language-tag match produces the moment a
 *      reply quotes an issuer verbatim.
 *
 *   2. A reply is frequently romanised Hinglish — "Assam mein terah alert hain"
 *      in Latin script — and which voice reads that best is a judgement about
 *      how it SOUNDS, which is not one to settle from the code. Listening to
 *      this machine: the Hindi voice reads Hinglish well and the stock English
 *      voices are the robotic ones. So Hinglish goes to the Hindi voice, and
 *      anyone who hears it differently overrides it in Settings, where every
 *      voice on their machine can be previewed before choosing.
 *
 * So the script decides, not the tag — and the default is only a default.
 */

const INDIC = /[ऀ-ൿ]/;

/**
 * Voices worth hearing, best first.
 *
 * macOS Siri-class (Aman, Tara), Chrome's own network voices, and the Windows
 * and Android neural sets. Matched as substrings because platforms decorate the
 * names — "Aman (Enhanced)", "Microsoft Swara Online (Natural)".
 */
const NATURAL_INDIC = ["Google हिन्दी", "Google Hindi", "Swara", "Madhur", "Kiyara", "Hemant"];
const NATURAL_INDIAN_ENGLISH = ["Aman", "Tara", "Neerja", "Prabhat", "Priya", "Heera", "Rishi"];
const NATURAL_ENGLISH = [
  "Google UK English Female",
  "Google US English",
  "Samantha",
  "Karen",
  "Daniel",
  "Aria",
  "Jenny",
];

/** Explicit quality markers some platforms put in the name. */
const ENHANCED = /premium|enhanced|natural|neural|siri|online/i;

/**
 * Voices to use only when there is nothing else.
 *
 * Deliberately short. "Compact" is Apple's low-footprint tier and audibly is
 * one; espeak is the Linux formant synthesiser. Named voices are NOT listed
 * here — an earlier version had Lekha on this list on the assumption that the
 * stock Hindi voice was the robotic one, and the first person to actually
 * listen said the opposite. Taste belongs in the settings panel, next to a
 * preview button, not in a regex written by someone who cannot hear it.
 */
const LAST_RESORT = /compact|espeak/i;

/** The shape this needs from a SpeechSynthesisVoice — nothing browser-only. */
export interface VoiceLike {
  name: string;
  lang: string;
}

const tag = (v: VoiceLike) => v.lang.replace("_", "-").toLowerCase();
const isIndic = (v: VoiceLike) => /^(hi|mr|bn|ta|te|ml|kn|gu|pa|or)\b/.test(tag(v));
const isIndianEnglish = (v: VoiceLike) => tag(v).startsWith("en-in");
const isEnglish = (v: VoiceLike) => tag(v).startsWith("en");

function best<T extends VoiceLike>(voices: T[], names: string[]): T | undefined {
  for (const n of names) {
    const hit = voices.find((v) => v.name.toLowerCase().includes(n.toLowerCase()));
    if (hit) return hit;
  }
  return undefined;
}

/** Anything not on the last-resort list, preferring an explicit quality marker. */
function anyDecent<T extends VoiceLike>(pool: T[]): T | undefined {
  const clean = pool.filter((v) => !LAST_RESORT.test(v.name));
  return clean.find((v) => ENHANCED.test(v.name)) ?? clean[0];
}

/**
 * The voice to speak `text` with, or null when the machine has none.
 *
 * Pure and platform-agnostic on purpose — this is the whole decision, and it is
 * checked in test/voices.mjs against the voice lists real machines report.
 */
// Generic so a caller passing SpeechSynthesisVoice[] gets one back, rather than
// the structural subset this file needs — the alternative is a cast at every
// call site, which is where a wrong voice would hide.
export function pickVoice<T extends VoiceLike>(voices: T[], text: string): T | null {
  if (!voices.length) return null;

  // Indic script: only an Indic voice can say these characters at all, so the
  // last-resort ones stay in play rather than falling through to silence.
  if (INDIC.test(text)) {
    const indic = voices.filter(isIndic);
    return (
      best(indic, NATURAL_INDIC) ??
      indic.find((v) => ENHANCED.test(v.name)) ??
      anyDecent(indic) ??
      indic[0] ??
      null
    );
  }

  // Latin script that is Hindi in spirit — the Hinglish case, and the one the
  // agent produces most. The Hindi voice sounds it out the way it is written;
  // the stock English voices flatten it. Indian English is the fallback, and a
  // long way ahead of a US or UK voice reading "baadh" and "Muzaffarpur".
  if (hindiness(text) >= 0.12) {
    const indic = voices.filter(isIndic);
    return (
      best(indic, NATURAL_INDIC) ??
      indic.find((v) => ENHANCED.test(v.name)) ??
      anyDecent(indic) ??
      indic[0] ??
      best(voices.filter(isIndianEnglish), NATURAL_INDIAN_ENGLISH) ??
      anyDecent(voices.filter(isEnglish)) ??
      anyDecent(voices) ??
      voices[0]
    );
  }

  // Plain English. Indian English first — this is an Indian product and the
  // place names are Indian, which is exactly what those voices get right.
  return (
    best(voices.filter(isIndianEnglish), NATURAL_INDIAN_ENGLISH) ??
    best(voices, NATURAL_ENGLISH) ??
    anyDecent(voices.filter(isEnglish)) ??
    anyDecent(voices) ??
    voices[0]
  );
}

/** True when the only thing available is one of the voices people complain about. */
export function isLastResort(v: VoiceLike | null): boolean {
  return !!v && LAST_RESORT.test(v.name);
}

/**
 * Which stored preference applies to this text.
 *
 * Devanagari and romanised Hinglish share a slot because they share a voice —
 * the same speaker reads both, and someone choosing one is choosing for both.
 */
export function slotFor(text: string): "indic" | "english" {
  return INDIC.test(text) || hindiness(text) >= 0.12 ? "indic" : "english";
}
