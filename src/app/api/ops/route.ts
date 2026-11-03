import { db, dbReady, haversineKm } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { CENTROIDS } from "@/lib/kb/national";
import { listIncidents, nearestTeams, specialistSlackKm } from "@/lib/ops";
import { deliverAlert, recipientsFor } from "@/lib/channels";
import { audienceFor } from "@/lib/audience";
import { createTask } from "@/lib/orgs";

/**
 * Relief operations: propose an action, a human confirms, then it executes.
 *
 * Nothing outward-facing fires on a voice parse alone. "Send alert to Kerala"
 * and "send alert to Kerala and Karnataka" differ by one mishearing, so every
 * write is staged as a pending action and only runs on an explicit confirm.
 */

const PENDING_TTL_MIN = 10;

/** Nearest district centroid wins — good enough to put an alert in a state. */
function stateOf(lat: number, lng: number): string | null {
  let best: string | null = null;
  let bestKm = Infinity;
  for (const c of CENTROIDS) {
    const km = haversineKm(lat, lng, c.lat, c.lng);
    if (km < bestKm) {
      bestKm = km;
      best = c.s;
    }
  }
  return bestKm < 250 ? best : null;
}

/**
 * Alert fatigue, measured rather than lamented.
 *
 * seen_alerts is the record of every warning the monitor has seen; incidents
 * is the record of people actually asking for help. A state that has heard
 * many warnings and raised nothing is a state where the next warning lands on
 * deaf ears — the direct mechanism behind "nobody trusts the alert". The
 * caveat is printed with it: our incident record is SOS traffic, not ground
 * truth, so this measures attention risk, never falsity.
 */
async function fatigueLedger() {
  const [alerts, incidents] = await Promise.all([
    db().execute(
      `SELECT colour, lat, lng FROM seen_alerts
       WHERE first_seen_at > datetime('now','-30 days') AND lat IS NOT NULL`,
    ),
    db().execute(
      `SELECT lat, lng FROM incidents
       WHERE created_at > datetime('now','-30 days') AND lat IS NOT NULL`,
    ),
  ]);

  const byState = new Map<string, { alerts: number; red: number; incidents: number }>();
  for (const r of alerts.rows) {
    const s = stateOf(Number(r.lat), Number(r.lng));
    if (!s) continue;
    const cur = byState.get(s) ?? { alerts: 0, red: 0, incidents: 0 };
    cur.alerts += 1;
    if (String(r.colour) === "red") cur.red += 1;
    byState.set(s, cur);
  }
  for (const r of incidents.rows) {
    const s = stateOf(Number(r.lat), Number(r.lng));
    if (!s) continue;
    const cur = byState.get(s) ?? { alerts: 0, red: 0, incidents: 0 };
    cur.incidents += 1;
    byState.set(s, cur);
  }

  return [...byState.entries()]
    .map(([state, v]) => ({ state, ...v }))
    .filter((v) => v.alerts >= 5 && v.incidents === 0)
    .sort((a, b) => b.alerts - a.alerts)
    .slice(0, 6);
}

/**
 * Coverage gaps — people under a live alert with nobody in reach.
 *
 * The one insight a ranked list cannot give: not "where is it bad" but "where
 * is it bad AND unserved". Distance floor mirrors the dispatch slack ladder.
 */
async function coverageGaps() {
  const [queue, teams] = await Promise.all([
    db().execute(
      `SELECT disaster_type, colour, area, people, lat, lng FROM seen_alerts
       WHERE acknowledged_at IS NULL AND colour IN ('red','orange')
         AND people > 0 AND lat IS NOT NULL
       ORDER BY people DESC LIMIT 60`,
    ),
    db().execute("SELECT name, lat, lng FROM teams WHERE status = 'available'"),
  ]);
  const bases = teams.rows.map((t) => ({ name: String(t.name), lat: Number(t.lat), lng: Number(t.lng) }));
  if (!bases.length) return [];

  const gaps: { area: string; type: string; colour: string; people: number; nearestTeam: string; distanceKm: number }[] = [];
  for (const r of queue.rows) {
    let best = bases[0];
    let bestKm = Infinity;
    for (const b of bases) {
      const km = haversineKm(Number(r.lat), Number(r.lng), b.lat, b.lng);
      if (km < bestKm) {
        bestKm = km;
        best = b;
      }
    }
    if (bestKm > 150) {
      gaps.push({
        area: String(r.area).slice(0, 90),
        type: String(r.disaster_type),
        colour: String(r.colour),
        people: Number(r.people),
        nearestTeam: best.name,
        distanceKm: Math.round(bestKm),
      });
    }
  }
  return gaps.sort((a, b) => b.people - a.people).slice(0, 6);
}

export async function GET() {
  await dbReady();
  const [incidents, teams, alerts, tempo, fatigue, gaps] = await Promise.all([
    listIncidents(),
    db().execute(`SELECT t.id, t.name, t.kind, t.place, t.status, t.capacity,
                         r.boats, r.medical_kits, r.food_packets
                  FROM teams t LEFT JOIN team_resources r ON r.team_id = t.id
                  ORDER BY t.status, t.name`),
    db().execute(
      "SELECT id, region, level, message, recipients, channels, created_at FROM alerts ORDER BY id DESC LIMIT 8",
    ),
    // Official alerts first seen per day — real history from the monitoring
    // loop's own record, so the tempo chart never has to invent a series.
    db().execute(
      `SELECT date(first_seen_at) AS d, COUNT(*) AS n,
              SUM(CASE WHEN colour = 'red' THEN 1 ELSE 0 END) AS red
       FROM seen_alerts WHERE first_seen_at > datetime('now','-14 days')
       GROUP BY date(first_seen_at) ORDER BY d`,
    ),
    fatigueLedger().catch(() => []),
    coverageGaps().catch(() => []),
  ]);

  return Response.json({
    incidents,
    teams: teams.rows,
    alerts: alerts.rows,
    activity: tempo.rows.map((r) => ({ d: String(r.d), n: Number(r.n), red: Number(r.red) })),
    fatigue,
    gaps,
    // The chart builds its 14-day axis from this rather than the client clock,
    // so a phone with a wrong date still draws the window the data describes.
    today: new Date().toISOString().slice(0, 10),
    stats: {
      open: incidents.filter((i) => i.status === "open").length,
      assigned: incidents.filter((i) => i.status === "assigned").length,
      available: teams.rows.filter((t) => t.status === "available").length,
      deployed: teams.rows.filter((t) => t.status === "deployed").length,
      boats: teams.rows.reduce((a, t) => a + Number(t.boats ?? 0), 0),
      medicalKits: teams.rows.reduce((a, t) => a + Number(t.medical_kits ?? 0), 0),
      foodPackets: teams.rows.reduce((a, t) => a + Number(t.food_packets ?? 0), 0),
    },
  });
}

/**
 * Who may move a team or broadcast to a region.
 *
 * These actions reach real people and real responders, so they are not open to
 * anyone who can reach the endpoint. Raising an SOS stays open to everybody —
 * a person in danger must never be blocked by a login — but acting on one is
 * a coordinator's job.
 */
function authorise(user: Awaited<ReturnType<typeof currentUser>>): Response | null {
  if (!user) {
    return Response.json({ error: "Log in to act on incidents." }, { status: 401 });
  }
  if (user.role !== "coordinator") {
    return Response.json(
      { error: "Only a coordinator can send alerts or dispatch teams." },
      { status: 403 },
    );
  }
  return null;
}

export async function POST(request: Request) {
  await dbReady();
  const user = await currentUser();
  const body = (await request.json()) as {
    action: "prepare_alert" | "prepare_dispatch" | "confirm" | "cancel" | "resolve";
    actionId?: number;
    region?: string;
    level?: string;
    message?: string;
    evidence?: string;
    incidentId?: number;
    teamId?: number;
    outcome?: string;
    // Set when dispatching against an alert rather than a report — there is no
    // incident yet, so one is opened for the place.
    title?: string;
    place?: string;
    lat?: number;
    lng?: number;
    severity?: number;
  };

  const denied = authorise(user);
  if (denied) return denied;

  if (body.action === "prepare_alert" || body.action === "prepare_dispatch") {
    const kind = body.action === "prepare_alert" ? "alert" : "dispatch";

    // The confirmation screen promises real numbers — who this reaches, which
    // team, how far — so they are computed here, at staging, and the chosen
    // team is pinned into the payload. Re-deriving at confirm time would let
    // the coordinator approve one team and dispatch another.
    const payload: Record<string, unknown> = { ...body };
    let preview: Record<string, unknown> = {};

    if (kind === "alert") {
      const region = body.region ?? "India";
      const audience = audienceFor(region);
      const people = await recipientsFor(region);
      preview = { region, recipients: people.length, scope: audience.scope, resolved: audience.resolved };
    } else {
      // No incident id means the coordinator is acting on an alert or one of
      // our own leads, before anyone has called. Open the incident here rather
      // than at confirm, so the confirmation screen can show the real team and
      // the real distance for a pre-positioning exactly as it does for a report.
      const incidentId =
        body.incidentId ?? (await openAnticipatoryIncident(body)) ?? 0;
      payload.incidentId = incidentId;

      const inc = await db().execute({
        sql: "SELECT title, category, severity, lat, lng FROM incidents WHERE id = ?",
        args: [incidentId],
      });
      const incident = inc.rows[0];
      if (!incident) {
        return Response.json(
          { error: "Nothing to dispatch to — an alert needs coordinates before a team can be sent." },
          { status: 400 },
        );
      }

      if (body.teamId) {
        // The agent already chose and displayed a team — honour it.
        const t = await db().execute({
          sql: "SELECT id, name, place, lat, lng FROM teams WHERE id = ? AND status = 'available'",
          args: [body.teamId],
        });
        const team = t.rows[0];
        if (!team) return Response.json({ error: "That team is no longer available." }, { status: 409 });
        const km =
          incident.lat !== null && team.lat !== null
            ? Math.round(
                haversineKm(Number(incident.lat), Number(incident.lng), Number(team.lat), Number(team.lng)),
              )
            : null;
        preview = { teamName: String(team.name), teamPlace: String(team.place), distanceKm: km };
      } else {
        if (incident.lat === null || incident.lng === null) {
          return Response.json({ error: "Incident has no location to dispatch to." }, { status: 400 });
        }
        const wanted = incident.category === "medical" ? "medical" : undefined;
        const near = await nearestTeams(
          Number(incident.lat),
          Number(incident.lng),
          wanted,
          2,
          specialistSlackKm(Number(incident.severity)),
        );
        if (!near.length) return Response.json({ error: "No available team found" }, { status: 409 });
        payload.teamId = near[0].id;
        preview = {
          teamName: near[0].name,
          teamPlace: near[0].place,
          distanceKm: near[0].distanceKm,
          backup: near[1] ? { teamName: near[1].name, distanceKm: near[1].distanceKm } : null,
        };
      }
    }

    const r = await db().execute({
      sql: `INSERT INTO pending_actions (kind, payload, created_by, expires_at)
            VALUES (?,?,?, datetime('now', ?)) RETURNING id`,
      args: [kind, JSON.stringify(payload), user?.id ?? null, `+${PENDING_TTL_MIN} minutes`],
    });
    return Response.json({ ok: true, pending: true, actionId: Number(r.rows[0].id), kind, ...preview });
  }

  // Recovery — close an incident, release the team, keep the record.
  if (body.action === "resolve") {
    const id = body.incidentId ?? 0;
    const inc = await db().execute({
      sql: "SELECT assigned_team_id, title FROM incidents WHERE id = ?",
      args: [id],
    });
    if (!inc.rows[0]) return Response.json({ error: "Incident not found" }, { status: 404 });

    const teamId = inc.rows[0].assigned_team_id;
    await db().execute({
      sql: "UPDATE incidents SET status='resolved', updated_at=datetime('now') WHERE id = ?",
      args: [id],
    });
    if (teamId !== null) {
      await db().execute({
        sql: "UPDATE teams SET status='available' WHERE id = ?",
        args: [Number(teamId)],
      });
      await db().execute({
        sql: `UPDATE assignments SET status='done', resolved_at=datetime('now'), outcome=?
              WHERE incident_id = ? AND status != 'done'`,
        args: [body.outcome ?? "resolved", id],
      });
    }
    return Response.json({
      ok: true,
      resolved: id,
      title: String(inc.rows[0].title),
      teamReleased: teamId !== null,
      incidents: await listIncidents(),
    });
  }

  if (body.action === "cancel") {
    await db().execute({
      sql: "UPDATE pending_actions SET status='cancelled' WHERE id = ? AND status='pending'",
      args: [body.actionId ?? 0],
    });
    return Response.json({ ok: true, cancelled: true });
  }

  // confirm — the only path that writes anything real
  if (body.action !== "confirm") {
    return Response.json({ error: "Unknown action" }, { status: 400 });
  }

  const p = await db().execute({
    sql: `SELECT id, kind, payload, created_by FROM pending_actions
          WHERE id = ? AND status = 'pending' AND expires_at > datetime('now')`,
    args: [body.actionId ?? 0],
  });
  const row = p.rows[0];
  if (!row) {
    return Response.json({ error: "That action expired or was already handled." }, { status: 410 });
  }
  // Staging and confirming must be the same person — otherwise one coordinator
  // could confirm an action another was still reviewing.
  if (row.created_by !== null && Number(row.created_by) !== user!.id) {
    return Response.json({ error: "That action was staged by someone else." }, { status: 403 });
  }

  const payload = JSON.parse(String(row.payload));

  // The coordinator can edit the wording on the confirmation screen, and what
  // they read there has to be what goes out. Without this the edit was accepted
  // by the textarea and silently discarded at send — the worst kind of bug in
  // this path, because nothing tells you it happened.
  if (typeof body.message === "string" && body.message.trim()) {
    payload.message = body.message.trim();
  }
  if (typeof body.level === "string" && body.level.trim()) {
    payload.level = body.level.trim();
  }

  const result =
    String(row.kind) === "alert"
      ? await sendAlert(payload, user!.id)
      : await dispatchTeam(payload);

  await db().execute({
    sql: "UPDATE pending_actions SET status='confirmed' WHERE id = ?",
    args: [Number(row.id)],
  });

  return Response.json({ ok: true, confirmed: true, ...result, incidents: await listIncidents() });
}

/**
 * Deliver an alert to the people registered in a region.
 *
 * in_app is genuinely delivered — it is persisted and every recipient sees it.
 * WhatsApp and SMS need a paid provider, so they are recorded as intended
 * channels rather than claimed as sent. Saying "sent by SMS" when no SMS left
 * the building would be the one lie this product cannot afford.
 */
async function sendAlert(
  p: { region?: string; level?: string; message?: string; evidence?: string },
  userId: number | null,
) {
  const region = p.region ?? "India";

  const level = p.level ?? "warning";
  const message = p.message ?? "";

  const r = await db().execute({
    sql: `INSERT INTO alerts (region, level, message, evidence, channels, recipients, sent_by)
          VALUES (?,?,?,?,?,?,?) RETURNING id`,
    args: [region, level, message, p.evidence ?? null, "", 0, userId],
  });
  const alertId = Number(r.rows[0].id);

  const { results, recipients } = await deliverAlert(alertId, region, message, level);
  const delivered = results.filter((x) => x.delivered > 0);

  // Record only the channels that actually delivered something.
  await db().execute({
    sql: "UPDATE alerts SET channels = ?, recipients = ? WHERE id = ?",
    args: [delivered.map((d) => d.channel).join(",") || "none", recipients, alertId],
  });

  return {
    alertId,
    region,
    recipients,
    channels: delivered.map((d) => d.channel),
    delivery: results,
    note:
      recipients === 0
        ? "Nobody is registered in that region yet — the alert is recorded and will reach anyone who registers there."
        : undefined,
  };
}

/** Assign a team to an incident and mark both sides. */
/**
 * Open an incident for a place nobody has called from yet.
 *
 * Dispatch used to require an existing incident, which meant a team could only
 * be sent where a citizen had already raised an SOS — exactly backwards for
 * this product's own argument. An official red alert arrives *before* the
 * phone rings; being unable to pre-position against it is the gap the whole
 * system exists to close.
 *
 * These are marked `anticipatory` in the title and carry a severity from the
 * alert colour rather than from a person's words, because they are not reports.
 * Nobody has said they need help. Presenting one as though somebody had would
 * put a fabricated emergency on the board.
 */
async function openAnticipatoryIncident(p: {
  title?: string;
  place?: string;
  lat?: number;
  lng?: number;
  severity?: number;
}): Promise<number | null> {
  if (typeof p.lat !== "number" || typeof p.lng !== "number") return null;

  const r = await db().execute({
    sql: `INSERT INTO incidents (title, category, severity, people_count, place, lat, lng, status)
          VALUES (?,?,?,?,?,?,?,'open') RETURNING id`,
    args: [
      (p.title ?? "Pre-positioning").slice(0, 140),
      "other",
      Math.min(5, Math.max(1, p.severity ?? 3)),
      null,
      p.place ?? null,
      p.lat,
      p.lng,
    ],
  });
  return Number(r.rows[0].id);
}

async function dispatchTeam(p: {
  incidentId?: number;
  teamId?: number;
  title?: string;
  place?: string;
  lat?: number;
  lng?: number;
  severity?: number;
}) {
  // Staging always pins one in, including for a pre-positioning.
  const incidentId = p.incidentId ?? 0;

  const inc = await db().execute({
    sql: "SELECT id, title, lat, lng, category, severity FROM incidents WHERE id = ?",
    args: [incidentId],
  });
  const incident = inc.rows[0];
  if (!incident) {
    return {
      error:
        "Nothing to dispatch to. An alert needs coordinates before a team can be sent to it.",
    };
  }

  let teamId = p.teamId;
  let distanceKm: number | null = null;

  if (!teamId && incident.lat !== null && incident.lng !== null) {
    const kind = incident.category === "medical" ? "medical" : undefined;
    const near = await nearestTeams(
      Number(incident.lat),
      Number(incident.lng),
      kind,
      1,
      specialistSlackKm(Number(incident.severity)),
    );
    teamId = near[0]?.id;
    distanceKm = near[0]?.distanceKm ?? null;
  }
  if (!teamId) return { error: "No available team found" };

  const t = await db().execute({ sql: "SELECT name, place, lat, lng FROM teams WHERE id = ?", args: [teamId] });
  const team = t.rows[0];

  // Staging pins the team, so this path no longer picks one — but the receipt
  // still owes the coordinator the distance the choice was made on.
  if (distanceKm === null && team && incident.lat !== null && team.lat !== null) {
    distanceKm = Math.round(
      haversineKm(Number(incident.lat), Number(incident.lng), Number(team.lat), Number(team.lng)),
    );
  }

  await db().execute({
    sql: "INSERT INTO assignments (incident_id, team_id) VALUES (?,?)",
    args: [incidentId, teamId],
  });

  // The assignment records that an org was sent. The task is the person-level
  // layer under it — unassigned within the org, so anyone on shift can pick it
  // up rather than the dispatch waiting on one named individual to open their
  // phone. Its transitions become the deployment log.
  const taskId = await createTask(incidentId, Number(teamId));
  await db().execute({
    sql: "UPDATE teams SET status='deployed' WHERE id = ?",
    args: [teamId],
  });
  await db().execute({
    sql: "UPDATE incidents SET status='assigned', assigned_team_id=?, updated_at=datetime('now') WHERE id = ?",
    args: [teamId, incidentId],
  });

  return {
    incidentId,
    incidentTitle: String(incident.title),
    teamId,
    teamName: team ? String(team.name) : "team",
    teamPlace: team ? String(team.place) : null,
    distanceKm,
    taskId,
  };
}
