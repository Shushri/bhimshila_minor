import { findRegion } from "@/lib/kb/regions";
import { DISTRICT_REGIONS } from "@/lib/kb/districts";
import {
  alertsMentioning,
  alertsNear,
  bySeverity,
  fetchOfficialAlerts,
  hazardKind,
  type OfficialAlert,
} from "@/lib/kb/sachet";
import { exposureFor } from "@/lib/kb/exposure";
import { scanAge, scanNation } from "@/lib/kb/national";
import { fetchNews, isDisasterRelated, type NewsItem } from "@/lib/kb/feeds";
import { fetchQuakes, type Quake } from "@/lib/kb/feeds";
import { rainfallAnomaly, type RainAnomaly } from "@/lib/kb/anomaly";
import { riverReport } from "@/lib/kb/rivers";
import { db, dbReady, haversineKm } from "@/lib/db";

export const maxDuration = 10;

/**
 * Everything the state drill-down needs, one call.
 *
 * Each layer is fetched independently and fails independently — the news feed
 * being down must not take the official alerts with it. A failed layer returns
 * `{ error }` and the window for it says so, because a blank panel reads as
 * "nothing is happening" and that is never what a failed fetch means.
 */

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

/** The SVG outline layer predates a few renames; the census layer did not. */
const NAME_FIXES: Record<string, string> = {
  orissa: "odisha",
  uttaranchal: "uttarakhand",
  pondicherry: "puducherry",
  nctofdelhi: "delhi",
};

interface AlertRow {
  id: string;
  colour: string;
  type: string;
  kind: string;
  issuer: string;
  area: string;
  message: string;
  language: string;
  startsAt: string | null;
  endsAt: string | null;
  people: number | null;
  basis: string | null;
}

function shapeAlert(a: OfficialAlert): AlertRow {
  const e = exposureFor(a);
  return {
    id: a.id,
    colour: a.colour,
    type: a.disasterType,
    kind: hazardKind(a.disasterType),
    issuer: a.source,
    area: a.areaDescription,
    message: a.message,
    language: a.language,
    startsAt: a.startsAt,
    endsAt: a.endsAt,
    people: e.method === "unknown" ? null : e.people,
    basis: e.method === "unknown" ? null : e.basis,
  };
}

type Section<T> = T | { error: string };

const attempt = async <T>(p: Promise<T>): Promise<Section<T>> => {
  try {
    return await p;
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
};

async function forecastFor(lat: number, lng: number) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&hourly=precipitation&past_days=1&forecast_days=3&timezone=auto`;
  const res = await fetch(url, { next: { revalidate: 900 }, signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const j = (await res.json()) as { hourly?: { time: string[]; precipitation: (number | null)[] } };
  const time = j.hourly?.time ?? [];
  const mm = (j.hourly?.precipitation ?? []).map((x) => x ?? 0);
  const nowIdx = 24; // past_days=1
  const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 10) / 10;
  return {
    hourly: time.map((t, i) => ({ t, mm: Math.round(mm[i] * 100) / 100 })),
    nowIdx,
    next24h: sum(mm.slice(nowIdx, nowIdx + 24)),
    next48h: sum(mm.slice(nowIdx, nowIdx + 48)),
    peakIntensity: Math.max(0, ...mm.slice(nowIdx, nowIdx + 24)),
    asOf: time[nowIdx] ?? null,
    source: "Open-Meteo forecast",
  };
}

export async function GET(_req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const raw = decodeURIComponent(code);
  const fixed = NAME_FIXES[norm(raw)] ?? raw;

  const region = findRegion(fixed);
  const stateName =
    region?.level === "state"
      ? region.name
      : DISTRICT_REGIONS.find((d) => norm(d.stateName) === norm(fixed))?.stateName;
  if (!stateName) {
    return Response.json({ error: `No state matches "${raw}".` }, { status: 404 });
  }
  const state = region?.level === "state" ? region : findRegion(stateName);
  if (!state) return Response.json({ error: `No state matches "${raw}".` }, { status: 404 });

  const [lat, lng] = state.center;
  const districts = DISTRICT_REGIONS.filter((d) => norm(d.stateName) === norm(stateName));

  // River cells are checked at the four most populous districts — where a
  // swollen river meets the most people. GloFAS is a ~5km grid, so a centroid
  // with no real river nearby simply drops out of the answer.
  const riverPoints = [...districts]
    .sort((a, b) => b.population - a.population)
    .slice(0, 4)
    .map((d) => ({ lat: d.center[0], lng: d.center[1], district: d.name }));

  const [alertsS, riskS, forecastS, anomalyS, newsS, quakesS, riversS, teamsS] = await Promise.all([
    attempt(
      fetchOfficialAlerts().then((all) => {
        // Union of "names the state" and "centroid falls inside it" — an IMD
        // nowcast for one town names the district, not the state.
        const seen = new Set<string>();
        const rows = [
          ...alertsMentioning(all, stateName),
          ...alertsNear(all, lat, lng, Math.max(120, Math.sqrt(state.areaKm2 / Math.PI))),
          ...districts.flatMap((d) => alertsMentioning(all, d.name)),
        ].filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)));
        return { list: rows.sort(bySeverity).slice(0, 30).map(shapeAlert), live: all.length > 0 };
      }),
    ),
    attempt(
      scanNation().then((signals) => {
        // An empty scan is an outage, not a calm country — rendering it as
        // "0 districts elevated" would be the all-clear this system must
        // never fabricate. (scanNation itself falls back to its last good
        // sweep for up to six hours, so this fires only when there is truly
        // nothing to serve.)
        if (!signals.length)
          throw new Error("Open-Meteo is rate-limiting the national scan — retry in a few minutes");
        const age = scanAge();
        const mine = signals
          .filter((s) => norm(s.state) === norm(stateName))
          .sort((a, b) => b.score - a.score);
        return {
          staleMin: age !== null && age > 20 * 60_000 ? Math.round(age / 60_000) : null,
          districts: mine.slice(0, 14).map((s) => ({
            district: s.district,
            score: s.score,
            level: s.level,
            antecedent72h: s.antecedent72h,
            next24h: s.next24h,
            peak: s.peak,
          })),
          scanned: mine.length,
          elevated: mine.filter((s) => s.score >= 28).length,
          source: "Open-Meteo, scored in plain code — an estimate, not an official warning",
        };
      }),
    ),
    attempt(forecastFor(lat, lng)),
    attempt(rainfallAnomaly(lat, lng, stateName)),
    attempt(
      fetchNews({ limit: 200 }).then((all) => {
        const names = [stateName, ...districts.map((d) => d.name)].map((n) => n.toLowerCase());
        const items = all.filter((n) => {
          const t = n.title.toLowerCase();
          return names.some((x) => x.length > 3 && t.includes(x));
        });
        // Disaster-related first, then anything mentioning the place at all.
        const rel = items.filter((n) => isDisasterRelated(n.title));
        const rest = items.filter((n) => !isDisasterRelated(n.title));
        return { items: [...rel, ...rest].slice(0, 12) };
      }),
    ),
    attempt(
      fetchQuakes(90, 4).then((all) =>
        all
          .filter((q) => haversineKm(lat, lng, q.lat, q.lng) < 800)
          .sort((a, b) => b.magnitude - a.magnitude)
          .slice(0, 6),
      ),
    ),
    attempt(riverReport(riverPoints)),
    attempt(
      (async () => {
        await dbReady();
        const r = await db().execute(
          `SELECT t.id, t.name, t.kind, t.place, t.status, t.lat, t.lng,
                  r.boats, r.medical_kits, r.food_packets
           FROM teams t LEFT JOIN team_resources r ON r.team_id = t.id`,
        );
        return r.rows
          .map((row) => ({
            id: Number(row.id),
            name: String(row.name),
            kind: String(row.kind),
            place: String(row.place),
            status: String(row.status),
            distanceKm: Math.round(haversineKm(lat, lng, Number(row.lat), Number(row.lng))),
            boats: Number(row.boats ?? 0),
            medicalKits: Number(row.medical_kits ?? 0),
            foodPackets: Number(row.food_packets ?? 0),
          }))
          .sort((a, b) => a.distanceKm - b.distanceKm)
          .slice(0, 10);
      })(),
    ),
  ]);

  // Population under alert, distinct by district, scoped to this state.
  let underAlert = 0;
  const exposedDistricts = new Map<string, { name: string; population: number; share: number }>();
  if (!("error" in alertsS)) {
    const all = await fetchOfficialAlerts().catch(() => [] as OfficialAlert[]);
    const mineIds = new Set(alertsS.list.map((a) => a.id));
    for (const a of all) {
      if (!mineIds.has(a.id)) continue;
      const e = exposureFor(a);
      for (const d of e.districts) {
        if (norm(d.state) !== norm(stateName)) continue;
        const cur = exposedDistricts.get(norm(d.name));
        if (!cur || d.population * d.share > cur.population * cur.share) {
          exposedDistricts.set(norm(d.name), { name: d.name, population: d.population, share: d.share });
        }
      }
    }
    underAlert = [...exposedDistricts.values()].reduce((s, d) => s + Math.round(d.population * d.share), 0);
  }

  const vulnerabilityOf = (name: string) => {
    const d = districts.find((x) => norm(x.name) === norm(name));
    return d
      ? { fragileHousingPct: d.vulnerability.fragileHousingPct, ruralPct: d.vulnerability.ruralPct }
      : { fragileHousingPct: null, ruralPct: null };
  };

  return Response.json({
    state: {
      name: state.name,
      id: state.id,
      population: state.population,
      population2026: districts.reduce((s, d) => s + (d.population2026 ?? d.population), 0) || null,
      density: state.density,
      areaKm2: state.areaKm2,
      literacyPct: state.literacyPct ?? null,
      hazards: state.hazards ?? [],
      center: state.center,
      districts: districts.length,
      source: state.source,
    },
    alerts: alertsS,
    risk: riskS,
    forecast: forecastS,
    anomaly: anomalyS as Section<RainAnomaly>,
    news: newsS as Section<{ items: NewsItem[] }>,
    quakes: ("error" in (quakesS as object) ? [] : quakesS) as Quake[],
    rivers: riversS,
    population: {
      underAlert,
      exposed: [...exposedDistricts.values()]
        .sort((a, b) => b.population * b.share - a.population * a.share)
        .slice(0, 8)
        .map((d) => ({ ...d, people: Math.round(d.population * d.share), ...vulnerabilityOf(d.name) })),
      source: "Census 2011, projected to 2026",
    },
    deployments: teamsS,
    at: new Date().toISOString(),
  });
}
