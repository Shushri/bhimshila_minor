/**
 * River discharge — the escalation signal between rainfall and flood.
 *
 * Rain is the cause; the river is the mechanism. GloFAS (Copernicus) models
 * discharge for every river cell on a ~5km grid, and Open-Meteo serves it
 * free, keyless, daily. What a coordinator needs from it is not the cumec
 * figure — it is "is this river carrying multiples of its normal load, and is
 * it still rising".
 *
 * Every number here is arithmetic on the model's own series: today against
 * the 90-day median, the week's change, the forecast peak. And it is said
 * plainly that this is a model, not a gauge — the CWC's gauges are the
 * authority, and this fills the map between them, never overrules them.
 */

export interface RiverSignal {
  district: string;
  lat: number;
  lng: number;
  /** m³/s today, from the model. */
  today: number;
  /** Median of the last 90 days at this cell — "normal" for this season. */
  median90d: number;
  /** today / median. 1 is normal; 3 is a river carrying triple its load. */
  ratio: number;
  /** Change vs 7 days ago. */
  changePct: number;
  trend: "rising" | "falling" | "steady";
  /** The worst day in the 14-day forecast, if it exceeds today. */
  peakAhead: { date: string; discharge: number; ratio: number } | null;
}

export interface RiverReport {
  rows: RiverSignal[];
  /** One deterministic sentence for the window header and the spoken path. */
  headline: string;
  source: string;
}

const API = "https://flood-api.open-meteo.com/v1/flood";

const round = (n: number) => Math.round(n * 10) / 10;

async function onePoint(lat: number, lng: number, district: string): Promise<RiverSignal | null> {
  const url =
    `${API}?latitude=${lat.toFixed(3)}&longitude=${lng.toFixed(3)}` +
    `&daily=river_discharge&past_days=92&forecast_days=14`;
  const res = await fetch(url, { next: { revalidate: 21_600 }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`flood API ${res.status}`);
  const j = (await res.json()) as { daily?: { time: string[]; river_discharge: (number | null)[] } };

  const time = j.daily?.time ?? [];
  const q = j.daily?.river_discharge ?? [];
  const todayIdx = 92; // past_days puts "today" here
  if (q.length < todayIdx + 1 || q[todayIdx] === null) return null;

  const past = q.slice(0, todayIdx).filter((x): x is number => x !== null);
  if (past.length < 60) return null;
  const sorted = [...past].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  // A dry-season trickle tripling is not news; skip cells with no real river.
  if (median < 5 && q[todayIdx]! < 50) return null;

  const today = q[todayIdx]!;
  const weekAgo = q[todayIdx - 7] ?? today;
  const changePct = weekAgo > 0 ? Math.round(((today - weekAgo) / weekAgo) * 100) : 0;

  let peak: RiverSignal["peakAhead"] = null;
  for (let i = todayIdx + 1; i < q.length; i++) {
    const v = q[i];
    if (v !== null && v > today && (!peak || v > peak.discharge)) {
      peak = { date: time[i], discharge: round(v), ratio: round(v / Math.max(median, 0.1)) };
    }
  }

  return {
    district,
    lat,
    lng,
    today: round(today),
    median90d: round(median),
    ratio: round(today / Math.max(median, 0.1)),
    changePct,
    trend: changePct > 12 ? "rising" : changePct < -12 ? "falling" : "steady",
    peakAhead: peak,
  };
}

/**
 * The named points, in parallel, tolerating individual failures — three
 * districts answering beats an error because the fourth timed out.
 */
export async function riverReport(
  points: { lat: number; lng: number; district: string }[],
): Promise<RiverReport> {
  const settled = await Promise.allSettled(points.map((p) => onePoint(p.lat, p.lng, p.district)));
  const rows = settled
    .filter((s): s is PromiseFulfilledResult<RiverSignal | null> => s.status === "fulfilled")
    .map((s) => s.value)
    .filter((v): v is RiverSignal => v !== null)
    .sort((a, b) => b.ratio - a.ratio);

  const answered = settled.filter((s) => s.status === "fulfilled").length;
  if (!rows.length) {
    // Fetched-but-empty is an answer, not an outage: these districts sit on
    // small, steep catchments the ~5km GloFAS grid reads as minor streams.
    // Saying so beats an error card that looks like something broke.
    if (answered > 0) {
      return {
        rows: [],
        headline:
          "No significant river cell near the checked districts — GloFAS reads best on large rivers; flash-flood risk here shows through the rainfall layers instead.",
        source: "GloFAS v4 modelled discharge via Open-Meteo — a model, not a gauge; CWC gauges are the authority",
      };
    }
    const firstErr = settled.find((s): s is PromiseRejectedResult => s.status === "rejected");
    throw new Error(firstErr ? String(firstErr.reason?.message ?? firstErr.reason) : "flood API unreachable");
  }

  const worst = rows[0];
  const headline =
    worst.ratio >= 2
      ? `The river near ${worst.district} is carrying ${worst.ratio}× its 90-day normal and ${worst.trend === "rising" ? "still rising" : worst.trend}.`
      : worst.trend === "rising"
        ? `Rivers are near seasonal normal; ${worst.district} is rising (${worst.changePct > 0 ? "+" : ""}${worst.changePct}% this week).`
        : `Rivers are near their seasonal normal across the checked districts.`;

  return {
    rows,
    headline,
    source: "GloFAS v4 modelled discharge via Open-Meteo — a model, not a gauge; CWC gauges are the authority",
  };
}
