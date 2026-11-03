import { currentUser } from "@/lib/auth";
import { logRelay, alertReach } from "@/lib/campsDb";

/**
 * Recording that a person passed an alert on by hand.
 *
 * This is the write half of the reach feature, and without it the read half
 * measures nothing — every alert would report zero relays forever, which is
 * worse than not having the feature, because it would look like nobody ever
 * relays anything rather than like nobody can record it.
 *
 * Deliberately open to any signed-in role. The J-PAL trial's finding was that
 * *community members* relay to each other — restricting this to volunteers
 * would encode an org chart the evidence does not describe. A citizen who
 * warned six neighbouring houses did the same work as a volunteer who warned
 * sixty, and the count belongs in the same place.
 *
 * Not agent-callable on purpose. An agent must never record that somebody
 * warned their village; only the person who did it can say that happened.
 */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return Response.json({ error: "Log in to record a relay." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    alertId?: number;
    households?: number;
    place?: string;
    method?: string;
    note?: string;
  };

  const alertId = Number(body.alertId);
  if (!Number.isFinite(alertId) || alertId <= 0) {
    return Response.json({ error: "Which alert did you pass on?" }, { status: 400 });
  }

  const households = Number(body.households);
  if (!Number.isFinite(households) || households < 1) {
    return Response.json(
      { error: "How many households did it reach? At least one." },
      { status: 400 },
    );
  }
  // A door-knock round is not four thousand houses. A number that large is a
  // typo or a guess, and it would swamp every honest count in the same total.
  if (households > 2000) {
    return Response.json(
      { error: "That is more households than one person can have told. Log it in parts." },
      { status: 400 },
    );
  }

  const METHODS = ["in_person", "phone", "whatsapp", "announcement", "other"] as const;
  const method = (METHODS as readonly string[]).includes(body.method ?? "")
    ? (body.method as (typeof METHODS)[number])
    : "in_person";

  // Their own registered place is the sensible default — someone relaying an
  // alert is almost always relaying it where they are.
  const place = body.place?.trim() || user.place || "";
  if (!place) {
    return Response.json({ error: "Where did you pass it on?" }, { status: 400 });
  }

  try {
    const id = await logRelay({
      alertId,
      userId: user.id,
      households: Math.round(households),
      place,
      method,
      note: body.note,
    });

    // Return the updated reach so the person who just logged it sees their own
    // contribution land, rather than a bare ok.
    const updated = await alertReach(alertId);
    return Response.json({ ok: true, relayId: id, reach: updated?.reach ?? null });
  } catch (err) {
    // A foreign-key failure here means the alert id does not exist — worth
    // saying, rather than a generic 500 that reads as the app being broken.
    const message = err instanceof Error ? err.message : String(err);
    if (/FOREIGN KEY|constraint/i.test(message)) {
      return Response.json({ error: "That alert does not exist." }, { status: 404 });
    }
    throw err;
  }
}

/** Reach for one alert, or the most recent. Read-only, any signed-in user. */
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Log in first." }, { status: 401 });

  const idParam = new URL(request.url).searchParams.get("alertId");
  const alertId = idParam ? Number(idParam) : undefined;
  const found = await alertReach(Number.isFinite(alertId!) ? alertId : undefined);

  if (!found) return Response.json({ alert: null, reach: null });
  return Response.json(found);
}
