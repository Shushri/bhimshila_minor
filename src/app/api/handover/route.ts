import { db, dbReady } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { chat, isTransient, resolveProviders } from "@/lib/agent/llm";

export const maxDuration = 10;

/**
 * The shift handover — twelve hours of the record, written down.
 *
 * Control rooms run on handovers, and a handover written from memory at the
 * end of a night shift is where facts go to die. Every number here is a
 * query; the model only turns them into three readable paragraphs, and when
 * no model is reachable the deterministic assembly IS the brief — less
 * elegant, equally true.
 */

interface Facts {
  window: string;
  alertsNew: number;
  alertsRed: number;
  worstAlert: string | null;
  sosCount: number;
  incidentsOpened: number;
  incidentsResolved: number;
  dispatches: { team: string; incident: string; status: string; outcome: string | null }[];
  broadcasts: { region: string; level: string; recipients: number }[];
  pendingWatch: number;
  pendingRequests: number;
}

async function gatherFacts(): Promise<Facts> {
  const [alerts, worst, sos, opened, resolved, tasks, casts, watchQ, reqQ] = await Promise.all([
    db().execute(
      `SELECT COUNT(*) AS n, SUM(CASE WHEN colour='red' THEN 1 ELSE 0 END) AS red
       FROM seen_alerts WHERE first_seen_at > datetime('now','-12 hours')`,
    ),
    db().execute(
      `SELECT disaster_type, area, colour, people FROM seen_alerts
       WHERE first_seen_at > datetime('now','-12 hours')
       ORDER BY CASE colour WHEN 'red' THEN 3 WHEN 'orange' THEN 2 ELSE 1 END DESC, people DESC LIMIT 1`,
    ),
    db().execute("SELECT COUNT(*) AS n FROM sos_requests WHERE created_at > datetime('now','-12 hours')"),
    db().execute("SELECT COUNT(*) AS n FROM incidents WHERE created_at > datetime('now','-12 hours')"),
    db().execute(
      `SELECT COUNT(*) AS n FROM incidents
       WHERE status='resolved' AND updated_at > datetime('now','-12 hours')`,
    ),
    db().execute(
      `SELECT tm.name AS team, i.title AS incident, t.status, t.outcome
       FROM tasks t JOIN teams tm ON tm.id=t.team_id JOIN incidents i ON i.id=t.incident_id
       WHERE t.created_at > datetime('now','-12 hours') ORDER BY t.id DESC LIMIT 8`,
    ),
    db().execute(
      `SELECT region, level, recipients FROM alerts
       WHERE created_at > datetime('now','-12 hours') ORDER BY id DESC LIMIT 8`,
    ),
    db().execute(
      `SELECT COUNT(*) AS n FROM seen_alerts
       WHERE acknowledged_at IS NULL AND colour IN ('red','orange')`,
    ),
    db().execute("SELECT COUNT(*) AS n FROM broadcast_requests WHERE status='pending'"),
  ]);

  const w = worst.rows[0];
  return {
    window: "last 12 hours",
    alertsNew: Number(alerts.rows[0].n),
    alertsRed: Number(alerts.rows[0].red ?? 0),
    worstAlert: w
      ? `${w.colour} ${w.disaster_type} over ${String(w.area).slice(0, 70)}${Number(w.people) ? `, ~${Number(w.people).toLocaleString("en-IN")} people under it` : ""}`
      : null,
    sosCount: Number(sos.rows[0].n),
    incidentsOpened: Number(opened.rows[0].n),
    incidentsResolved: Number(resolved.rows[0].n),
    dispatches: tasks.rows.map((r) => ({
      team: String(r.team),
      incident: String(r.incident),
      status: String(r.status),
      outcome: r.outcome === null ? null : String(r.outcome),
    })),
    broadcasts: casts.rows.map((r) => ({
      region: String(r.region),
      level: String(r.level),
      recipients: Number(r.recipients),
    })),
    pendingWatch: Number(watchQ.rows[0].n),
    pendingRequests: Number(reqQ.rows[0].n),
  };
}

/** The brief with no model: the facts, in order, in sentences. */
function assemble(f: Facts): string {
  const lines: string[] = [];
  lines.push(
    `Official alerts: ${f.alertsNew} new in the ${f.window}${f.alertsRed ? `, ${f.alertsRed} red` : ""}.` +
      (f.worstAlert ? ` Worst: ${f.worstAlert}.` : ""),
  );
  lines.push(
    `Citizen traffic: ${f.sosCount} SOS, ${f.incidentsOpened} incident${f.incidentsOpened === 1 ? "" : "s"} opened, ${f.incidentsResolved} resolved.`,
  );
  if (f.dispatches.length) {
    lines.push(
      `Dispatches: ` +
        f.dispatches
          .map((d) => `${d.team} → "${d.incident}" (${d.status}${d.outcome ? ` — ${d.outcome}` : ""})`)
          .join("; ") +
        ".",
    );
  }
  if (f.broadcasts.length) {
    lines.push(
      `Broadcasts sent: ` +
        f.broadcasts.map((b) => `${b.level} to ${b.region} (${b.recipients} reached)`).join("; ") + ".",
    );
  }
  lines.push(
    `Open at handover: ${f.pendingWatch} unreviewed orange+ alerts in the watch queue, ${f.pendingRequests} broadcast request${f.pendingRequests === 1 ? "" : "s"} waiting.`,
  );
  return lines.join("\n\n");
}

export async function GET() {
  await dbReady();
  const user = await currentUser();
  if (!user) return Response.json({ error: "Log in first." }, { status: 401 });
  if (user.role !== "coordinator") {
    return Response.json({ error: "The handover is the coordinator's record." }, { status: 403 });
  }

  const facts = await gatherFacts();
  const fallback = assemble(facts);

  // The model may rephrase; it may not add. Facts travel alongside the prose
  // so the reader can always check the sentence against the number.
  let prose: string | null = null;
  for (const p of resolveProviders()) {
    try {
      const reply = await chat(
        p,
        [
          {
            role: "system",
            content:
              "You write a 12-hour shift handover for a disaster-response control room in India. " +
              "Use ONLY the facts provided — no additions, no speculation, no advice. Three short " +
              "paragraphs, plain prose, numbers as digits. Start with the alert picture, then citizen " +
              "traffic and dispatches, then what is open for the incoming shift.",
          },
          { role: "user", content: JSON.stringify(facts) },
        ],
        [],
      );
      if (reply.content?.trim()) {
        prose = reply.content.trim();
        break;
      }
    } catch (err) {
      if (!isTransient(err)) break;
    }
  }

  return Response.json({
    brief: prose ?? fallback,
    written: prose ? "model, from the facts below" : "assembled without a model — same facts",
    facts,
    at: new Date().toISOString(),
  });
}
