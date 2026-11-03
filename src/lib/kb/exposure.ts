import { DISTRICT_REGIONS, type DistrictRegion } from "./districts";
import { distanceKm, type OfficialAlert } from "./sachet";

/**
 * How many people are under an official alert.
 *
 * Colour alone cannot rank warnings. A red alert over the Nicobars and a red
 * alert over Kerala are the same colour and three orders of magnitude apart in
 * people affected, and a coordinator with one helicopter has to choose. This
 * turns the alert list into a queue.
 *
 * Two methods, in order of trust:
 *
 *   named      The issuer listed the districts — "Khowai, West Tripura
 *              districts of Tripura". Matching those is exact, and it is what
 *              most SDMA alerts give us.
 *   geometric  Only "5 districts of Rajasthan" and a centroid. The alert's own
 *              `area_covered` becomes a disc, and each district contributes the
 *              share of its area that falls inside.
 *
 * The method is always reported, because they are not equally trustworthy and
 * the difference should be visible rather than averaged away.
 */

export type ExposureMethod = "named" | "geometric" | "unknown";

export interface Exposure {
  /** Best available headcount, projected to 2026. */
  people: number;
  /** The same figure on the 2011 census base, for anyone who wants the source number. */
  people2011: number;
  districts: { name: string; state: string; population: number; share: number }[];
  method: ExposureMethod;
  /** Plain-language note on how this was derived, for the spoken answer. */
  basis: string;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

/** Words that appear in area descriptions but are not places. */
const NOT_A_PLACE = new Set(
  [
    "district", "districts", "mandal", "mandals", "taluk", "taluka", "block", "blocks",
    "and", "of", "the", "nearby", "adjoining", "parts", "some", "few", "isolated",
    "north", "south", "east", "west", "central", "alert", "areas", "area", "region",
    "river", "at", "in", "near", "crossing", "bridge", "town", "city", "village",
  ].map(norm),
);

const DISTRICTS_BY_NAME = new Map<string, DistrictRegion[]>();
for (const d of DISTRICT_REGIONS) {
  const k = norm(d.name);
  if (!DISTRICTS_BY_NAME.has(k)) DISTRICTS_BY_NAME.set(k, []);
  DISTRICTS_BY_NAME.get(k)!.push(d);
}

/**
 * The state an alert belongs to, read off the issuing authority.
 *
 * "Kerala SDMA", "IMD Bhubaneswar", "Assam SDMA" — the issuer names its own
 * jurisdiction, which is what disambiguates the several Bilaspurs and
 * Hamirpurs when a description lists a bare district name.
 */
function issuerState(alert: OfficialAlert): string | null {
  const src = alert.source.toLowerCase();
  for (const d of DISTRICT_REGIONS) {
    const s = d.stateName.toLowerCase();
    if (s.length > 3 && src.includes(s)) return d.stateName;
  }
  // "8 districts of Kerala" — the description names it even when the issuer does not.
  const m = /(?:districts?|mandals?|parts)\s+of\s+([A-Za-z\s]+)/i.exec(alert.areaDescription);
  if (m) {
    const named = m[1].trim();
    const hit = DISTRICT_REGIONS.find((d) => norm(d.stateName) === norm(named));
    if (hit) return hit.stateName;
  }
  return null;
}

/** Districts explicitly listed in the description. */
function namedDistricts(alert: OfficialAlert, state: string | null): DistrictRegion[] {
  const tokens = alert.areaDescription
    .split(/[,;/]|\s+and\s+/i)
    .map((t) => t.replace(/\b(district|districts|mandal|mandals|taluk|block)s?\b/gi, "").trim())
    .filter((t) => t.length >= 4);

  const found = new Map<string, DistrictRegion>();
  for (const raw of tokens) {
    const k = norm(raw);
    if (!k || NOT_A_PLACE.has(k)) continue;
    const matches = DISTRICTS_BY_NAME.get(k);
    if (!matches?.length) continue;

    // Where the issuing authority's jurisdiction is known, a name only counts
    // if it sits inside it — including when there is exactly one match.
    //
    // The single-match case looked safe and was not. The Uttarakhand SDMA
    // warned "Srinagar", and the only Srinagar in our district set is the one
    // in Jammu and Kashmir — so a Uttarakhand warning was credited with the
    // population of a district 600km away in another state's jurisdiction.
    // There is a Srinagar in Uttarakhand; it is a town inside Pauri Garhwal,
    // which is why the district lookup could not see it. An SDMA does not warn
    // outside its own state, so a lone match outside it is the wrong place with
    // the right name, and dropping it loses nothing real.
    const inJurisdiction = state
      ? matches.filter((d) => norm(d.stateName) === norm(state))
      : matches;

    const pick =
      inJurisdiction.length === 1
        ? inJurisdiction[0]
        : inJurisdiction.length > 1
          ? // Several districts of the same name inside one state is not a real
            // case in India; if it ever is, guessing between them is worse than
            // skipping the token and letting the geometric estimate answer.
            null
          : null;
    if (pick) found.set(pick.id, pick);
  }
  return [...found.values()];
}

/**
 * Overlap area of two discs, in km².
 *
 * Both the alert and each district are approximated as discs of equal area to
 * the real shape. It is a coarse model — a long river district is nothing like
 * a circle — but it is honest about being an estimate, needs no polygon
 * intersection, and only ever produces a fraction between 0 and 1.
 */
function discOverlapKm2(r1: number, r2: number, d: number): number {
  if (d >= r1 + r2) return 0;
  if (d <= Math.abs(r1 - r2)) return Math.PI * Math.min(r1, r2) ** 2;

  const a1 = Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1));
  const a2 = Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2));
  return r1 * r1 * (a1 - Math.sin(2 * a1) / 2) + r2 * r2 * (a2 - Math.sin(2 * a2) / 2);
}

const radiusOf = (areaKm2: number) => Math.sqrt(Math.max(areaKm2, 1) / Math.PI);

/** "5 districts of Rajasthan" → 5. The issuer telling us how many. */
function statedDistrictCount(description: string): number | null {
  const m = /(\d+)\s+(?:districts?|mandals?)\b/i.exec(description);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 && n < 100 ? n : null;
}

function geometricExposure(alert: OfficialAlert, state: string | null): Exposure["districts"] {
  const alertRadius = radiusOf(alert.areaKm2 ?? 400);
  const out: Exposure["districts"] = [];

  // A disc centred in Rajasthan with a large stated area sweeps into Gujarat,
  // Haryana and MP, and reported more people than Rajasthan has. Where the
  // issuer's jurisdiction is known, the alert cannot reach outside it — the
  // Rajasthan SDMA does not warn Gujarat.
  const scope = state
    ? DISTRICT_REGIONS.filter((d) => norm(d.stateName) === norm(state))
    : DISTRICT_REGIONS;

  for (const d of scope) {
    if (!d.areaKm2) continue;
    const gap = distanceKm(alert.lat, alert.lng, d.center[0], d.center[1]);
    const dRadius = radiusOf(d.areaKm2);
    if (gap > alertRadius + dRadius) continue;

    const overlap = discOverlapKm2(alertRadius, dRadius, gap);
    const share = Math.min(1, overlap / (Math.PI * dRadius * dRadius));
    if (share < 0.02) continue; // a sliver is noise, not exposure

    out.push({
      name: d.name,
      state: d.stateName,
      population: Math.round((d.population2026 ?? d.population) * share),
      share: Math.round(share * 100) / 100,
    });
  }
  out.sort((a, b) => b.population - a.population);

  // The issuer often says how many districts it covers. Honouring that beats
  // whatever the disc happened to touch.
  const stated = statedDistrictCount(alert.areaDescription);
  return stated ? out.slice(0, stated) : out;
}

/** People under one official alert. */
export function exposureFor(alert: OfficialAlert): Exposure {
  const state = issuerState(alert);
  const named = namedDistricts(alert, state);

  if (named.length) {
    const districts = named.map((d) => ({
      name: d.name,
      state: d.stateName,
      population: d.population2026 ?? d.population,
      share: 1,
    }));
    return {
      people: districts.reduce((a, d) => a + d.population, 0),
      people2011: named.reduce((a, d) => a + d.population, 0),
      districts: districts.sort((a, b) => b.population - a.population),
      method: "named",
      basis:
        `${named.length} district${named.length === 1 ? "" : "s"} named in the alert itself, ` +
        `population projected to 2026 from Census 2011.`,
    };
  }

  const geo = geometricExposure(alert, state);
  if (!geo.length) {
    return {
      people: 0,
      people2011: 0,
      districts: [],
      method: "unknown",
      basis: "The alert names no districts and its area does not overlap any district centre.",
    };
  }

  return {
    people: geo.reduce((a, d) => a + d.population, 0),
    people2011: 0,
    districts: geo,
    method: "geometric",
    basis:
      `The alert names no districts, so its stated area of ${Math.round(alert.areaKm2 ?? 0).toLocaleString("en-IN")} km² ` +
      `was overlaid on ${geo.length} district${geo.length === 1 ? "" : "s"}` +
      (state ? ` within ${state}` : "") +
      `. Approximate — treat as an order of magnitude.`,
  };
}

export interface RankedAlert {
  alert: OfficialAlert;
  exposure: Exposure;
}

const COLOUR_RANK: Record<string, number> = { red: 3, orange: 2, yellow: 1, green: 0 };

/**
 * Rank alerts for a coordinator: severity first, then people within it.
 *
 * People-first was tried and is wrong. IMD's colours are not a scale of
 * interest, they are response categories — red means act, orange means prepare,
 * yellow means be aware. Sorting purely by headcount floated a yellow
 * thunderstorm over 97 million people above every red alert in the country,
 * which inverts the one instruction the issuing authority actually gave.
 *
 * Population decides within a tier, which is where it belongs: among four red
 * alerts and one team, the four million beat the forty thousand.
 *
 * `by: "people"` gives the other order for the question "where is the largest
 * exposure", which is a real question — just not the queue.
 */
export function rankByExposure(
  alerts: OfficialAlert[],
  by: "severity" | "people" = "severity",
): RankedAlert[] {
  const scored = alerts.map((alert) => ({ alert, exposure: exposureFor(alert) }));
  return by === "people"
    ? scored.sort(
        (a, b) =>
          b.exposure.people - a.exposure.people ||
          COLOUR_RANK[b.alert.colour] - COLOUR_RANK[a.alert.colour],
      )
    : scored.sort(
        (a, b) =>
          COLOUR_RANK[b.alert.colour] - COLOUR_RANK[a.alert.colour] ||
          b.exposure.people - a.exposure.people,
      );
}

/** Total distinct people under any alert — districts counted once. */
export function totalExposed(alerts: OfficialAlert[]): { people: number; districts: number } {
  const worst = new Map<string, number>();
  for (const a of alerts) {
    for (const d of exposureFor(a).districts) {
      const key = `${d.name}|${d.state}`;
      // A district under three alerts is one district of people, not three.
      worst.set(key, Math.max(worst.get(key) ?? 0, d.population));
    }
  }
  return {
    people: [...worst.values()].reduce((a, b) => a + b, 0),
    districts: worst.size,
  };
}
