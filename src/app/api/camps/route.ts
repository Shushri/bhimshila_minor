import { db, dbReady } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { listCamps, teamStocks } from "@/lib/campsDb";
import { supplierFor, type NeedItem, type Urgency } from "@/lib/camps";

/**
 * Relief camps and their unmet needs.
 *
 * GET is open to any signed-in user: a volunteer heading out should be able to
 * see what the camp they are driving to is short of, and that is not a
 * coordinator-only fact. Writing is coordinator-only, because a camp's
 * recorded population is what ranks it against every other camp — an
 * unreviewed edit there quietly reorders the supply queue.
 */

const ITEMS: NeedItem[] = ["food", "water", "medical", "bedding", "sanitation", "boats"];
const URGENCIES: Urgency[] = ["normal", "urgent", "critical"];

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Log in first." }, { status: 401 });

  const place = new URL(request.url).searchParams.get("place") ?? undefined;
  const [list, stocks] = await Promise.all([listCamps(place), teamStocks()]);

  return Response.json({
    camps: list.camps.map((c) => ({
      ...c,
      // Named here rather than in the client so the "nobody is carrying this"
      // case is decided once, by the same rule the agent uses.
      supplier: c.worst ? (supplierFor(c.worst.item, stocks)?.team ?? null) : null,
    })),
    scope: list.scope,
    unmatched: list.unmatched ?? null,
  });
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Log in first." }, { status: 401 });
  if (user.role !== "coordinator") {
    return Response.json(
      { error: "Only a coordinator can open a camp or change what it needs." },
      { status: 403 },
    );
  }

  await dbReady();
  const body = (await request.json().catch(() => ({}))) as {
    action?: string;
    name?: string;
    place?: string;
    people?: number;
    lat?: number;
    lng?: number;
    campId?: number;
    item?: string;
    needed?: number;
    received?: number;
    urgency?: string;
  };

  if (body.action === "open_camp") {
    const name = body.name?.trim();
    const place = body.place?.trim();
    if (!name || !place) {
      return Response.json({ error: "A camp needs a name and a place." }, { status: 400 });
    }
    const people = Math.max(0, Math.round(Number(body.people) || 0));

    const r = await db().execute({
      sql: `INSERT INTO relief_camps (name, place, lat, lng, people)
            VALUES (?,?,?,?,?) RETURNING id`,
      args: [
        name,
        place,
        Number.isFinite(body.lat) ? Number(body.lat) : null,
        Number.isFinite(body.lng) ? Number(body.lng) : null,
        people,
      ],
    });
    return Response.json({ ok: true, campId: Number(r.rows[0].id) });
  }

  if (body.action === "set_need") {
    const campId = Number(body.campId);
    const item = String(body.item) as NeedItem;
    if (!Number.isFinite(campId) || !ITEMS.includes(item)) {
      return Response.json(
        { error: `Need a camp and one of: ${ITEMS.join(", ")}.` },
        { status: 400 },
      );
    }

    const needed = Math.max(0, Math.round(Number(body.needed) || 0));
    const received = Math.max(0, Math.round(Number(body.received) || 0));
    const urgency = URGENCIES.includes(body.urgency as Urgency)
      ? (body.urgency as Urgency)
      : "normal";

    // One row per camp per item. A second report of the same shortage is an
    // update, not a duplicate — two rows for "water" would be counted twice by
    // the ranking and quietly double that camp's claim on the next truck.
    const existing = await db().execute({
      sql: "SELECT id FROM camp_needs WHERE camp_id = ? AND item = ?",
      args: [campId, item],
    });

    if (existing.rows.length) {
      await db().execute({
        sql: `UPDATE camp_needs SET needed = ?, received = ?, urgency = ?,
              updated_at = datetime('now') WHERE id = ?`,
        args: [needed, received, urgency, Number(existing.rows[0].id)],
      });
    } else {
      await db().execute({
        sql: `INSERT INTO camp_needs (camp_id, item, needed, received, urgency)
              VALUES (?,?,?,?,?)`,
        args: [campId, item, needed, received, urgency],
      });
    }
    return Response.json({ ok: true });
  }

  if (body.action === "close_camp") {
    const campId = Number(body.campId);
    if (!Number.isFinite(campId)) {
      return Response.json({ error: "Which camp?" }, { status: 400 });
    }
    await db().execute({
      sql: "UPDATE relief_camps SET status = 'closed' WHERE id = ?",
      args: [campId],
    });
    return Response.json({ ok: true });
  }

  return Response.json(
    { error: "Unknown action. Use open_camp, set_need or close_camp." },
    { status: 400 },
  );
}
