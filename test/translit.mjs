/**
 * Devanagari to Roman, for the transcript the microphone produces.
 *
 * Recognition runs on hi-IN, so Chrome returns Devanagari — "मध्य प्रदेश का
 * सारा डेटा खोलो" for someone who said "madhya pradesh ka saara data kholo".
 * Correct, and the wrong thing to show: people here read and type Hinglish in
 * Roman letters, and being shown a script you did not use reads as the machine
 * having misheard you.
 *
 * What this is not: reversible. It is judged on whether it looks like what a
 * person would have typed, which is why the inherent vowel gets deleted at the
 * end of a word — "pradesha" is the giveaway that a machine wrote it.
 */
import { loadFromSrc, harness } from "./_build.mjs";

const { toRoman, hasDevanagari } = await loadFromSrc("lib/voice/translit.ts", { bundle: true });
const { check, report } = harness();

console.log("THE SENTENCES PEOPLE ACTUALLY SAY TO THIS");
for (const [deva, want] of [
  ["मध्य प्रदेश का सारा डेटा खोलो", "madhya pradesh ka saara deta kholo"],
  ["असम में तेरह अलर्ट हैं", "asam mein terah alart hain"],
  ["पानी घर में घुस गया", "paani ghar mein ghus gaya"],
  ["मुझे मदद चाहिए", "mujhe madad chaahie"],
  ["केरल खोलो", "keral kholo"],
]) {
  check(`"${deva}"`, toRoman(deva) === want, `got "${toRoman(deva)}"  want "${want}"`);
}

console.log("\nSCHWA DELETION — the thing that makes it look human");
check("word-final inherent vowel is dropped", toRoman("घर") === "ghar", toRoman("घर"));
check("प्रदेश is pradesh, not pradesha", toRoman("प्रदेश") === "pradesh", toRoman("प्रदेश"));
// Both exceptions exist because dropping the vowel makes the word unsayable.
check("a semivowel keeps it — गया is gaya, not gay", toRoman("गया") === "gaya", toRoman("गया"));
check("one syllable keeps it — क्या is kya, not ky", toRoman("क्या") === "kya", toRoman("क्या"));

console.log("\nMIXED SCRIPT — the normal case, not an edge case");
check(
  "Latin words pass through untouched",
  toRoman("Kerala में red alert है") === "Kerala mein red alert hai",
  toRoman("Kerala में red alert है"),
);
check("digits and punctuation survive", toRoman("१२ बजे") === "12 baje", toRoman("१२ बजे"));
check("nothing to do is left alone", toRoman("nearest shelter Guwahati") === "nearest shelter Guwahati");

console.log("\nNO INPUT IS EVER DROPPED");
for (const s of ["", "   ", "?", "…", "क", "ऋषि"]) {
  check(`"${s}" does not throw and returns a string`, typeof toRoman(s) === "string", JSON.stringify(toRoman(s)));
}

console.log("\nDETECTION");
check("Devanagari is detected", hasDevanagari("असम"));
check("plain Latin is not", !hasDevanagari("Assam"));
// Malayalam and Telugu come through NDMA alerts and are not Devanagari — they
// must be left exactly as the issuing authority published them.
check("Malayalam is left alone", toRoman("കേരളം") === "കേരളം", toRoman("കേരളം"));

report();
