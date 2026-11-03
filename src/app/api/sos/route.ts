import { db, dbReady } from "@/lib/db";
import { clientKey, limited } from "@/lib/ratelimit";
import { currentUser } from "@/lib/auth";
import { parseSos, locate, clusterIntoIncident, listIncidents } from "@/lib/ops";

/**
 * Citizen SOS intake.
 *
 * Free text in — voice or typed, Hindi, English or a mix. The model structures
 * it, the knowledge base locates it, and the clusterer decides whether this is
 * a new emergency or another report of one already open.
 */

export async function GET() {
  await dbReady();
  return Response.json({ incidents: await listIncidents() });
}

export async function POST(request: Request) {
  // Loginless by design, limited by design: a dozen sends in ten minutes is
  // a frightened family retrying; a hundred is a script.
  if (limited(`sos:${clientKey(request)}`, 12, 10 * 60_000)) {
    return Response.json(
      { error: "Too many SOS from this connection just now. If this is real, call 112 as well." },
      { status: 429 },
    );
  }
  await dbReady();

  const body = (await request.json()) as {
    message: string;
    place?: string;
    lat?: number;
    lng?: number;
  };

  const message = (body.message ?? "").trim();
  if (!message) return Response.json({ error: "Empty message" }, { status: 400 });

  const user = await currentUser();
  const parsed = await parseSos(message);

  // Explicit coordinates beat a place name; the user's saved location is the
  // last resort. An SOS with no location still gets recorded — losing it
  // because we could not geocode it would be the worse failure.
  const named = locate(body.place ?? parsed.place);
  const lat = body.lat ?? named?.lat ?? user?.lat ?? null;
  const lng = body.lng ?? named?.lng ?? user?.lng ?? null;
  const place = body.place ?? parsed.place ?? named?.name ?? user?.place ?? null;

  const r = await db().execute({
    sql: `INSERT INTO sos_requests
            (user_id, message, category, severity, people_count, place, lat, lng)
          VALUES (?,?,?,?,?,?,?,?) RETURNING id`,
    args: [
      user?.id ?? null,
      message,
      parsed.category,
      parsed.severity,
      parsed.peopleCount,
      place,
      lat,
      lng,
    ],
  });
  const sosId = Number(r.rows[0].id);

  const incidentId = await clusterIntoIncident({
    id: sosId,
    category: parsed.category,
    severity: parsed.severity,
    peopleCount: parsed.peopleCount,
    place,
    lat,
    lng,
    summary: parsed.summary,
  });

  const incidents = await listIncidents();
  const incident = incidents.find((i) => i.id === incidentId);

  return Response.json({
    ok: true,
    sosId,
    incidentId,
    parsed,
    merged: (incident?.reportCount ?? 1) > 1,
    incident,
    incidents,
  });
}
