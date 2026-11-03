import { DISTRICT_REGIONS } from "./kb/districts";

/**
 * Who an alert for a place is actually for.
 *
 * This existed as `place LIKE '%region%'` and it did not work. Staging an alert
 * for "Himachal Pradesh" matched nobody at all, because everyone registers
 * where they live — Kangra, Shimla, Mandi — and none of those strings contain
 * "himachal pradesh". The alert authorised correctly, staged correctly,
 * recorded correctly, and reached zero people. Silent, and the worst possible
 * failure for the one feature the product exists to deliver.
 *
 * Now that every district carries its state, a region resolves to the set of
 * place names that belong to it: name a state and it reaches all its districts,
 * name a district and it reaches that district and anyone who wrote the state.
 */

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

/** State id → its own name plus every district in it. */
const STATE_MEMBERS = new Map<string, string[]>();
for (const d of DISTRICT_REGIONS) {
  const key = norm(d.stateName);
  if (!STATE_MEMBERS.has(key)) STATE_MEMBERS.set(key, [d.stateName]);
  STATE_MEMBERS.get(key)!.push(d.name);
}

export interface Audience {
  /** Place strings to match a user's registered place against. */
  places: string[];
  /** How the region was understood — surfaced so a coordinator can see it. */
  scope: "state" | "district" | "literal";
  /** Canonical name of what was matched. */
  resolved: string;
}

/**
 * Expand a region into the places whose residents it covers.
 *
 * Falls back to the literal string rather than returning nothing: a coordinator
 * may name a town or a river basin we have no district record for, and matching
 * that text is still better than matching nothing. The scope says which
 * happened, so "literal" can be shown as the weaker case it is.
 */
export function audienceFor(region: string): Audience {
  const key = norm(region);
  if (!key) return { places: [], scope: "literal", resolved: region };

  const asState = STATE_MEMBERS.get(key);
  if (asState) {
    return { places: asState, scope: "state", resolved: asState[0] };
  }

  const district = DISTRICT_REGIONS.find((d) => norm(d.name) === key);
  if (district) {
    // Someone in Kangra may have registered as "Kangra" or as "Himachal
    // Pradesh"; a district alert should reach both.
    return {
      places: [district.name, district.stateName],
      scope: "district",
      resolved: `${district.name}, ${district.stateName}`,
    };
  }

  return { places: [region], scope: "literal", resolved: region };
}

/**
 * SQL fragment matching a user's place against an audience.
 *
 * Substring in both directions on purpose. People write "Shimla, Himachal
 * Pradesh" as freely as "Shimla", so an exact match loses them, and a one-way
 * LIKE loses the other half.
 */
export function placeMatchSql(audience: Audience): { sql: string; args: string[] } {
  if (!audience.places.length) return { sql: "0", args: [] };
  // Gated on the place existing: the reverse-direction LIKE against an empty
  // place is '%%', which is true of every string — so a user who never
  // registered a place would have received every regional alert in the country.
  const clauses = audience.places
    .map(() => "(length(COALESCE(place,'')) > 0 AND (lower(place) LIKE ? OR ? LIKE '%' || lower(place) || '%'))")
    .join(" OR ");
  const args = audience.places.flatMap((p) => [`%${p.toLowerCase()}%`, p.toLowerCase()]);
  return { sql: `(${clauses})`, args };
}
