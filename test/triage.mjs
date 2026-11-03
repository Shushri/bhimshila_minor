/**
 * SOS triage — the part of the system that decides who gets rescued first.
 *
 * Two things are checked here, and the second is the one that bites. The
 * keyword parser has to read Hinglish emergency phrasing correctly. And the
 * merge with the model's reading has to refuse to be talked down: asked to
 * structure "paani ghar me ghus gaya, chhat pe phase hain", a live model
 * answered `shelter` — people trapped on a roof by rising water, filed as a
 * request for accommodation. Category and severity are therefore resolved
 * deterministically, and these cases pin that.
 */
import { loadFromSrc, harness } from "./_build.mjs";

const { parseHeuristically, reconcileSos } = await loadFromSrc("lib/triage.ts");
const { check, report } = harness();

console.log("KEYWORD PARSER");
const cases = [
  // "paani" is drowning far more often than thirst — water arriving is a rescue
  ["Paani ghar me ghus gaya, chhat pe phase hain", "rescue", 5],
  ["Ghar me paani bhar gaya, do bacche hain", "rescue", 5],
  ["Log chhat par phanse hue hain", "rescue", 5],
  ["Nadi me beh gaya ek aadmi", "rescue", 5],
  // ...but water *absent* is a supply need
  ["Do din se paani nahi mila, 40 log hain", "food_water", 2],
  ["Khana nahi mila camp me", "food_water", 2],
  ["Bahut khoon beh raha hai, ambulance chahiye", "medical", 5],
  ["Mera beta lapata hai", "missing", 4],
  ["Trapped on roof, water rising", "rescue", 5],
];
for (const [msg, wantCat, wantSev] of cases) {
  const r = parseHeuristically(msg);
  check(
    `${r.category.padEnd(11)} sev${r.severity}  "${msg.slice(0, 42)}"`,
    r.category === wantCat && r.severity === wantSev,
    `want ${wantCat} sev${wantSev}`,
  );
}

console.log("\nMODEL CANNOT DOWNGRADE A LIFE-SAFETY CALL");
const roof = parseHeuristically("Paani ghar me ghus gaya, chhat pe phase hain");
const modelSaidShelter = {
  category: "shelter",
  severity: 4,
  peopleCount: null,
  place: "Thrissur",
  summary: "Water has entered the house",
};
const merged = reconcileSos(roof, modelSaidShelter);
check("keeps rescue when the model says shelter", merged.category === "rescue", merged.category);
check("keeps severity 5 when the model says 4", merged.severity === 5, String(merged.severity));
check("still takes the place the model found", merged.place === "Thrissur", String(merged.place));
check("still takes the model's summary", merged.summary === "Water has entered the house");

console.log("\nMODEL STILL LEADS WHERE KEYWORDS ARE SILENT");
const vague = parseHeuristically("humein yahan madad chahiye");
check("keywords have no opinion", vague.category === "other", vague.category);
const upgraded = reconcileSos(vague, {
  category: "medical",
  severity: 4,
  peopleCount: 3,
  place: "Kangra",
  summary: "Needs medical help",
});
check("takes the model's category", upgraded.category === "medical", upgraded.category);
check("takes the model's people count", upgraded.peopleCount === 3, String(upgraded.peopleCount));

console.log("\nSEVERITY ONLY EVER MOVES UP");
check(
  "model may raise severity",
  reconcileSos(vague, { ...modelSaidShelter, severity: 5 }).severity === 5,
);
check(
  "model may not lower it",
  reconcileSos(roof, { ...modelSaidShelter, severity: 1 }).severity === 5,
);
check(
  "a zero people_count is treated as unknown, not as nobody",
  reconcileSos(vague, { ...modelSaidShelter, peopleCount: null }).peopleCount === null,
);

report();
