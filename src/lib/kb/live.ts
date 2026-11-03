/**
 * Live geo/weather signals. Queried on demand — nothing stored.
 *
 * Open-Meteo: free, no API key, no signup, ~1.5km regional resolution,
 * historical archive back to 1940. See DATA_SOURCES.md Tier 1.
 */

import sheltersData from "@/data/shelters.json";

interface ShelterBundle {
  source: string;
  builtAt: string;
  note: string;
  districts: Record<string, { n: string | null; k: string; lat: number; lng: number; m: number }[]>;
}

/**
 * Evacuation destinations, bundled at build time.
 *
 * Schools, colleges, hospitals and clinics near every district centre. See
 * scripts/build-shelters.mjs for where it comes from and what it is not.
 */
const SHELTERS = sheltersData as ShelterBundle;

/** Provenance — this is OpenStreetMap, not a state register of shelters. */
export const SHELTER_SOURCE = SHELTERS.source;
export const SHELTER_NOTE = SHELTERS.note;

export interface RainfallSignal {
  lat: number;
  lng: number;
  elevationM: number | null;
  /** mm accumulated over the trailing 72h — saturated ground is the real flash-flood driver */
  antecedent72h: number;
  next6h: number;
  next12h: number;
  next24h: number;
  /** peak hourly intensity in the next 24h, mm/h */
  peakIntensity: number;
  asOf: string;
}

const OM = "https://api.open-meteo.com/v1/forecast";
const OM_ARCHIVE = "https://archive-api.open-meteo.com/v1/archive";

const sum = (xs: number[]) => xs.reduce((a, b) => a + (b || 0), 0);

/**
 * The three windows every risk assessment needs, from one hourly series.
 *
 * `nowIdx` is the index of "now" — for a forecast that is `past_days * 24`,
 * for the archive it is the index of the target date. Shared by the point
 * lookups here and the national sweep in national.ts so the definition of
 * "antecedent 72h" cannot drift between them.
 */
export function rainfallWindows(precip: (number | null)[], nowIdx: number) {
  const p = precip.map((x) => x ?? 0);
  const next24 = p.slice(nowIdx, nowIdx + 24);
  return {
    antecedent72h: round(sum(p.slice(Math.max(0, nowIdx - 72), nowIdx))),
    next6h: round(sum(p.slice(nowIdx, nowIdx + 6))),
    next12h: round(sum(p.slice(nowIdx, nowIdx + 12))),
    next24h: round(sum(next24)),
    peakIntensity: round(next24.length ? Math.max(0, ...next24) : 0),
  };
}

/** Forecast-mode rainfall for a point. `past_days` gives us the antecedent window. */
export async function getRainfall(lat: number, lng: number): Promise<RainfallSignal> {
  const url = `${OM}?latitude=${lat}&longitude=${lng}&hourly=precipitation&past_days=3&forecast_days=2&timezone=auto`;
  // A stalled connection here holds the whole turn open. This one legitimately
  // throws on failure — a flood-risk score with no rainfall behind it would be
  // a number with nothing under it — but it must fail fast, not hang.
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const j = await res.json();

  const precip: (number | null)[] = j.hourly?.precipitation ?? [];
  const times: string[] = j.hourly?.time ?? [];
  // past_days=3 puts "now" at index 72
  const nowIdx = Math.min(72, Math.max(0, precip.length - 48));

  return {
    lat,
    lng,
    elevationM: typeof j.elevation === "number" ? j.elevation : null,
    ...rainfallWindows(precip, nowIdx),
    asOf: times[nowIdx] ?? new Date().toISOString(),
  };
}

/** Historical rainfall for replay mode — reconstruct a past event on real data. */
export async function getHistoricalRainfall(
  lat: number,
  lng: number,
  date: string,
): Promise<RainfallSignal & { date: string; hourly: { time: string; mm: number }[] }> {
  const d = new Date(date + "T00:00:00Z");
  const start = new Date(d.getTime() - 3 * 864e5).toISOString().slice(0, 10);
  const end = new Date(d.getTime() + 1 * 864e5).toISOString().slice(0, 10);

  const url = `${OM_ARCHIVE}?latitude=${lat}&longitude=${lng}&start_date=${start}&end_date=${end}&hourly=precipitation&timezone=auto`;
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Open-Meteo archive ${res.status}`);
  const j = await res.json();

  const precip: (number | null)[] = j.hourly?.precipitation ?? [];
  const times: string[] = j.hourly?.time ?? [];
  const targetIdx = times.findIndex((t) => t.startsWith(date));
  const idx = targetIdx >= 0 ? targetIdx : 72;

  return {
    lat,
    lng,
    elevationM: typeof j.elevation === "number" ? j.elevation : null,
    ...rainfallWindows(precip, idx),
    asOf: times[idx] ?? date,
    date,
    hourly: times
      .map((t, i) => ({ time: t, mm: round(precip[i] ?? 0) }))
      .slice(Math.max(0, idx - 48), idx + 24),
  };
}

/**
 * Distance to the nearest mapped watercourse, via OSM Overpass.
 * Free, no key. Returns null if nothing within the search radius.
 */
export async function nearestWaterway(
  lat: number,
  lng: number,
  radiusM = 3000,
): Promise<{ distanceM: number; name: string | null } | null> {
  const q = `[out:json][timeout:20];way(around:${radiusM},${lat},${lng})[waterway~"^(river|stream)$"];out center 20;`;
  try {
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: "data=" + encodeURIComponent(q),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const j = await res.json();
    let best: { distanceM: number; name: string | null } | null = null;
    for (const el of j.elements ?? []) {
      const c = el.center ?? el;
      if (typeof c.lat !== "number") continue;
      const d = haversine(lat, lng, c.lat, c.lon);
      if (!best || d < best.distanceM) best = { distanceM: Math.round(d), name: el.tags?.name ?? null };
    }
    return best;
  } catch {
    return null;
  }
}

interface OverpassElement {
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export interface Shelter {
  name: string;
  kind: string;
  lat: number;
  lng: number;
  distanceM: number;
}

/**
 * Where to go, answered offline first.
 *
 * "Where do I go" is the one question that must work when the network does
 * not, and a disaster is exactly when Overpass is unreachable or rate-limited.
 * So the bundled index answers first and the live query only runs to improve
 * on it. If the network is down the answer is slightly coarser; it is not
 * absent.
 *
 * Built by scripts/build-shelters.mjs from the HDX/HOT national extract.
 */
export async function nearbyShelters(lat: number, lng: number, radiusM = 5000): Promise<Shelter[]> {
  const offline = bundledShelters(lat, lng);

  const live = await liveShelters(lat, lng, radiusM);
  if (live.length) return live;

  return offline;
}

/** Shelter list from the bundle, nearest first. Never touches the network. */
export function bundledShelters(lat: number, lng: number, limit = 8): Shelter[] {
  const out: Shelter[] = [];
  for (const list of Object.values(SHELTERS.districts)) {
    for (const s of list) {
      const distanceM = Math.round(haversine(lat, lng, s.lat, s.lng));
      // The bundle is indexed on district centres, so a point near a district
      // boundary is legitimately served by the neighbouring district's list.
      if (distanceM <= 60_000) {
        out.push({
          name: s.n ?? `unnamed ${s.k}`,
          kind: s.k,
          lat: s.lat,
          lng: s.lng,
          distanceM,
        });
      }
    }
  }
  return out.sort((a, b) => a.distanceM - b.distanceM).slice(0, limit);
}

async function liveShelters(lat: number, lng: number, radiusM: number): Promise<Shelter[]> {
  const q = `[out:json][timeout:20];(node(around:${radiusM},${lat},${lng})[amenity~"^(school|hospital|community_centre)$"];way(around:${radiusM},${lat},${lng})[amenity~"^(school|hospital|community_centre)$"];);out center 30;`;
  try {
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: "data=" + encodeURIComponent(q),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const j = await res.json();
    const elements: OverpassElement[] = j.elements ?? [];
    const out: Shelter[] = [];
    for (const el of elements) {
      const c = el.center ?? el;
      if (typeof c.lat !== "number" || typeof c.lon !== "number") continue;
      out.push({
        name: el.tags?.name ?? el.tags?.amenity ?? "unnamed",
        kind: el.tags?.amenity ?? "unknown",
        lat: c.lat,
        lng: c.lon,
        distanceM: Math.round(haversine(lat, lng, c.lat, c.lon)),
      });
    }
    return out.sort((a, b) => a.distanceM - b.distanceM).slice(0, 8);
  } catch {
    return [];
  }
}

function haversine(a: number, b: number, c: number, d: number) {
  const R = 6371000;
  const p = Math.PI / 180;
  const dLat = (c - a) * p;
  const dLng = (d - b) * p;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a * p) * Math.cos(c * p) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const round = (n: number) => Math.round(n * 10) / 10;
