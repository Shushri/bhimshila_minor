import { currentUser } from "@/lib/auth";
import { canAccessTask, listMessages, postMessage } from "@/lib/field";

/**
 * Mission chat. Thread per task — auditable, scoped, and it stops the tool
 * becoming WhatsApp. Read and write follow the task's own boundary: the org it
 * was dispatched to, plus the coordinator desk.
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Log in to read mission chat." }, { status: 401 });

  const { id } = await ctx.params;
  const taskId = Number(id);
  if (!(await canAccessTask(taskId, user))) {
    return Response.json({ error: "That mission belongs to another organisation." }, { status: 403 });
  }
  const since = Number(new URL(request.url).searchParams.get("since") ?? 0);
  return Response.json({ messages: await listMessages(taskId, since), me: user.id });
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Log in to send a message." }, { status: 401 });

  const { id } = await ctx.params;
  const taskId = Number(id);
  if (!(await canAccessTask(taskId, user))) {
    return Response.json({ error: "That mission belongs to another organisation." }, { status: 403 });
  }
  const body = (await request.json()) as { body?: string };
  if (!body.body?.trim()) return Response.json({ error: "Empty message." }, { status: 400 });

  return Response.json({ messages: await postMessage(taskId, user.id, body.body.trim()), me: user.id });
}
