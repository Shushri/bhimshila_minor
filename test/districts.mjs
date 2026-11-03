/**
 * District profiles — the census layer under everything else.
 *
 * This data went through name matching, alias tables, fuzzy fallback and an
 * apportionment step for districts that did not exist in 2011. Every one of
 * those can be wrong in a way that still sums correctly, so the spot checks
 * below matter more than the totals: a substring match once handed Delhi New
 * Delhi's 142,004 people instead of the NCT's 16.8 million, and a scaling pass
 * once inflated Thane by 783,000 to balance an unclaimed Mumbai.
 *
 * No server needed.
 */
import { loadFromSrc, harness } from "./_build.mjs";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

const profiles = JSON.parse(
  readFileSync(join(fileURLToPath(new URL("../src/data", import.meta.url)), "district-profiles.json"), "utf8"),
);

const { check, report } = harness();
const INDIA_2011 = 1_210_854_977;

console.log("SHAPE");
check("has the whole country, not a pilot", profiles.length > 700, `${profiles.length} districts`);
check(
  "no district is missing a name",
  profiles.every((p) => p.d && p.d !== "null"),
  "34 state-level rows used to be scored as districts",
);
check("no district is missing a population", profiles.every((p) => typeof p.population === "number"));
check(
  "every centroid is inside India",
  profiles.every((p) => p.lat > 6 && p.lat < 38 && p.lng > 67 && p.lng < 98),
);
check(
  "names are unique within a state",
  new Set(profiles.map((p) => `${p.d}|${p.s}`)).size === profiles.length,
);

console.log("\nTOTALS");
const total = profiles.reduce((a, p) => a + p.population, 0);
const driftPct = (100 * (INDIA_2011 - total)) / INDIA_2011;
check(
  `national population reconciles to Census 2011 (${driftPct.toFixed(2)}% unplaced)`,
  Math.abs(driftPct) < 1,
  `${total.toLocaleString()} vs ${INDIA_2011.toLocaleString()}`,
);
check("nobody is double-counted — total never exceeds the census", total <= INDIA_2011,
  `${(total - INDIA_2011).toLocaleString()} over`);

console.log("\nPUBLISHED FIGURES, EXACTLY");
// Chosen to cover the ways matching broke: a plain match, a rename, a digit in
// the name, a district that is its own state, one absent from our geometry, and
// two carved out of a shared parent.
const PUBLISHED = {
  Thane: 11_060_148,
  Pune: 9_429_408,
  Palakkad: 2_809_934,
  Kangra: 1_510_075,
  Chennai: 4_646_732,
  Dibrugarh: 1_326_335,
  "North 24 Parganas": 10_009_781,
  "South 24 Parganas": 8_161_961,
  "Bengaluru Urban": 9_621_551,
  Delhi: 16_787_941,
  "Mumbai Suburban": 9_356_962,
  Lakshadweep: 64_473,
  Nicobars: 36_842,
};
for (const [name, expected] of Object.entries(PUBLISHED)) {
  const d = profiles.find((p) => p.d === name);
  check(
    `${name.padEnd(19)} ${expected.toLocaleString()}`,
    d?.population === expected,
    d ? `got ${d.population.toLocaleString()}` : "not found",
  );
}

console.log("\nESTIMATES ARE LABELLED");
const estimated = profiles.filter((p) => p.estimated);
check("post-2011 districts exist and are flagged", estimated.length > 0, `${estimated.length}`);
check(
  "every estimate says it is one",
  estimated.every((p) => /estimate, not a count/.test(p.note ?? "")),
);
check(
  "no verified district is labelled an estimate",
  !profiles.some((p) => p.estimated && p.d in PUBLISHED),
);

console.log("\nVULNERABILITY FIELDS");
const withVuln = profiles.filter((p) => p.fragileHousingPct != null);
check("carried for most districts", withVuln.length > 500, `${withVuln.length}`);
check(
  "percentages are percentages",
  withVuln.every(
    (p) =>
      p.fragileHousingPct >= 0 && p.fragileHousingPct <= 100 &&
      p.phoneReachPct >= 0 && p.phoneReachPct <= 100 &&
      p.ruralPct >= 0 && p.ruralPct <= 100,
  ),
);
check(
  "density agrees with population over area",
  profiles
    .filter((p) => p.areaKm2 && p.density)
    .every((p) => Math.abs(p.density - p.population / p.areaKm2) < 1.5),
);

console.log("\nPROJECTION TO 2026");
// Census 2011 is fifteen years old and there is no newer one, so the base is
// grown at each state's official rate. The risk is silently passing a
// projection off as a count, so both numbers must survive together.
const projected = profiles.filter((p) => typeof p.population2026 === "number");
check("every district carries a projection", projected.length === profiles.length);
check(
  "the census figure is kept alongside it",
  projected.every((p) => typeof p.population === "number"),
);
check("projections only ever grow the base", projected.every((p) => p.population2026 >= p.population));
// The report's own extremes are the two migration-driven coastal UTs — Daman
// & Diu is projected 243k → 705k (×2.90). An earlier parse missed their page
// entirely (a two-line column header), so this check once pinned ≤1.4 and was
// pinning the gap, not the report.
check(
  "growth stays within the report's own range",
  projected.every((p) => p.growthFactor >= 1 && p.growthFactor <= 2.91),
  `${Math.min(...projected.map((p) => p.growthFactor))}–${Math.max(...projected.map((p) => p.growthFactor))}`,
);
check(
  "…and everything outside those two UTs stays under ×1.41",
  projected
    .filter((p) => !/daman|dadra/i.test(p.s))
    .every((p) => p.growthFactor <= 1.41),
  projected.filter((p) => p.growthFactor > 1.41).map((p) => `${p.s} ×${p.growthFactor}`).slice(0, 4).join(", "),
);
// The census layer carries the 2020-merged UT; the report predates the merger
// and prints the halves separately (243k→705k and 344k→836k). The merged
// factor is the sum of the report's own rows, nothing modelled.
check(
  "the merged Dadra–Daman UT carries the report's own combined rate, ×2.6252",
  profiles.find((p) => /daman/i.test(p.s))?.growthFactor === 2.6252,
  `×${profiles.find((p) => /daman/i.test(p.s))?.growthFactor} src:${profiles.find((p) => /daman/i.test(p.s))?.growthSource}`,
);
check(
  "a state projected separately uses its own rate, not the national one",
  profiles.find((p) => p.d === "Delhi")?.growthFactor === 1.3426,
  `Delhi ×${profiles.find((p) => p.d === "Delhi")?.growthFactor}`,
);
check(
  "southern states grow slower than northern ones, as the report has it",
  profiles.find((p) => p.d === "Palakkad").growthFactor <
    profiles.find((p) => p.d === "Patna").growthFactor,
);
// Fallback districts must all carry the same national factor — the report's
// own ×1.1756 — and say so. (This once compared against North Goa, which was
// only on the national rate because its page had not parsed; Goa now carries
// its own ×1.096.)
check(
  "a fallback to the national rate is labelled as one",
  profiles
    .filter((p) => p.growthSource === "national")
    .every((p) => Math.abs(p.growthFactor - 1.1756) < 0.0001),
  [...new Set(profiles.filter((p) => p.growthSource === "national").map((p) => p.growthFactor))].join(","),
);
check(
  "Goa is projected at its own rate now, not the national one",
  profiles.find((p) => p.d === "North Goa")?.growthSource !== "national",
  profiles.find((p) => p.d === "North Goa")?.growthSource,
);
const nat2026 = projected.reduce((a, p) => a + p.population2026, 0);
check(
  `national projection lands near the report's 1.42bn (${(nat2026 / 1e9).toFixed(3)}bn)`,
  Math.abs(nat2026 - 1_423_435_000) / 1_423_435_000 < 0.01,
  nat2026.toLocaleString(),
);

console.log("\nLOOKUP");
const { findDistrict, districtsNamed, DISTRICT_REGIONS } = await loadFromSrc("lib/kb/districts.ts", {
  bundle: true,
});
check("resolves a district that used to return nothing", findDistrict("Palakkad")?.population === 2_809_934);
check("resolves one that always worked", findDistrict("Kangra")?.population === 1_510_075);
check("is case and spacing insensitive", findDistrict("  palakkad ")?.name === "Palakkad");
check("unknown names return null", findDistrict("Xyzzyland") === null);

const dupes = districtsNamed("Bilaspur");
check("finds every district sharing a name", dupes.length > 1, `${dupes.length} Bilaspurs`);
check(
  "an ambiguous name resolves to the largest",
  findDistrict("Bilaspur")?.population === Math.max(...dupes.map((d) => d.population)),
);
check(
  "a state disambiguates it",
  findDistrict("Bilaspur", "Himachal Pradesh")?.stateName === "Himachal Pradesh",
);
check("every region carries a readable state name", DISTRICT_REGIONS.every((d) => d.stateName?.length > 2));

report();
