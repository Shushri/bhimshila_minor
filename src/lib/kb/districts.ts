import profiles from "@/data/district-profiles.json";
import { STATES, type Region } from "@/data/regions";

/**
 * Every district in India, as a Region the rest of the app already understands.
 *
 * Before this, the knowledge base held 36 states and 12 Himachal districts —
 * the leftovers of a Kangra pilot. "Tell me about Kangra" returned a full
 * profile; "tell me about Palakkad" returned nothing at all, while Palakkad sat
 * inside a live Kerala red alert.
 *
 * Built by scripts/build-district-profiles.mjs from the Census 2011 district
 * tables. See that file for how post-2011 districts are handled and what the
 * figures can and cannot be trusted for.
 */

interface RawProfile {
  d: string;
  s: string;
  lat: number;
  lng: number;
  areaKm2: number | null;
  population: number;
  households?: number;
  density: number | null;
  ruralPct?: number | null;
  fragileHousingPct?: number | null;
  phoneReachPct?: number | null;
  elderlyPct?: number | null;
  lowIncomePct?: number | null;
  /** True when the district post-dates the census and the figure is derived. */
  estimated?: boolean;
  note?: string;
  population2026?: number;
  growthFactor?: number;
  growthSource?: "state" | "national";
}

/**
 * What a responder should know about a place beyond its headcount.
 *
 * Chosen because each one changes what you do. Fragile housing says who loses a
 * roof first; phone reach says whether an alert can even land; rural share says
 * how long a team takes to arrive.
 */
export interface Vulnerability {
  households: number | null;
  ruralPct: number | null;
  fragileHousingPct: number | null;
  phoneReachPct: number | null;
  elderlyPct: number | null;
  lowIncomePct: number | null;
}

export interface DistrictRegion extends Region {
  level: "district";
  /**
   * The 2011 base grown at the state's official projected rate.
   *
   * Census 2011 is the most recent completed census — 2021 was postponed to
   * 2027 — so this is what "how many people live here now" honestly resolves
   * to. Always presented as a projection alongside the census figure, never
   * instead of it.
   */
  population2026?: number;
  growthFactor?: number;
  /** "national" when the report does not project this state separately. */
  growthSource?: "state" | "national";
  /** The state's display name. parentId is an id like "mh" and reads badly. */
  stateName: string;
  vulnerability: Vulnerability;
  /** Set when the population is derived rather than counted. */
  populationEstimated?: boolean;
  populationNote?: string;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const STATE_ID_BY_NAME = new Map(STATES.map((s) => [norm(s.name), s.id]));

/** Hazards are carried down from the parent state — the only source we have. */
const STATE_HAZARDS = new Map(STATES.map((s) => [norm(s.name), s.hazards ?? []]));

export const DISTRICT_REGIONS: DistrictRegion[] = (profiles as RawProfile[]).map((p) => ({
  id: `d-${slug(p.s)}-${slug(p.d)}`,
  name: p.d,
  level: "district" as const,
  stateName: p.s,
  parentId: STATE_ID_BY_NAME.get(norm(p.s)),
  center: [p.lat, p.lng] as [number, number],
  areaKm2: p.areaKm2 ?? 0,
  population: p.population,
  density: p.density ?? 0,
  hazards: STATE_HAZARDS.get(norm(p.s)),
  source: p.estimated
    ? "Derived from Census of India 2011 state totals"
    : "Census of India 2011",
  asOf: "2011",
  populationEstimated: p.estimated || undefined,
  populationNote: p.note,
  population2026: p.population2026,
  growthFactor: p.growthFactor,
  growthSource: p.growthSource,
  vulnerability: {
    households: p.households ?? null,
    ruralPct: p.ruralPct ?? null,
    fragileHousingPct: p.fragileHousingPct ?? null,
    phoneReachPct: p.phoneReachPct ?? null,
    elderlyPct: p.elderlyPct ?? null,
    lowIncomePct: p.lowIncomePct ?? null,
  },
}));

const BY_NAME = new Map<string, DistrictRegion[]>();
for (const d of DISTRICT_REGIONS) {
  const k = norm(d.name);
  if (!BY_NAME.has(k)) BY_NAME.set(k, []);
  BY_NAME.get(k)!.push(d);
}

/**
 * Resolve a district by name, optionally disambiguated by state.
 *
 * Names repeat across India — there are several Bilaspurs, Hamirpurs and
 * Aurangabads. Without a state the largest is returned, which is the one a
 * user almost always means, and the caller can say which it picked.
 */
export function findDistrict(name: string, state?: string): DistrictRegion | null {
  const matches = BY_NAME.get(norm(name));
  if (!matches?.length) return null;
  if (matches.length === 1) return matches[0];

  if (state) {
    const s = norm(state);
    const inState = matches.find((d) => norm(d.parentId ?? "") === s || norm(d.stateName) === s);
    if (inState) return inState;
  }
  return [...matches].sort((a, b) => b.population - a.population)[0];
}

/** All districts sharing a name — used to warn about ambiguity. */
export function districtsNamed(name: string): DistrictRegion[] {
  return BY_NAME.get(norm(name)) ?? [];
}

export const stateNameOf = (d: DistrictRegion) => d.stateName;

export const districtsOfState = (stateId: string) =>
  DISTRICT_REGIONS.filter((d) => d.parentId === stateId);
