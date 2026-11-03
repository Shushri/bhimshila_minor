/**
 * Alert reach, and duplicate coverage.
 *
 * The counting rules here decide what number a coordinator is told about how
 * many people a warning got to. Two ways to get that wrong, and both flatter:
 * adding households to people as if they were the same unit, and dividing by
 * zero to claim infinite amplification. Both are asserted against below.
 */
import { loadFromSrc, harness } from "./_build.mjs";

const { computeReach, findOverlaps, PEOPLE_PER_HOUSEHOLD, OVERLAP_KM } =
  await loadFromSrc("lib/reach.ts", { bundle: true });
const { check, report } = harness();

const relay = (households, place, method = "in_person") => ({ households, place, method });

console.log("REACH — two numbers, never silently added");
{
  const r = computeReach(120, [relay(40, "Dhubri"), relay(25, "Barpeta")]);
  check("delivered is passed through untouched", r.delivered === 120, String(r.delivered));
  check("households sum", r.relayedHouseholds === 65, String(r.relayedHouseholds));
  check(
    "people is an estimate from households, not a second count of the same thing",
    r.relayedPeopleEstimate === Math.round(65 * PEOPLE_PER_HOUSEHOLD),
    String(r.relayedPeopleEstimate),
  );
  check("places deduped and sorted", r.places.join(",") === "Barpeta,Dhubri", r.places.join(","));
  check("multiplier is relayed people over delivered", r.multiplier === 2.7, String(r.multiplier));
}

console.log("\nTHE FLATTERING FAILURES");
{
  // Dividing by zero here would produce Infinity and read as spectacular
  // amplification, which is exactly the direction a wrong number must not err.
  const r = computeReach(0, [relay(50, "Kangra")]);
  check("no deliveries → multiplier is null, not Infinity", r.multiplier === null, String(r.multiplier));
  check("but the relay is still counted", r.relayedHouseholds === 50);
  check("and the headline says so honestly", /No registered deliveries/.test(r.headline), r.headline);
}
{
  const r = computeReach(500, []);
  check("no relays → multiplier null rather than 0×", r.multiplier === null, String(r.multiplier));
  check(
    "headline names the invisibility rather than implying full coverage",
    /invisible/.test(r.headline),
    r.headline,
  );
}
{
  const r = computeReach(0, []);
  check(
    "nothing sent reads as not-sent, not as zero-reached",
    /Not sent to anyone yet/.test(r.headline),
    r.headline,
  );
}

console.log("\nHEADLINE IS SPEAKABLE");
{
  const r = computeReach(120, [relay(40, "Dhubri")]);
  check("no markup", !/[*_<>{}#]/.test(r.headline), r.headline);
  check("names both numbers", /120/.test(r.headline) && /40/.test(r.headline), r.headline);
  check("labels the estimate as one", /roughly|estimated/.test(r.headline), r.headline);
}

console.log("\nDEGENERATE INPUT");
{
  const r = computeReach(10, [relay(5, "  "), relay(3, "Kochi")]);
  check("blank place dropped, not shown as empty", r.places.join(",") === "Kochi", r.places.join(","));
  check("its households still count", r.relayedHouseholds === 8, String(r.relayedHouseholds));
  const neg = computeReach(10, [{ households: -5, place: "X", method: "other" }]);
  check("a negative household count cannot reduce reach", neg.relayedHouseholds === 0, String(neg.relayedHouseholds));
}

console.log("\nDUPLICATE COVERAGE — the half nobody looks at");
const at = (team, place, lat, lng) => ({ team, place, lat, lng });
{
  // Aceh: four measles vaccinations for the same children. Haiti: some areas
  // served twice while others had nothing. This is that, in one function.
  const o = findOverlaps([
    at("NDRF 1st Bn", "Dhubri", 26.02, 89.98),
    at("Red Cross Dhubri", "Dhubri", 26.05, 90.01),
    at("SDRF Kerala", "Thrissur", 10.52, 76.21),
  ]);
  check("two teams within range are flagged", o.length === 1, JSON.stringify(o));
  check("both teams named", o[0] && o[0].a !== o[0].b, JSON.stringify(o[0]));
  check("distance reported", o[0] && o[0].km > 0 && o[0].km <= OVERLAP_KM, String(o[0]?.km));
  check("a far-away team is not flagged", !JSON.stringify(o).includes("SDRF Kerala"));
}
{
  const same = findOverlaps([
    at("NDRF 1st Bn", "Dhubri", 26.02, 89.98),
    at("NDRF 1st Bn", "Dhubri", 26.03, 89.99),
  ]);
  check(
    "one team on two jobs nearby is not a duplication of effort",
    same.length === 0,
    JSON.stringify(same),
  );
}
{
  const noCoords = findOverlaps([
    at("A", "X", null, null),
    at("B", "X", null, null),
  ]);
  check("missing coordinates are skipped, not guessed at", noCoords.length === 0);
}
{
  const many = findOverlaps([
    at("A", "P", 26.0, 90.0),
    at("B", "P", 26.01, 90.01),
    at("C", "P", 26.02, 90.02),
  ]);
  check("every distinct pair is reported", many.length === 3, String(many.length));
  check("sorted closest first", many[0].km <= many[many.length - 1].km);
}

report();
