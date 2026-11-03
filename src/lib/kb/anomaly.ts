/**
 * Rainfall anomaly against the full instrument-era archive.
 *
 * The question a coordinator actually has is not "how much rain fell" but "is
 * this normal here". 300mm in a Kerala monsoon fortnight is a Tuesday; the same
 * total in Rajasthan is a disaster forming. The only honest way to answer is to
 * compare this fortnight against every same-calendar fortnight the archive has
 * — Open-Meteo's ERA5 reanalysis reaches back to 1940, free, one request.
 *
 * The statistical test is plain arithmetic in this file. The model never
 * produces the percentile, the rank or the verdict — an anomaly claim invents
 * urgency, and an invented one sends teams to a place having ordinary weather.
 */

export interface RainAnomaly {
  lat: number;
  lng: number;
  /** Days in the comparison window. */
  windowDays: number;
  /** mm accumulated over the current window. */
  currentMm: number;
  /** Last day of the window — the archive lags a few days and this says so. */
  windowEnd: string;
  /** How many past years had a complete same-calendar window to compare. */
  yearsCompared: number;
  /** Share of past years this window beats, 0–100. */
  percentile: number;
  /** 1 = the wettest such window since the archive begins. */
  rank: number;
  medianMm: number;
  wettest: { year: number; mm: number };
  verdict: "exceptional" | "unusual" | "elevated" | "normal" | "dry";
  /** One plain sentence, built from the numbers above — safe to speak. */
  evidence: string;
  source: string;
}

const ARCHIVE = "https://archive-api.open-meteo.com/v1/archive";
const WINDOW_DAYS = 14;
const FIRST_YEAR = 1940;

const round1 = (n: number) => Math.round(n * 10) / 10;

function verdictFor(percentile: number): RainAnomaly["verdict"] {
  if (percentile >= 99) return "exceptional";
  if (percentile >= 95) return "unusual";
  if (percentile >= 85) return "elevated";
  if (percentile >= 30) return "normal";
  return "dry";
}

/**
 * One archive request: daily precipitation for this point since 1940.
 *
 * Cached six hours — climate history does not change between sweeps, and the
 * response is ~250KB that Open-Meteo would rather not serve per click.
 */
export async function rainfallAnomaly(lat: number, lng: number, place?: string): Promise<RainAnomaly> {
  const today = new Date().toISOString().slice(0, 10);
  const url =
    `${ARCHIVE}?latitude=${lat.toFixed(3)}&longitude=${lng.toFixed(3)}` +
    `&start_date=${FIRST_YEAR}-01-01&end_date=${today}&daily=precipitation_sum&timezone=GMT`;

  const res = await fetch(url, { next: { revalidate: 21_600 }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Open-Meteo archive ${res.status}`);
  const j = (await res.json()) as { daily?: { time: string[]; precipitation_sum: (number | null)[] } };

  const time = j.daily?.time ?? [];
  const mm = j.daily?.precipitation_sum ?? [];
  if (time.length < 365 * 2) throw new Error("Archive returned too little history to compare");

  // ERA5 lags a few days behind now. The window is the last WINDOW_DAYS with
  // real values, and windowEnd states that honestly rather than pretending the
  // window ends today.
  let last = mm.length - 1;
  while (last >= 0 && (mm[last] === null || mm[last] === undefined)) last--;
  if (last < WINDOW_DAYS) throw new Error("Archive has no recent data for this point");

  const sumWindow = (endIdx: number): number | null => {
    let s = 0;
    for (let i = endIdx - WINDOW_DAYS + 1; i <= endIdx; i++) {
      const v = mm[i];
      if (v === null || v === undefined) return null;
      s += v;
    }
    return s;
  };

  const currentMm = sumWindow(last);
  if (currentMm === null) throw new Error("Archive has gaps in the current window");
  const windowEnd = time[last];

  // The same calendar window in every earlier year. Daily rows are contiguous
  // dates, so the index of any date is plain day arithmetic from the start.
  const startMs = Date.parse(time[0] + "T00:00:00Z");
  const endDate = new Date(windowEnd + "T00:00:00Z");
  const endYear = endDate.getUTCFullYear();

  const past: { year: number; mm: number }[] = [];
  for (let y = FIRST_YEAR; y < endYear; y++) {
    // Same month and day in year y. 29 Feb in a non-leap year lands on 1 Mar,
    // which is a one-day shift and not worth special-casing.
    const sameDay = Date.UTC(y, endDate.getUTCMonth(), endDate.getUTCDate());
    const idx = Math.round((sameDay - startMs) / 864e5);
    if (idx < WINDOW_DAYS || idx >= mm.length) continue;
    const s = sumWindow(idx);
    if (s !== null) past.push({ year: y, mm: s });
  }
  if (past.length < 30) throw new Error("Too few complete past windows to rank against");

  const sorted = [...past].sort((a, b) => a.mm - b.mm);
  const below = sorted.filter((p) => p.mm <= currentMm).length;
  const percentile = Math.round((below / sorted.length) * 100);
  const rank = 1 + sorted.filter((p) => p.mm > currentMm).length;
  const medianMm = sorted[Math.floor(sorted.length / 2)].mm;
  const wettest = sorted[sorted.length - 1];
  const verdict = verdictFor(percentile);

  const at = place ? ` at ${place}` : "";
  const endLabel = new Date(windowEnd + "T00:00:00Z").toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  // Rank reads better than percentile when the window is genuinely rare, and
  // the comparison to the median carries the "is this normal" answer.
  const evidence =
    rank === 1
      ? `${round1(currentMm)} mm fell in the ${WINDOW_DAYS} days to ${endLabel}${at} — the wettest such fortnight in ${past.length + 1} years of records, ahead of ${wettest.year}'s ${round1(wettest.mm)} mm.`
      : verdict === "exceptional" || verdict === "unusual"
        ? `${round1(currentMm)} mm fell in the ${WINDOW_DAYS} days to ${endLabel}${at} — ${ordinal(rank)} wettest in ${past.length} comparable years (${percentile}th percentile; the record is ${wettest.year}'s ${round1(wettest.mm)} mm).`
        : `${round1(currentMm)} mm in the ${WINDOW_DAYS} days to ${endLabel}${at} — ${percentile}th percentile of ${past.length} comparable years; the median such fortnight is ${round1(medianMm)} mm.`;

  return {
    lat,
    lng,
    windowDays: WINDOW_DAYS,
    currentMm: round1(currentMm),
    windowEnd,
    yearsCompared: past.length,
    percentile,
    rank,
    medianMm: round1(medianMm),
    wettest: { year: wettest.year, mm: round1(wettest.mm) },
    verdict,
    evidence,
    source: `Open-Meteo ERA5 reanalysis, ${FIRST_YEAR}–${endYear}`,
  };
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}
