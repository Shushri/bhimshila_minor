/**
 * Offline shelter lookup.
 *
 * "Where do I go" is the one question that has to answer with no network, and
 * a disaster is exactly when Overpass is unreachable. Nothing here touches the
 * network — that is the point of the check.
 */
import { loadFromSrc, harness } from "./_build.mjs";

const { bundledShelters, SHELTER_SOURCE, SHELTER_NOTE } = await loadFromSrc("lib/kb/live.ts", {
  bundle: true,
});
const { check, report } = harness();

console.log("LOOKUP WITH NO NETWORK");
for (const [name, lat, lng] of [
  ["Dehradun", 30.32, 78.03],
  ["Palakkad", 10.85, 76.49],
  ["Kangra", 32.1, 76.27],
  ["Guwahati", 26.14, 91.73],
  ["Thrissur", 10.52, 76.21],
]) {
  const s = bundledShelters(lat, lng, 4);
  check(
    `${name.padEnd(10)} ${s.length} found, nearest ${s[0] ? (s[0].distanceM / 1000).toFixed(1) + "km" : "—"}`,
    s.length > 0,
  );
  if (s[0]) console.log(`      ${s[0].name.slice(0, 56)} (${s[0].kind})`);
}

console.log("\nSHAPE");
const sample = bundledShelters(30.32, 78.03, 6);
check("nearest first", sample.every((x, i) => i === 0 || sample[i - 1].distanceM <= x.distanceM));
check(
  "named buildings are preferred — 'go to the unnamed school' helps nobody",
  sample.filter((s) => !s.name.startsWith("unnamed")).length >= sample.length - 1,
);
check(
  "coordinates land in India",
  bundledShelters(22, 79, 50).every((s) => s.lat > 6 && s.lat < 38 && s.lng > 67 && s.lng < 98),
);
check("a distance is always given", sample.every((s) => Number.isFinite(s.distanceM)));
check("the middle of the Bay of Bengal returns nothing", bundledShelters(15, 88, 5).length === 0);

console.log("\nPROVENANCE");
check("the source is stated", /OpenStreetMap/i.test(SHELTER_SOURCE), SHELTER_SOURCE);
check(
  "it does not claim to be a register of designated shelters",
  /NOT a register|not a register/i.test(SHELTER_NOTE),
  SHELTER_NOTE.slice(0, 60),
);

report();
