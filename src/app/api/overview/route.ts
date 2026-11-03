import { scanNation, byState } from "@/lib/kb/national";
import { fetchNews, fetchQuakes, isDisasterRelated } from "@/lib/kb/feeds";

/**
 * National live feed for the dashboard.
 *
 * Scores all 757 districts (4 bulk Open-Meteo calls), then layers on the
 * ground-truth feeds so the map can mark what is actually happening rather
 * than only what the model thinks might.
 */

export const revalidate = 900; // 15 min

export async function GET() {
  try {
    const [signals, news, quakes] = await Promise.all([
      scanNation(),
      fetchNews({ disasterOnly: true, limit: 12 }).catch(() => []),
      fetchQuakes(30, 4.2).catch(() => []),
    ]);

    const elevated = signals.filter((s) => s.score >= 28);
    const states = byState(signals);

    // Map markers: everything elevated, plus recent significant quakes.
    const markers = [
      ...elevated.slice(0, 60).map((s) => ({
        kind: "rain" as const,
        name: s.district,
        state: s.state,
        lat: s.lat,
        lng: s.lng,
        level: s.level,
        score: s.score,
        detail: `${s.antecedent72h}mm past 72h · ${s.next24h}mm incoming`,
      })),
      // The USGS bbox necessarily catches Afghanistan, Tajikistan and Pakistan
      // events. They matter seismically, but plotting them on a map that only
      // draws India reads as a rendering bug — keep them in the feed, off the map.
      ...quakes
        .filter((q) => /india/i.test(q.place))
        .slice(0, 15)
        .map((q) => ({
        kind: "quake" as const,
        name: `M${q.magnitude.toFixed(1)}`,
        state: q.place,
        lat: q.lat,
        lng: q.lng,
        level: q.magnitude >= 5.5 ? "severe" : q.magnitude >= 4.8 ? "high" : "moderate",
        score: Math.round(q.magnitude * 10),
        detail: `${q.place} · ${q.depthKm}km deep`,
      })),
    ];

    return Response.json({
      ok: true,
      scanned: signals.length,
      elevatedCount: elevated.length,
      exposure: signals.slice(0, 12),
      // Every state, not a top-10 — this drives the board's resting heat map,
      // and a choropleth with two-thirds of the country unpainted reads as
      // missing data rather than low risk.
      states: states.map((s) => ({
        state: s.state,
        worst: s.worst.score,
        level: s.worst.level,
        elevated: s.elevated,
        districts: s.count,
      })),
      markers,
      news: news.filter((n) => isDisasterRelated(n.title)).slice(0, 6),
      quakes: quakes.slice(0, 6),
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Feed unavailable",
        scanned: 0,
        elevatedCount: 0,
        exposure: [],
        states: [],
        markers: [],
        news: [],
        quakes: [],
      },
      { status: 200 }, // the dashboard degrades rather than breaks
    );
  }
}
