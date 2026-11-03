import { db, haversineKm } from "./db";
import { chat, resolveProviders, isTransient, sortForExtraction } from "./agent/llm";
import { findRegion, findLocality } from "./kb/regions";
import { CENTROIDS } from "./kb/national";
import { parseHeuristically, reconcileSos, CATEGORIES } from "./triage";
import type { SosCategory, ParsedSos } from "./triage";

export type { SosCategory, ParsedSos };

/**
 * Relief operations: intake → clustering → prioritisation → dispatch.
 *
 * The split matters. Understanding "paani ghar me ghus gaya, teen bacche hain"
 * is a language problem, so the model does it. Deciding who gets rescued first
 * is not — that is deterministic and explainable, for the same reason the risk
 * engine is: a hallucinated priority is a harm, not a bug.
 */

/**
 * How long an SOS will wait for the model before going without it.
 *
 * Measured, not chosen: a reasoning model — sarvam-105b thinks before it
 * answers, and returns that thinking in a `reasoning_content` field — took 14
 * to 23 seconds on this prompt. That is a person standing in water, watching
 * a spinner, wondering whether anyone heard them.
 *
 * The keyword parser was already the safety floor: it decides category and
 * severity, and the model is not permitted to lower either (see reconcileSos).
 * So it can be the latency floor too. What the model adds beyond the floor —
 * the place, the headcount, a readable summary — is genuinely useful and
 * genuinely optional. None of it is worth twenty seconds of silence.
 *
 * Four seconds is roughly where a fast provider lands with room to spare, and
 * well inside what someone will wait after pressing send.
 */
const SOS_MODEL_BUDGET_MS = 4_000;

/**
 * Structure a free-text SOS.
 *
 * Uses the model for language and the keyword parser for anything that decides
 * priority — see reconcileSos. Falls back entirely to keywords when no model is
 * reachable or simply too slow, because an SOS must never be lost to a rate
 * limit and must never be delayed by one either.
 */
/**
 * Resolve to null once the budget is spent, rather than waiting.
 *
 * The in-flight request is deliberately not cancelled — it may already be most
 * of the way through, and its result is simply no longer waited on. What it
 * must not do is reject into nothing: an unhandled rejection from an abandoned
 * call would take down the process for a request nobody is reading.
 */
async function withBudget<T>(work: Promise<T>, ms = SOS_MODEL_BUDGET_MS): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([work.catch(() => null), expiry]);
  } finally {
    clearTimeout(timer);
  }
}

export async function parseSos(message: string): Promise<ParsedSos> {
  const keywords = parseHeuristically(message);
  // Extraction, not judgement — a reasoning model is slower here and returns
  // less. See sortForExtraction.
  const providers = sortForExtraction(resolveProviders());
  if (!providers.length) return keywords;

  try {
    const reply = await withBudget(chatWithFailover(
      providers,
      [
        {
          role: "system",
          content:
            "You convert emergency messages into structured data. The message may be Hindi, English or a mix. " +
            "Reply with ONLY a JSON object, no prose, no markdown fences:\n" +
            '{"category":"rescue|medical|food_water|shelter|missing|other","severity":1-5,' +
            '"people_count":number|null,"place":string|null,"summary":"one short line in English"}\n' +
            "severity 5 = life in immediate danger, 4 = urgent injury or trapped, 3 = needs help today, " +
            "2 = needs supplies, 1 = information only.",
        },
        { role: "user", content: message },
      ],
    ));

    // Budget spent — the keyword floor already has category and severity, and
    // those are the two fields that decide who gets help first.
    if (!reply) return keywords;

    const raw = reply.content.replace(/```json|```/g, "").trim();
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end < 0) return keywords;

    const j = JSON.parse(raw.slice(start, end + 1));
    const count = Number(j.people_count);

    return reconcileSos(keywords, {
      category: CATEGORIES.includes(j.category) ? j.category : "other",
      severity: Math.min(5, Math.max(1, Number(j.severity) || 3)),
      // Zero is not a count — models emit it to mean "unknown", and a literal 0
      // would read as an emergency affecting nobody.
      peopleCount: Number.isFinite(count) && count > 0 ? count : null,
      place: typeof j.place === "string" && j.place.trim() ? j.place.trim() : null,
      summary: (typeof j.summary === "string" && j.summary.trim() ? j.summary : message).slice(0, 140),
    });
  } catch {
    return keywords;
  }
}

/**
 * Try each provider in turn on a rate limit. Classifying an SOS is the one call
 * that must not fail — the keyword fallback is the floor, but a second key is
 * a far better answer than falling back to keywords.
 */
async function chatWithFailover(
  providers: ReturnType<typeof resolveProviders>,
  messages: Parameters<typeof chat>[1],
) {
  let lastErr: unknown;
  for (const p of providers) {
    try {
      return await chat(p, messages, []);
    } catch (err) {
      lastErr = err;
      if (!isTransient(err)) throw err;
    }
  }
  throw lastErr;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

/**
 * Resolve a place name to coordinates.
 *
 * Districts are checked before states because they are far more specific, and
 * they cover all 757 — the curated region set only details Himachal, so
 * without this an SOS from Thrissur has no location, and an unlocated report
 * can never be clustered with the ones next to it.
 */
export function locate(place: string | null): { lat: number; lng: number; name: string } | null {
  if (!place) return null;

  const loc = findLocality(place);
  if (loc) return { lat: loc.center[0], lng: loc.center[1], name: loc.name };

  const q = norm(place);
  if (q.length >= 3) {
    const exact = CENTROIDS.find((c) => c.d && norm(c.d) === q);
    if (exact) return { lat: exact.lat, lng: exact.lng, name: exact.d };

    const partial = CENTROIDS.find(
      (c) => c.d && (norm(c.d).startsWith(q) || q.startsWith(norm(c.d))),
    );
    if (partial) return { lat: partial.lat, lng: partial.lng, name: partial.d };
  }

  const region = findRegion(place);
  if (region) return { lat: region.center[0], lng: region.center[1], name: region.name };
  return null;
}

const CLUSTER_RADIUS_KM = 12;
const CLUSTER_WINDOW_HOURS = 12;

/**
 * Attach a report to an existing incident, or open a new one.
 *
 * This is what stops "aid duplicating in some areas and never arriving in
 * others": ten calls about one collapsed bridge become one incident with ten
 * corroborating reports, not ten dispatches.
 */
export async function clusterIntoIncident(sos: {
  id: number;
  category: SosCategory;
  severity: number;
  peopleCount: number | null;
  place: string | null;
  lat: number | null;
  lng: number | null;
  summary: string;
}): Promise<number> {
  const c = db();

  if (sos.lat !== null && sos.lng !== null) {
    const open = await c.execute({
      sql: `SELECT id, lat, lng, severity, report_count, people_count
            FROM incidents
            WHERE status != 'resolved' AND category = ?
              AND created_at > datetime('now', ?)`,
      args: [sos.category, `-${CLUSTER_WINDOW_HOURS} hours`],
    });

    for (const row of open.rows) {
      if (row.lat === null || row.lng === null) continue;
      const km = haversineKm(sos.lat, sos.lng, Number(row.lat), Number(row.lng));
      if (km > CLUSTER_RADIUS_KM) continue;

      // Same event: corroboration raises confidence, and the incident keeps the
      // worst severity and the largest headcount reported.
      await c.execute({
        sql: `UPDATE incidents
              SET report_count = report_count + 1,
                  severity = MAX(severity, ?),
                  people_count = MAX(COALESCE(people_count,0), COALESCE(?,0)),
                  updated_at = datetime('now')
              WHERE id = ?`,
        args: [sos.severity, sos.peopleCount, Number(row.id)],
      });
      await c.execute({
        sql: "UPDATE sos_requests SET incident_id = ? WHERE id = ?",
        args: [Number(row.id), sos.id],
      });
      return Number(row.id);
    }
  }

  const r = await c.execute({
    sql: `INSERT INTO incidents (title, category, severity, people_count, place, lat, lng)
          VALUES (?,?,?,?,?,?,?) RETURNING id`,
    args: [sos.summary, sos.category, sos.severity, sos.peopleCount, sos.place, sos.lat, sos.lng],
  });
  const id = Number(r.rows[0].id);
  await c.execute({
    sql: "UPDATE sos_requests SET incident_id = ? WHERE id = ?",
    args: [id, sos.id],
  });
  return id;
}

export interface RankedIncident {
  id: number;
  title: string;
  category: string;
  severity: number;
  status: string;
  reportCount: number;
  peopleCount: number | null;
  place: string | null;
  lat: number | null;
  lng: number | null;
  assignedTeam: string | null;
  waitingMinutes: number;
  priority: number;
  reasons: string[];
}

/**
 * Priority — deterministic, weighted, explainable.
 *
 * Severity dominates; corroboration and headcount raise it; time waiting raises
 * it so nothing starves; an assigned incident drops down because coverage is
 * already on the way. That last term is what surfaces the gap rather than
 * piling more responders onto the loudest incident.
 */
export function prioritise(rows: RankedIncident[]): RankedIncident[] {
  for (const i of rows) {
    const reasons: string[] = [];

    const sev = i.severity * 14;
    reasons.push(`severity ${i.severity}/5`);

    const corroboration = Math.min(20, (i.reportCount - 1) * 7);
    if (corroboration) reasons.push(`${i.reportCount} independent reports`);

    const people = i.peopleCount ? Math.min(18, Math.log10(i.peopleCount + 1) * 14) : 0;
    if (i.peopleCount) reasons.push(`${i.peopleCount} people affected`);

    const waiting = Math.min(18, (i.waitingMinutes / 60) * 6);
    if (i.waitingMinutes > 30) reasons.push(`waiting ${Math.round(i.waitingMinutes)} min`);

    const covered = i.status === "assigned" ? -30 : 0;
    if (covered) reasons.push("team already dispatched");

    i.priority = Math.max(0, Math.round(sev + corroboration + people + waiting + covered));
    i.reasons = reasons;
  }
  return rows.sort((a, b) => b.priority - a.priority);
}

export async function listIncidents(limit = 20): Promise<RankedIncident[]> {
  const r = await db().execute({
    sql: `SELECT i.*, t.name AS team_name,
                 (julianday('now') - julianday(i.created_at)) * 1440 AS waiting_minutes
          FROM incidents i
          LEFT JOIN teams t ON t.id = i.assigned_team_id
          WHERE i.status != 'resolved'
          ORDER BY i.created_at DESC
          LIMIT ?`,
    args: [limit],
  });

  return prioritise(
    r.rows.map((row) => ({
      id: Number(row.id),
      title: String(row.title),
      category: String(row.category),
      severity: Number(row.severity),
      status: String(row.status),
      reportCount: Number(row.report_count),
      peopleCount: row.people_count === null ? null : Number(row.people_count),
      place: row.place === null ? null : String(row.place),
      lat: row.lat === null ? null : Number(row.lat),
      lng: row.lng === null ? null : Number(row.lng),
      assignedTeam: row.team_name === null ? null : String(row.team_name),
      waitingMinutes: Number(row.waiting_minutes) || 0,
      priority: 0,
      reasons: [],
    })),
  );
}

export interface NearestTeam {
  id: number;
  name: string;
  kind: string;
  place: string;
  distanceKm: number;
  status: string;
}

/**
 * How much further we will travel to get the right kind of team.
 *
 * Specialisation is worth a detour, not a journey — an ambulance 1,600km away
 * is not an ambulance. And the detour worth taking shrinks as the emergency
 * gets worse: for a severe bleed, whoever arrives first should go and the
 * specialist can follow. Hence severity decides, not a fixed number.
 */
export function specialistSlackKm(severity: number): number {
  if (severity >= 5) return 30; // life in immediate danger — speed dominates
  if (severity === 4) return 80;
  return 200; // supplies and shelter can wait for the right unit
}

/** Nearest available team, preferring a kind but never at an absurd distance. */
export async function nearestTeams(
  lat: number,
  lng: number,
  preferKind?: string,
  limit = 3,
  slackKm = 120,
): Promise<NearestTeam[]> {
  const r = await db().execute(
    "SELECT id, name, kind, place, lat, lng, status FROM teams WHERE status = 'available'",
  );

  const all = r.rows
    .map((row) => ({
      id: Number(row.id),
      name: String(row.name),
      kind: String(row.kind),
      place: String(row.place),
      status: String(row.status),
      distanceKm: Math.round(haversineKm(lat, lng, Number(row.lat), Number(row.lng))),
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm);

  if (!preferKind || !all.length) return all.slice(0, limit);

  const specialist = all.find((t) => t.kind === preferKind);
  const nearest = all[0];

  // Worth the detour → lead with the specialist. Otherwise lead with whoever
  // can actually get there, and keep the specialist in the list as backup.
  const specialistWins = specialist && specialist.distanceKm <= nearest.distanceKm + slackKm;

  const ordered = specialistWins
    ? [specialist, ...all.filter((t) => t.id !== specialist.id)]
    : all;

  return ordered.slice(0, limit);
}
