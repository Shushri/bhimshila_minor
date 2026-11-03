import { currentUser } from "@/lib/auth";
import { addReport, canAccessTask, listReports } from "@/lib/field";

/**
 * Ground reports — what a volunteer saw, said or photographed on a mission.
 *
 * Media is served only through this route, behind the same membership check as
 * the mission itself. Never a public URL: photos from a disaster contain
 * injured and dead people, and a leaked link must not be able to show them.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Log in to read reports." }, { status: 401 });

  const { id } = await ctx.params;
  const taskId = Number(id);
  if (!(await canAccessTask(taskId, user))) {
    return Response.json({ error: "That mission belongs to another organisation." }, { status: 403 });
  }
  return Response.json({ reports: await listReports(taskId) });
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Log in to file a report." }, { status: 401 });

  const { id } = await ctx.params;
  const taskId = Number(id);
  if (!(await canAccessTask(taskId, user))) {
    return Response.json({ error: "That mission belongs to another organisation." }, { status: 403 });
  }

  const body = (await request.json()) as {
    kind?: "note" | "photo";
    body?: string;
    media?: string;
    mediaType?: string;
    capturedAt?: string;
  };
  const r = await addReport(taskId, user.id, {
    kind: body.kind === "photo" ? "photo" : "note",
    body: body.body,
    media: body.media,
    mediaType: body.mediaType,
    capturedAt: body.capturedAt,
  });
  if (!r.ok) return Response.json({ error: r.reason }, { status: 400 });
  return Response.json({ ok: true, reports: await listReports(taskId) });
}
