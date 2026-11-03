import { dbReady } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { inboxFor } from "@/lib/channels";

/** Alerts that actually reached the signed-in user, per channel. */
export async function GET() {
  await dbReady();
  const user = await currentUser();
  if (!user) return Response.json({ alerts: [] });
  return Response.json({ alerts: await inboxFor(user.id) });
}
