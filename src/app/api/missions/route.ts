import { currentUser } from "@/lib/auth";
import { tasksForUser, allTasks, orgsOf, createMission, membersOf } from "@/lib/orgs";
import { db, dbReady } from "@/lib/db";

/**
 * What one person should be looking at.
 *
 * Scoped by membership rather than by role: a volunteer in one NGO must not be
 * able to read another's missions by changing an id, and role alone cannot
 * express that. A coordinator sees everything, because coordinating is the job.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Log in to see your missions." }, { status: 401 });

  const [tasks, orgs] = await Promise.all([
    user.role === "coordinator" ? allTasks() : tasksForUser(user.id),
    orgsOf(user.id),
  ]);

  return Response.json({
    tasks,
    orgs,
    scope: user.role === "coordinator" ? "all" : "member",
  });
}


/**
 * Raise a mission.
 *
 * Coordinator-only, and scoped to an organisation they belong to — a
 * coordinator is not an administrator of every NGO in the country, and the
 * membership check is what says so.
 */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Log in first." }, { status: 401 });
  if (user.role !== "coordinator") {
    return Response.json({ error: "Only a coordinator can raise a mission." }, { status: 403 });
  }

  const body = (await request.json()) as {
    teamId?: number;
    volunteerIds?: number[];
    note?: string;
    incidentId?: number | null;
    alertId?: number | null;
  };

  if (!body.teamId) return Response.json({ error: "Choose an organisation." }, { status: 400 });

  const mine = await orgsOf(user.id);
  if (!mine.some((o) => o.id === body.teamId)) {
    return Response.json({ error: "You are not in that organisation." }, { status: 403 });
  }

  const result = await createMission({
    teamId: body.teamId,
    volunteerIds: body.volunteerIds ?? [],
    note: body.note ?? "",
    incidentId: body.incidentId ?? null,
    alertId: body.alertId ?? null,
    createdBy: user.id,
  });

  if (!result.ok) return Response.json({ error: result.reason }, { status: 400 });
  return Response.json({ ok: true, created: result.taskIds!.length, taskIds: result.taskIds });
}

/**
 * Everything the raise-a-mission form needs, in one call.
 *
 * The form cannot be filled without knowing which organisations this
 * coordinator can act for, who is in them, and what there is to respond to —
 * three round trips that would each show their own spinner.
 */
export async function PUT() {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Log in first." }, { status: 401 });
  if (user.role !== "coordinator") {
    return Response.json({ error: "Only a coordinator can raise a mission." }, { status: 403 });
  }
  await dbReady();

  const orgs = await orgsOf(user.id);
  const members = await Promise.all(
    orgs.map(async (o) => ({ orgId: o.id, people: await membersOf(o.id) })),
  );

  const [incidents, alerts] = await Promise.all([
    db().execute(
      `SELECT id, title, place, severity FROM incidents
       WHERE status != 'resolved' ORDER BY severity DESC, id DESC LIMIT 25`,
    ),
    db().execute(
      `SELECT id, region, level, message FROM alerts ORDER BY id DESC LIMIT 25`,
    ),
  ]);

  return Response.json({
    orgs,
    members,
    incidents: incidents.rows.map((r) => ({
      id: Number(r.id),
      title: String(r.title),
      place: r.place === null ? null : String(r.place),
      severity: Number(r.severity),
    })),
    alerts: alerts.rows.map((r) => ({
      id: Number(r.id),
      region: String(r.region),
      level: String(r.level),
      message: String(r.message).slice(0, 90),
    })),
  });
}
