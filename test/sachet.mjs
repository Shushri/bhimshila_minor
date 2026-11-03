/**
 * NDMA Sachet client — checked against the live government feed.
 *
 * This one talks to the network on purpose. The parsing risks here are not
 * hypothetical: the feed writes centroids longitude-first and stamps dates
 * "IST", and getting either wrong fails silently rather than loudly — alerts
 * plotted in the Arabian Sea, or a three-hour warning treated as expired. A
 * fixture would freeze today's shape and stop testing the thing that breaks.
 *
 * If NDMA is unreachable the fetch checks fail loudly, which is the correct
 * signal: the source is down, and the app should be saying so.
 */
import { loadFromSrc, harness } from "./_build.mjs";

const {
  fetchOfficialAlerts,
  alertsNear,
  alertsMentioning,
  crossCheck,
  distanceKm,
  fetchCapDocument,
  actionable,
} = await loadFromSrc("lib/kb/sachet.ts");

const { check, report } = harness();
const RANK = { red: 3, orange: 2, yellow: 1, green: 0 };
/** Devanagari through Malayalam — the scripts the feed actually carries. */
const INDIC = /[ऀ-ൿ]/;

const t0 = Date.now();
const alerts = await fetchOfficialAlerts();
console.log(`\nFETCH  ${alerts.length} live official alerts in ${Date.now() - t0}ms\n`);

console.log("FEED");
check("feed returns alerts", alerts.length > 0, `got ${alerts.length} — NDMA may be down`);
check(
  "every centroid lands inside India",
  alerts.every((a) => a.lat > 6 && a.lat < 38 && a.lng > 67 && a.lng < 98),
  "lon/lat swapped would put these in the Arabian Sea",
);
check(
  "expired alerts are dropped",
  alerts.every((a) => !a.endsAt || Date.parse(a.endsAt) > Date.now()),
  "a stale alert would be broadcast as current",
);
check(
  "IST timestamps parse to valid ISO",
  alerts.every((a) => !a.startsAt || !Number.isNaN(Date.parse(a.startsAt))),
);
const dated = alerts.find((a) => a.startsAt);
check(
  "IST offset applied, not read as UTC",
  !dated || Math.abs(Date.parse(dated.startsAt) - Date.now()) < 48 * 3600e3,
  dated ? `${dated.startsAt} is implausibly far from now` : "",
);
check("colours normalised to the IMD set", alerts.every((a) => a.colour in RANK));
check(
  "sorted severest first",
  alerts.length < 2 || RANK[alerts[0].colour] >= RANK[alerts.at(-1).colour],
);
// An identifier is NOT unique across the feed, and assuming it was is what
// this check used to assert. The Central Water Commission issues a river
// warning and the state SDMA relays it — same gauge, same window, same CAP
// identifier, two rows differing only by `alert_source`.
//
// Deduping on the identifier is therefore right, not a workaround: it is one
// flood and belongs in the queue once. What must hold is that the identifier
// is stable and usable as a key at all — present, non-empty, and the same
// shape every poll — because seen_alerts is keyed on it.
{
  const ids = alerts.map((a) => a.id);
  check("every alert carries an identifier", ids.every((i) => i && i.length > 4),
    `${ids.filter((i) => !i || i.length <= 4).length} missing`);

  const byId = new Map();
  for (const a of alerts) {
    const seen = byId.get(a.id);
    if (seen) seen.push(a);
    else byId.set(a.id, [a]);
  }
  const repeated = [...byId.values()].filter((g) => g.length > 1);
  check(
    "a repeated identifier is the same alert relayed, not two different ones",
    repeated.every((g) =>
      g.every((a) => a.disasterType === g[0].disasterType && a.areaDescription === g[0].areaDescription),
    ),
    repeated.length
      ? repeated.map((g) => g.map((a) => a.source).join(" + ")).join(" | ")
      : "none repeated in this poll",
  );
  if (repeated.length) {
    console.log(`    (${repeated.length} relayed by more than one authority — deduped to one row)`);
  }
}
check(
  "official non-English warning text preserved verbatim",
  alerts.some((a) => a.language !== "en" && INDIC.test(a.message)),
  "the multilingual advantage is gone if this fails",
);

console.log("\nGEOMETRY");
check(
  "haversine sane — Delhi to Mumbai is ~1150km",
  Math.abs(distanceKm(28.6, 77.2, 19.07, 72.87) - 1150) < 60,
  distanceKm(28.6, 77.2, 19.07, 72.87).toFixed(0),
);
check("point lookup returns a list", Array.isArray(alertsNear(alerts, 30.32, 78.03, 60)));
check(
  "a wide-area alert reaches past the fixed radius",
  (() => {
    const big = alerts.find((a) => (a.areaKm2 ?? 0) > 20000);
    if (!big) return true; // nothing wide-area live right now
    const edgeKm = Math.sqrt(big.areaKm2 / Math.PI) * 0.9;
    return alertsNear(alerts, big.lat + edgeKm / 111, big.lng, 60).some((a) => a.id === big.id);
  })(),
  "centroid-only matching would miss places well inside the warned area",
);
check("name matching ignores sub-3-character noise", alertsMentioning(alerts, "a").length === 0);

console.log("\nCROSS-CHECK WITH OUR OWN SCORE");
const one = alerts.slice(0, 1);
check("model elevated + official live → confirmed", crossCheck(80, one).agreement === "confirmed");
check("official live + model quiet → defer to issuer", crossCheck(10, one).agreement === "official_only");
check(
  "model elevated + no official → stated as a lead, not a warning",
  crossCheck(80, []).agreement === "model_only" && /lead to verify/.test(crossCheck(80, []).note),
);
check("both quiet → quiet", crossCheck(10, []).agreement === "quiet");

console.log("\nCAP DOCUMENT — NDMA'S DOCUMENTED PATH");
if (!alerts.length) {
  check("skipped — no alerts to fetch a document for", true);
} else {
  const id = alerts[0].id;
  const t1 = Date.now();
  const first = await fetchCapDocument(id);
  const firstMs = Date.now() - t1;

  check("CAP document fetched and parsed", !!first, `identifier ${id}`);
  if (first) {
    check("first request is a real fetch, not a cache hit", first.fromCache === false);
    check("carries CAP status", /^(Actual|Exercise|System|Test|Draft)$/.test(first.status), first.status);
    check("carries msgType", /^(Alert|Update|Cancel|Ack|Error)$/.test(first.msgType), first.msgType);
    check("carries urgency", /^(Immediate|Expected|Future|Past|Unknown)$/.test(first.urgency), first.urgency);
    check("carries certainty", /^(Observed|Likely|Possible|Unlikely|Unknown)$/.test(first.certainty), first.certainty);
    check("names the issuing authority", first.sender.length > 2, first.sender);

    // The guide makes this mandatory: send If-None-Match, honour the 304. What
    // it buys is a skipped body and no throttling, not necessarily less time —
    // so this asserts the cache hit, and only that the round trip stays sane.
    const t2 = Date.now();
    const second = await fetchCapDocument(id);
    const secondMs = Date.now() - t2;
    check("second request served from cache via 304", second?.fromCache === true,
      `fromCache=${second?.fromCache}`);
    check("cached result is identical", second?.identifier === first.identifier);
    check(`revalidation round trip stays fast (${firstMs}ms then ${secondMs}ms)`,
      secondMs < 3000, `${secondMs}ms`);

    console.log("\n  " + [first.sender, first.event, first.status, first.msgType,
      first.urgency, first.certainty].join(" · "));
    if (first.instruction) console.log("  instruction:", first.instruction.slice(0, 120));
  }
}

console.log("\nACTIONABILITY GATE");
const base = {
  status: "Actual", msgType: "Alert", expires: null, urgency: "Immediate",
  certainty: "Observed", sender: "Kerala SDMA",
};
check("a live Actual alert is actionable", actionable(base).ok);
check("an Exercise is refused", !actionable({ ...base, status: "Exercise" }).ok);
check("a Test is refused", !actionable({ ...base, status: "Test" }).ok);
check("a cancelled alert is refused", !actionable({ ...base, msgType: "Cancel" }).ok);
check(
  "an expired alert is refused",
  !actionable({ ...base, expires: new Date(Date.now() - 3600e3).toISOString() }).ok,
);
check(
  "refusal explains itself",
  /Exercise/.test(actionable({ ...base, status: "Exercise" }).reason),
  actionable({ ...base, status: "Exercise" }).reason,
);

if (alerts.length) {
  console.log("\nLIVE SAMPLE");
  for (const a of alerts.slice(0, 6)) {
    console.log(
      `  ${a.colour.padEnd(6)} ${a.disasterType.slice(0, 24).padEnd(26)} ` +
        `${a.areaDescription.slice(0, 30).padEnd(32)} ${a.source}`,
    );
  }
  const counts = Object.fromEntries(
    ["red", "orange", "yellow"].map((c) => [c, alerts.filter((a) => a.colour === c).length]),
  );
  console.log(
    `\n  ${JSON.stringify(counts)}  languages: ${[...new Set(alerts.map((a) => a.language))].join(" ")}`,
  );
}

report();
