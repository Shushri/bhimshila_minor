import { STATES, DISTRICTS, LOCALITIES, ALL_REGIONS, type Region, type Locality } from "@/data/regions";
import { DISTRICT_REGIONS, findDistrict } from "./districts";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Everything the agent can name, curated first.
 *
 * The 36 states and 12 Himachal districts in data/regions.ts are hand-checked
 * and carry hazard classes and localities, so they win a name collision. The
 * other ~700 districts come from the census build and fill in the rest of the
 * country — which is most of it.
 */
const curatedNames = new Set(ALL_REGIONS.map((r) => norm(r.name)));
const SEARCHABLE: Region[] = [
  ...ALL_REGIONS,
  ...DISTRICT_REGIONS.filter((d) => !curatedNames.has(norm(d.name))),
];

/**
 * Resolve a spoken or typed name to a Region.
 *
 * Voice input is messy, so this is lenient — but it used to be lenient in the
 * wrong direction and the results were quietly, badly wrong:
 *
 *   "Dharamshala"      → Dhar, Madhya Pradesh   (q.startsWith("dhar"))
 *   "Global Warming"   → Alwar                  ("globalwarming".includes("alwar"))
 *   "Monsoon Patterns" → Mon, Nagaland
 *
 * The first is the worst: Dharamshala is this project's own anchor example and
 * it resolved to a district 1,200km away in another state, so every figure that
 * followed was about the wrong place while looking entirely plausible.
 *
 * Two rules fix the class rather than the cases:
 *
 *   Localities resolve BEFORE any fuzzy pass. Dharamshala is a known town in
 *   Kangra; the old order let a substring match answer first.
 *
 *   Only one direction of prefix matching survives — the region name may start
 *   with the query ("Kang" → Kangra), because that is someone typing a prefix.
 *   The reverse is a longer word that merely begins with a shorter place name,
 *   which is almost always a different word entirely. Free-floating `includes`
 *   is gone in both directions; it is what turned a climate question into a
 *   district in Rajasthan.
 */
const MIN_FUZZY = 4;

/**
 * Cities whose name is not their district's.
 *
 * Most of India's big cities share a name with the district around them, so
 * they resolve for free. These do not, and they are exactly the names a person
 * types — nobody in Guwahati says "Kamrup Metropolitan", and nobody asks about
 * "Ernakulam" when they mean Kochi. Left out, a citizen naming their own city
 * got nothing back.
 *
 * Old names are here too. Bangalore and Bengaluru are the same place and both
 * are still said; whichever the census used is the one the district set has.
 */
const CITY_TO_DISTRICT: Record<string, string> = {
  guwahati: "Kamrup Metropolitan",
  bangalore: "Bengaluru Urban",
  bengaluru: "Bengaluru Urban",
  kochi: "Ernakulam",
  cochin: "Ernakulam",
  vizag: "Visakhapatnam",
  trivandrum: "Thiruvananthapuram",
  calicut: "Kozhikode",
  mysore: "Mysuru",
  pondicherry: "Puducherry",
  gurgaon: "Gurugram",
  noida: "Gautam Buddha Nagar",
  navimumbai: "Thane",
  secunderabad: "Hyderabad",
  panaji: "North Goa",
  gangtok: "East Sikkim",
  itanagar: "Papum Pare",
  shillong: "East Khasi Hills",
  imphal: "Imphal West",
  aizawl: "Aizawl",
  kohima: "Kohima",
  agartala: "West Tripura",
};

export function findRegion(query: string): Region | null {
  const q = norm(query);
  if (!q) return null;

  const exactName = SEARCHABLE.find((r) => norm(r.name) === q);
  if (exactName) return exactName;

  // Exact district match before any fuzzy pass — a partial match against a
  // curated name must not beat an exact match on a real district.
  const exact = findDistrict(query);
  if (exact) return exact;

  // A named town resolves to its district before anything fuzzy is tried.
  const loc = findLocality(query);
  if (loc) return DISTRICTS.find((d) => d.id === loc.districtId) ?? null;

  // A major city whose name differs from its district.
  const aliased = CITY_TO_DISTRICT[q];
  if (aliased) {
    const hit = SEARCHABLE.find((r) => norm(r.name) === norm(aliased));
    if (hit) return hit;
  }

  // Someone typing or saying a prefix. Short queries are excluded because at
  // three characters almost everything is a prefix of something.
  if (q.length >= MIN_FUZZY) {
    const prefix = SEARCHABLE.find((r) => norm(r.name).startsWith(q));
    if (prefix) return prefix;
  }

  return null;
}

/**
 * A named town or village.
 *
 * The substring pass is kept here — unlike in findRegion — because this set is
 * small and hand-curated, so "Khaniyara village" reaching Khaniyara is a win
 * rather than a coincidence. It gets the same length floor though: without one,
 * findLocality("a") returned Khaniyara, because every name contains an "a".
 */
export function findLocality(query: string): Locality | null {
  const q = norm(query);
  if (!q) return null;

  const exact = LOCALITIES.find((l) => norm(l.name) === q);
  if (exact) return exact;

  if (q.length < MIN_FUZZY) return null;
  return LOCALITIES.find((l) => norm(l.name).includes(q) || q.includes(norm(l.name))) ?? null;
}

export function getRegion(id: string): Region | null {
  return ALL_REGIONS.find((r) => r.id === id) ?? null;
}

export function childrenOf(parentId: string): Region[] {
  return DISTRICTS.filter((d) => d.parentId === parentId);
}

export function localitiesOf(districtId: string): Locality[] {
  return LOCALITIES.filter((l) => l.districtId === districtId);
}

export type Metric = "density" | "population" | "area" | "literacy";

const metricOf = (r: Region, m: Metric): number => {
  switch (m) {
    case "density": return r.density;
    case "population": return r.population;
    case "area": return r.areaKm2;
    case "literacy": return r.literacyPct ?? 0;
  }
};

export const metricLabel: Record<Metric, string> = {
  density: "Persons per km²",
  population: "Population",
  area: "Area (km²)",
  literacy: "Literacy (%)",
};

/**
 * Rank regions by a metric. `scope` is a state id (ranks its districts),
 * "india" (ranks states), or a state name.
 */
export function rankRegions(
  metric: Metric,
  scope = "india",
  limit = 10,
): { regions: Region[]; level: "state" | "district"; scopeName: string } {
  if (scope === "india" || norm(scope) === "india") {
    const sorted = [...STATES].sort((a, b) => metricOf(b, metric) - metricOf(a, metric));
    return { regions: sorted.slice(0, limit), level: "state", scopeName: "India" };
  }

  const parent = findRegion(scope);
  if (parent) {
    const kids = childrenOf(parent.id);
    if (kids.length) {
      const sorted = [...kids].sort((a, b) => metricOf(b, metric) - metricOf(a, metric));
      return { regions: sorted.slice(0, limit), level: "district", scopeName: parent.name };
    }
  }

  const sorted = [...STATES].sort((a, b) => metricOf(b, metric) - metricOf(a, metric));
  return { regions: sorted.slice(0, limit), level: "state", scopeName: "India" };
}

export { STATES, DISTRICTS, LOCALITIES, ALL_REGIONS, metricOf };
export type { Region, Locality };
