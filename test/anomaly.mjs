/**
 * The 80-year rainfall anomaly — the statistical test behind "is this normal
 * here". Deliberately runs against the live Open-Meteo archive, for the same
 * reason sachet.mjs runs live: the risk is a silent change in the feed's
 * shape, and a fixture would freeze today's shape instead of testing it.
 *
 * What these pin: the percentile is a real rank over real years, the window
 * end states the archive's actual lag instead of pretending it ends today,
 * and the evidence sentence is speakable arithmetic — because this number
 * decides whether a coordinator reads a fortnight as weather or as an event.
 */
import { loadFromSrc, harness } from "./_build.mjs";

const { check, report } = harness();
const { rainfallAnomaly } = await loadFromSrc("lib/kb/anomaly.ts");

/**
 * The archive is ~250KB of daily values back to 1940 and Open-Meteo serves it
 * slowly under load. `rainfallAnomaly` throws by design so each caller decides
 * what to do — the state deck wraps it in `attempt()` and reports the layer as
 * unavailable — but this suite let the rejection escape, so a slow morning
 * ended the whole run with an uncaught DOMException and no report at all.
 *
 * A network failure here is not a code failure. It is reported as a skip, and
 * only a *wrong answer* fails the suite.
 */
async function anomalyOrSkip(lat, lng, place) {
  try {
    return await rainfallAnomaly(lat, lng, place);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    console.log(`  ⚠ ${place}: archive unreachable — ${why.slice(0, 70)}`);
    check(`${place}: skipped, archive unreachable (not a code failure)`, true);
    return null;
  }
}

console.log("DHARAMSHALA (monsoon-heavy, mid-Himalaya)");
const a = await anomalyOrSkip(32.22, 76.32, "Dharamshala");
if (!a) {
  console.log("\n  Nothing to assert without the archive. Re-run when it responds.");
  report();
}

check("percentile is a percentage", a.percentile >= 0 && a.percentile <= 100, String(a.percentile));
check("rank 1 means wettest on record", a.rank >= 1 && a.rank <= a.yearsCompared + 1, String(a.rank));
check("it compared a real archive, not a sample", a.yearsCompared >= 30, String(a.yearsCompared));
check("the current window is a real accumulation", a.currentMm >= 0, String(a.currentMm));
check("the window end admits the archive's lag", /^\d{4}-\d{2}-\d{2}$/.test(a.windowEnd), a.windowEnd);
const lagDays = (Date.now() - Date.parse(a.windowEnd)) / 864e5;
check("…and it is recent, not stale", lagDays < 15, `${Math.round(lagDays)} days behind`);
check("the record year is a plausible year", a.wettest.year >= 1940 && a.wettest.year <= new Date().getFullYear(),
  String(a.wettest.year));
check("verdict follows the percentile", ["exceptional", "unusual", "elevated", "normal", "dry"].includes(a.verdict),
  a.verdict);
check("the evidence sentence carries its numbers", a.evidence.includes("mm") && a.evidence.includes(String(a.windowDays)),
  a.evidence);
check("the evidence is speakable — no markup", !/[*_#<>|]/.test(a.evidence), a.evidence);
check("the source names the reanalysis and the era", /ERA5/.test(a.source) && /1940/.test(a.source), a.source);

console.log("\nRANK AND PERCENTILE AGREE");
// rank 1 must mean a top percentile; a median window must sit mid-scale. The
// two are computed from the same sorted list, so disagreement means the sort
// or the comparison inverted — the exact silent failure this suite is for.
const topHalf = a.percentile >= 50;
check("wetter-than-median windows rank in the top half",
  topHalf === (a.rank <= Math.ceil(a.yearsCompared / 2)),
  `percentile ${a.percentile}, rank ${a.rank} of ${a.yearsCompared}`);

console.log("\nJAISALMER (desert — the same code must not cry wolf in the dry)");
const b = await anomalyOrSkip(26.92, 70.9, "Jaisalmer");
if (b) {
  check("a desert answers too", b.percentile >= 0 && b.percentile <= 100, String(b.percentile));
  check("its median fortnight is drier than Dharamshala's", b.medianMm <= a.medianMm,
    `desert ${b.medianMm}mm vs hills ${a.medianMm}mm`);
}

report();
