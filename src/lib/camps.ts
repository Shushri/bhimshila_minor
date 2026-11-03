/**
 * Relief camps, and which supply run should leave next.
 *
 * Kerala, August 2018. Every one of the state's 14 districts flooded, more
 * than a million people displaced. What made the response work is on the
 * record: 400 volunteers ran a 24-hour call centre that fielded 25,000 calls
 * in five days, and college students "created a database to assess the needs
 * of each camp, set up in schools across the district, and direct supply
 * trucks accordingly."
 *
 * That database is this file. It was built by students, during the flood,
 * from nothing, because no system held it — and it is the difference between
 * a truck of drinking water going where water is short and going where three
 * trucks already went.
 *
 * The ranking below is deliberately arithmetic and readable, not a model. A
 * camp's claim on the next truck is how many people are waiting, multiplied
 * by how badly, and nothing about that judgement should require trusting a
 * black box — the same rule this codebase applies to risk scoring.
 */

export type NeedItem = "food" | "water" | "medical" | "bedding" | "sanitation" | "boats";
export type Urgency = "normal" | "urgent" | "critical";

/**
 * Urgency as a multiplier, stated in the open so it can be argued with.
 *
 * Critical is 4× rather than 10× on purpose: a critical shortage in a camp of
 * 20 people should not outrank an urgent one in a camp of 2,000. Population is
 * the dominant term, and urgency modulates it.
 */
const URGENCY_WEIGHT: Record<Urgency, number> = {
  normal: 1,
  urgent: 2,
  critical: 4,
};

/**
 * Water and medical outrank bedding.
 *
 * Sphere standards put water and health at the top of the life-safety order,
 * and this reflects that rather than treating every shortage as equal. It is a
 * tiebreak, not the main term.
 */
const ITEM_WEIGHT: Record<NeedItem, number> = {
  water: 1.3,
  medical: 1.3,
  food: 1.2,
  sanitation: 1.1,
  boats: 1.1,
  bedding: 1,
};

export interface NeedRow {
  item: NeedItem;
  needed: number;
  received: number;
  urgency: Urgency;
}

export interface CampRow {
  id: number;
  name: string;
  place: string;
  people: number;
  team: string | null;
  needs: NeedRow[];
}

export interface RankedCamp {
  id: number;
  name: string;
  place: string;
  people: number;
  team: string | null;
  /** Everything still outstanding, worst first. */
  unmet: { item: NeedItem; short: number; urgency: Urgency }[];
  /** The single most pressing shortage, for a one-line summary. */
  worst: { item: NeedItem; short: number; urgency: Urgency } | null;
  /** Ranking score. Readable arithmetic — see weights above. */
  priority: number;
  /** Plain sentence stating why this camp is where it is in the list. */
  why: string;
}

const shortOf = (n: NeedRow) => Math.max(0, n.needed - n.received);

/**
 * Camps that still need something, most pressing first.
 *
 * A camp whose needs are all met drops out entirely rather than ranking last —
 * a supply list should contain only things that need supplying, and a fully
 * stocked camp on the list is a row a driver has to read and dismiss.
 */
export function rankCamps(camps: CampRow[]): RankedCamp[] {
  return camps
    .map((c) => {
      const unmet = c.needs
        .map((n) => ({ item: n.item, short: shortOf(n), urgency: n.urgency }))
        .filter((n) => n.short > 0)
        .sort(
          (a, b) =>
            URGENCY_WEIGHT[b.urgency] * ITEM_WEIGHT[b.item] -
            URGENCY_WEIGHT[a.urgency] * ITEM_WEIGHT[a.item],
        );

      // People waiting is the dominant term; a camp of 800 short of water
      // outranks a camp of 30 short of water at the same urgency.
      const priority = Math.round(
        unmet.reduce(
          (sum, n) => sum + URGENCY_WEIGHT[n.urgency] * ITEM_WEIGHT[n.item] * Math.max(1, c.people),
          0,
        ),
      );

      const worst = unmet[0] ?? null;
      return {
        id: c.id,
        name: c.name,
        place: c.place,
        people: c.people,
        team: c.team,
        unmet,
        worst,
        priority,
        why: explain(c, worst, unmet.length),
      };
    })
    .filter((c) => c.unmet.length > 0)
    .sort((a, b) => b.priority - a.priority);
}

function explain(c: CampRow, worst: RankedCamp["worst"], count: number): string {
  if (!worst) return `${c.name} has everything it asked for.`;
  const others = count > 1 ? `, and ${count - 1} other shortage${count > 2 ? "s" : ""}` : "";
  const who = c.team ? `${c.team} is running it` : "nobody has taken charge of it";
  return `${c.people.toLocaleString("en-IN")} people at ${c.name}, ${c.place} — short ${worst.short.toLocaleString("en-IN")} ${worst.item}${others}. ${who[0].toUpperCase()}${who.slice(1)}.`;
}

/**
 * One sentence for the top of the list, for the spoken path.
 *
 * Says "nothing outstanding" rather than staying silent when every camp is
 * stocked — silence reads as a failed lookup, and this is the one case where
 * the good news and the broken case look identical.
 */
export function campsHeadline(ranked: RankedCamp[]): string {
  if (!ranked.length) return "No camp has an outstanding need right now.";
  const top = ranked[0];
  const people = ranked.reduce((s, c) => s + c.people, 0);
  return `${ranked.length} camp${ranked.length === 1 ? "" : "s"} short of supplies, ${people.toLocaleString("en-IN")} people between them. Worst is ${top.name} in ${top.place} — ${top.worst!.short.toLocaleString("en-IN")} ${top.worst!.item} short for ${top.people.toLocaleString("en-IN")} people.`;
}

/**
 * Which team should run the next delivery.
 *
 * Matches a camp's worst shortage against what teams are actually holding.
 * Returns null rather than a nearest-anything guess when nobody has the item —
 * "no team is carrying medical supplies" is a fact a coordinator can act on;
 * naming a team that cannot help is a wasted phone call.
 */
export interface Stock {
  team: string;
  place: string;
  boats: number;
  medicalKits: number;
  foodPackets: number;
}

const HOLDS: Record<NeedItem, (s: Stock) => number> = {
  boats: (s) => s.boats,
  medical: (s) => s.medicalKits,
  food: (s) => s.foodPackets,
  // Not tracked as stock — a team can still be sent, but nothing is claimed
  // about what they are carrying.
  water: () => 0,
  bedding: () => 0,
  sanitation: () => 0,
};

export function supplierFor(item: NeedItem, stocks: Stock[]): Stock | null {
  const holder = HOLDS[item];
  const able = stocks.filter((s) => holder(s) > 0).sort((a, b) => holder(b) - holder(a));
  return able[0] ?? null;
}
