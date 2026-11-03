/**
 * People under an official alert.
 *
 * This is what turns a flat list of ~70 warnings into a queue. The failure to
 * guard against is a confident wrong number: double-counting a district that
 * sits under three alerts, matching "Bilaspur" to the wrong state, or letting a
 * geometric estimate pass as though the issuer had named the districts.
 *
 * Runs against the live NDMA feed.
 */
import { loadFromSrc, harness } from "./_build.mjs";

const { fetchOfficialAlerts } = await loadFromSrc("lib/kb/sachet.ts");
const { exposureFor, rankByExposure, totalExposed } = await loadFromSrc("lib/kb/exposure.ts", {
  bundle: true,
});

const { check, report } = harness();
const INDIA_2026 = 1_423_435_000;

const alerts = await fetchOfficialAlerts();
console.log(`\n${alerts.length} live alerts\n`);

if (!alerts.length) {
  check("skipped — NDMA returned nothing", true);
  report();
}

console.log("PER ALERT");
const ranked = rankByExposure(alerts);
check("every alert gets an exposure figure", ranked.length === alerts.length);
check(
  "nobody is counted who does not exist",
  ranked.every((r) => r.exposure.people >= 0 && r.exposure.people < INDIA_2026),
  `max ${Math.max(...ranked.map((r) => r.exposure.people)).toLocaleString()}`,
);
check(
  "every figure declares how it was derived",
  ranked.every((r) => ["named", "geometric", "unknown"].includes(r.exposure.method)),
);
check(
  "a named alert says which districts it named",
  ranked
    .filter((r) => r.exposure.method === "named")
    .every((r) => r.exposure.districts.length > 0),
);
check(
  "named districts count in full, not fractionally",
  ranked
    .filter((r) => r.exposure.method === "named")
    .every((r) => r.exposure.districts.every((d) => d.share === 1)),
);
check(
  "geometric shares stay a fraction",
  ranked
    .filter((r) => r.exposure.method === "geometric")
    .every((r) => r.exposure.districts.every((d) => d.share > 0 && d.share <= 1)),
);
check(
  "the issuer's own naming is used where available",
  ranked.filter((r) => r.exposure.method === "named").length > 0,
  `${ranked.filter((r) => r.exposure.method === "named").length} of ${ranked.length} named`,
);

console.log("\nRANKING");
// Severity first: IMD's colours are response categories, not a scale of
// interest. Sorting purely by headcount once put a yellow "be aware"
// thunderstorm over 97 million people above every red alert in India.
const RANK = { red: 3, orange: 2, yellow: 1, green: 0 };
check(
  "severity leads the queue",
  ranked.every((r, i) => i === 0 || RANK[ranked[i - 1].alert.colour] >= RANK[r.alert.colour]),
);
check(
  "no yellow alert outranks a red one, however large",
  !ranked.some((r, i) => r.alert.colour === "yellow" && ranked.slice(i).some((x) => x.alert.colour === "red")),
);
check(
  "population orders within a tier",
  ranked.every(
    (r, i) =>
      i === 0 ||
      ranked[i - 1].alert.colour !== r.alert.colour ||
      ranked[i - 1].exposure.people >= r.exposure.people,
  ),
);
const byPeople = rankByExposure(alerts, "people");
check(
  "the other order is available for 'where is the largest exposure'",
  byPeople.every((r, i) => i === 0 || byPeople[i - 1].exposure.people >= r.exposure.people),
);

console.log("\nGEOMETRIC ESTIMATES STAY INSIDE THE ISSUER'S STATE");
// A disc centred in Rajasthan with a large stated area used to sweep into
// Gujarat and Haryana, reporting more people than Rajasthan contains.
const spill = ranked.filter(
  (r) =>
    r.exposure.method === "geometric" &&
    /\bSDMA\b/.test(r.alert.source) &&
    new Set(r.exposure.districts.map((d) => d.state)).size > 1,
);
check("a state SDMA's alert does not reach other states", spill.length === 0,
  spill.slice(0, 2).map((r) => `${r.alert.source} → ${[...new Set(r.exposure.districts.map((d) => d.state))].join("+")}`).join(" | "));
check(
  "a stated district count is honoured",
  ranked
    .filter((r) => r.exposure.method === "geometric")
    .every((r) => {
      const m = /(\d+)\s+districts?/i.exec(r.alert.areaDescription);
      return !m || r.exposure.districts.length <= Number(m[1]);
    }),
);

console.log("\nDOUBLE COUNTING");
const total = totalExposed(alerts);
const naiveSum = ranked.reduce((a, r) => a + r.exposure.people, 0);
check(
  "a district under several alerts is counted once",
  total.people <= naiveSum,
  `${total.people.toLocaleString()} distinct vs ${naiveSum.toLocaleString()} summed`,
);
check(
  "the national total stays under India's population",
  total.people < INDIA_2026,
  `${total.people.toLocaleString()}`,
);
check("distinct district count is sane", total.districts > 0 && total.districts < 800,
  `${total.districts}`);

console.log("\nSTATE DISAMBIGUATION");
// Several states have a Bilaspur, a Hamirpur, an Aurangabad. A named match must
// land in the issuing authority's own state, not the first alphabetically.
const misplaced = ranked.filter((r) =>
  r.exposure.method === "named" &&
  r.exposure.districts.some(
    (d) =>
      !r.alert.source.toLowerCase().includes(d.state.toLowerCase()) &&
      !r.alert.areaDescription.toLowerCase().includes(d.state.toLowerCase()) &&
      !r.alert.source.toLowerCase().includes("imd") &&
      !r.alert.source.toLowerCase().includes("cwc"),
  ),
);
check(
  "named districts sit in the issuing authority's state",
  misplaced.length === 0,
  misplaced
    .slice(0, 2)
    .map((r) => `${r.alert.source} → ${r.exposure.districts.map((d) => `${d.name}/${d.state}`).join(",")}`)
    .join(" | "),
);

console.log("\nTOP OF THE QUEUE");
for (const r of ranked.slice(0, 6)) {
  console.log(
    `  ${r.alert.colour.padEnd(6)} ${String(r.exposure.people.toLocaleString("en-IN")).padStart(12)} ` +
      `${r.exposure.method.padEnd(9)} ${r.alert.disasterType.slice(0, 22).padEnd(24)} ${r.alert.source}`,
  );
}
console.log(
  `\n  ${total.people.toLocaleString("en-IN")} people across ${total.districts} districts are under some live alert`,
);

report();
