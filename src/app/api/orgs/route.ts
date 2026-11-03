import { currentUser } from "@/lib/auth";
import { db, dbReady } from "@/lib/db";
import { createOrg, listOrgs, membersOf, isLead } from "@/lib/orgs";

/**
 * Organisations.
 *
 * Registering one is a coordinator's act — an org that appears in the dispatch
 * pool is a claim that these people will turn up, and that claim needs someone
 * accountable behind it. Reading the roster is open to the org's own lead too.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await currentUser();
  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  if (id) {
    if (!user) return Response.json({ error: "Log in first." }, { status: 401 });
    const teamId = Number(id);
    // A roster is org-scoped, not role-scoped: leading this org is enough,
    // and being a coordinator is enough, but being a volunteer somewhere else
    // is not.
    if (user.role !== "coordinator" && !(await isLead(teamId, user.id))) {
      return Response.json({ error: "That roster belongs to another organisation." }, { status: 403 });
    }
    return Response.json({ members: await membersOf(teamId) });
  }

  return Response.json({ orgs: await listOrgs(user?.id ?? null) });
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Log in first." }, { status: 401 });
  if (user.role !== "coordinator") {
    return Response.json(
      { error: "Only a coordinator can register an organisation." },
      { status: 403 },
    );
  }

  const b = (await request.json()) as {
    name?: string; kind?: string; place?: string;
    lat?: number; lng?: number; contact?: string; capacity?: number;
  };

  if (!b.name?.trim() || !b.place?.trim()) {
    return Response.json({ error: "An organisation needs a name and a base location." }, { status: 400 });
  }
  if (typeof b.lat !== "number" || typeof b.lng !== "number") {
    return Response.json(
      { error: "A base location needs coordinates — dispatch picks the nearest team by distance." },
      { status: 400 },
    );
  }

  const org = await createOrg({
    name: b.name,
    kind: ["rescue", "medical", "ngo"].includes(b.kind ?? "") ? b.kind! : "ngo",
    place: b.place,
    lat: b.lat,
    lng: b.lng,
    contact: b.contact ?? null,
    capacity: b.capacity,
    createdBy: user.id,
  });
  return Response.json({ ok: true, org });
}

/**
 * Resource levels — boats, medical kits, food packets.
 *
 * Until now these were written once by the seed and never again, which made
 * "resource availability" a label wearing a number's clothes. The org's own
 * lead updates them (they are the ones loading the truck), and a coordinator
 * can too. Absolute counts, not deltas — a stock-take is idempotent, and a
 * replayed update must not double anything.
 */
export async function PATCH(request: Request) {
  await dbReady();
  const user = await currentUser();
  if (!user) return Response.json({ error: "Log in first." }, { status: 401 });

  const b = (await request.json()) as {
    id?: number;
    boats?: number;
    medicalKits?: number;
    foodPackets?: number;
  };
  const teamId = Number(b.id ?? 0);
  if (!teamId) return Response.json({ error: "Which organisation?" }, { status: 400 });

  if (user.role !== "coordinator" && !(await isLead(teamId, user.id))) {
    return Response.json({ error: "Only the org's lead or a coordinator sets its stock." }, { status: 403 });
  }

  const clamp = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(100_000, Math.round(v))) : null;
  const boats = clamp(b.boats);
  const kits = clamp(b.medicalKits);
  const food = clamp(b.foodPackets);
  if (boats === null && kits === null && food === null) {
    return Response.json({ error: "Nothing to update." }, { status: 400 });
  }

  await db().execute({
    sql: `INSERT INTO team_resources (team_id, boats, medical_kits, food_packets, updated_at)
          VALUES (?, COALESCE(?,0), COALESCE(?,0), COALESCE(?,0), datetime('now'))
          ON CONFLICT(team_id) DO UPDATE SET
            boats = COALESCE(?, boats),
            medical_kits = COALESCE(?, medical_kits),
            food_packets = COALESCE(?, food_packets),
            updated_at = datetime('now')`,
    args: [teamId, boats, kits, food, boats, kits, food],
  });

  const r = await db().execute({
    sql: "SELECT boats, medical_kits, food_packets FROM team_resources WHERE team_id = ?",
    args: [teamId],
  });
  const row = r.rows[0];
  return Response.json({
    ok: true,
    resources: {
      boats: Number(row.boats),
      medicalKits: Number(row.medical_kits),
      foodPackets: Number(row.food_packets),
    },
  });
}
