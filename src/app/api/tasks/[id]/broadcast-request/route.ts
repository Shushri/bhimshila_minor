import { currentUser } from "@/lib/auth";
import { canAccessTask, listBroadcastRequests, requestBroadcast } from "@/lib/field";

/**
 * A volunteer asks for people near their mission to be warned.
 *
 * This is the gate the trust model turns on: the volunteer is closest to the
 * ground and most likely to be right, and broadcasting stays a coordinator's
 * act. The request carries the volunteer's own wording to the top of the
 * coordinator's queue — approval sends exactly those words.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Log in first." }, { status: 401 });
  const { id } = await ctx.params;
  const taskId = Number(id);
  if (!(await canAccessTask(taskId, user))) {
    return Response.json({ error: "That mission belongs to another organisation." }, { status: 403 });
  }
  return Response.json({ requests: await listBroadcastRequests(taskId) });
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Log in to request a broadcast." }, { status: 401 });

  const { id } = await ctx.params;
  const taskId = Number(id);
  if (!(await canAccessTask(taskId, user))) {
    return Response.json({ error: "That mission belongs to another organisation." }, { status: 403 });
  }

  const body = (await request.json()) as { message?: string };
  const r = await requestBroadcast(taskId, user.id, body.message ?? "");
  if (!r.ok) return Response.json({ error: r.reason }, { status: 400 });
  return Response.json({ ok: true, request: r.request });
}
