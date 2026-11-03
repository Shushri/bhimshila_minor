/**
 * Browser voice selection.
 *
 * This suite exists because "it sounded robotic" is not a bug report anyone can
 * act on twice. The complaint has a cause — a language-tag match lands on
 * Lekha, the only hi-IN voice macOS ships, for every Hindi and Hinglish reply —
 * and a cause can be asserted against.
 *
 * The voice lists below are what real machines report, not invented fixtures:
 * `say -v '?'` on this Mac, plus the Google voices Chrome adds on top and the
 * Microsoft set Windows exposes.
 */
import { loadFromSrc, harness } from "./_build.mjs";

const { pickVoice, isLastResort } = await loadFromSrc("lib/voice/voices.ts", { bundle: true });
const { check, report } = harness();

const v = (name, lang) => ({ name, lang });

/** macOS 15 with the Indian voices installed, as Chrome reports them. */
const MAC_CHROME = [
  v("Aman", "en-IN"),
  v("Tara", "en-IN"),
  v("Rishi", "en-IN"),
  v("Lekha", "hi-IN"),
  v("Samantha", "en-US"),
  v("Daniel", "en-GB"),
  v("Google हिन्दी", "hi-IN"),
  v("Google UK English Female", "en-GB"),
];

/** A machine with a compact voice in the list, which is the real low tier. */
const MAC_BARE = [v("Lekha", "hi-IN"), v("Samantha", "en-US"), v("Daniel", "en-GB")];

const WINDOWS = [
  v("Microsoft Swara Online (Natural) - Hindi (India)", "hi-IN"),
  v("Microsoft Madhur Online (Natural) - Hindi (India)", "hi-IN"),
  v("Microsoft Neerja Online (Natural) - English (India)", "en-IN"),
  v("Microsoft Hemant - Hindi (India)", "hi-IN"),
  v("Microsoft Zira - English (United States)", "en-US"),
];

const HINGLISH = "Assam mein terah alert hain, do orange";
const DEVANAGARI = "असम में तेरह अलर्ट हैं";
const MALAYALAM = "കേരളത്തിൽ റെഡ് അലർട്ട്";
const ENGLISH = "Thirteen live alerts across Assam, two of them orange";

console.log("HINGLISH — Latin script, Hindi in spirit");
{
  const p = pickVoice(MAC_CHROME, HINGLISH);
  // Listened to on this machine: the Hindi voice sounds Hinglish out the way it
  // is written, and the stock English voices flatten it. The default follows the
  // ear, and Settings overrides it for a different one.
  check("goes to a Hindi voice, not an English one", p.lang === "hi-IN", `${p.name} · ${p.lang}`);
  check("prefers Google's Hindi where it exists", p.name === "Google \u0939\u093f\u0928\u094d\u0926\u0940", p.name);
  check("never a compact/low-tier voice", !isLastResort(p), p.name);
}

console.log("\nDEVANAGARI — only an Indic voice can say it at all");
{
  const p = pickVoice(MAC_CHROME, DEVANAGARI);
  check("picks a Hindi voice", p.lang === "hi-IN", `${p.name} · ${p.lang}`);
  check("prefers Google's Hindi over Lekha", p.name === "Google हिन्दी", p.name);
  check(
    "never an English voice — that is silence, not an accent",
    !p.lang.startsWith("en"),
    p.lang,
  );
}

console.log("\nWHEN LEKHA IS ALL THERE IS");
{
  const p = pickVoice(MAC_BARE, DEVANAGARI);
  check("Devanagari still gets said", p.name === "Lekha", p.name);
  check("Lekha is not treated as low-tier — that was a guess, and it was wrong", !isLastResort(p));
  const h = pickVoice(MAC_BARE, HINGLISH);
  check("Hinglish uses Lekha too when it is the only Indian voice", h.name === "Lekha", h.name);
}

console.log("\nOTHER INDIC SCRIPTS — NDMA writes alerts in the local language");
{
  const p = pickVoice(MAC_CHROME, MALAYALAM);
  check("Malayalam routed to an Indic voice, not English", !p.lang.startsWith("en"), `${p.name} · ${p.lang}`);
}

console.log("\nENGLISH");
{
  const p = pickVoice(MAC_CHROME, ENGLISH);
  check("plain English prefers an Indian English voice for Indian place names", p.lang === "en-IN", `${p.name} · ${p.lang}`);
  check("not a last-resort voice", !isLastResort(p), p.name);
}

console.log("\nWINDOWS");
{
  check(
    "Devanagari takes a Natural voice over the older one",
    /Swara|Madhur/.test(pickVoice(WINDOWS, DEVANAGARI).name),
    pickVoice(WINDOWS, DEVANAGARI).name,
  );
  check(
    "Hinglish takes a Natural Hindi voice",
    /Swara|Madhur/.test(pickVoice(WINDOWS, HINGLISH).name),
    pickVoice(WINDOWS, HINGLISH).name,
  );
  check(
    "plain English takes the Indian English Natural voice",
    pickVoice(WINDOWS, ENGLISH).name.includes("Neerja"),
    pickVoice(WINDOWS, ENGLISH).name,
  );
}

console.log("\nDEGENERATE INPUT");
check("no voices at all returns null rather than throwing", pickVoice([], HINGLISH) === null);
check("empty text still returns something speakable", !!pickVoice(MAC_CHROME, ""));

report();
