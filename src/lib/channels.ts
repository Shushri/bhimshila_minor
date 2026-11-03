import { db } from "./db";
import { audienceFor, placeMatchSql } from "./audience";

/**
 * Alert delivery.
 *
 * The rule here is that a channel is only reported as delivered if something
 * actually left the building. Telling a coordinator "SMS sent" when no SMS was
 * sent is the one failure this product cannot survive, so each channel returns
 * its own result and the alert record stores what genuinely went out.
 *
 *   in_app     always real — persisted, and the recipient sees it on login
 *   telegram   real and free — Bot API, no cost, no approval, works today
 *   whatsapp   real only with a Meta Business token, otherwise skipped
 *   sms        needs a paid gateway; recorded as unavailable, never faked
 */

export type Channel = "in_app" | "telegram" | "whatsapp" | "sms";

export interface DeliveryResult {
  channel: Channel;
  delivered: number;
  failed: number;
  /** Present when the channel could not be used at all. */
  unavailable?: string;
}

const usable = (k?: string) => !!k && k.trim().length > 12 && !k.trim().startsWith("#");

interface Recipient {
  id: number;
  name: string;
  phone: string;
  telegramChatId: string | null;
  language: string;
}

export async function recipientsFor(region: string): Promise<Recipient[]> {
  // A state reaches everyone in its districts. Matching the region string
  // directly against `place` used to send "Himachal Pradesh" alerts to nobody,
  // because people register as Kangra or Shimla. See lib/audience.ts.
  const match = placeMatchSql(audienceFor(region));
  const r = await db().execute({
    sql: `SELECT id, name, phone, telegram_chat_id, language
          FROM users WHERE ${match.sql}`,
    args: match.args,
  });
  return r.rows.map((row) => ({
    id: Number(row.id),
    name: String(row.name),
    phone: String(row.phone),
    telegramChatId: row.telegram_chat_id === null ? null : String(row.telegram_chat_id),
    language: String(row.language),
  }));
}

/**
 * In-app is the floor: it always works and is always genuinely delivered.
 *
 * One batch rather than a write per recipient. Against a local file the loop
 * was free; against a hosted database it is one network round trip each, so
 * warning a well-registered state would spend its entire time budget writing
 * receipts. The same shape cost the monitoring sweep a 504 on Vercel.
 */
async function deliverInApp(alertId: number, people: Recipient[]): Promise<DeliveryResult> {
  if (!people.length) return { channel: "in_app", delivered: 0, failed: 0 };
  await db().batch(
    people.map((p) => ({
      sql: "INSERT INTO alert_deliveries (alert_id, user_id, channel, status) VALUES (?,?,?,'delivered')",
      args: [alertId, p.id, "in_app"],
    })),
    "write",
  );
  return { channel: "in_app", delivered: people.length, failed: 0 };
}

/**
 * Telegram Bot API — free, instant, no business verification. This is what
 * makes "multilingual alerts on a messaging channel" true rather than aspirational.
 */
async function deliverTelegram(alertId: number, people: Recipient[], text: string): Promise<DeliveryResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!usable(token)) {
    return {
      channel: "telegram",
      delivered: 0,
      failed: 0,
      unavailable: "TELEGRAM_BOT_TOKEN not set — free from @BotFather",
    };
  }

  // One chat, one message. Several accounts can legitimately share a chat id —
  // someone registered twice, or a demo seed placing the same person in every
  // state — and sending once per matching row means they receive the same
  // warning dozens of times and Telegram throttles the whole broadcast.
  const byChat = new Map<string, Recipient>();
  for (const p of people) {
    if (p.telegramChatId && !byChat.has(p.telegramChatId)) byChat.set(p.telegramChatId, p);
  }
  const linked = [...byChat.values()];

  if (!linked.length) {
    return { channel: "telegram", delivered: 0, failed: 0, unavailable: "No recipient has linked Telegram" };
  }

  let delivered = 0;
  let failed = 0;

  // Why a send failed matters more than that it did. "failed=1" tells a
  // coordinator nothing; "has not started the bot" tells them exactly what to
  // fix, and it is the failure that actually happens — Telegram refuses to let
  // a bot open a conversation the person did not start.
  const reasons = new Set<string>();

  for (const p of linked) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: p.telegramChatId, text, parse_mode: "HTML" }),
      });
      const ok = res.ok;
      if (ok) {
        delivered++;
      } else {
        failed++;
        const body = (await res.json().catch(() => ({}))) as { description?: string };
        const why = body.description ?? `HTTP ${res.status}`;
        reasons.add(
          /chat not found|bot was blocked|user is deactivated|can't initiate/i.test(why)
            ? `${p.name} has not opened the bot — Telegram only allows a bot to message someone who pressed Start first`
            : why,
        );
      }
      await db().execute({
        sql: "INSERT INTO alert_deliveries (alert_id, user_id, channel, status) VALUES (?,?,?,?)",
        args: [alertId, p.id, "telegram", ok ? "delivered" : "failed"],
      });
    } catch {
      failed++;
      reasons.add("Telegram was unreachable");
    }
  }

  return {
    channel: "telegram",
    delivered,
    failed,
    // Only when nothing got through. A partial failure is visible in the
    // counts, and claiming the channel was unavailable would understate what
    // did reach people.
    unavailable: delivered === 0 && reasons.size ? [...reasons].join("; ") : undefined,
  };
}

/** WhatsApp Cloud API — real, but only with a Meta Business token. */
async function deliverWhatsApp(alertId: number, people: Recipient[], text: string): Promise<DeliveryResult> {
  const token = process.env.WHATSAPP_TOKEN?.trim();
  const phoneId = process.env.WHATSAPP_PHONE_ID?.trim();
  if (!usable(token) || !phoneId) {
    return {
      channel: "whatsapp",
      delivered: 0,
      failed: 0,
      unavailable: "Needs a Meta Business account — not configured",
    };
  }

  let delivered = 0;
  let failed = 0;
  for (const p of people) {
    try {
      const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: `91${p.phone}`,
          type: "text",
          text: { body: text },
        }),
      });
      if (res.ok) delivered++;
      else failed++;
      await db().execute({
        sql: "INSERT INTO alert_deliveries (alert_id, user_id, channel, status) VALUES (?,?,?,?)",
        args: [alertId, p.id, "whatsapp", res.ok ? "delivered" : "failed"],
      });
    } catch {
      failed++;
    }
  }
  return { channel: "whatsapp", delivered, failed };
}

/** Deliver on every channel that is genuinely available. */
export async function deliverAlert(
  alertId: number,
  region: string,
  message: string,
  level: string,
): Promise<{ results: DeliveryResult[]; recipients: number }> {
  const people = await recipientsFor(region);

  const text =
    `⚠️ <b>${level.toUpperCase()} — ${region}</b>\n\n${message}\n\n` +
    `— BhimShila disaster intelligence`;

  const results = await Promise.all([
    deliverInApp(alertId, people),
    deliverTelegram(alertId, people, text),
    deliverWhatsApp(alertId, people, text),
    Promise.resolve<DeliveryResult>({
      channel: "sms",
      delivered: 0,
      failed: 0,
      unavailable: "SMS needs a paid gateway — not configured",
    }),
  ]);

  return { results, recipients: people.length };
}

/** Alerts a given user has actually received. */
export async function inboxFor(userId: number) {
  const r = await db().execute({
    sql: `SELECT a.id, a.region, a.level, a.message, a.evidence, a.created_at,
                 group_concat(d.channel) AS channels
          FROM alert_deliveries d
          JOIN alerts a ON a.id = d.alert_id
          WHERE d.user_id = ? AND d.status = 'delivered'
          GROUP BY a.id
          ORDER BY a.id DESC LIMIT 20`,
    args: [userId],
  });
  return r.rows.map((row) => ({
    id: Number(row.id),
    region: String(row.region),
    level: String(row.level),
    message: String(row.message),
    evidence: row.evidence === null ? null : String(row.evidence),
    channels: String(row.channels ?? "in_app").split(","),
    createdAt: String(row.created_at),
  }));
}
