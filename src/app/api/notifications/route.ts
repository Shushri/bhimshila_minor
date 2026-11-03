import { currentUser } from "@/lib/auth";
import { db, dbReady } from "@/lib/db";
import { hazardKind } from "@/lib/kb/sachet";

/**
 * The notification centre — one merged, per-person stream.
 *
 * Four things can concern *you* specifically, and they arrive on four
 * different tables: an alert delivered to you, an official alert matching a
 * place you subscribed to, a decision on a broadcast you requested, and a
 * mission assigned to your org. Reading four screens to learn them is how
 * things get missed at 3am; this returns them as one list, newest first.
 *
 * Subscription matches come from `seen_alerts` — the monitoring loop's own
 * record — so the centre works from what the sweeps have genuinely seen, not
 * from a fetch that may be down right now.
 */

const COLOUR_RANK: Record<string, number> = { yellow: 1, orange: 2, red: 3 };

export interface Notification {
  id: string;
  kind: "delivery" | "watch" | "decision" | "mission";
  title: string;
  body: string;
  at: string;
  severity?: string;
}

export async function GET() {
  await dbReady();
  const user = await currentUser();
  if (!user) return Response.json({ error: "Log in first." }, { status: 401 });

  const items: Notification[] = [];

  // 1 · Alerts that actually reached me.
  const deliveries = await db().execute({
    sql: `SELECT a.id, a.region, a.level, a.message, d.created_at
          FROM alert_deliveries d JOIN alerts a ON a.id = d.alert_id
          WHERE d.user_id = ? ORDER BY d.id DESC LIMIT 20`,
    args: [user.id],
  });
  for (const r of deliveries.rows) {
    items.push({
      id: `delivery:${r.id}:${r.created_at}`,
      kind: "delivery",
      title: `Alert for ${r.region}`,
      body: String(r.message).slice(0, 240) || `${r.level} alert`,
      at: String(r.created_at),
      severity: String(r.level),
    });
  }

  // 2 · Official alerts matching my subscriptions — or, with none set, my
  // registered place. The account's place is the implicit first subscription.
  const subs = await db().execute({
    sql: "SELECT place, hazard, min_colour FROM subscriptions WHERE user_id = ?",
    args: [user.id],
  });
  const watchers: { place: string; hazard: string | null; min: number }[] = subs.rows.map((r) => ({
    place: String(r.place).toLowerCase(),
    hazard: r.hazard === null ? null : String(r.hazard),
    min: COLOUR_RANK[String(r.min_colour)] ?? 1,
  }));
  if (!watchers.length && user.place) {
    watchers.push({ place: user.place.toLowerCase(), hazard: null, min: 1 });
  }
  if (watchers.length) {
    const seen = await db().execute(
      `SELECT cap_id, colour, disaster_type, area, source, last_seen_at
       FROM seen_alerts WHERE last_seen_at > datetime('now','-3 days')
       ORDER BY last_seen_at DESC LIMIT 400`,
    );
    for (const r of seen.rows) {
      const area = String(r.area).toLowerCase();
      const colour = String(r.colour);
      const kind = hazardKind(String(r.disaster_type));
      const hit = watchers.find(
        (w) =>
          (area.includes(w.place) || w.place.includes(area)) &&
          (COLOUR_RANK[colour] ?? 0) >= w.min &&
          (!w.hazard || kind === w.hazard || String(r.disaster_type).toLowerCase().includes(w.hazard)),
      );
      if (!hit) continue;
      items.push({
        id: `watch:${r.cap_id}`,
        kind: "watch",
        title: `${String(r.disaster_type)} — ${String(r.area).slice(0, 80)}`,
        body: `${colour.toUpperCase()} alert issued by ${r.source}. Matched your watch on "${hit.place}".`,
        at: String(r.last_seen_at),
        severity: colour,
      });
      if (items.length > 60) break;
    }
  }

  // 3 · Decisions on broadcasts I requested.
  const decisions = await db().execute({
    sql: `SELECT b.id, b.status, b.decided_at, b.message, u.name AS decider
          FROM broadcast_requests b LEFT JOIN users u ON u.id = b.decided_by
          WHERE b.requested_by = ? AND b.status != 'pending' ORDER BY b.decided_at DESC LIMIT 10`,
    args: [user.id],
  });
  for (const r of decisions.rows) {
    items.push({
      id: `decision:${r.id}`,
      kind: "decision",
      title: `Broadcast request ${r.status}`,
      body:
        r.status === "approved"
          ? `${r.decider ?? "A coordinator"} sent your wording out: "${String(r.message).slice(0, 120)}"`
          : `${r.decider ?? "A coordinator"} declined it. Your words were not sent.`,
      at: String(r.decided_at ?? ""),
    });
  }

  // 4 · Missions waiting on my orgs.
  const tasks = await db().execute({
    sql: `SELECT t.id, t.created_at, i.title, i.place, i.severity, tm.name AS org
          FROM tasks t
          JOIN memberships m ON m.team_id = t.team_id AND m.user_id = ?
          JOIN incidents i ON i.id = t.incident_id
          JOIN teams tm ON tm.id = t.team_id
          WHERE t.status = 'assigned' ORDER BY t.id DESC LIMIT 10`,
    args: [user.id],
  });
  for (const r of tasks.rows) {
    items.push({
      id: `mission:${r.id}`,
      kind: "mission",
      title: `Mission for ${r.org}`,
      body: `${r.title}${r.place ? ` — ${r.place}` : ""}. Nobody has accepted it yet.`,
      at: String(r.created_at),
      severity: Number(r.severity) >= 4 ? "red" : "orange",
    });
  }

  items.sort((a, b) => b.at.localeCompare(a.at));
  return Response.json({ items: items.slice(0, 50), at: new Date().toISOString() });
}
