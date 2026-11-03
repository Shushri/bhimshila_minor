import { currentUser } from "@/lib/auth";
import { joinByCode } from "@/lib/orgs";

/**
 * Join an organisation with an invite code.
 *
 * Open to any logged-in user: the code is the credential, exactly as with the
 * Telegram link. Idempotent, because a volunteer who taps the link twice should
 * see their org, not an error.
 */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Log in or sign up first, then open the invite again." }, { status: 401 });

  const { code } = (await request.json()) as { code?: string };
  if (!code?.trim()) return Response.json({ error: "No invite code." }, { status: 400 });

  const r = await joinByCode(code, user.id);
  if (!r.ok) return Response.json({ error: r.reason }, { status: 404 });
  return Response.json({ ok: true, org: r.org });
}
