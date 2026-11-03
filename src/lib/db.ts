import { createClient, type Client } from "@libsql/client";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * The real backend — SQLite via libsql.
 *
 * Local: a file on disk, zero config, zero cost. Deployed: point
 * DATABASE_URL + DATABASE_AUTH_TOKEN at a Turso database and nothing else
 * changes — same client, same SQL. That is why libsql over better-sqlite3.
 */

let client: Client | null = null;
let ready: Promise<void> | null = null;

/**
 * Turso over plain HTTPS rather than the WebSocket `libsql://` implies.
 *
 * Turso hands out `libsql://…`, and the client reads that as "open a
 * WebSocket". That is the wrong shape for this deployment twice over: a
 * serverless function is torn down between requests so a persistent socket
 * buys nothing, and any network that filters WebSockets makes every query hang
 * until it times out — which is exactly what happened here, a ten-second
 * connect timeout against a host that answered plain HTTPS in 97ms.
 *
 * Rewriting the scheme keeps the copied-from-the-dashboard URL working as-is,
 * so nobody has to remember this when setting the variable.
 */
function connectionUrl(): string {
  const raw = process.env.DATABASE_URL?.trim();
  if (!raw) return "file:./data/dai.db";
  return raw.startsWith("libsql://") ? raw.replace("libsql://", "https://") : raw;
}

export function db(): Client {
  if (!client) {
    const url = connectionUrl();
    // A fresh clone has no data/ directory — it holds only the database, so it
    // is gitignored and never arrives with the code. libsql answers that with
    // SQLITE_CANTOPEN (14), which reads like a corrupt file rather than a
    // missing folder, and the app fails to boot on the one path every new
    // contributor takes first. Creating it is cheaper than documenting it.
    if (url.startsWith("file:")) {
      mkdirSync(dirname(url.slice("file:".length)), { recursive: true });
    }
    client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });
  }
  return client;
}

/**
 * Every route awaits this once; the schema is idempotent.
 *
 * A failed migration is NOT cached. It used to be: one transient network blip
 * while reaching Turso left a rejected promise in `ready`, and every request
 * afterwards failed against it in five milliseconds without touching the
 * network again — a process poisoned for its whole life by one bad moment at
 * boot. Clearing it on failure means the next request simply tries again.
 */
export function dbReady(): Promise<void> {
  if (!ready) {
    ready = migrate().catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}

async function migrate() {
  const c = db();

  // WAL is a local-file concern. Turso is a managed service that handles its
  // own journalling and rejects the pragma with a 400 — which aborted the
  // entire migration on the first deploy and left the database with no tables
  // at all. Only set it when the database really is a file.
  if (!process.env.DATABASE_URL) {
    await c.execute("PRAGMA journal_mode = WAL");
  }

  await c.executeMultiple(`

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'citizen' CHECK (role IN ('citizen','volunteer','coordinator')),
      language TEXT NOT NULL DEFAULT 'hi-IN',
      place TEXT,
      lat REAL,
      lng REAL,
      telegram_chat_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Raw citizen reports, exactly as they came in
    CREATE TABLE IF NOT EXISTS sos_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      message TEXT NOT NULL,
      category TEXT NOT NULL,
      severity INTEGER NOT NULL,
      people_count INTEGER,
      place TEXT,
      lat REAL,
      lng REAL,
      incident_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Clustered view: several reports of the same thing become one incident
    CREATE TABLE IF NOT EXISTS incidents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      severity INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','assigned','resolved')),
      report_count INTEGER NOT NULL DEFAULT 1,
      people_count INTEGER,
      place TEXT,
      lat REAL,
      lng REAL,
      assigned_team_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('rescue','medical','ngo')),
      place TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','deployed')),
      capacity INTEGER NOT NULL DEFAULT 40,
      contact TEXT,
      -- A team IS the organisation. There is no separate table for one: this
      -- row already carries the name, base and capacity, and every dispatch
      -- path resolves through it. Two tables for one concept would drift.
      created_by INTEGER REFERENCES users(id),
      verified INTEGER NOT NULL DEFAULT 1,
      invite_code TEXT UNIQUE
    );

    -- Who belongs to which organisation.
    --
    -- Deliberately separate from users.role. A person's role in the system is
    -- which screens they get; their role inside an org is whether they can add
    -- members. Someone can lead one NGO and be an ordinary member of another,
    -- and collapsing the two would make that unrepresentable.
    CREATE TABLE IF NOT EXISTS memberships (
      team_id INTEGER NOT NULL REFERENCES teams(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      role_in_org TEXT NOT NULL DEFAULT 'member' CHECK (role_in_org IN ('lead','member')),
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (team_id, user_id)
    );

    -- The person-level layer under a dispatch.
    --
    -- The assignments table records that an org was sent. This records who
    -- actually went, whether they arrived, and what they found. The organizers
    -- asked for a deployment log — who is deployed, where, when — and the
    -- timestamps on these transitions are that log, with no form to fill in.
    -- (No backticks in this file: the whole schema is one template literal.)
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      -- Nullable since coordinator-raised missions arrived. A mission answers
      -- either a citizen SOS (an incident) or an official warning (an alert),
      -- and requiring an incident forced the second kind to invent one — which
      -- would have put fictional citizen reports on the incident board.
      incident_id INTEGER REFERENCES incidents(id),
      team_id INTEGER NOT NULL REFERENCES teams(id),
      -- Null until a volunteer accepts it. A task belongs to the org first and
      -- a person second, so nothing is stuck waiting on one named individual.
      assignee_user_id INTEGER REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'assigned'
        CHECK (status IN ('assigned','accepted','on_site','done','declined')),
      note TEXT,
      outcome TEXT,
      -- The alert this mission answers, when it answers one rather than an SOS.
      alert_id INTEGER REFERENCES alerts(id),
      -- Who raised it. A dispatch is raised by the system on a coordinator's
      -- confirmation; a mission is raised by a named person, and the volunteer
      -- receiving it should be able to see which.
      created_by INTEGER REFERENCES users(id),
      outcome_note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      accepted_at TEXT,
      on_site_at TEXT,
      done_at TEXT
    );

    CREATE TABLE IF NOT EXISTS assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      incident_id INTEGER NOT NULL REFERENCES incidents(id),
      team_id INTEGER NOT NULL REFERENCES teams(id),
      status TEXT NOT NULL DEFAULT 'dispatched' CHECK (status IN ('dispatched','on_site','done')),
      note TEXT,
      resolved_at TEXT,
      outcome TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      region TEXT NOT NULL,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      evidence TEXT,
      channels TEXT NOT NULL DEFAULT 'in_app',
      recipients INTEGER NOT NULL DEFAULT 0,
      sent_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Write actions the agent proposed and a human has not yet confirmed.
    -- Voice can mishear; nothing outward-facing fires without a confirm.
    CREATE TABLE IF NOT EXISTS pending_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL CHECK (kind IN ('alert','dispatch')),
      payload TEXT NOT NULL,
      created_by INTEGER,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','cancelled','expired')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    );

    -- Per-recipient, per-channel proof of delivery. An alert row says what was
    -- attempted; these rows say what actually arrived.
    CREATE TABLE IF NOT EXISTS alert_deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      alert_id INTEGER NOT NULL REFERENCES alerts(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      channel TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'delivered',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- What a team is carrying, so "resource availability" is a number that
    -- moves rather than a label.
    CREATE TABLE IF NOT EXISTS team_resources (
      team_id INTEGER PRIMARY KEY REFERENCES teams(id),
      boats INTEGER NOT NULL DEFAULT 0,
      medical_kits INTEGER NOT NULL DEFAULT 0,
      food_packets INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Every official alert the watcher has already seen.
    --
    -- This is what turns polling into monitoring: without a record of what was
    -- already known, every sweep looks like a hundred brand-new alerts and the
    -- console cries wolf until nobody reads it. Keyed on the CAP identifier,
    -- which the feed guarantees unique.
    --
    -- The colour is stored so an escalation is detectable too — the same warning
    -- going yellow to red is news, and re-issuing under the same identifier is
    -- exactly how an authority signals that.
    CREATE TABLE IF NOT EXISTS seen_alerts (
      cap_id TEXT PRIMARY KEY,
      colour TEXT NOT NULL,
      disaster_type TEXT NOT NULL,
      area TEXT NOT NULL,
      source TEXT NOT NULL,
      lat REAL,
      lng REAL,
      -- People under it when we first saw it. Stored rather than recomputed
      -- because the queue reads from here and the row does not carry the
      -- geometry the estimate needs.
      people INTEGER NOT NULL DEFAULT 0,
      -- Set when a coordinator has looked at it, so the queue can be cleared.
      acknowledged_at TEXT,
      first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- One-time codes binding a Telegram chat to an account.
    --
    -- Telegram will not reveal a chat id from a phone number — the person has
    -- to message the bot first. That is deliberate on their part and correct:
    -- it means nobody lands on a broadcast list without opting in. So a code is
    -- minted here, carried in a deep link, and matched when /start arrives.
    CREATE TABLE IF NOT EXISTS telegram_links (
      code TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      chat_id TEXT,
      linked_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    );

    -- Small key/value store. Currently just the Telegram getUpdates offset,
    -- which must persist: two pollers without a shared offset each consume
    -- updates the other needed, and links fail silently for whoever loses.
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Mission-scoped chat. Thread per task, never free-form DMs: a message in
    -- a disaster response is part of the record of that response, and a tool
    -- that grows unscoped messaging turns into WhatsApp and stops being
    -- auditable.
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL REFERENCES tasks(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- The volunteer-to-coordinator gate. Volunteers are closest to the ground
    -- and most likely to be right, and they are also the largest,
    -- least-verified population on the platform — so they raise a request
    -- scoped to their mission, and broadcasting stays a coordinator's act.
    CREATE TABLE IF NOT EXISTS broadcast_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL REFERENCES tasks(id),
      requested_by INTEGER NOT NULL REFERENCES users(id),
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','approved','declined')),
      decided_by INTEGER REFERENCES users(id),
      decided_at TEXT,
      -- The alert that went out when this was approved — the receipt.
      alert_id INTEGER REFERENCES alerts(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- What a volunteer saw, said, or photographed on a mission. captured_at is
    -- when it happened in the field; created_at is when it reached us — both
    -- kept, because the gap between them is the offline queue doing its job.
    -- Media lives in the row and is served only through the mission API, never
    -- a public URL: photos from a disaster contain injured people.
    CREATE TABLE IF NOT EXISTS field_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL REFERENCES tasks(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      kind TEXT NOT NULL DEFAULT 'note' CHECK (kind IN ('note','photo')),
      body TEXT,
      media TEXT,
      media_type TEXT,
      captured_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Personalised alerting: which places and hazards a person wants to hear
    -- about, and from which severity. The monitoring sweep matches new
    -- official alerts against these.
    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      place TEXT NOT NULL,
      hazard TEXT,
      min_colour TEXT NOT NULL DEFAULT 'yellow' CHECK (min_colour IN ('yellow','orange','red')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    /*
     * Relays — an alert passed on by a human being, off-platform.
     *
     * The J-PAL trial in Bihar is the reason this table exists. Comparing
     * volunteer-relayed warnings against app-only alerts across 319
     * panchayats, relayed communities were 46.5% more likely to get the
     * warning BEFORE the water arrived, and the mechanism the study names is
     * blunt: "households typically relied on other community members for
     * flood alerts". One in five people there had a smartphone.
     *
     * So an alert's reach is not how many rows we pushed to. It is that,
     * plus everyone a volunteer actually told. Without this table the
     * product can only ever report the first number and call it coverage.
     */
    CREATE TABLE IF NOT EXISTS relays (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      alert_id INTEGER NOT NULL REFERENCES alerts(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      /* Households, not people — it is what someone doing a door-knock round
         can actually count without guessing at family size. */
      households INTEGER NOT NULL CHECK (households > 0),
      place TEXT NOT NULL,
      method TEXT NOT NULL DEFAULT 'in_person'
        CHECK (method IN ('in_person','phone','whatsapp','announcement','other')),
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    /*
     * Relief camps and what they are short of.
     *
     * Kerala 2018: college students built exactly this by hand — "a database
     * to assess the needs of each camp… and direct supply trucks
     * accordingly" — while 400 volunteers ran a call centre that fielded
     * 25,000 calls in five days. It worked. It also had to be rebuilt from
     * nothing, by students, during the flood.
     *
     * teams already carry resources in team_resources. A camp's unmet need
     * and a team's stock are the two halves of a supply run; holding camps
     * as first-class rows is what lets the two be matched instead of phoned.
     */
    CREATE TABLE IF NOT EXISTS relief_camps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      place TEXT NOT NULL,
      lat REAL,
      lng REAL,
      people INTEGER NOT NULL DEFAULT 0,
      /* The organisation running it, when one is. A camp can exist before
         anybody has taken charge of it — that is worth being able to see. */
      team_id INTEGER REFERENCES teams(id),
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS camp_needs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      camp_id INTEGER NOT NULL REFERENCES relief_camps(id),
      item TEXT NOT NULL CHECK (item IN ('food','water','medical','bedding','sanitation','boats')),
      needed INTEGER NOT NULL CHECK (needed >= 0),
      received INTEGER NOT NULL DEFAULT 0 CHECK (received >= 0),
      urgency TEXT NOT NULL DEFAULT 'normal' CHECK (urgency IN ('normal','urgent','critical')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);
    CREATE INDEX IF NOT EXISTS idx_relays_alert ON relays(alert_id);
    CREATE INDEX IF NOT EXISTS idx_camps_status ON relief_camps(status);
    CREATE INDEX IF NOT EXISTS idx_needs_camp ON camp_needs(camp_id);
    CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_team ON tasks(team_id, status);
    CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_user_id);
    CREATE INDEX IF NOT EXISTS idx_seen_ack ON seen_alerts(acknowledged_at);
    CREATE INDEX IF NOT EXISTS idx_deliveries_user ON alert_deliveries(user_id);
    CREATE INDEX IF NOT EXISTS idx_sos_incident ON sos_requests(incident_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_messages_task ON messages(task_id, id);
    CREATE INDEX IF NOT EXISTS idx_reports_task ON field_reports(task_id, id);
    CREATE INDEX IF NOT EXISTS idx_bcast_status ON broadcast_requests(status);
    CREATE INDEX IF NOT EXISTS idx_subs_user ON subscriptions(user_id);
  `);

  await addMissingColumns(c);
  await relaxTaskIncident(c);
  await seedTeams(c);

  // Hygiene on boot: expired sessions and stale unlinked telegram codes are
  // dead rows that only ever grow. Once per process is enough.
  await c.execute("DELETE FROM sessions WHERE expires_at < datetime('now')");
  await c.execute("DELETE FROM telegram_links WHERE linked_at IS NULL AND expires_at < datetime('now')");
}

/**
 * Let a task exist without an incident.
 *
 * SQLite cannot drop a NOT NULL constraint in place, so the column has to be
 * rebuilt — and a rebuild of a live table is the one migration worth being
 * paranoid about. This runs only when the constraint is still there, copies
 * every row, and refuses to swap unless the copy has exactly as many rows as
 * the original. A demo tomorrow with an empty missions board would be worse
 * than one where coordinators still cannot raise alert-linked missions.
 *
 * Foreign keys are switched off for the swap and switched back on in a finally,
 * without exception. Three tables — messages, broadcast_requests, field_reports
 * — point at tasks(id), so dropping it with enforcement on fails outright,
 * which is exactly what happened the first time this ran. Leaving enforcement
 * off afterwards would be far worse than the migration failing, so restoring it
 * does not depend on the rest succeeding.
 *
 * Not wrapped in a transaction: SQLite ignores the foreign_keys pragma inside
 * one. The order below is chosen so that any single-step failure leaves the
 * original table intact and simply retries on the next boot.
 */
async function relaxTaskIncident(c: Client) {
  const info = await c.execute("PRAGMA table_info(tasks)");
  const incident = info.rows.find((r) => String(r.name) === "incident_id");
  if (!incident || Number(incident.notnull) === 0) return; // already relaxed

  const before = Number((await c.execute("SELECT count(*) AS n FROM tasks")).rows[0].n);

  await c.execute("PRAGMA foreign_keys=OFF");
  try {
    await rebuildTasks(c, before);
  } finally {
    await c.execute("PRAGMA foreign_keys=ON");
  }
}

async function rebuildTasks(c: Client, before: number) {
  await c.executeMultiple(`
    DROP TABLE IF EXISTS tasks_rebuild;
    CREATE TABLE tasks_rebuild (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      incident_id INTEGER REFERENCES incidents(id),
      team_id INTEGER NOT NULL REFERENCES teams(id),
      assignee_user_id INTEGER REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'assigned'
        CHECK (status IN ('assigned','accepted','on_site','done','declined')),
      note TEXT,
      outcome TEXT,
      alert_id INTEGER REFERENCES alerts(id),
      created_by INTEGER REFERENCES users(id),
      outcome_note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      accepted_at TEXT,
      on_site_at TEXT,
      done_at TEXT
    );
    INSERT INTO tasks_rebuild
      (id, incident_id, team_id, assignee_user_id, status, note, outcome,
       created_at, accepted_at, on_site_at, done_at)
    SELECT id, incident_id, team_id, assignee_user_id, status, note, outcome,
           created_at, accepted_at, on_site_at, done_at
    FROM tasks;
  `);

  const after = Number((await c.execute("SELECT count(*) AS n FROM tasks_rebuild")).rows[0].n);
  if (after !== before) {
    await c.execute("DROP TABLE IF EXISTS tasks_rebuild");
    throw new Error(`tasks rebuild copied ${after} of ${before} rows — original left untouched`);
  }

  await c.executeMultiple(`
    DROP TABLE tasks;
    ALTER TABLE tasks_rebuild RENAME TO tasks;
    CREATE INDEX IF NOT EXISTS idx_tasks_team ON tasks(team_id, status);
    CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_user_id);
  `);
  console.warn(`[db] tasks rebuilt so a mission can exist without an incident — ${after} rows preserved`);
}

/**
 * Columns added to tables that already exist.
 *
 * `CREATE TABLE IF NOT EXISTS` does nothing to a table that is already there,
 * so adding a column to the schema above is invisible to any database created
 * before it — the table stays as it was and every query naming the new column
 * fails with "no such column". That is exactly what happened when `people` was
 * added to seen_alerts, and it would have happened on the deployed database
 * rather than a local one that can simply be deleted.
 *
 * Each entry is applied only if the column is missing, so this is safe to run
 * on every boot and on a fresh database alike.
 */
async function addMissingColumns(c: Client) {
  const additions: [table: string, column: string, definition: string][] = [
    ["seen_alerts", "people", "INTEGER NOT NULL DEFAULT 0"],
    // Added when coordinators could raise missions directly rather than only
    // through a dispatch. Nullable by design: a dispatch has neither.
    ["tasks", "alert_id", "INTEGER REFERENCES alerts(id)"],
    ["tasks", "created_by", "INTEGER REFERENCES users(id)"],
  ];

  for (const [table, column, definition] of additions) {
    const info = await c.execute(`PRAGMA table_info(${table})`);
    if (!info.rows.length) continue; // table not created yet — the schema above owns it
    if (info.rows.some((r) => String(r.name) === column)) continue;
    await c.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/**
 * Real NDRF battalion locations plus a few well-known relief NGOs — the demo
 * should dispatch plausible responders, not "Team A".
 */
async function seedTeams(c: Client) {
  const n = await c.execute("SELECT COUNT(*) AS n FROM teams");
  if (Number(n.rows[0].n) > 0) return;

  const teams: [string, string, string, number, number, number][] = [
    ["1st Bn NDRF Guwahati", "rescue", "Guwahati, Assam", 26.14, 91.73, 60],
    ["2nd Bn NDRF Kolkata", "rescue", "Kolkata, West Bengal", 22.57, 88.36, 60],
    ["3rd Bn NDRF Mundali", "rescue", "Cuttack, Odisha", 20.43, 85.85, 60],
    ["4th Bn NDRF Arakkonam", "rescue", "Arakkonam, Tamil Nadu", 13.08, 79.67, 60],
    ["5th Bn NDRF Pune", "rescue", "Pune, Maharashtra", 18.52, 73.86, 60],
    ["6th Bn NDRF Gandhinagar", "rescue", "Gandhinagar, Gujarat", 23.22, 72.65, 60],
    ["7th Bn NDRF Bathinda", "rescue", "Bathinda, Punjab", 30.21, 74.94, 60],
    ["8th Bn NDRF Ghaziabad", "rescue", "Ghaziabad, Uttar Pradesh", 28.67, 77.42, 60],
    ["9th Bn NDRF Patna", "rescue", "Patna, Bihar", 25.6, 85.1, 60],
    ["10th Bn NDRF Vijayawada", "rescue", "Vijayawada, Andhra Pradesh", 16.51, 80.63, 60],
    ["11th Bn NDRF Varanasi", "rescue", "Varanasi, Uttar Pradesh", 25.32, 82.99, 60],
    ["14th Bn NDRF Nurpur", "rescue", "Nurpur, Himachal Pradesh", 32.3, 75.9, 60],
    ["SDRF Kerala Thrissur", "rescue", "Thrissur, Kerala", 10.52, 76.21, 45],
    ["Indian Red Cross Kochi", "medical", "Kochi, Kerala", 9.93, 76.27, 30],
    ["Indian Red Cross Guwahati", "medical", "Guwahati, Assam", 26.18, 91.75, 30],
    ["Indian Red Cross Delhi", "medical", "New Delhi", 28.63, 77.22, 30],
    ["Indian Red Cross Shimla", "medical", "Shimla, Himachal Pradesh", 31.1, 77.17, 25],
    ["Indian Red Cross Dehradun", "medical", "Dehradun, Uttarakhand", 30.32, 78.03, 25],
    ["Indian Red Cross Mumbai", "medical", "Mumbai, Maharashtra", 19.08, 72.88, 30],
    ["Indian Red Cross Bhubaneswar", "medical", "Bhubaneswar, Odisha", 20.3, 85.82, 25],
    ["Indian Red Cross Lucknow", "medical", "Lucknow, Uttar Pradesh", 26.85, 80.95, 30],
    ["Goonj Relief Delhi", "ngo", "New Delhi", 28.61, 77.21, 25],
    ["Rapid Response Chennai", "ngo", "Chennai, Tamil Nadu", 13.08, 80.27, 25],
    ["Seeds India Dehradun", "ngo", "Dehradun, Uttarakhand", 30.32, 78.03, 25],
  ];

  for (const [name, kind, place, lat, lng, capacity] of teams) {
    const r = await c.execute({
      sql: "INSERT INTO teams (name, kind, place, lat, lng, capacity) VALUES (?,?,?,?,?,?) RETURNING id",
      args: [name, kind, place, lat, lng, capacity],
    });
    const id = Number(r.rows[0].id);
    // Rough kit per unit type — enough that depletion is visible on dispatch.
    const [boats, kits, food] =
      kind === "rescue" ? [6, 20, 200] : kind === "medical" ? [0, 80, 60] : [0, 15, 400];
    await c.execute({
      sql: "INSERT INTO team_resources (team_id, boats, medical_kits, food_packets) VALUES (?,?,?,?)",
      args: [id, boats, kits, food],
    });
  }
}

export function haversineKm(a: number, b: number, c2: number, d: number) {
  const R = 6371;
  const p = Math.PI / 180;
  const dLat = (c2 - a) * p;
  const dLng = (d - b) * p;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a * p) * Math.cos(c2 * p) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
