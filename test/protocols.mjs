/**
 * Protocol lookup — the precautions layer.
 *
 * Two things are checked. That the corpus covers what NDMA actually issues:
 * lightning and thunderstorm were 28 of 102 alerts in a sampled sweep, the
 * largest category after flood, and had no entry at all. And that a question
 * gets the answer for the person asking it — "ghar tut gaya to kitna muavza"
 * and "paani aa raha hai, kya karun" are both flood questions with completely
 * different right answers.
 *
 * No server needed.
 */
import { loadFromSrc, harness } from "./_build.mjs";

const { lookupProtocol, protocolsForHazard, PROTOCOLS } = await loadFromSrc("lib/protocols.ts");
const { check, report } = harness();

console.log("CORPUS");
check("substantially larger than the original ten", PROTOCOLS.length >= 30, `${PROTOCOLS.length} entries`);
check("every entry carries a source", PROTOCOLS.every((p) => p.source?.length > 5));
check("every entry carries a reference", PROTOCOLS.every((p) => p.reference?.length > 5));
check("every entry names its audience", PROTOCOLS.every((p) => ["citizen", "coordinator"].includes(p.audience)));
check("ids are unique", new Set(PROTOCOLS.map((p) => p.id)).size === PROTOCOLS.length);
check(
  "citizen guidance exists at all — it did not before",
  PROTOCOLS.filter((p) => p.audience === "citizen").length >= 12,
  `${PROTOCOLS.filter((p) => p.audience === "citizen").length}`,
);

console.log("\nCOVERS WHAT THE FEED ACTUALLY ISSUES");
// Ordered by how often each appears in a live Sachet sweep.
for (const hazard of ["storm", "flood", "rain", "cyclone", "quake", "landslide", "heat", "cold", "wind"]) {
  const hits = protocolsForHazard(hazard);
  check(`${hazard.padEnd(10)} has guidance`, hits.length > 0, `${hits.length} entries`);
}
check(
  "lightning is covered — the largest alert category had nothing",
  lookupProtocol("bijli kadak rahi hai main khet me hoon")[0]?.hazard === "storm",
  lookupProtocol("bijli kadak rahi hai main khet me hoon")[0]?.title,
);

console.log("\nTHE ASKER GETS THEIR OWN ANSWER");
const cases = [
  ["ghar tut gaya to kitna muavza milta hai", "coordinator"],
  ["paani ghar me aa raha hai main kya karun", "citizen"],
  ["what should I do if lightning starts", "citizen"],
  ["relief camp minimum standards", "coordinator"],
  ["bhukamp aaya hai main kya karun", "citizen"],
  ["SDRF norms for a destroyed house", "coordinator"],
];
for (const [q, want] of cases) {
  const hit = lookupProtocol(q)[0];
  check(`${want.padEnd(11)} "${q.slice(0, 40)}"`, hit?.audience === want, `got ${hit?.audience} — ${hit?.title}`);
}

console.log("\nSPECIFIC ANSWERS, NOT GENERIC ONES");
const shouldContain = [
  ["lightning me ped ke neeche khada rahun kya", /tree/i],
  ["cyclone ke beech hawa ruk gayi", /eye/i],
  ["bhukamp me lift use karun", /lift/i],
  ["underpass me paani bhara hai", /underpass/i],
  ["bijli girne se aadmi behosh hai", /CPR/i],
  ["thand me angithi jalau kya", /carbon monoxide/i],
];
for (const [q, pattern] of shouldContain) {
  const hit = lookupProtocol(q)[0];
  check(
    `"${q.slice(0, 38)}" → the specific warning`,
    !!hit && pattern.test(hit.body),
    hit ? hit.title : "no match",
  );
}

console.log("\nSCOPING");
check(
  "a hazard filter returns only that hazard",
  lookupProtocol("what do I do", { hazard: "flood" }).every((p) => p.hazard === "flood"),
);
check(
  "a phase filter returns only that phase",
  lookupProtocol("flood", { phase: "after" }).every((p) => p.phase === "after"),
);
check(
  "hazard guidance is ordered before, during, after",
  (() => {
    const order = { before: 0, during: 1, after: 2 };
    const seq = protocolsForHazard("flood").map((p) => order[p.phase ?? "during"]);
    return seq.every((v, i) => i === 0 || seq[i - 1] <= v);
  })(),
);
check(
  "the audience nudge never hides the other audience entirely",
  lookupProtocol("flood", { limit: 20 }).some((p) => p.audience === "coordinator") &&
    lookupProtocol("flood", { limit: 20 }).some((p) => p.audience === "citizen"),
);
check("an unknown topic returns nothing rather than a guess", lookupProtocol("zzzz qqqq").length === 0);
// The feed issues more hazard types than anyone writes separate advice for, and
// several share an answer: a flash flood and a cloudburst mean the same thing to
// the person under them.
check("a flash flood falls back to flood guidance", protocolsForHazard("flashflood").length > 0);
check("a squall falls back to wind guidance", protocolsForHazard("squall").length > 0);
check("a genuinely unknown hazard still returns nothing", protocolsForHazard("asteroid").length === 0);
check("the old numeric-limit signature still works", lookupProtocol("muavza", 1).length === 1);

report();
