import { db, dbReady } from "./db";
import { deliverAlert } from "./channels";
import type { SessionUser } from "./auth";

/**
 * The field layer: mission chat, ground reports, and the broadcast gate.
 *
 * Everything here is scoped to a task. That is the deliberate shape — a
 * message, a photo or a request to warn people all belong to the record of one
 * response. Access follows the same boundary as the task itself: the members
 * of the org it was dispatched to, and the coordinator desk.
 */

async function taskScope(taskId: number): Promise<{ teamId: number; incidentId: number } | null> {
  const r = await db().execute({
    sql: "SELECT team_id, incident_id FROM tasks WHERE id = ?",
    args: [taskId],
  });
  const row = r.rows[0];
  return row ? { teamId: Number(row.team_id), incidentId: Number(row.incident_id) } : null;
}

/**
 * Whether this user may see inside this mission.
 *
 * Checked by membership, not by role — a volunteer in org A must not read org
 * B's thread by changing an id in the URL. The coordinator desk sees all of
 * them, because the whole point of the record is that someone accountable can.
 */
export async function canAccessTask(taskId: number, user: SessionUser): Promise<boolean> {
  await dbReady();
  if (user.role === "coordinator") return true;
  const scope = await taskScope(taskId);
  if (!scope) return false;
  const m = await db().execute({
    sql: "SELECT 1 FROM memberships WHERE team_id = ? AND user_id = ?",
    args: [scope.teamId, user.id],
  });
  return m.rows.length > 0;
}

// ────────────────────────────────────────────── chat

export interface Message {
  id: number;
  taskId: number;
  userId: number;
  name: string;
  role: string;
  body: string;
  at: string;
}

export async function listMessages(taskId: number, sinceId = 0): Promise<Message[]> {
  await dbReady();
  const r = await db().execute({
    sql: `SELECT m.id, m.task_id, m.user_id, m.body, m.created_at, u.name, u.role
          FROM messages m JOIN users u ON u.id = m.user_id
          WHERE m.task_id = ? AND m.id > ?
          ORDER BY m.id LIMIT 200`,
    args: [taskId, sinceId],
  });
  return r.rows.map((row) => ({
    id: Number(row.id),
    taskId: Number(row.task_id),
    userId: Number(row.user_id),
    name: String(row.name),
    role: String(row.role),
    body: String(row.body),
    at: String(row.created_at),
  }));
}

export async function postMessage(taskId: number, userId: number, body: string): Promise<Message[]> {
  await dbReady();
  await db().execute({
    sql: "INSERT INTO messages (task_id, user_id, body) VALUES (?,?,?)",
    args: [taskId, userId, body.slice(0, 2000)],
  });
  return listMessages(taskId);
}

// ────────────────────────────────────────────── field reports

export interface FieldReport {
  id: number;
  taskId: number;
  userId: number;
  name: string;
  kind: "note" | "photo";
  body: string | null;
  media: string | null;
  mediaType: string | null;
  capturedAt: string | null;
  at: string;
}

/**
 * Media limits. ~800KB of data-URL is a phone photo compressed client-side to
 * 1280px JPEG. Bigger than that and SQLite rows stop being the right home —
 * which is stated in the platform doc as the first thing that breaks at scale.
 */
const MEDIA_MAX_CHARS = 1_100_000;
const MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function listReports(taskId: number): Promise<FieldReport[]> {
  await dbReady();
  const r = await db().execute({
    sql: `SELECT f.id, f.task_id, f.user_id, f.kind, f.body, f.media, f.media_type,
                 f.captured_at, f.created_at, u.name
          FROM field_reports f JOIN users u ON u.id = f.user_id
          WHERE f.task_id = ? ORDER BY f.id DESC LIMIT 30`,
    args: [taskId],
  });
  return r.rows.map((row) => ({
    id: Number(row.id),
    taskId: Number(row.task_id),
    userId: Number(row.user_id),
    name: String(row.name),
    kind: String(row.kind) as FieldReport["kind"],
    body: row.body === null ? null : String(row.body),
    media: row.media === null ? null : String(row.media),
    mediaType: row.media_type === null ? null : String(row.media_type),
    capturedAt: row.captured_at === null ? null : String(row.captured_at),
    at: String(row.created_at),
  }));
}

export async function addReport(
  taskId: number,
  userId: number,
  input: { kind: "note" | "photo"; body?: string; media?: string; mediaType?: string; capturedAt?: string },
): Promise<{ ok: true } | { ok: false; reason: string }> {
  await dbReady();

  if (input.kind === "photo") {
    if (!input.media?.startsWith("data:")) return { ok: false, reason: "Photo missing or malformed." };
    if (input.media.length > MEDIA_MAX_CHARS)
      return { ok: false, reason: "Photo too large — retake at lower quality; the queue keeps it under 800KB." };
    const declared = input.media.slice(5, input.media.indexOf(";"));
    if (!MEDIA_TYPES.has(declared) || declared !== (input.mediaType ?? declared)) {
      return { ok: false, reason: "Only JPEG, PNG or WebP photos are accepted." };
    }
  } else if (!input.body?.trim()) {
    return { ok: false, reason: "An empty note says nothing." };
  }

  // The claimed capture time is clamped like a task transition: the deployment
  // record wants field time, but not a time from the future or the far past.
  const now = Date.now();
  const t = input.capturedAt ? Date.parse(input.capturedAt) : NaN;
  const captured =
    Number.isNaN(t) || t > now + 2 * 60_000 || t < now - 7 * 864e5
      ? null
      : new Date(t).toISOString().replace("T", " ").slice(0, 19);

  await db().execute({
    sql: `INSERT INTO field_reports (task_id, user_id, kind, body, media, media_type, captured_at)
          VALUES (?,?,?,?,?,?,?)`,
    args: [
      taskId,
      userId,
      input.kind,
      input.body?.slice(0, 4000) ?? null,
      input.kind === "photo" ? (input.media ?? null) : null,
      input.kind === "photo" ? (input.mediaType ?? null) : null,
      captured,
    ],
  });
  return { ok: true };
}

// ────────────────────────────────────────────── broadcast requests

export interface BroadcastRequest {
  id: number;
  taskId: number;
  requestedBy: number;
  volunteer: string;
  org: string;
  incidentTitle: string;
  place: string | null;
  severity: number;
  message: string;
  status: "pending" | "approved" | "declined";
  decidedBy: number | null;
  alertId: number | null;
  at: string;
}

const BCAST_SELECT = `
  SELECT b.id, b.task_id, b.requested_by, b.message, b.status, b.decided_by, b.alert_id,
         b.created_at, u.name AS volunteer, t.name AS org, i.title AS incident_title,
         i.place, i.severity
  FROM broadcast_requests b
  JOIN users u ON u.id = b.requested_by
  JOIN tasks k ON k.id = b.task_id
  JOIN teams t ON t.id = k.team_id
  JOIN incidents i ON i.id = k.incident_id`;

function shapeRequest(row: Record<string, unknown>): BroadcastRequest {
  return {
    id: Number(row.id),
    taskId: Number(row.task_id),
    requestedBy: Number(row.requested_by),
    volunteer: String(row.volunteer),
    org: String(row.org),
    incidentTitle: String(row.incident_title),
    place: row.place === null ? null : String(row.place),
    severity: Number(row.severity),
    message: String(row.message),
    status: String(row.status) as BroadcastRequest["status"],
    decidedBy: row.decided_by === null ? null : Number(row.decided_by),
    alertId: row.alert_id === null ? null : Number(row.alert_id),
    at: String(row.created_at),
  };
}

export async function requestBroadcast(
  taskId: number,
  userId: number,
  message: string,
): Promise<{ ok: true; request: BroadcastRequest } | { ok: false; reason: string }> {
  await dbReady();
  if (!message.trim()) return { ok: false, reason: "Say what people near you need to hear." };

  // One live request per task per volunteer. A second while the first is
  // pending would only race the coordinator reading it.
  const dup = await db().execute({
    sql: "SELECT id FROM broadcast_requests WHERE task_id = ? AND requested_by = ? AND status = 'pending'",
    args: [taskId, userId],
  });
  if (dup.rows.length) return { ok: false, reason: "Your previous request is still waiting on the coordinator." };

  const r = await db().execute({
    sql: "INSERT INTO broadcast_requests (task_id, requested_by, message) VALUES (?,?,?) RETURNING id",
    args: [taskId, userId, message.slice(0, 600)],
  });
  const one = await db().execute({
    sql: `${BCAST_SELECT} WHERE b.id = ?`,
    args: [Number(r.rows[0].id)],
  });
  return { ok: true, request: shapeRequest(one.rows[0] as Record<string, unknown>) };
}

export async function listBroadcastRequests(taskId?: number): Promise<BroadcastRequest[]> {
  await dbReady();
  const r = taskId
    ? await db().execute({ sql: `${BCAST_SELECT} WHERE b.task_id = ? ORDER BY b.id DESC LIMIT 20`, args: [taskId] })
    : await db().execute(
        `${BCAST_SELECT} WHERE b.status = 'pending'
           OR b.decided_at > datetime('now','-24 hours')
         ORDER BY CASE b.status WHEN 'pending' THEN 0 ELSE 1 END, b.id DESC LIMIT 40`,
      );
  return r.rows.map((row) => shapeRequest(row as Record<string, unknown>));
}

/**
 * Approve or decline. Approval IS the human confirmation — the volunteer wrote
 * the words, the coordinator is reading them and their evidence, and the tap
 * sends exactly that wording to the incident's own area. Nothing re-derives
 * behind the decision.
 */
export async function decideBroadcast(
  requestId: number,
  coordinator: SessionUser,
  approve: boolean,
): Promise<
  | { ok: true; status: "declined" }
  | { ok: true; status: "approved"; recipients: number; delivery: unknown[]; region: string }
  | { ok: false; reason: string }
> {
  await dbReady();
  const r = await db().execute({ sql: `${BCAST_SELECT} WHERE b.id = ?`, args: [requestId] });
  const row = r.rows[0];
  if (!row) return { ok: false, reason: "No such request." };
  const req = shapeRequest(row as Record<string, unknown>);
  if (req.status !== "pending") return { ok: false, reason: `Already ${req.status}.` };

  if (!approve) {
    await db().execute({
      sql: "UPDATE broadcast_requests SET status='declined', decided_by=?, decided_at=datetime('now') WHERE id=?",
      args: [coordinator.id, requestId],
    });
    return { ok: true, status: "declined" };
  }

  const region = req.place ?? "India";
  const level = req.severity >= 4 ? "severe" : "warning";
  // The receipt names who asked and from where — an approved relay is still an
  // act with two authors, and the record should say so.
  const evidence = `Requested from the ground by ${req.volunteer} (${req.org}), on-mission at "${req.incidentTitle}". Approved by ${coordinator.name}.`;

  const ins = await db().execute({
    sql: `INSERT INTO alerts (region, level, message, evidence, channels, recipients, sent_by)
          VALUES (?,?,?,?,?,?,?) RETURNING id`,
    args: [region, level, req.message, evidence, "", 0, coordinator.id],
  });
  const alertId = Number(ins.rows[0].id);
  const { results, recipients } = await deliverAlert(alertId, region, req.message, level);
  const delivered = results.filter((x) => x.delivered > 0);
  await db().execute({
    sql: "UPDATE alerts SET channels = ?, recipients = ? WHERE id = ?",
    args: [delivered.map((d) => d.channel).join(",") || "none", recipients, alertId],
  });
  await db().execute({
    sql: "UPDATE broadcast_requests SET status='approved', decided_by=?, decided_at=datetime('now'), alert_id=? WHERE id=?",
    args: [coordinator.id, alertId, requestId],
  });

  return { ok: true, status: "approved", recipients, delivery: results, region };
}
