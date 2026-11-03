import { currentUser } from "@/lib/auth";
import { decideBroadcast, listBroadcastRequests } from "@/lib/field";

/**
 * The coordinator's broadcast queue. Pending requests first, with the
 * volunteer's name, org, mission and exact wording attached; approval is the
 * one-tap human confirmation and sends that wording to the incident's area.
 */
export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Log in first." }, { status: 401 });
  if (user.role !== "coordinator") {
    return Response.json({ error: "Only a coordinator reads the broadcast queue." }, { status: 403 });
  }
  return Response.json({ requests: await listBroadcastRequests() });
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Log in first." }, { status: 401 });
  if (user.role !== "coordinator") {
    return Response.json({ error: "Only a coordinator can approve a broadcast." }, { status: 403 });
  }

  const body = (await request.json()) as { id?: number; action?: "approve" | "decline" };
  if (!body.id || !body.action) return Response.json({ error: "id and action required." }, { status: 400 });

  const r = await decideBroadcast(Number(body.id), user, body.action === "approve");
  if (!r.ok) return Response.json({ error: r.reason }, { status: 409 });
  return Response.json({ ...r, requests: await listBroadcastRequests() });
}
