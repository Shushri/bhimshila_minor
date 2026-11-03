import { db, dbReady } from "./db";
import { fetchOfficialAlerts, type OfficialAlert, type AlertColour } from "./kb/sachet";
import { exposureFor } from "./kb/exposure";

/**
 * The monitoring loop.
 *
 * Caching a feed for five minutes is not monitoring — it only means the answer
 * is fresh *when someone asks*. Between questions nothing was watching, and a
 * red alert going out over Kerala at 3am would have sat unnoticed until the
 * next person opened the app. This closes that: a sweep runs on a schedule,
 * compares against what has already been seen, and surfaces only the change.
 *
 * What it deliberately does NOT do is broadcast. The rule everywhere else in
 * this app is that nothing outward-facing fires without a human confirming it,
 * and an automated watcher is exactly the component that would be tempting to
 * wire straight to a send. It raises things into the coordinator's queue; a
 * person still decides.
 */

const RANK: Record<AlertColour, number> = { red: 3, orange: 2, yellow: 1, green: 0 };

export interface AlertChange {
  alert: OfficialAlert;
  /** People under it — what decides which change to look at first. */
  people: number;
  /** `new` — never seen before. `escalated` — same alert, higher colour. */
  change: "new" | "escalated";
  /** Only set for an escalation. */
  previousColour?: AlertColour;
}

export interface SweepResult {
  checked: number;
  changes: AlertChange[];
  /** Feed unreachable — distinct from "nothing new", and reported as such. */
  sourceReachable: boolean;
  at: string;
}

/**
 * Poll NDMA, diff against what we already knew, record the result.
 *
 * Idempotent: running it twice in a row yields no changes the second time.
 * That matters because the schedule can double-fire, and an operator who sees
 * the same red alert raised twice stops trusting the queue.
 */
export async function sweep(): Promise<SweepResult> {
  await dbReady();
  const at = new Date().toISOString();
  const alerts = await fetchOfficialAlerts();

  // An empty result is ambiguous — no alerts nationwide, or NDMA down. Treating
  // an outage as "all clear" is the one reading that gets someone hurt, so it
  // is reported rather than smoothed over.
  if (!alerts.length) {
    return { checked: 0, changes: [], sourceReachable: false, at };
  }

  const known = await db().execute("SELECT cap_id, colour FROM seen_alerts");
  const previous = new Map(known.rows.map((r) => [String(r.cap_id), String(r.colour) as AlertColour]));

  const changes: AlertChange[] = [];
  for (const a of alerts) {
    const before = previous.get(a.id);
    if (before === undefined) {
      changes.push({ alert: a, change: "new", people: exposureFor(a).people });
    } else if (RANK[a.colour] > RANK[before]) {
      changes.push({
        alert: a,
        change: "escalated",
        previousColour: before,
        people: exposureFor(a).people,
      });
    }
  }

  // Record every alert seen this sweep, not only the changed ones — last_seen_at
  // is what lets a later cleanup tell a still-live alert from a stale row.
  //
  // One batch, not one call per alert. Awaiting each write in a loop is free
  // against a local file and fatal against a hosted database: eighty alerts
  // became eighty sequential round trips to Mumbai, and the sweep took 10.3s
  // on Vercel — over the Hobby ceiling, so the endpoint the monitoring cron
  // calls every ten minutes returned 504 and monitoring was simply off.
  await db().batch(
    alerts.map((a) => ({
      sql: `INSERT INTO seen_alerts (cap_id, colour, disaster_type, area, source, lat, lng, people)
            VALUES (?,?,?,?,?,?,?,?)
            ON CONFLICT(cap_id) DO UPDATE SET
              colour = excluded.colour,
              people = excluded.people,
              last_seen_at = datetime('now')`,
      args: [
        a.id, a.colour, a.disasterType, a.areaDescription, a.source, a.lat, a.lng,
        exposureFor(a).people,
      ],
    })),
    "write",
  );

  // Severest first, then by how many people are under it — the same order the
  // coordinator's queue uses.
  changes.sort((x, y) => RANK[y.alert.colour] - RANK[x.alert.colour] || y.people - x.people);

  return { checked: alerts.length, changes, sourceReachable: true, at };
}

export interface QueuedAlert {
  capId: string;
  colour: AlertColour;
  disasterType: string;
  area: string;
  source: string;
  lat: number | null;
  lng: number | null;
  firstSeenAt: string;
  people: number;
}

/**
 * Unacknowledged alerts, severest first.
 *
 * Yellow is excluded by default. There are typically fifty live at once and
 * they mean "be aware" — putting them in an action queue buries the six that
 * mean "act" and trains people to dismiss the whole thing unread.
 */
export async function queue(minColour: AlertColour = "orange"): Promise<QueuedAlert[]> {
  await dbReady();
  const allowed = (Object.keys(RANK) as AlertColour[]).filter((c) => RANK[c] >= RANK[minColour]);
  const rows = await db().execute({
    sql: `SELECT cap_id, colour, disaster_type, area, source, lat, lng, people, first_seen_at
          FROM seen_alerts
          WHERE acknowledged_at IS NULL AND colour IN (${allowed.map(() => "?").join(",")})
          ORDER BY first_seen_at DESC`,
    args: allowed,
  });

  return rows.rows
    .map((r) => ({
      capId: String(r.cap_id),
      colour: String(r.colour) as AlertColour,
      disasterType: String(r.disaster_type),
      area: String(r.area),
      source: String(r.source),
      lat: r.lat === null ? null : Number(r.lat),
      lng: r.lng === null ? null : Number(r.lng),
      firstSeenAt: String(r.first_seen_at),
      people: Number(r.people ?? 0),
    }))
    // Severest first, then by how many people are under it. Recency only breaks
    // a tie between two alerts of equal severity over equal populations.
    .sort(
      (a, b) =>
        RANK[b.colour] - RANK[a.colour] ||
        b.people - a.people ||
        b.firstSeenAt.localeCompare(a.firstSeenAt),
    );
}

/** Mark alerts as seen by a human, so the queue drains. */
export async function acknowledge(capIds: string[]): Promise<number> {
  if (!capIds.length) return 0;
  await dbReady();
  const r = await db().execute({
    sql: `UPDATE seen_alerts SET acknowledged_at = datetime('now')
          WHERE acknowledged_at IS NULL AND cap_id IN (${capIds.map(() => "?").join(",")})`,
    args: capIds,
  });
  return r.rowsAffected ?? 0;
}
