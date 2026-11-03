import { rainfallWindows } from "@/lib/kb/live";
import { scoreRisk, type RiskLevel } from "@/lib/risk";
import { DISTRICT_REGIONS } from "@/lib/kb/districts";

/**
 * National monitoring — every district, continuously.
 *
 * Open-Meteo accepts ~200 coordinates per request (measured: 200 in 1.6s), so
 * the whole country costs 4 calls. At a 15-minute cache that is ~384 calls/day,
 * well inside the free tier's 10k/day. No API key anywhere.
 *
 * The centroid list used to come straight from district-centroids.json, which
 * carried 34 rows with a null district name — state centroids that had leaked
 * into a district file. Every state was therefore scored an extra time at its
 * own centre, and the sweep reported 757 districts when it was scanning 723 and
 * 34 phantoms. Sourcing from the built profiles removes them by construction.
 */

export interface DistrictCentroid {
  d: string;
  s: string;
  lat: number;
  lng: number;
}

export const CENTROIDS: DistrictCentroid[] = DISTRICT_REGIONS.map((d) => ({
  d: d.name,
  s: d.stateName,
  lat: d.center[0],
  lng: d.center[1],
}));

export interface DistrictSignal {
  district: string;
  state: string;
  lat: number;
  lng: number;
  score: number;
  level: RiskLevel;
  antecedent72h: number;
  next24h: number;
  peak: number;
  elevationM: number | null;
}

const BATCH = 200;

interface OpenMeteoPoint {
  elevation?: number;
  hourly?: { time: string[]; precipitation: (number | null)[] };
}

async function fetchBatch(points: DistrictCentroid[], pastDays: number): Promise<OpenMeteoPoint[]> {
  const lat = points.map((p) => p.lat).join(",");
  const lng = points.map((p) => p.lng).join(",");
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&hourly=precipitation&past_days=${pastDays}&forecast_days=2&timezone=GMT`;

  const res = await fetch(url, {
    next: { revalidate: 900 },
    // Without this a stalled connection holds the batch open until the whole
    // turn times out. Open-Meteo answers 200 coordinates in under two seconds
    // when it is healthy, so anything past twenty is not coming.
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const j = await res.json();
  return Array.isArray(j) ? j : [j];
}

/**
 * The last sweep that actually answered, kept in-process.
 *
 * Open-Meteo rate-limits by the hour, and a burst of use (a demo, a test run)
 * can empty a fresh scan entirely. A scan from forty minutes ago is a far
 * better answer than nothing — risk built on 72 hours of antecedent rain does
 * not swing in forty minutes — so an empty result falls back to the last good
 * one, and `scanAge()` lets any caller say how old the answer is.
 */
let lastGood: { at: number; signals: DistrictSignal[] } | null = null;
const LAST_GOOD_MAX_MS = 6 * 3600_000;

export function scanAge(): number | null {
  return lastGood ? Date.now() - lastGood.at : null;
}

/**
 * Score every district in India. `pastDays` controls the antecedent window
 * available; 3 is enough for the 72h saturation term.
 */
export async function scanNation(pastDays = 3): Promise<DistrictSignal[]> {
  const batches: DistrictCentroid[][] = [];
  for (let i = 0; i < CENTROIDS.length; i += BATCH) batches.push(CENTROIDS.slice(i, i + BATCH));

  // Settled, not all. The country is fetched in four batches, and Promise.all
  // meant one timing out threw away the other three — the whole national scan
  // failing, and with it the answer to "what is happening", because a quarter
  // of it was slow. A scan of 543 districts is a worse answer than 724; it is a
  // far better answer than an error.
  const settled = await Promise.allSettled(batches.map((b) => fetchBatch(b, pastDays)));
  const results = settled.map((r, i) =>
    r.status === "fulfilled" ? r.value : (batches[i].map(() => ({})) as OpenMeteoPoint[]),
  );
  const lost = settled.filter((r) => r.status === "rejected").length;
  if (lost) {
    console.warn(`scanNation: ${lost} of ${batches.length} batches failed — partial scan`);
  }

  const NOW = pastDays * 24;
  const out: DistrictSignal[] = [];

  batches.forEach((batch, bi) => {
    const series = results[bi];
    batch.forEach((c, i) => {
      const precip = series[i]?.hourly?.precipitation ?? [];
      if (!precip.length) return;

      const w = rainfallWindows(precip, NOW);
      const elevationM = series[i]?.elevation ?? null;

      const risk = scoreRisk({
        ...w,
        // National sweep skips the per-point Overpass lookup — that would be
        // 757 calls. assess_risk does the real proximity check on demand.
        waterwayDistanceM: null,
        elevationM,
      });

      out.push({
        district: c.d,
        state: c.s,
        lat: c.lat,
        lng: c.lng,
        score: risk.score,
        level: risk.level,
        antecedent72h: w.antecedent72h,
        next24h: w.next24h,
        peak: w.peakIntensity,
        elevationM,
      });
    });
  });

  out.sort((a, b) => b.score - a.score);

  if (out.length) {
    lastGood = { at: Date.now(), signals: out };
  } else if (lastGood && Date.now() - lastGood.at < LAST_GOOD_MAX_MS) {
    console.warn(`scanNation: empty sweep — serving the last good scan, ${Math.round((Date.now() - lastGood.at) / 60000)} min old`);
    return lastGood.signals;
  }

  return out;
}

/** Roll district signals up to state level — max score, because risk is not an average. */
export function byState(signals: DistrictSignal[]) {
  const m = new Map<string, { state: string; worst: DistrictSignal; count: number; elevated: number }>();
  for (const s of signals) {
    const cur = m.get(s.state);
    if (!cur) {
      m.set(s.state, { state: s.state, worst: s, count: 1, elevated: s.score >= 28 ? 1 : 0 });
    } else {
      cur.count += 1;
      if (s.score >= 28) cur.elevated += 1;
      if (s.score > cur.worst.score) cur.worst = s;
    }
  }
  return [...m.values()].sort((a, b) => b.worst.score - a.worst.score);
}

