import { currentUser } from "@/lib/auth";
import { db, dbReady } from "@/lib/db";

/**
 * Personalised alerting: which places and hazards a person wants to hear
 * about, and from which severity up. The notification centre matches new
 * official alerts against these; the registered `place` on the account keeps
 * working as the implicit first subscription.
 */

const COLOURS = new Set(["yellow", "orange", "red"]);

async function list(userId: number) {
  const r = await db().execute({
    sql: `SELECT id, place, hazard, min_colour, created_at FROM subscriptions
          WHERE user_id = ? ORDER BY id`,
    args: [userId],
  });
  return r.rows.map((row) => ({
    id: Number(row.id),
    place: String(row.place),
    hazard: row.hazard === null ? null : String(row.hazard),
    minColour: String(row.min_colour),
    at: String(row.created_at),
  }));
}

export async function GET() {
  await dbReady();
  const user = await currentUser();
  if (!user) return Response.json({ error: "Log in first." }, { status: 401 });
  return Response.json({ subscriptions: await list(user.id) });
}

export async function POST(request: Request) {
  await dbReady();
  const user = await currentUser();
  if (!user) return Response.json({ error: "Log in to subscribe." }, { status: 401 });

  const body = (await request.json()) as { place?: string; hazard?: string; minColour?: string };
  const place = body.place?.trim();
  if (!place) return Response.json({ error: "Name a place — a district or a state." }, { status: 400 });

  const n = await db().execute({
    sql: "SELECT COUNT(*) AS n FROM subscriptions WHERE user_id = ?",
    args: [user.id],
  });
  if (Number(n.rows[0].n) >= 12) {
    return Response.json({ error: "Twelve places is the cap — remove one first." }, { status: 400 });
  }

  await db().execute({
    sql: "INSERT INTO subscriptions (user_id, place, hazard, min_colour) VALUES (?,?,?,?)",
    args: [
      user.id,
      place.slice(0, 80),
      body.hazard?.trim() ? body.hazard.trim().toLowerCase().slice(0, 30) : null,
      COLOURS.has(body.minColour ?? "") ? body.minColour! : "yellow",
    ],
  });
  return Response.json({ ok: true, subscriptions: await list(user.id) });
}

export async function DELETE(request: Request) {
  await dbReady();
  const user = await currentUser();
  if (!user) return Response.json({ error: "Log in first." }, { status: 401 });

  const id = Number(new URL(request.url).searchParams.get("id") ?? 0);
  // Scoped to the caller — removing someone else's subscription by id must not
  // be possible no matter what id is passed.
  await db().execute({
    sql: "DELETE FROM subscriptions WHERE id = ? AND user_id = ?",
    args: [id, user.id],
  });
  return Response.json({ ok: true, subscriptions: await list(user.id) });
}
