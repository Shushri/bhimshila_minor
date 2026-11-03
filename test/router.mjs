import { loadFromSrc } from "./_build.mjs";

// Transpiled from src rather than copied, so the check can never drift
// from the router that actually ships. Bundled because the router now resolves
// candidate places against the region data before routing them — a place it
// cannot find is not a place, and that check has to run here too.
const { route } = await loadFromSrc("lib/agent/router.ts", { bundle: true });

const cases = [
  ["abhi kya chal raha hai", "situation_report"],

  // A place in a status question must survive into the args. "Indore mein kya
  // update hai" used to sweep all of India; naming both a state and a district
  // used to pick the state, and the answer covered 52 districts without
  // mentioning the one that was asked about.
  ["Indore mein kya update hai", "situation_report", { state: "Indore" }],
  ["Madhya Pradesh ke Indore district mein kya update hai", "situation_report", { state: "Indore" }],
  ["Kerala me kya ho raha hai", "situation_report", { state: "Kerala" }],
  ["what's the update", "situation_report"],
  ["kaun se incidents open hain", "list_incidents"],
  ["nearest team bhejo", "dispatch_team"],
  ["dispatch a team to incident 3", "dispatch_team"],
  ["Kangra ko alert bhejo", "prepare_alert"],

  // Warning people vs. sending a team. These share "bhej do", and the router
  // once sent "Himachal ke logon ko alert bhej do" to dispatch_team — offering
  // to move NDRF to an unrelated incident when a broadcast was asked for.
  // Wrong action, taken confidently, in the one flow that reaches the public.
  ["Himachal ke logon ko alert bhej do", "prepare_alert", { region: "Himachal" }],
  ["Kerala ke logon ko chetavni bhej do", "prepare_alert"],
  ["warn the people of Assam", "prepare_alert"],
  ["team bhej do", "dispatch_team"],
  ["NDRF bhejo", "dispatch_team"],
  ["rescue team bhej do Patna", "dispatch_team"],
  ["badal fatne pe kya protocol hai", "lookup_protocol"],
  ["ghar tut gaya to kitna muavza milta hai", "lookup_protocol"],

  // Sending an alert vs. reading one the government issued. These share nearly
  // every keyword; routing a question to prepare_alert would stage a broadcast
  // instead of answering, so both directions are pinned.
  ["orange alert ka matlab kya hai", "lookup_protocol"],
  ["red alert ka matlab", "lookup_protocol"],
  ["koi official alert hai abhi", "official_alerts"],
  ["sarkari chetavni dikhao", "official_alerts"],
  ["NDMA ne kya warning di hai", "official_alerts"],
  ["Kerala me koi alert hai", "official_alerts"],
  ["red alert kahan kahan hai", "official_alerts"],
  ["which alerts are live right now", "official_alerts"],
  ["IMD alert for Uttarakhand", "official_alerts"],

  // A person in the middle of it never says "protocol" — they say "kya karun".
  ["paani ghar me aa raha hai main kya karun", "lookup_protocol"],
  ["bijli kadak rahi hai kaise bachu", "lookup_protocol"],
  ["what should I do in an earthquake", "lookup_protocol"],
  ["baadh me kya savdhani rakhein", "lookup_protocol"],
  ["verify Kerala", "verify_signal"],

  // "Where do I go" is the question the whole offline shelter bundle exists
  // for, and it used to land on the protocol lookup and return a lightning
  // card. It sits above protocol because "paani aa raha hai kahan jaun" is
  // both, and the destination is the urgent half.
  ["Kangra me sabse paas ka shelter kahan hai", "find_shelter", { place: "Kangra" }],
  ["Dehradun me kahan jaun", "find_shelter"],
  ["where do I go in Palakkad", "find_shelter"],
  ["news me kya hai", "search_news"],
  ["which states face landslides", "list_hazards"],
  ["Khaniyara ka flood risk kya hai", "assess_risk", { place: "Khaniyara" }],
  ["kis region me sabse zyada bheed hai", "rank_regions"],
  ["show me population across India", "region_density"],
  // A date and a place is a question about the past on its own — it no longer
  // needs a "replay" word beside it, because the archive covers every date
  // rather than four hardcoded events.
  ["replay Khaniyara on 2025-07-21", "past_weather", { place: "Khaniyara", from: "2025-07-21" }],
  ["Wayanad on 2024-07-30", "past_weather", { place: "Wayanad", from: "2024-07-30" }],
  ["tell me about Kangra", "region_profile"],
  // A greeting has nothing to look up. Left to the model it answered "hello"
  // with the incident board — eight emergencies nobody asked about.
  ["hello", "greet"],
  ["namaste", "greet"],
  ["hi", "greet"],
  ["can you help me", null],
  ["what do you think about the monsoon this year", null],

  // Conceptual questions name no place, and the router used to hand them one.
  // "Global Warming" resolved to Alwar and "Monsoon Patterns" to Mon, Nagaland,
  // because the region lookup matched on a free-floating substring — so a
  // question about climate came back as a district profile. Candidates are
  // checked against the region data now, and anything that is not a real place
  // falls through to the model, which is where these belong.
  ["what is the major threat of world climate affecting india", null],
  ["how is climate change affecting India", null],
  ["is global warming making this worse", null],
  ["tell me about monsoon patterns", null],
  ["why does India flood every year", null],

  // …but a real place in the same shape still routes.
  ["tell me about Dharamshala", "region_profile", { region: "Dharamshala" }],
  ["nearest shelter Guwahati", "find_shelter", { place: "Guwahati" }],
];

let ok = 0;
// A third element asserts the arguments too. Without it a case passes on the
// tool name alone, which is how "Madhya Pradesh ke Indore district" shipped
// routing correctly while handing the tool a place called "ke Indore".
for (const [q, want, wantArgs] of cases) {
  const r = route(q);
  const got = r?.name ?? null;
  const nameOk = got === want;
  const argsOk =
    !wantArgs ||
    Object.entries(wantArgs).every(([k, v]) => r?.args?.[k] === v);
  const good = nameOk && argsOk;
  if (good) ok++;
  console.log(`  ${good ? "✓" : "✗"} ${String(got ?? "→ model").padEnd(18)} "${q.slice(0,44)}"` +
    (nameOk ? "" : `   want ${want ?? "→ model"}`) +
    (nameOk && !argsOk ? `   want args ${JSON.stringify(wantArgs)}` : "") +
    (r?.args && Object.keys(r.args).length ? `  ${JSON.stringify(r.args)}` : ""));
}
console.log(`\n  ${ok}/${cases.length} routed correctly`);
// Without this the runner reads a suite with red checks as a pass.
process.exit(ok === cases.length ? 0 : 1);
