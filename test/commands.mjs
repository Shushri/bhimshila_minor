/**
 * The Jarvis layer — spoken commands that drive the interface with no model.
 *
 * This suite exists because the layer had none, and the gap showed. The rule
 * was "an action verb plus a state name opens that state's deck", which is
 * right until the sentence also names a subject: "Assam ke alerts dikhao" was
 * read as a command, so the assistant opened a deck and said "Assam ka deck
 * khul raha hai" to someone who had asked about alerts. Narrating your own
 * action back at a question is the worst failure this layer has, because it
 * looks like the assistant did not understand at all.
 *
 * What settles command versus question is two things, and both are asserted
 * here: a verb must be present, and no lookup subject may be.
 */
import { loadFromSrc, harness } from "./_build.mjs";

const { uiCommand, commandAck } = await loadFromSrc("lib/voice/commands.ts", { bundle: true });
const { check, report } = harness();

const kindOf = (q) => uiCommand(q)?.kind ?? null;

console.log("COMMANDS — a verb, and nothing to look up");
for (const [q, kind, extra] of [
  ["Kerala kholo", "open_state", "Kerala"],
  ["Assam dikhao", "open_state", "Assam"],
  ["show Bihar", "open_state", "Bihar"],
  ["Arunachal Pradesh kholo", "open_state", "Arunachal Pradesh"],
  ["operations kholo", "tab", "ops"],
  ["ai intelligence dikhao", "tab", "intel"],
  ["overview pe le chalo", "tab", "overview"],
  ["missions kholo", "missions", null],
  ["sab band karo", "close_all", null],
]) {
  const c = uiCommand(q);
  const ok = c?.kind === kind && (!extra || c.state === extra || c.tab === extra);
  check(`"${q}" → ${kind}`, ok, JSON.stringify(c));
}

console.log("\nQUESTIONS — must reach the agent, never the interface");
for (const q of [
  "Kerala mein kya chal raha hai",
  "Assam mein abhi kya alerts hain",
  "Bihar ke flood ka status batao",
  "kitne districts observation mein hain",
]) {
  check(`"${q}" stays a question`, kindOf(q) === null, String(kindOf(q)));
}

console.log("\nTHE BUG — a verb is not enough when a subject is named");
for (const q of [
  "Assam ke alerts dikhao",
  "Kerala ka risk dikhao",
  "Bihar ki barish dikhao",
  "Odisha ke shelters dikhao",
  "Assam ka population dikhao",
  "show me the news for Kerala",
]) {
  check(`"${q}" is a lookup, not a deck to open`, kindOf(q) === null, String(kindOf(q)));
}

console.log("\nNO VERB, NO COMMAND");
for (const q of ["Kerala", "Assam ke baare mein", "Bihar Bihar Bihar"]) {
  check(`"${q}" does nothing`, kindOf(q) === null, String(kindOf(q)));
}

console.log("\nSPOKEN — recognition returns Devanagari, not Latin");
{
  // The entire command layer was dead when spoken. Recognition runs on hi-IN,
  // so "Kerala kholo" arrives as "केरल खोलो", and every pattern in the matcher
  // is written in Latin — so nothing matched, and a command silently fell
  // through to the agent, which answered it as though it were a question.
  // Typing worked the whole time, which is exactly why it went unnoticed.
  for (const [q, kind, extra] of [
    ["केरल खोलो", "open_state", "Kerala"],
    ["असम खोलो", "open_state", "Assam"],
    ["उत्तर प्रदेश का सारा डेटा दिखाओ", "open_state", "Uttar Pradesh"],
    ["मध्य प्रदेश दिखाओ", "open_state", "Madhya Pradesh"],
    ["ऑपरेशन्स खोलो", "tab", "ops"],
    ["सब बंद करो", "close_all", null],
  ]) {
    const c = uiCommand(q);
    const ok = c?.kind === kind && (!extra || c.state === extra || c.tab === extra);
    check(`spoken "${q}" → ${kind}`, ok, JSON.stringify(c));
  }
}

console.log("\nSPOKEN QUESTIONS still reach the agent");
for (const q of ["असम में क्या अलर्ट हैं", "केरल का रिस्क दिखाओ", "केरल में क्या चल रहा है"]) {
  check(`spoken "${q}" stays a question`, kindOf(q) === null, String(kindOf(q)));
}

console.log("\nTHE ACK IS SPEAKABLE");
{
  // It is read aloud by a synthesiser, so it must be a sentence — no markup, no
  // identifiers, and short enough not to talk over the thing it just opened.
  const acks = ["Kerala kholo", "operations kholo", "sab band karo", "missions kholo"]
    .map((q) => commandAck(uiCommand(q)));
  check("every ack is a short plain sentence", acks.every((a) => a.length > 8 && a.length < 60), acks.join(" | "));
  check("no markup or underscores leak into speech", acks.every((a) => !/[*_<>{}]/.test(a)));
}

console.log("\nDEGENERATE INPUT");
check("empty string is not a command", kindOf("") === null);
check("a paragraph is not a command", kindOf("kholo ".repeat(40)) === null);

report();
