/**
 * NDMA Sachet — India's official disaster alert feed.
 *
 * Every other source in this app is inferred: Open-Meteo gives us rainfall and
 * we score it, news gives us reports and we weigh them. Sachet is different.
 * These are warnings a State Disaster Management Authority, the IMD or the
 * Central Water Commission has actually *issued*, under the Common Alerting
 * Protocol. When Sachet says orange for Dehradun, that is not a guess we have
 * to defend — it is the government's own position, and we cite it.
 *
 * That makes it the strongest corroboration verify_signal can get, and it is
 * why an official alert short-circuits our own confidence ladder.
 *
 * What it does NOT do is cover everywhere. An SDMA issues an alert when it has
 * decided to; the gaps between those decisions are exactly where our continuous
 * scoring earns its place. The two are complements, not substitutes — see
 * `crossCheck()` for how disagreement is reported rather than hidden.
 *
 * "Subscribe" is aspirational: CAP over HTTP is poll-based, there is no push.
 * We poll on the cache interval below and dedupe on `identifier`.
 */

const BASE = "https://sachet.ndma.gov.in/cap_public_website";

/**
 * Five minutes. Nowcast alerts run on a three-hour window and the feed is
 * ~90KB, so polling harder buys nothing and hammers a government host that
 * takes 19s to answer when it is unhappy.
 */
const REVALIDATE_SECONDS = 300;

/** Slow origin — an unresponsive government host must not hang the agent. */
const TIMEOUT_MS = 12_000;

export type AlertColour = "red" | "orange" | "yellow" | "green";

export interface OfficialAlert {
  /** CAP identifier — stable, used to dedupe across polls. */
  id: string;
  disasterType: string;
  /** IMD colour convention: red act, orange be prepared, yellow be aware. */
  colour: AlertColour;
  /** The issuing authority. Named, because provenance is the whole point. */
  source: string;
  areaDescription: string;
  /** Warning text as written by the issuer, in `language`. Never translated. */
  message: string;
  /** ISO 639-1 of `message` — the feed carries hi, te, or, ml, mr, kn and en. */
  language: string;
  lat: number;
  lng: number;
  areaKm2: number | null;
  startsAt: string | null;
  endsAt: string | null;
}

interface RawAlert {
  identifier?: string;
  disaster_type?: string;
  severity_color?: string;
  severity?: string;
  alert_source?: string;
  area_description?: string;
  warning_message?: string;
  actual_lang?: string;
  centroid?: string;
  area_covered?: string | number;
  effective_start_time?: string;
  effective_end_time?: string;
}

const COLOUR_RANK: Record<AlertColour, number> = { red: 3, orange: 2, yellow: 1, green: 0 };

/** Sort key: severest first, then largest affected area. */
export const bySeverity = (a: OfficialAlert, b: OfficialAlert) =>
  COLOUR_RANK[b.colour] - COLOUR_RANK[a.colour] || (b.areaKm2 ?? 0) - (a.areaKm2 ?? 0);

/**
 * Parse "79.214,13.949".
 *
 * The feed writes centroids in GeoJSON order — longitude first. Reading it as
 * lat,lng puts every Indian alert in the sea off Somalia, so the India bounding
 * box below is a real assertion, not defensive noise: it rejects a row rather
 * than plot it somewhere absurd. Two of 102 rows fail it on a normal day.
 */
function parseCentroid(s: string | undefined): { lat: number; lng: number } | null {
  const parts = (s ?? "").split(",").map((x) => Number(x.trim()));
  if (parts.length !== 2 || parts.some(Number.isNaN)) return null;
  const [lng, lat] = parts;
  if (lat < 6 || lat > 38 || lng < 67 || lng > 98) return null;
  return { lat, lng };
}

/**
 * "Tue Aug 04 17:30:00 IST 2026" → ISO.
 *
 * Date.parse does not understand "IST" — it reads it as Israel Standard Time in
 * some runtimes and returns NaN in others. So the offset is applied explicitly.
 */
function parseIstDate(s: string | undefined): string | null {
  if (!s) return null;
  const m = /^\w{3} (\w{3}) (\d{2}) (\d{2}):(\d{2}):(\d{2}) IST (\d{4})$/.exec(s.trim());
  if (!m) {
    const fallback = Date.parse(s);
    return Number.isNaN(fallback) ? null : new Date(fallback).toISOString();
  }
  const months = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
  const month = months.indexOf(m[1]);
  if (month < 0) return null;
  // IST is UTC+5:30 — build the UTC instant directly.
  const utc = Date.UTC(Number(m[6]), month, Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]));
  return new Date(utc - 5.5 * 3600 * 1000).toISOString();
}

function normaliseColour(raw: string | undefined): AlertColour {
  const c = (raw ?? "").toLowerCase();
  if (c === "red" || c === "orange" || c === "yellow" || c === "green") return c;
  return "yellow";
}

function normalise(r: RawAlert): OfficialAlert | null {
  const point = parseCentroid(r.centroid);
  if (!point) return null;

  const area = Number(r.area_covered);
  return {
    id: String(r.identifier ?? `${r.centroid}-${r.effective_start_time}`),
    disasterType: (r.disaster_type ?? "Alert").trim(),
    colour: normaliseColour(r.severity_color),
    source: (r.alert_source ?? "NDMA Sachet").trim(),
    areaDescription: (r.area_description ?? "").trim(),
    message: (r.warning_message ?? "").trim(),
    language: (r.actual_lang ?? "en").trim(),
    lat: point.lat,
    lng: point.lng,
    areaKm2: Number.isFinite(area) && area > 0 ? area : null,
    startsAt: parseIstDate(r.effective_start_time),
    endsAt: parseIstDate(r.effective_end_time),
  };
}

/**
 * Every live official alert across India.
 *
 * Returns [] rather than throwing. A government feed being down is a normal
 * Tuesday, and it must degrade the answer, not break the agent — the caller
 * checks for emptiness and says so out loud.
 */
export async function fetchOfficialAlerts(): Promise<OfficialAlert[]> {
  try {
    const res = await fetch(`${BASE}/FetchAllAlertDetails`, {
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; BhimShila/1.0)" },
      next: { revalidate: REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return [];

    const raw: unknown = await res.json();
    if (!Array.isArray(raw)) return [];

    const now = Date.now();
    return (raw as RawAlert[])
      .map(normalise)
      .filter((a): a is OfficialAlert => a !== null)
      // Expired alerts stay in the feed. Broadcasting one as current would be
      // the same class of lie as claiming an SMS was delivered.
      .filter((a) => !a.endsAt || Date.parse(a.endsAt) > now)
      .sort(bySeverity);
  } catch {
    return [];
  }
}

const EARTH_KM = 6371;
const rad = (d: number) => (d * Math.PI) / 180;

export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}

/**
 * Alerts whose centroid is near a point.
 *
 * A centroid is not a footprint: "49 districts of Madhya Pradesh" collapses to
 * one dot, so a fixed radius would miss places well inside the warned area. The
 * radius therefore grows with the alert's own stated `area_covered` — treating
 * it as a disc — with the passed radius as the floor.
 */
export function alertsNear(
  alerts: OfficialAlert[],
  lat: number,
  lng: number,
  radiusKm = 60,
): OfficialAlert[] {
  return alerts
    .filter((a) => {
      const footprintKm = a.areaKm2 ? Math.sqrt(a.areaKm2 / Math.PI) : 0;
      return distanceKm(lat, lng, a.lat, a.lng) <= Math.max(radiusKm, footprintKm);
    })
    .sort(bySeverity);
}

/** Alerts whose area description mentions a place by name. */
export function alertsMentioning(alerts: OfficialAlert[], place: string): OfficialAlert[] {
  const needle = place.toLowerCase().trim();
  if (needle.length < 3) return [];
  return alerts
    .filter(
      (a) =>
        a.areaDescription.toLowerCase().includes(needle) ||
        a.message.toLowerCase().includes(needle),
    )
    .sort(bySeverity);
}

/**
 * Collapse the feed's free-text `disaster_type` into a hazard family.
 *
 * The feed writes 30-odd variants ("Moderate Thunderstorms with surface wind",
 * "Extremely Heavy Rain"), which is too many to give distinct map glyphs. These
 * families are what a responder actually acts on differently, and the glyph is
 * what keeps severity legible without relying on colour alone.
 */
export function hazardKind(disasterType: string): string {
  const t = disasterType.toLowerCase();
  if (t.includes("flash flood")) return "flashflood";
  if (t.includes("flood")) return "flood";
  if (t.includes("cyclone")) return "cyclone";
  if (t.includes("lightning") || t.includes("thunder")) return "storm";
  if (t.includes("squall") || t.includes("wind") || t.includes("gale")) return "wind";
  if (t.includes("landslide") || t.includes("landslip")) return "landslide";
  if (t.includes("heat") || t.includes("warm")) return "heat";
  if (t.includes("cold") || t.includes("snow") || t.includes("frost")) return "cold";
  if (t.includes("rain") || t.includes("shower")) return "rain";
  return "alert";
}

// ───────────────────────────────────────── CAP documents (the documented path)

/**
 * NDMA's published integration path, per "CAP XML Feed Integration Guide for
 * Agencies": GET FetchXMLFile?identifier=… returns the full CAP 1.2 document
 * for one alert.
 *
 * The guide makes ETag caching mandatory, not advisory — consumers MUST send
 * If-None-Match after the first request and MUST serve 304s from their own
 * cache. It lists "no rate-limiting issues" as the benefit, which is a polite
 * way of saying you get throttled otherwise. Fetching a dozen of these without
 * ETags is exactly how this integration first got its connections dropped.
 */
interface CachedDocument {
  etag: string | null;
  xml: string;
  at: number;
}

/**
 * Process-lifetime cache, keyed by CAP identifier.
 *
 * Deliberately not Next's fetch cache: the ETag exchange has to reach the
 * origin to learn whether anything changed, and a cache that answers locally
 * would never send If-None-Match at all. Bounded because a long-running server
 * would otherwise accumulate every alert it has ever seen.
 */
const capCache = new Map<string, CachedDocument>();
const CAP_CACHE_MAX = 300;

export interface CapDocument {
  identifier: string;
  sender: string;
  sent: string | null;
  /** Actual | Exercise | System | Test | Draft — only Actual may be acted on. */
  status: string;
  /** Alert | Update | Cancel | Ack | Error — Cancel means it is over. */
  msgType: string;
  event: string;
  /** Immediate | Expected | Future | Past — how soon. */
  urgency: string;
  /** Extreme | Severe | Moderate | Minor | Unknown — CAP's own scale. */
  severity: string;
  /** Observed | Likely | Possible | Unlikely — how sure the issuer is. */
  certainty: string;
  headline: string;
  /** What the issuer tells people to actually do. Official wording. */
  instruction: string;
  areaDesc: string;
  effective: string | null;
  expires: string | null;
  /** Set when this supersedes an earlier alert. */
  references: string;
  /** Whether the response came from our cache via a 304. */
  fromCache: boolean;
}

const capTag = (xml: string, tag: string): string => {
  const m = new RegExp(`<cap:${tag}>([\\s\\S]*?)</cap:${tag}>`).exec(xml);
  return m ? m[1].trim() : "";
};

function parseCap(xml: string, fromCache: boolean): CapDocument | null {
  if (!xml.includes("<cap:alert")) return null;

  // A document may carry several <cap:info> blocks, one per language. The first
  // is the issuer's primary; the alert-level fields are shared across all.
  const info = /<cap:info>([\s\S]*?)<\/cap:info>/.exec(xml)?.[1] ?? xml;

  return {
    identifier: capTag(xml, "identifier"),
    sender: capTag(xml, "sender"),
    sent: capTag(xml, "sent") || null,
    status: capTag(xml, "status") || "Unknown",
    msgType: capTag(xml, "msgType") || "Unknown",
    event: capTag(info, "event"),
    urgency: capTag(info, "urgency") || "Unknown",
    severity: capTag(info, "severity") || "Unknown",
    certainty: capTag(info, "certainty") || "Unknown",
    headline: capTag(info, "headline"),
    instruction: capTag(info, "instruction"),
    areaDesc: capTag(info, "areaDesc"),
    effective: capTag(info, "effective") || null,
    expires: capTag(info, "expires") || null,
    references: capTag(xml, "references"),
    fromCache,
  };
}

/**
 * Fetch one alert's full CAP document, honouring the mandated ETag protocol.
 *
 * Returns null rather than throwing — a government host that times out is a
 * normal Tuesday, and the caller already has the summary from the JSON feed.
 */
export async function fetchCapDocument(identifier: string): Promise<CapDocument | null> {
  const cached = capCache.get(identifier);

  try {
    const res = await fetch(`${BASE}/FetchXMLFile?identifier=${encodeURIComponent(identifier)}`, {
      headers: {
        Accept: "application/xml",
        "User-Agent": "Mozilla/5.0 (compatible; BhimShila/1.0)",
        // Mandatory per the integration guide, once we hold an ETag.
        ...(cached?.etag ? { "If-None-Match": cached.etag } : {}),
      },
      // Our own ETag exchange is the cache; Next's would answer without ever
      // asking the origin, so If-None-Match would never be sent.
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    // 304: nothing changed. The guide is explicit — do not re-request, use what
    // we already hold.
    if (res.status === 304 && cached) return parseCap(cached.xml, true);
    if (!res.ok) return cached ? parseCap(cached.xml, true) : null;

    const xml = await res.text();
    if (capCache.size >= CAP_CACHE_MAX) capCache.delete(capCache.keys().next().value!);
    capCache.set(identifier, { etag: res.headers.get("etag"), xml, at: Date.now() });
    return parseCap(xml, false);
  } catch {
    return cached ? parseCap(cached.xml, true) : null;
  }
}

/**
 * Whether an alert may be acted on.
 *
 * The summary feed carries no `status` or `msgType`, so nothing there
 * distinguishes a live warning from a drill or from one that has been
 * withdrawn. Broadcasting an Exercise as real, or a Cancel as current, is the
 * same class of failure as claiming an SMS was delivered — so the check runs
 * against the CAP document before we act, not after.
 */
export function actionable(doc: CapDocument): { ok: boolean; reason: string } {
  if (doc.status !== "Actual") {
    return { ok: false, reason: `This is a ${doc.status} message, not a live alert. Do not broadcast it.` };
  }
  if (doc.msgType === "Cancel") {
    return { ok: false, reason: "The issuing authority has cancelled this alert. It is no longer in force." };
  }
  if (doc.expires && Date.parse(doc.expires) < Date.now()) {
    return { ok: false, reason: "This alert has expired." };
  }
  return { ok: true, reason: `${doc.urgency} urgency, ${doc.certainty.toLowerCase()} certainty, issued by ${doc.sender}.` };
}

export const colourMeaning: Record<AlertColour, string> = {
  red: "take action",
  orange: "be prepared",
  yellow: "be aware",
  green: "no warning",
};

/**
 * Reconcile our own risk score against the official position.
 *
 * The honest cases are the asymmetric ones. Official-but-quiet-model means the
 * issuer has radar and river gauges we do not — we defer, always. Model-loud-
 * but-no-official is the only case where this product adds information rather
 * than repeating it, and it is stated as a lead to check, never as a warning
 * that overrides silence from the authority.
 */
export function crossCheck(
  riskScore: number,
  official: OfficialAlert[],
): { agreement: "confirmed" | "official_only" | "model_only" | "quiet"; note: string } {
  const worst = official[0];
  const modelElevated = riskScore >= 50;

  if (worst && modelElevated) {
    return {
      agreement: "confirmed",
      note: `Our model and ${worst.source} agree — an official ${worst.colour} alert for ${worst.disasterType.toLowerCase()} is live.`,
    };
  }
  if (worst) {
    return {
      agreement: "official_only",
      note: `${worst.source} has a live ${worst.colour} alert here though our rainfall signal is quiet. Go with the official alert — the issuer sees radar and river gauges we do not.`,
    };
  }
  if (modelElevated) {
    return {
      agreement: "model_only",
      note: "Our rainfall signal is elevated but no authority has issued an alert for this area. Treat it as a lead to verify, not as a warning.",
    };
  }
  return { agreement: "quiet", note: "No official alert is live here and our own signal is quiet." };
}
