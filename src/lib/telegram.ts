import { randomBytes } from "crypto";
import { db, dbReady } from "./db";
import { route } from "./agent/router";
import { runTool } from "./agent/tools";
import { limited } from "./ratelimit";

/**
 * Linking a person's Telegram to their BhimShila account.
 *
 * The delivery path already knew how to send — `telegram_chat_id` was read on
 * every alert — but nothing ever wrote it, so the column was always null and
 * the channel reported "no recipient has linked Telegram" forever. This is the
 * missing half.
 *
 * Telegram will not tell you a user's chat id from their phone number; there is
 * no lookup. The only way to learn it is for the person to message the bot
 * first, which is deliberate on Telegram's part and correct — it means nobody
 * can be added to a broadcast list without opting in. So the flow is: we mint a
 * one-time code, they open a deep link that sends `/start <code>` to the bot,
 * and we match the code to the account.
 *
 * Polling `getUpdates` rather than a webhook, because a webhook needs a public
 * HTTPS URL and this has to work on localhost during development and on the
 * deployed URL without reconfiguration.
 */

const API = (token: string, method: string) => `https://api.telegram.org/bot${token}/${method}`;

/** Long enough that guessing one is pointless, short enough to type. */
const CODE_BYTES = 5;
const LINK_TTL_MINUTES = 15;

export const telegramToken = () => {
  const t = process.env.TELEGRAM_BOT_TOKEN?.trim();
  return t && t.length > 12 && !t.startsWith("#") ? t : null;
};

export interface LinkRequest {
  code: string;
  /** Deep link that opens the bot with the code already filled in. */
  url: string;
  botUsername: string;
  expiresInMinutes: number;
}

/** The bot's own @name, needed to build a deep link. Cached for the process. */
let cachedBot: string | null = null;
async function botUsername(token: string): Promise<string | null> {
  if (cachedBot) return cachedBot;
  try {
    const res = await fetch(API(token, "getMe"), { cache: "no-store" });
    if (!res.ok) return null;
    const j = await res.json();
    cachedBot = j?.result?.username ?? null;
    return cachedBot;
  } catch {
    return null;
  }
}

/**
 * Mint a code and the deep link that carries it.
 *
 * Any earlier unused code for this user is dropped first — leaving several live
 * means a stale QR or a re-tapped old link can bind the account to whichever
 * chat used it last.
 */
export async function createLink(userId: number): Promise<LinkRequest | null> {
  const token = telegramToken();
  if (!token) return null;

  const name = await botUsername(token);
  if (!name) return null;

  await dbReady();
  const code = randomBytes(CODE_BYTES).toString("hex");

  await db().execute({
    sql: "DELETE FROM telegram_links WHERE user_id = ? AND chat_id IS NULL",
    args: [userId],
  });
  await db().execute({
    sql: `INSERT INTO telegram_links (code, user_id, expires_at)
          VALUES (?, ?, datetime('now', ?))`,
    args: [code, userId, `+${LINK_TTL_MINUTES} minutes`],
  });

  return {
    code,
    url: `https://t.me/${name}?start=${code}`,
    botUsername: name,
    expiresInMinutes: LINK_TTL_MINUTES,
  };
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    text?: string;
    chat?: { id: number };
    from?: { first_name?: string };
  };
}

/**
 * Drain pending `/start <code>` messages and bind the chats they came from.
 *
 * `getUpdates` is a queue: an update is only removed once acknowledged with an
 * offset past it. That offset is persisted, because two callers polling without
 * it would each consume updates the other needed and links would silently fail
 * for whoever lost the race.
 */
export async function drainUpdates(): Promise<{ linked: number; checked: number }> {
  const token = telegramToken();
  if (!token) return { linked: 0, checked: 0 };

  await dbReady();
  const stored = await db().execute("SELECT value FROM app_state WHERE key = 'tg_offset'");
  const offset = Number(stored.rows[0]?.value ?? 0);

  let updates: TelegramUpdate[] = [];
  try {
    const res = await fetch(API(token, "getUpdates") + `?offset=${offset + 1}&timeout=0&limit=100`, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { linked: 0, checked: 0 };
    const j = await res.json();
    updates = Array.isArray(j?.result) ? j.result : [];
  } catch {
    return { linked: 0, checked: 0 };
  }

  let linked = 0;
  let highest = offset;

  for (const u of updates) {
    highest = Math.max(highest, u.update_id);
    const text = u.message?.text?.trim() ?? "";
    const chatId = u.message?.chat?.id;
    if (!chatId) continue;

    const m = /^\/start\s+([a-f0-9]+)$/i.exec(text);
    if (!m) {
      // Two-way: anything else typed at the bot is a question, answered by
      // the deterministic router alone — an open inbox must never spend model
      // quota, and unrouted questions get pointed at the app. Write intents
      // are refused outright: an alert or a dispatch cannot start life in a
      // chat window, even staged.
      if (!text || text.startsWith("/")) continue;
      if (limited(`tg:${chatId}`, 10, 10 * 60_000)) continue;

      let answer: string;
      const routed = route(text);
      if (routed && ["dispatch_team", "prepare_alert", "resolve_incident"].includes(routed.name)) {
        answer = "Ye action sirf coordinator dashboard se hota hai — chat se nahi.";
      } else if (routed) {
        try {
          const out = await runTool(routed.name, routed.args);
          answer = (out.panel?.headline ?? out.summary).slice(0, 900);
        } catch {
          answer = "Us sawaal ka source abhi unreachable hai — thodi der mein phir poochhiye.";
        }
      } else {
        answer =
          "Main live alerts, kisi district ka flood risk, nearest shelter aur protocols bata " +
          'sakta hoon — jaise "Kerala me koi alert hai?" ya "nearest shelter in Patna".';
      }

      await fetch(API(token, "sendMessage"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: answer }),
      }).catch(() => {});
      continue;
    }

    const claim = await db().execute({
      sql: `SELECT user_id FROM telegram_links
            WHERE code = ? AND chat_id IS NULL AND expires_at > datetime('now')`,
      args: [m[1].toLowerCase()],
    });
    const userId = claim.rows[0]?.user_id;
    if (userId === undefined) continue;

    await db().execute({
      sql: "UPDATE users SET telegram_chat_id = ? WHERE id = ?",
      args: [String(chatId), Number(userId)],
    });
    await db().execute({
      sql: "UPDATE telegram_links SET chat_id = ?, linked_at = datetime('now') WHERE code = ?",
      args: [String(chatId), m[1].toLowerCase()],
    });
    linked++;

    // Confirm in the chat itself. Someone who linked and then heard nothing
    // has no way to tell whether it worked, and would not trust the channel
    // when a real alert arrives.
    await fetch(API(token, "sendMessage"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text:
          "✅ <b>Linked to BhimShila</b>\n\nOfficial disaster alerts for your region will arrive here. " +
          "Nothing is sent automatically — a coordinator confirms every broadcast.",
        parse_mode: "HTML",
      }),
    }).catch(() => {});
  }

  if (highest > offset) {
    await db().execute({
      sql: `INSERT INTO app_state (key, value) VALUES ('tg_offset', ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      args: [String(highest)],
    });
  }

  return { linked, checked: updates.length };
}

/** Whether this user's Telegram is connected. */
export async function linkStatus(userId: number): Promise<{ linked: boolean; configured: boolean }> {
  const configured = telegramToken() !== null;
  if (!configured) return { linked: false, configured };
  await dbReady();
  const r = await db().execute({
    sql: "SELECT telegram_chat_id FROM users WHERE id = ?",
    args: [userId],
  });
  return { linked: !!r.rows[0]?.telegram_chat_id, configured };
}
