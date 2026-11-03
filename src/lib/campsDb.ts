import { db, dbReady } from "./db";
import { rankCamps, type CampRow, type NeedItem, type Urgency, type Stock } from "./camps";
import { computeReach, findOverlaps, type RelayRow, type Deployment } from "./reach";

/**
 * The database half of camps, relays and coverage.
 *
 * Kept apart from camps.ts and reach.ts on purpose: those two hold the
 * arithmetic that decides which truck leaves next and what a warning actually
 * reached, and that arithmetic is the part worth checking in isolation. A
 * pure module can be tested without a database, a network, or a seeded world,
 * which is why test/camps.mjs and test/reach.mjs run in milliseconds and
 * cannot go green against a stale fixture.
 */

export interface CampList {
  camps: ReturnType<typeof rankCamps>;
  /** What was actually searched — "all" when a place filter matched nothing. */
  scope: "all" | "place";
  /** The place asked for, when one was and it found nothing. */
  unmatched?: string;
}

/**
 * Open camps with unmet needs, worst first.
 *
 * A place filter that matches nothing widens to every open camp rather than
 * returning empty, and says so. This is not a convenience — it is the
 * difference between "no camp needs anything" and "nothing matched the word
 * you used", and those two sentences must never be delivered by the same
 * silence. An agent asked "which camps across India need supplies" passes
 * place="India"; no camp is recorded as being in a place called India, they
 * are in Dhubri and Barpeta, and reporting all-clear because of that would be
 * the same false negative this codebase refuses everywhere else.
 */
export async function listCamps(place?: string): Promise<CampList> {
  await dbReady();

  const wanted = place?.trim();
  const first = await queryCamps(wanted);
  if (first.length || !wanted) return { camps: first, scope: wanted ? "place" : "all" };

  const all = await queryCamps(undefined);
  // Only widen if there is genuinely something to widen to. With no open camps
  // at all, "no camp needs anything" is the true answer, not a filter miss.
  return all.length
    ? { camps: all, scope: "all", unmatched: wanted }
    : { camps: all, scope: "place", unmatched: wanted };
}

async function queryCamps(place?: string) {
  const filter = place
    ? { sql: " WHERE c.status = 'open' AND lower(c.place) LIKE ?", args: [`%${place.toLowerCase()}%`] }
    : { sql: " WHERE c.status = 'open'", args: [] as string[] };

  // One query, not one per camp — the needs come back joined and are grouped
  // in memory. The per-camp version was two round trips per row against a
  // hosted database, which is the same shape that cost the monitoring sweep a
  // 504 before it was batched.
  const r = await db().execute({
    sql: `SELECT c.id, c.name, c.place, c.people, t.name AS team,
                 n.item, n.needed, n.received, n.urgency
          FROM relief_camps c
          LEFT JOIN teams t ON t.id = c.team_id
          LEFT JOIN camp_needs n ON n.camp_id = c.id
          ${filter.sql}
          ORDER BY c.id`,
    args: filter.args,
  });

  const byId = new Map<number, CampRow>();
  for (const row of r.rows) {
    const id = Number(row.id);
    let camp = byId.get(id);
    if (!camp) {
      camp = {
        id,
        name: String(row.name),
        place: String(row.place),
        people: Number(row.people),
        team: row.team === null ? null : String(row.team),
        needs: [],
      };
      byId.set(id, camp);
    }
    // LEFT JOIN gives one row with null need columns for a camp that has none.
    if (row.item !== null) {
      camp.needs.push({
        item: String(row.item) as NeedItem,
        needed: Number(row.needed),
        received: Number(row.received),
        urgency: String(row.urgency) as Urgency,
      });
    }
  }

  return rankCamps([...byId.values()]);
}

/** What every team is currently carrying, for matching against a shortage. */
export async function teamStocks(): Promise<Stock[]> {
  await dbReady();
  const r = await db().execute(
    `SELECT t.name, t.place, r.boats, r.medical_kits, r.food_packets
     FROM teams t JOIN team_resources r ON r.team_id = t.id
     WHERE t.status = 'available'`,
  );
  return r.rows.map((row) => ({
    team: String(row.name),
    place: String(row.place ?? ""),
    boats: Number(row.boats ?? 0),
    medicalKits: Number(row.medical_kits ?? 0),
    foodPackets: Number(row.food_packets ?? 0),
  }));
}

/**
 * Reach for one alert — or the most recent one, which is what someone asking
 * "did that get through" almost always means.
 */
export async function alertReach(alertId?: number) {
  await dbReady();

  const target = alertId
    ? await db().execute({ sql: "SELECT id, region, level, message FROM alerts WHERE id = ?", args: [alertId] })
    : await db().execute("SELECT id, region, level, message FROM alerts ORDER BY id DESC LIMIT 1");

  if (!target.rows.length) return null;
  const alert = target.rows[0];
  const id = Number(alert.id);

  const [delivered, relays] = await Promise.all([
    db().execute({
      sql: "SELECT count(*) AS c FROM alert_deliveries WHERE alert_id = ? AND status = 'delivered'",
      args: [id],
    }),
    db().execute({
      sql: "SELECT households, place, method FROM relays WHERE alert_id = ?",
      args: [id],
    }),
  ]);

  const rows: RelayRow[] = relays.rows.map((r) => ({
    households: Number(r.households),
    place: String(r.place),
    method: String(r.method) as RelayRow["method"],
  }));

  return {
    alert: {
      id,
      region: String(alert.region),
      level: String(alert.level),
      message: String(alert.message),
    },
    reach: computeReach(Number(delivered.rows[0].c), rows),
  };
}

/** Record that a person passed an alert on by hand. */
export async function logRelay(input: {
  alertId: number;
  userId: number;
  households: number;
  place: string;
  method?: RelayRow["method"];
  note?: string;
}) {
  await dbReady();
  const r = await db().execute({
    sql: `INSERT INTO relays (alert_id, user_id, households, place, method, note)
          VALUES (?,?,?,?,?,?) RETURNING id`,
    args: [
      input.alertId,
      input.userId,
      Math.max(1, Math.round(input.households)),
      input.place.trim(),
      input.method ?? "in_person",
      input.note?.trim() || null,
    ],
  });
  return Number(r.rows[0].id);
}

/**
 * Two teams working the same ground.
 *
 * Reads live assignments and their incident coordinates — the overlap is
 * computed from where teams actually are, not where they are registered.
 */
export async function duplicateCoverage() {
  await dbReady();
  const r = await db().execute(
    `SELECT t.name AS team, i.place, i.lat, i.lng
     FROM assignments a
     JOIN teams t ON t.id = a.team_id
     JOIN incidents i ON i.id = a.incident_id
     WHERE a.resolved_at IS NULL AND i.status != 'resolved'`,
  );

  const deployments: Deployment[] = r.rows.map((row) => ({
    team: String(row.team),
    place: String(row.place ?? "unknown"),
    lat: row.lat === null ? null : Number(row.lat),
    lng: row.lng === null ? null : Number(row.lng),
  }));

  return findOverlaps(deployments);
}
