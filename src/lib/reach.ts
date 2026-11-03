/**
 * What an alert actually reached — and the arithmetic behind saying so.
 *
 * This file exists because of one number. A randomised trial across 319
 * panchayats in Bihar compared flood warnings relayed by trained local
 * volunteers against the same warnings pushed to phones alone. The relayed
 * communities were 46.5% more likely to receive the warning *before the water
 * arrived*, and the study's own explanation of why is not technological:
 * "households typically relied on other community members for flood alerts."
 * One in five people surveyed used a smartphone.
 *
 * Every alerting product, including this one until now, reports reach as the
 * number of rows it pushed to. In a place where four in five people are not
 * reachable that way, that number is not coverage — it is the ceiling of what
 * the channel can see, mistaken for the population.
 *
 * So reach here is two numbers that are never added together silently:
 * delivered (ours, verifiable, a row per recipient) and relayed (theirs,
 * reported by the person who did it, in households because that is what a
 * door-knock round can honestly count). The multiplier between them is the
 * only claim this file makes, and it is division.
 *
 * Deliberately pure: no database, no network. The counting rules are the part
 * worth checking, and they are checked in test/reach.mjs.
 */

/** Households → people. India's mean household size, Census 2011. */
export const PEOPLE_PER_HOUSEHOLD = 4.9;

export interface RelayRow {
  households: number;
  place: string;
  method: "in_person" | "phone" | "whatsapp" | "announcement" | "other";
}

export interface Reach {
  /** Recipients we pushed to and recorded a delivery for. Verifiable. */
  delivered: number;
  /** Households a person reported telling. Their count, not ours. */
  relayedHouseholds: number;
  /**
   * Households × 4.9, rounded. An estimate, and labelled one everywhere it
   * surfaces — the alternative is reporting households as if they were people,
   * which understates by a factor of five and would be worse.
   */
  relayedPeopleEstimate: number;
  /** Distinct places a relay was logged from. */
  places: string[];
  /**
   * Total relayed people ÷ delivered. Null when nothing was delivered —
   * dividing by zero to produce "infinite reach" would be a lie in the
   * flattering direction, which is the direction that matters.
   */
  multiplier: number | null;
  /** One plain sentence, ready to speak. Never invents a figure. */
  headline: string;
}

const fmt = (n: number) => n.toLocaleString("en-IN");

export function computeReach(delivered: number, relays: RelayRow[]): Reach {
  const relayedHouseholds = relays.reduce((sum, r) => sum + Math.max(0, r.households), 0);
  const relayedPeopleEstimate = Math.round(relayedHouseholds * PEOPLE_PER_HOUSEHOLD);

  // Sorted so the same set of relays always produces the same sentence — a
  // headline that reorders itself between two reads of the same alert looks
  // like the data changed.
  const places = [...new Set(relays.map((r) => r.place.trim()).filter(Boolean))].sort();

  const multiplier =
    delivered > 0 && relayedPeopleEstimate > 0
      ? Math.round((relayedPeopleEstimate / delivered) * 10) / 10
      : null;

  return {
    delivered,
    relayedHouseholds,
    relayedPeopleEstimate,
    places,
    multiplier,
    headline: headlineFor(delivered, relayedHouseholds, relayedPeopleEstimate, places, multiplier),
  };
}

function headlineFor(
  delivered: number,
  households: number,
  people: number,
  places: string[],
  multiplier: number | null,
): string {
  if (!delivered && !households) {
    // Said plainly rather than as "0 reached", which reads like a delivery
    // failure when the real state is that nothing has been sent yet.
    return "Not sent to anyone yet, and no relays logged.";
  }

  if (!households) {
    return `Delivered to ${fmt(delivered)} registered ${delivered === 1 ? "person" : "people"}. No relays logged — anyone passing this on by hand is currently invisible.`;
  }

  const where =
    places.length === 0
      ? ""
      : places.length === 1
        ? ` from ${places[0]}`
        : ` from ${places.length} places`;

  if (!delivered) {
    return `No registered deliveries, but volunteers relayed it to ${fmt(households)} households${where} — roughly ${fmt(people)} people, estimated.`;
  }

  const times = multiplier ? ` — about ${multiplier}× the registered reach` : "";
  return `Delivered to ${fmt(delivered)} registered, and relayed by hand to ${fmt(households)} households${where}, roughly ${fmt(people)} people${times}.`;
}

/**
 * Two responders sent to the same place.
 *
 * The other half of a coverage failure, and the half nobody looks at. After
 * the Aceh tsunami some children received four measles vaccinations; after
 * Haiti's earthquake "some areas of the country were receiving duplicated
 * services while others had no access". The ops console already answers where
 * nobody is. This answers where two people are doing one job.
 *
 * 15km because that is roughly a relief team's working radius on broken roads
 * — close enough that two teams would see each other, and the overlap is real
 * rather than an artifact of a coarse threshold.
 */
export const OVERLAP_KM = 15;

export interface Deployment {
  team: string;
  place: string;
  lat: number | null;
  lng: number | null;
}

export interface Overlap {
  a: string;
  b: string;
  place: string;
  km: number;
}

/** Haversine, kilometres. Same formula as lib/kb/sachet.ts. */
function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function findOverlaps(deployments: Deployment[], withinKm = OVERLAP_KM): Overlap[] {
  const located = deployments.filter(
    (d): d is Deployment & { lat: number; lng: number } => d.lat !== null && d.lng !== null,
  );

  const out: Overlap[] = [];
  for (let i = 0; i < located.length; i++) {
    for (let j = i + 1; j < located.length; j++) {
      const a = located[i];
      const b = located[j];
      // A team overlapping with itself is one team on two jobs, which is
      // normal and not a duplication of effort.
      if (a.team === b.team) continue;
      const km = distanceKm(a.lat, a.lng, b.lat, b.lng);
      if (km <= withinKm) {
        out.push({ a: a.team, b: b.team, place: a.place, km: Math.round(km * 10) / 10 });
      }
    }
  }
  return out.sort((x, y) => x.km - y.km);
}
