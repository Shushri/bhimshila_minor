/**
 * Put one demo recipient in every state, so any regional alert lands on a phone.
 *
 *   DEMO_TELEGRAM_CHAT_ID=123456789 node scripts/seed-demo-recipient.mjs
 *
 * WHY A STATE AND NOT A DISTRICT
 *
 * `audienceFor` expands a district alert to [district, state] and a state alert
 * to every district in it. So a recipient registered under a state name is
 * reached by both — 36 rows do what 725 would, and the demo does not depend on
 * guessing which district gets alerted.
 *
 * WHY THE CHAT ID IS NOT IN THE CODE
 *
 * It is a real person's Telegram account and this repository is public for
 * submission. It comes from the environment, and the seeded rows are labelled
 * so they are obvious to anyone reading the database later.
 *
 * Delivery deduplicates on chat id, so one alert is one message however many of
 * these rows match. Without that this script would send the same warning
 * thirty-six times and get the bot throttled.
 */

import { createClient } from "@libsql/client";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { scryptSync, randomBytes } from "crypto";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

// dotenv is not a dependency here; the file is three lines to parse.
for (const line of readFileSync(join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i < 0) continue;
  const k = t.slice(0, i).trim();
  if (!process.env[k]) process.env[k] = t.slice(i + 1).trim();
}

const CHAT_ID = (process.env.DEMO_TELEGRAM_CHAT_ID ?? "").trim();
if (!/^\d{5,}$/.test(CHAT_ID)) {
  console.error(
    "DEMO_TELEGRAM_CHAT_ID is not set to a Telegram chat id.\n\n" +
      "Put it on its own line in dai/.env:\n" +
      "  DEMO_TELEGRAM_CHAT_ID=123456789\n\n" +
      "Message @userinfobot on Telegram to find yours.",
  );
  process.exit(1);
}

const profiles = JSON.parse(
  readFileSync(join(ROOT, "src", "data", "district-profiles.json"), "utf8"),
);
const states = [...new Set(profiles.map((p) => p.s))].sort();

const db = createClient({
  url: process.env.DATABASE_URL || "file:./data/dai.db",
  authToken: process.env.DATABASE_AUTH_TOKEN,
});

/** Matches the app's own scrypt format so these accounts can actually log in. */
function hashPassword(password) {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${key.toString("hex")}`;
}

const PASSWORD = "demo2026";
const hash = hashPassword(PASSWORD);

// The app owns the schema and creates it on the first request. Running this
// against a database it has never touched throws "no such table: users" as a
// raw stack trace, which says nothing about the one-line fix.
const ready = await db.execute(
  "SELECT name FROM sqlite_master WHERE type='table' AND name='users'",
);
if (!ready.rows.length) {
  console.error(
    "The database has no schema yet — the app creates it on its first request.\n\n" +
      "Start the app and load it once, then run this again:\n" +
      "  npm run dev\n" +
      "  curl -s localhost:3000/api/auth > /dev/null\n" +
      "  node scripts/seed-demo-recipient.mjs",
  );
  process.exit(1);
}

let created = 0;
let updated = 0;

for (const [i, state] of states.entries()) {
  // Deterministic, obviously-fake phone numbers in the 90000 00000 block, so a
  // seeded row is never confused with a real signup.
  const phone = `90000${String(10000 + i).slice(-5)}`;
  const name = `Demo recipient — ${state}`;

  const existing = await db.execute({
    sql: "SELECT id FROM users WHERE phone = ?",
    args: [phone],
  });

  if (existing.rows[0]) {
    await db.execute({
      sql: "UPDATE users SET telegram_chat_id = ?, place = ?, name = ? WHERE phone = ?",
      args: [CHAT_ID, state, name, phone],
    });
    updated++;
  } else {
    await db.execute({
      sql: `INSERT INTO users (phone, name, password_hash, role, place, telegram_chat_id)
            VALUES (?,?,?,'citizen',?,?)`,
      args: [phone, name, hash, state, CHAT_ID],
    });
    created++;
  }
}

console.log(`${created} created, ${updated} updated — one recipient in each of ${states.length} states.`);
console.log(`Chat id ${CHAT_ID.slice(0, 3)}…${CHAT_ID.slice(-2)} · login 900001xxxx / ${PASSWORD}`);
console.log(
  "\nAn alert for any state or district now reaches this Telegram account.\n" +
    "Delivery deduplicates on chat id, so it arrives once.",
);
