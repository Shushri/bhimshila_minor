import { randomBytes } from "crypto";
import { db, dbReady } from "./db";

/**
 * Organisations, membership, and the deployment log.
 *
 * Until now `teams` held 24 seeded rows with nobody inside them. The system
 * could say "NDRF 9th Battalion is deployed" and could not say who went,
 * whether they arrived, or what they found — which is precisely the deliverable
 * the organizers asked for and the only thing separating a volunteer account
 * from a citizen one.
 *
 * A task belongs to the organisation first and a person second. That ordering
 * matters: a dispatch that waits on one named individual to open their phone is
 * a dispatch that can stall, so anyone in the org can pick it up.
 */

export type OrgRole = "lead" | "member";
export type TaskStatus = "assigned" | "accepted" | "on_site" | "done" | "declined";

export interface Org {
  id: number;
  name: string;
  kind: string;
  place: string;
  lat: number;
  lng: number;
  status: string;
  capacity: number;
  contact: string | null;
  verified: boolean;
  memberCount: number;
  /** Only ever returned to a lead of that org or a coordinator. */
  inviteCode?: string;
}

export interface Task {
  id: number;
  /** Null when the mission answers an alert rather than a citizen report. */
  incidentId: number | null;
  /** Null when it answers an incident. One of the two is always set. */
  alertId: number | null;
  /** What the coordinator asked for, in their words. */
  note: string | null;
  /** Who raised it — null for a dispatch, which the system raises. */
  raisedBy: string | null;
  teamId: number;
  teamName: string;
  assigneeUserId: number | null;
  assigneeName: string | null;
  status: TaskStatus;
  outcome: string | null;
  createdAt: string;
  acceptedAt: string | null;
  onSiteAt: string | null;
  doneAt: string | null;
  // Denormalised from the incident so a volunteer's screen is one query and
  // renders with no network beyond the first load.
  title: string;
  category: string;
  place: string | null;
  severity: number;
  peopleCount: number | null;
  lat: number | null;
  lng: number | null;
}

const code = () => randomBytes(4).toString("hex");

// ─────────────────────────────────────────────────────────── organisations

export async function createOrg(input: {
  name: string;
  kind: string;
  place: string;
  lat: number;
  lng: number;
  contact?: string | null;
  capacity?: number;
  createdBy: number;
}): Promise<Org> {
  await dbReady();
  const r = await db().execute({
    sql: `INSERT INTO teams (name, kind, place, lat, lng, capacity, contact, created_by, verified, invite_code)
          VALUES (?,?,?,?,?,?,?,?,1,?) RETURNING id`,
    args: [
      input.name.trim(),
      input.kind,
      input.place.trim(),
      input.lat,
      input.lng,
      input.capacity ?? 20,
      input.contact?.trim() || null,
      input.createdBy,
      code(),
    ],
  });
  const id = Number(r.rows[0].id);

  // Whoever registers it leads it. Without this an org exists with no one able
  // to add anyone, and a coordinator has to be called back for every member.
  await db().execute({
    sql: "INSERT INTO memberships (team_id, user_id, role_in_org) VALUES (?,?,'lead')",
    args: [id, input.createdBy],
  });

  return (await getOrg(id, input.createdBy))!;
}

export async function getOrg(id: number, viewerId: number | null): Promise<Org | null> {
  await dbReady();
  const r = await db().execute({
    sql: `SELECT t.*, (SELECT COUNT(*) FROM memberships m WHERE m.team_id = t.id) AS members
          FROM teams t WHERE t.id = ?`,
    args: [id],
  });
  const row = r.rows[0];
  if (!row) return null;

  const canSeeCode = viewerId !== null && (await isLead(id, viewerId));
  return shapeOrg(row, canSeeCode);
}

function shapeOrg(row: Record<string, unknown>, withCode: boolean): Org {
  return {
    id: Number(row.id),
    name: String(row.name),
    kind: String(row.kind),
    place: String(row.place),
    lat: Number(row.lat),
    lng: Number(row.lng),
    status: String(row.status),
    capacity: Number(row.capacity),
    contact: row.contact === null ? null : String(row.contact),
    verified: Number(row.verified) === 1,
    memberCount: Number(row.members ?? 0),
    ...(withCode && row.invite_code ? { inviteCode: String(row.invite_code) } : {}),
  };
}

export async function listOrgs(viewerId: number | null): Promise<Org[]> {
  await dbReady();
  const r = await db().execute(
    `SELECT t.*, (SELECT COUNT(*) FROM memberships m WHERE m.team_id = t.id) AS members
     FROM teams t ORDER BY t.name`,
  );
  const led = viewerId === null ? new Set<number>() : await ledBy(viewerId);
  return r.rows.map((row) => shapeOrg(row, led.has(Number(row.id))));
}

async function ledBy(userId: number): Promise<Set<number>> {
  const r = await db().execute({
    sql: "SELECT team_id FROM memberships WHERE user_id = ? AND role_in_org = 'lead'",
    args: [userId],
  });
  return new Set(r.rows.map((x) => Number(x.team_id)));
}

export async function isLead(teamId: number, userId: number): Promise<boolean> {
  const r = await db().execute({
    sql: "SELECT 1 FROM memberships WHERE team_id = ? AND user_id = ? AND role_in_org = 'lead'",
    args: [teamId, userId],
  });
  return r.rows.length > 0;
}

/** Every org this person belongs to. Drives what tasks they can see. */
export async function orgsOf(userId: number): Promise<{ id: number; name: string; role: OrgRole }[]> {
  await dbReady();
  const r = await db().execute({
    sql: `SELECT t.id, t.name, m.role_in_org FROM memberships m
          JOIN teams t ON t.id = m.team_id WHERE m.user_id = ? ORDER BY t.name`,
    args: [userId],
  });
  return r.rows.map((x) => ({
    id: Number(x.id),
    name: String(x.name),
    role: String(x.role_in_org) as OrgRole,
  }));
}

/**
 * Join by invite code.
 *
 * The same handshake the Telegram link already uses: a code is minted with the
 * org, shared as a link, and redeemed by whoever opens it. Idempotent, because
 * a volunteer who taps the link twice should not see an error.
 */
export async function joinByCode(
  inviteCode: string,
  userId: number,
): Promise<{ ok: boolean; org?: Org; reason?: string }> {
  await dbReady();
  const r = await db().execute({
    sql: "SELECT id FROM teams WHERE invite_code = ?",
    args: [inviteCode.trim().toLowerCase()],
  });
  const row = r.rows[0];
  if (!row) return { ok: false, reason: "That invite link is not valid." };

  const teamId = Number(row.id);
  await db().execute({
    sql: `INSERT INTO memberships (team_id, user_id, role_in_org) VALUES (?,?,'member')
          ON CONFLICT(team_id, user_id) DO NOTHING`,
    args: [teamId, userId],
  });
  return { ok: true, org: (await getOrg(teamId, userId))! };
}

export async function membersOf(teamId: number) {
  await dbReady();
  const r = await db().execute({
    sql: `SELECT u.id, u.name, u.phone, m.role_in_org, m.joined_at
          FROM memberships m JOIN users u ON u.id = m.user_id
          WHERE m.team_id = ? ORDER BY m.role_in_org, u.name`,
    args: [teamId],
  });
  return r.rows.map((x) => ({
    id: Number(x.id),
    name: String(x.name),
    phone: String(x.phone),
    role: String(x.role_in_org) as OrgRole,
    joinedAt: String(x.joined_at),
  }));
}

// ──────────────────────────────────────────────────────────────── tasks

/**
 * A mission raised by a coordinator, for named volunteers.
 *
 * One row per volunteer rather than one row for the group, because a mission
 * is a thing a person does: two volunteers sent to the same place still arrive
 * separately, and a shared row could only record one arrival and one outcome.
 * The board already groups by incident, so the pair still read as one job.
 *
 * Either an incident or an alert — a mission answers a citizen's SOS or an
 * authority's warning, and it is worth knowing which. Neither is accepted,
 * because a mission with no cause is a task nobody can judge the priority of.
 */
export async function createMission(input: {
  teamId: number;
  volunteerIds: number[];
  note: string;
  incidentId?: number | null;
  alertId?: number | null;
  createdBy: number;
}): Promise<{ ok: boolean; taskIds?: number[]; reason?: string }> {
  await dbReady();

  const note = input.note.trim();
  if (!note) return { ok: false, reason: "A mission needs a brief — say what to do." };
  if (!input.volunteerIds.length) return { ok: false, reason: "Choose at least one volunteer." };
  if (!input.incidentId && !input.alertId) {
    return { ok: false, reason: "Link the mission to an incident or an alert." };
  }

  // Everyone named must actually be in this organisation. Without the check a
  // coordinator could address a mission to somebody else's volunteer, who
  // would then see a job from an org they do not belong to.
  const members = await db().execute({
    sql: `SELECT user_id FROM memberships WHERE team_id = ?`,
    args: [input.teamId],
  });
  const allowed = new Set(members.rows.map((r) => Number(r.user_id)));
  const outsiders = input.volunteerIds.filter((id) => !allowed.has(id));
  if (outsiders.length) {
    return { ok: false, reason: `${outsiders.length} of those volunteers are not in this organisation.` };
  }

  const created = await db().batch(
    input.volunteerIds.map((uid) => ({
      sql: `INSERT INTO tasks (incident_id, alert_id, team_id, assignee_user_id, note, created_by, status)
            VALUES (?,?,?,?,?,?,'assigned') RETURNING id`,
      args: [input.incidentId ?? null, input.alertId ?? null, input.teamId, uid, note, input.createdBy],
    })),
    "write",
  );

  return { ok: true, taskIds: created.map((r) => Number(r.rows[0].id)) };
}

/** Raised when a dispatch is confirmed. Unassigned within the org by default. */
export async function createTask(incidentId: number, teamId: number): Promise<number> {
  await dbReady();
  const r = await db().execute({
    sql: "INSERT INTO tasks (incident_id, team_id) VALUES (?,?) RETURNING id",
    args: [incidentId, teamId],
  });
  return Number(r.rows[0].id);
}

/*
 * LEFT JOIN on incidents, not INNER.
 *
 * A coordinator-raised mission answers an alert and has no incident, and an
 * inner join silently dropped every one of them — the volunteer's board showed
 * nothing, the coordinator's board showed nothing, and the task existed
 * perfectly well in the table the whole time. A missing row is a worse failure
 * than an error, because nothing anywhere says it happened.
 *
 * Where the incident supplied the headline, the alert now does.
 */
const TASK_SELECT = `
  SELECT t.*, tm.name AS team_name, u.name AS assignee_name,
         COALESCE(i.title, 'Response — ' || a.region) AS title,
         COALESCE(i.category, 'alert') AS category,
         COALESCE(i.place, a.region) AS place,
         COALESCE(i.severity, CASE a.level WHEN 'severe' THEN 5 WHEN 'warning' THEN 4 ELSE 3 END) AS severity,
         i.people_count, i.lat, i.lng,
         a.id AS alert_ref, a.level AS alert_level, a.region AS alert_region,
         c.name AS raised_by
  FROM tasks t
  JOIN teams tm ON tm.id = t.team_id
  LEFT JOIN incidents i ON i.id = t.incident_id
  LEFT JOIN alerts a ON a.id = t.alert_id
  LEFT JOIN users c ON c.id = t.created_by
  LEFT JOIN users u ON u.id = t.assignee_user_id`;

function shapeTask(x: Record<string, unknown>): Task {
  return {
    id: Number(x.id),
    incidentId: x.incident_id === null ? null : Number(x.incident_id),
    alertId: x.alert_ref === null ? null : Number(x.alert_ref),
    note: x.note === null ? null : String(x.note),
    raisedBy: x.raised_by === null ? null : String(x.raised_by),
    teamId: Number(x.team_id),
    teamName: String(x.team_name),
    assigneeUserId: x.assignee_user_id === null ? null : Number(x.assignee_user_id),
    assigneeName: x.assignee_name === null ? null : String(x.assignee_name),
    status: String(x.status) as TaskStatus,
    outcome: x.outcome === null ? null : String(x.outcome),
    createdAt: String(x.created_at),
    acceptedAt: x.accepted_at === null ? null : String(x.accepted_at),
    onSiteAt: x.on_site_at === null ? null : String(x.on_site_at),
    doneAt: x.done_at === null ? null : String(x.done_at),
    title: String(x.title),
    category: String(x.category),
    place: x.place === null ? null : String(x.place),
    severity: Number(x.severity),
    peopleCount: x.people_count === null ? null : Number(x.people_count),
    lat: x.lat === null ? null : Number(x.lat),
    lng: x.lng === null ? null : Number(x.lng),
  };
}

/**
 * What one volunteer should see.
 *
 * Everything still open for any org they belong to, plus anything they
 * personally closed today — so a finished task does not vanish the instant it
 * is marked done and leave them wondering whether it registered.
 */
export async function tasksForUser(userId: number): Promise<Task[]> {
  await dbReady();
  const r = await db().execute({
    sql: `${TASK_SELECT}
          WHERE t.team_id IN (SELECT team_id FROM memberships WHERE user_id = ?)
            AND (t.status != 'done' OR t.done_at > datetime('now','-12 hours'))
          ORDER BY
            CASE t.status WHEN 'on_site' THEN 0 WHEN 'accepted' THEN 1
                          WHEN 'assigned' THEN 2 ELSE 3 END,
            severity DESC, t.created_at DESC`,
    args: [userId],
  });
  return r.rows.map(shapeTask);
}

/** Every live task, for the coordinator's deployment view. */
export async function allTasks(): Promise<Task[]> {
  await dbReady();
  const r = await db().execute(
    `${TASK_SELECT}
     WHERE t.status != 'done' OR t.done_at > datetime('now','-24 hours')
     ORDER BY t.created_at DESC`,
  );
  return r.rows.map(shapeTask);
}

/**
 * Where a mission can go next.
 *
 * `assigned → on_site` was added when coordinators began raising missions for
 * a named volunteer. Accepting is how an unclaimed team task gets an owner —
 * it answers "who is taking this". A mission addressed to one person by name
 * has already been answered, so making them press Accept before they can say
 * they have arrived is a step that carries no information, and one more thing
 * to do on a phone at eleven percent.
 *
 * Accept is kept, not removed: a dispatch still lands on the whole
 * organisation with nobody's name on it, and there it is the only way anyone
 * learns who went.
 */
const NEXT: Record<TaskStatus, TaskStatus[]> = {
  assigned: ["accepted", "on_site", "declined"],
  accepted: ["on_site", "declined"],
  on_site: ["done"],
  done: [],
  declined: [],
};

/**
 * Move a task forward.
 *
 * Transitions are checked rather than trusted. The volunteer screen queues
 * these offline and replays them when the network returns, so the same
 * transition can legitimately arrive twice — replaying "accept" on a task
 * already on site must not drag it backwards.
 */
/**
 * When the volunteer pressed the button, not when the request arrived.
 *
 * The offline queue replays actions hours after they happened, and the
 * deployment log is only honest if it records the press. Client clocks lie,
 * though, so the claim is clamped: nothing from the future, nothing older than
 * a week — outside that window the sync time is the better truth.
 */
function actionTime(claimed?: string): string {
  const now = Date.now();
  const t = claimed ? Date.parse(claimed) : NaN;
  if (Number.isNaN(t) || t > now + 2 * 60_000 || t < now - 7 * 864e5) {
    return new Date(now).toISOString().replace("T", " ").slice(0, 19);
  }
  return new Date(t).toISOString().replace("T", " ").slice(0, 19);
}

export async function advanceTask(
  taskId: number,
  userId: number,
  to: TaskStatus,
  outcome?: string,
  at?: string,
): Promise<{ ok: boolean; task?: Task; reason?: string }> {
  await dbReady();
  const cur = await db().execute({
    sql: `SELECT t.status, t.team_id, t.assignee_user_id, t.incident_id FROM tasks t WHERE t.id = ?`,
    args: [taskId],
  });
  const row = cur.rows[0];
  if (!row) return { ok: false, reason: "No such task." };

  const member = await db().execute({
    sql: "SELECT 1 FROM memberships WHERE team_id = ? AND user_id = ?",
    args: [Number(row.team_id), userId],
  });
  if (!member.rows.length) return { ok: false, reason: "That task belongs to another organisation." };

  // Nobody records somebody else's arrival.
  //
  // The transitions on a task are the deployment log — accepted at, on site
  // at, done by. If a coordinator can advance a mission they sent to a
  // volunteer, the log ends up saying the coordinator went, and that is the
  // one record in this product that has to be true. Stated as a rule about
  // ownership rather than about roles, so it also stops one volunteer closing
  // another's mission.
  //
  // An unclaimed dispatch has no owner yet, and accepting it is exactly how it
  // gets one — so that path stays open to anyone in the organisation.
  const owner = row.assignee_user_id === null ? null : Number(row.assignee_user_id);
  if (owner !== null && owner !== userId) {
    return {
      ok: false,
      reason: "This mission belongs to someone else — only they can report on it.",
    };
  }

  const from = String(row.status) as TaskStatus;
  // A replayed offline action that has already landed is a success, not an
  // error — the volunteer did the right thing and the network was the problem.
  if (from === to) return { ok: true, task: (await oneTask(taskId))! };
  if (!NEXT[from].includes(to)) {
    return { ok: false, reason: `Cannot go from ${from} to ${to}.` };
  }

  const stamp =
    to === "accepted" ? "accepted_at" : to === "on_site" ? "on_site_at" : to === "done" ? "done_at" : null;
  const when = actionTime(at);

  await db().execute({
    sql: `UPDATE tasks SET status = ?, assignee_user_id = COALESCE(assignee_user_id, ?)
          ${stamp ? `, ${stamp} = ?` : ""}
          ${to === "done" ? ", outcome = ?" : ""}
          WHERE id = ?`,
    args:
      to === "done"
        ? [to, userId, ...(stamp ? [when] : []), outcome ?? "completed", taskId]
        : [to, userId, ...(stamp ? [when] : []), taskId],
  });

  // Closing the last open task on an incident closes the incident and releases
  // the team, so the board reflects the ground without a second action.
  if (to === "done" && row.incident_id !== null) {
    const open = await db().execute({
      sql: "SELECT COUNT(*) AS n FROM tasks WHERE incident_id = ? AND status NOT IN ('done','declined')",
      args: [Number(row.incident_id)],
    });
    if (Number(open.rows[0].n) === 0) {
      await db().execute({
        sql: "UPDATE incidents SET status='resolved', updated_at=datetime('now') WHERE id = ?",
        args: [Number(row.incident_id)],
      });
      await db().execute({
        sql: "UPDATE teams SET status='available' WHERE id = ?",
        args: [Number(row.team_id)],
      });
    }
  }

  return { ok: true, task: (await oneTask(taskId))! };
}

async function oneTask(id: number): Promise<Task | null> {
  const r = await db().execute({ sql: `${TASK_SELECT} WHERE t.id = ?`, args: [id] });
  return r.rows[0] ? shapeTask(r.rows[0]) : null;
}
