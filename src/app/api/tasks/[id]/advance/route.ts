import { currentUser } from "@/lib/auth";
import { advanceTask, type TaskStatus } from "@/lib/orgs";

/**
 * Move a mission forward.
 *
 * Idempotent on purpose. The volunteer screen queues these locally and replays
 * them when the network returns, so the same transition legitimately arrives
 * twice — and a replayed action that already landed is a success, not an error.
 * The volunteer did the right thing; the network was the problem.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Log in to update a mission." }, { status: 401 });

  const { id } = await ctx.params;
  const body = (await request.json()) as { to: TaskStatus; outcome?: string; at?: string };

  const r = await advanceTask(Number(id), user.id, body.to, body.outcome, body.at);
  if (!r.ok) {
    // 409 rather than 400: the request was well formed, the world had moved on.
    return Response.json({ error: r.reason }, { status: r.reason?.includes("another") ? 403 : 409 });
  }
  return Response.json({ ok: true, task: r.task });
}
