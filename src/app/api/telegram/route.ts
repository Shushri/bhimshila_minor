import { currentUser } from "@/lib/auth";
import { createLink, drainUpdates, linkStatus, telegramToken } from "@/lib/telegram";

/**
 * Connect a person's Telegram so alerts can actually reach a phone.
 *
 * GET  — status, and drains any pending /start messages first so the answer
 *        reflects a link the user completed seconds ago.
 * POST — mint a one-time code and the deep link that carries it.
 *
 * Both require a session: a chat id is bound to an account, so there has to be
 * an account to bind it to.
 */

export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Log in first." }, { status: 401 });

  // Poll before answering. The user taps the link, comes back, and expects to
  // see "connected" — not to wait for some other request to notice.
  const drained = await drainUpdates();
  const status = await linkStatus(user.id);

  return Response.json({
    ...status,
    justLinked: drained.linked > 0,
    hint: status.configured
      ? undefined
      : "TELEGRAM_BOT_TOKEN is not set. Get one free from @BotFather and put it on its own line in .env.",
  });
}

export async function POST() {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Log in first." }, { status: 401 });

  if (!telegramToken()) {
    return Response.json(
      {
        error:
          "TELEGRAM_BOT_TOKEN is not set. Get one free from @BotFather, put it on its own line in " +
          ".env, and restart the dev server.",
      },
      { status: 503 },
    );
  }

  const link = await createLink(user.id);
  if (!link) {
    return Response.json(
      { error: "Telegram rejected the token, or is unreachable. Check the token and try again." },
      { status: 502 },
    );
  }
  return Response.json(link);
}
