import { currentUser } from "@/lib/auth";
import { sweep, queue, acknowledge } from "@/lib/watch";
import { drainUpdates } from "@/lib/telegram";

/**
 * The monitoring endpoint.
 *
 * GET runs a sweep and returns what changed. It is called on a schedule (see
 * .github/workflows/watch.yml) and by the ops console while it is open, so
 * monitoring continues whether or not anyone is looking.
 *
 * Vercel's free tier only allows a daily cron, which is useless for this, so
 * the schedule lives in GitHub Actions instead — free, five-minute granularity,
 * and it works against any deployment.
 */

export const maxDuration = 10;
/** A sweep must hit NDMA every time; a cached response would defeat the point. */
export const dynamic = "force-dynamic";

/**
 * Optional shared secret for the scheduled caller.
 *
 * Unset, the endpoint stays open — a sweep only reads a public government feed
 * and writes rows nobody else can see, so the exposure is a stranger costing us
 * NDMA requests, not data. Set WATCH_TOKEN in production and the schedule sends
 * it, which stops that.
 */
function authorised(request: Request): boolean {
  const expected = process.env.WATCH_TOKEN?.trim();
  if (!expected) return true;
  const given =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    new URL(request.url).searchParams.get("token");
  return given === expected;
}

export async function GET(request: Request) {
  // The same cron that sweeps NDMA also empties the bot's inbox, so a citizen
  // asking the Telegram bot a question gets answered within ten minutes even
  // when nobody has the app open. Fire-and-forget: the sweep must not wait.
  drainUpdates().catch(() => {});
  if (!authorised(request)) {
    return Response.json({ error: "Bad or missing watch token." }, { status: 401 });
  }

  const result = await sweep();
  const pending = await queue();

  return Response.json({
    ...result,
    changes: result.changes.map((c) => ({
      change: c.change,
      previousColour: c.previousColour,
      capId: c.alert.id,
      colour: c.alert.colour,
      disasterType: c.alert.disasterType,
      area: c.alert.areaDescription,
      source: c.alert.source,
      lat: c.alert.lat,
      lng: c.alert.lng,
    })),
    queue: pending,
    // Said plainly so a caller cannot mistake an outage for an all-clear.
    note: result.sourceReachable
      ? undefined
      : "NDMA Sachet returned nothing. This is not an all-clear — the feed may be unreachable.",
  });
}

/** Clear alerts a coordinator has looked at. */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Log in to acknowledge alerts." }, { status: 401 });
  if (user.role !== "coordinator") {
    return Response.json({ error: "Only a coordinator can clear the alert queue." }, { status: 403 });
  }

  const body = (await request.json()) as { capIds?: string[] };
  const cleared = await acknowledge(body.capIds ?? []);
  return Response.json({ ok: true, cleared, queue: await queue() });
}
