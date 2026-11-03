import { rainfallWindows } from "./live";
import { scoreRisk, type RiskLevel } from "@/lib/risk";

/**
 * Any place, any date since 1940 — scored by the engine that runs today.
 *
 * This replaces a fixed catalogue of four disasters. That catalogue answered
 * one question well ("would this have caught Khaniyara?") and every other
 * question not at all: a coordinator asking about the 2018 Kerala floods, or
 * what last August looked like in their own district, got nothing, because
 * their event was not one of the four somebody had hardcoded.
 *
 * The archive does not care. Open-Meteo holds hourly reanalysis back to 1940
 * for every point in the country, so the limit was never the data — it was
 * that the only way in was a dropdown.
 *
 * What comes back is the same three things the replay produced, for whatever
 * was asked: how much fell, what the live scorer makes of each hour, and when
 * it would have crossed each threshold.
 *
 * The honesty rule carries over unchanged. An archive holds what actually
 * fell, not what was forecast at the time, so a score computed from it is the
 * engine's ceiling — evidence it can detect a pattern, never a claim about
 * what anyone could have known that morning. Every answer says so.
 */

const ARCHIVE = "https://archive-api.open-meteo.com/v1/archive";

export interface HistoryHour {
  t: string;
  mm: number;
  score: number;
  level: RiskLevel;
}

export interface HistoryReport {
  place: string;
  /** The window actually fetched, which may be wider than the one asked for. */
  from: string;
  to: string;
  totalMm: number;
  wettestDay: { date: string; mm: number } | null;
  peak: { at: string; score: number; level: RiskLevel } | null;
  /** When the score first crossed each threshold, if it did. */
  crossings: { moderate: string | null; high: string | null; severe: string | null };
  hours: HistoryHour[];
  /** One plain sentence, ready to speak. */
  headline: string;
  caveat: string;
  source: string;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const round = (n: number) => Math.round(n * 10) / 10;

/**
 * Widen a single date into a window worth scoring.
 *
 * The scorer needs 72 hours of antecedent rain behind any hour it judges —
 * saturated ground is the dominant term — so asking about one day means
 * fetching the three before it. Two days after are included because what
 * happened next is the part a person actually remembers.
 */
function windowFor(from: string, to?: string) {
  const start = new Date(from + "T00:00:00Z");
  const end = new Date((to ?? from) + "T00:00:00Z");
  const fetchFrom = new Date(start.getTime() - 4 * 864e5);
  const fetchTo = new Date(Math.min(end.getTime() + 2 * 864e5, Date.now() - 6 * 864e5));
  return { fetchFrom: iso(fetchFrom), fetchTo: iso(fetchTo), start, end };
}

export async function historyFor(
  lat: number,
  lng: number,
  place: string,
  from: string,
  to?: string,
): Promise<HistoryReport> {
  const w = windowFor(from, to);

  const url =
    `${ARCHIVE}?latitude=${lat.toFixed(3)}&longitude=${lng.toFixed(3)}` +
    `&start_date=${w.fetchFrom}&end_date=${w.fetchTo}&hourly=precipitation&timezone=auto`;

  // A refusal and an outage arrive differently — one carries a status, the
  // other is a thrown TypeError with none. Both are the archive being
  // unavailable, and neither is this app being broken.
  let res: Response;
  try {
    res = await fetch(url, { next: { revalidate: 86_400 }, signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new Error("The weather archive did not answer in time. Retry shortly.");
  }
  if (!res.ok) throw new Error(`The weather archive is unreachable (${res.status}).`);

  const j = (await res.json()) as {
    hourly?: { time: string[]; precipitation: (number | null)[] };
  };
  const time = j.hourly?.time ?? [];
  const precip = (j.hourly?.precipitation ?? []).map((x) => x ?? 0);
  if (time.length < 96) throw new Error("The archive returned too short a window to score.");

  // Only hours inside the window asked about are scored; the days before it
  // exist to give those hours their antecedent.
  const startIdx = Math.max(72, time.findIndex((t) => t >= iso(w.start)));
  const endIdx = time.length - 1;

  const hours: HistoryHour[] = [];
  const crossings = { moderate: null as string | null, high: null as string | null, severe: null as string | null };

  for (let i = startIdx; i <= endIdx; i++) {
    const windows = rainfallWindows(precip, i);
    const r = scoreRisk({
      ...windows,
      // Unknown for an arbitrary point, and stated as unknown rather than
      // guessed — the scorer already handles a null by leaving that term out.
      waterwayDistanceM: null,
      elevationM: null,
    });
    hours.push({ t: time[i], mm: round(precip[i]), score: r.score, level: r.level });

    if (!crossings.moderate && r.level !== "low") crossings.moderate = time[i];
    if (!crossings.high && (r.level === "high" || r.level === "severe")) crossings.high = time[i];
    if (!crossings.severe && r.level === "severe") crossings.severe = time[i];
  }

  const totalMm = round(hours.reduce((s, h) => s + h.mm, 0));

  const byDay = new Map<string, number>();
  for (const h of hours) {
    const d = h.t.slice(0, 10);
    byDay.set(d, (byDay.get(d) ?? 0) + h.mm);
  }
  const wettest = [...byDay.entries()].sort((a, b) => b[1] - a[1])[0];
  const wettestDay = wettest ? { date: wettest[0], mm: round(wettest[1]) } : null;

  const peakHour = hours.reduce<HistoryHour | null>(
    (best, h) => (!best || h.score > best.score ? h : best),
    null,
  );
  const peak = peakHour ? { at: peakHour.t, score: peakHour.score, level: peakHour.level } : null;

  return {
    place,
    from: iso(w.start),
    to: w.fetchTo,
    totalMm,
    wettestDay,
    peak,
    crossings,
    hours,
    headline: headlineFor(place, iso(w.start), to, totalMm, wettestDay, peak, crossings),
    caveat:
      "Scored from what actually fell — an archive holds observations, not the forecasts anyone had at the time. " +
      "This is the engine's ceiling, not a claim about what was knowable that morning.",
    source: "Open-Meteo ERA5 reanalysis, hourly, 1940 onwards",
  };
}

function headlineFor(
  place: string,
  from: string,
  to: string | undefined,
  totalMm: number,
  wettestDay: { date: string; mm: number } | null,
  peak: { at: string; score: number; level: RiskLevel } | null,
  crossings: HistoryReport["crossings"],
): string {
  const pretty = (d: string) =>
    new Date(d + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

  const when = to && to !== from ? `${pretty(from)} to ${pretty(to)}` : pretty(from);

  if (totalMm < 1) {
    return `${place} recorded almost no rain around ${when} — ${totalMm}mm in total.`;
  }

  const wettest = wettestDay ? ` The wettest day was ${pretty(wettestDay.date)} at ${wettestDay.mm}mm.` : "";

  // The crossing is the interesting number, because it is the thing this
  // engine would have said rather than a figure anyone can read off a chart.
  const crossed = crossings.high
    ? ` Our scorer would have reached HIGH on ${new Date(crossings.high).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", hour12: true })}.`
    : crossings.moderate
      ? ` Our scorer would have reached MODERATE on ${new Date(crossings.moderate).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", hour12: true })}.`
      : " Our scorer stays low throughout — this was rain, not a flood signal.";

  const peakBit = peak ? ` Peak exposure ${peak.score} out of 100.` : "";

  return `${place}, ${when}: ${totalMm}mm fell.${wettest}${crossed}${peakBit}`;
}
