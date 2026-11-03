/**
 * Which language the agent answers in.
 *
 * There used to be a Hindi/English switch in the header. A single Indian
 * sentence runs "Kerala mein red alert hai, kitne log affected hain" and having
 * to flip a mode mid-thought is exactly the friction that makes a voice UI feel
 * like a machine. Nothing is selected now — the reply voice comes from the
 * reply's own words, so this is the check that it picks right.
 *
 * The failure that matters is asymmetric: the Hindi voice reads Hinglish
 * acceptably, the English voice reads Devanagari as silence. So a wrong guess
 * towards Hindi is survivable and a wrong guess towards English is not.
 */
import { loadFromSrc, harness } from "./_build.mjs";

const { replyLanguage, hindiness, RECOGNITION_LANG } = await loadFromSrc("lib/voice/language.ts");
const { check, report } = harness();

console.log("SCRIPT IS DECISIVE");
check("any Devanagari means Hindi", replyLanguage("Kerala में red alert है") === "hi-IN");
check("mixed script leans Hindi, never English", hindiness("8 districts में भारी बारिश") === 1);
check(
  "the issuer's own Malayalam is not read by an English voice",
  replyLanguage("അടുത്ത 3 മണിക്കൂറിൽ കേരളത്തിൽ") === "hi-IN",
);

console.log("\nROMANISED HINGLISH");
const hinglish = [
  "Kerala mein kitne log affected hain",
  "abhi kya chal raha hai",
  "nearest team bhejo",
  "paani ghar me aa raha hai main kya karun",
  "Palakkad ka flood risk batao",
  "bijli kadak rahi hai kaise bachu",
];
for (const q of hinglish) {
  check(`hi  "${q.slice(0, 42)}"`, replyLanguage(q) === "hi-IN", `scored ${hindiness(q).toFixed(2)}`);
}

console.log("\nPLAIN ENGLISH");
const english = [
  "Kerala SDMA has a red alert out for very heavy rain",
  "Which states face landslides",
  "Show me population across India",
  "This red alert covers roughly 2.3 million people across 8 districts",
  "Thane has eleven million people at the 2011 census",
];
for (const q of english) {
  check(`en  "${q.slice(0, 42)}"`, replyLanguage(q) === "en-IN", `scored ${hindiness(q).toFixed(2)}`);
}

console.log("\nEDGES");
check("empty text does not crash", replyLanguage("") === "en-IN");
check("punctuation only", replyLanguage("?!.") === "en-IN");
check(
  "shared vocabulary alone is not Hindi — 'alert' and 'district' are said in both",
  replyLanguage("alert district team flood") === "en-IN",
);
check(
  "two Hindi function words in a long English sentence still switch",
  replyLanguage("The alert says kitne log are affected in this district right now") === "hi-IN",
);
check("recognition stays on the code-switching model", RECOGNITION_LANG === "hi-IN");

report();
