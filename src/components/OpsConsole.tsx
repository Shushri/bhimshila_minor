"use client";

import { useEffect, useState } from "react";
import { Panel } from "./Charts";
import CampBoard from "./CampBoard";

/**
 * The relief-operations side of the console: what is open, who is deployed,
 * what supplies remain, and — for a citizen — what alerts actually reached them.
 *
 * Deliberately read-only. Every write goes through the agent's confirm card so
 * there is exactly one path that can send an alert or move a team.
 */

interface Ops {
  incidents: {
    id: number;
    title: string;
    place: string | null;
    priority: number;
    status: string;
    assignedTeam: string | null;
    reportCount: number;
  }[];
  teams: {
    id: number;
    name: string;
    kind: string;
    place: string;
    status: string;
    boats: number | null;
    medical_kits: number | null;
    food_packets: number | null;
  }[];
  alerts: { id: number; region: string; level: string; message: string; recipients: number; channels: string }[];
  /** Official alerts first seen per day, from the monitor's own record. */
  activity: { d: string; n: number; red: number }[];
  today: string;
  /** States that heard many warnings and raised nothing — attention risk. */
  fatigue: { state: string; alerts: number; red: number; incidents: number }[];
  /** People under a live alert with no available team within reach. */
  gaps: { area: string; type: string; colour: string; people: number; nearestTeam: string; distanceKm: number }[];
  stats: {
    open: number;
    assigned: number;
    available: number;
    deployed: number;
    boats: number;
    medicalKits: number;
    foodPackets: number;
  };
}

interface Inbox {
  id: number;
  region: string;
  level: string;
  message: string;
  channels: string[];
  createdAt: string;
}

interface Watch {
  queue: {
    capId: string;
    colour: string;
    disasterType: string;
    area: string;
    source: string;
    firstSeenAt: string;
    people: number;
  }[];
  checked: number;
  sourceReachable: boolean;
}

/** IMD's colour convention, reusing the app's status steps. */
const COLOUR: Record<string, string> = {
  red: "var(--critical)",
  orange: "var(--serious)",
  yellow: "var(--warning)",
};

const LEVEL: Record<string, string> = {
  advisory: "#0ca30c",
  warning: "#fab219",
  severe: "#d03b3b",
};

/**
 * Alert tempo — how many official alerts the monitor first saw each day.
 *
 * Real history, not a mood line: every point is a count from seen_alerts.
 * Days the monitor saw nothing render as zero, which is the honest shape of a
 * record that only began when monitoring began.
 */
function TempoChart({ activity, today }: { activity: { d: string; n: number; red: number }[]; today: string }) {
  // Fill the missing days so a quiet Tuesday reads as zero, not as absent.
  // The axis anchors on the server's date, which also keeps this render pure.
  const byDay = new Map(activity.map((a) => [a.d, a]));
  const end = Date.parse(today + "T00:00:00Z");
  const days: { d: string; n: number; red: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(end - i * 864e5).toISOString().slice(0, 10);
    days.push(byDay.get(d) ?? { d, n: 0, red: 0 });
  }
  const max = Math.max(1, ...days.map((x) => x.n));
  const W = 560, H = 150, PAD = 6;
  const step = W / (days.length - 1);
  const y = (v: number) => H - PAD - (v / max) * (H - 26);
  const line = days.map((p, i) => `${i === 0 ? "M" : "L"} ${(i * step).toFixed(1)} ${y(p.n).toFixed(1)}`).join(" ");
  const peak = days.reduce((a, b) => (b.n > a.n ? b : a));
  const label = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Official alerts first seen per day, last 14 days">
        <defs>
          <linearGradient id="tempoFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3987e5" stopOpacity="0.34" />
            <stop offset="100%" stopColor="#3987e5" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <line x1={0} x2={W} y1={H - PAD} y2={H - PAD} stroke="var(--baseline)" strokeWidth="1" />
        <path d={`${line} L ${W} ${H - PAD} L 0 ${H - PAD} Z`} fill="url(#tempoFill)" />
        <path d={line} fill="none" stroke="var(--seq-400)" strokeWidth="2" strokeLinejoin="round" />
        {/* Red alerts as marks on the days they arrived — status colour, never a second series hue. */}
        {days.map((p, i) =>
          p.red > 0 ? (
            <circle key={p.d} cx={i * step} cy={y(p.n)} r={3.4} fill="var(--critical)" stroke="var(--surface)" strokeWidth="1.4">
              <title>{`${label(p.d)} — ${p.red} red of ${p.n}`}</title>
            </circle>
          ) : null,
        )}
        <text x={Math.min(W - 60, peak.n ? days.indexOf(peak) * step + 6 : 6)} y={Math.max(12, y(peak.n) - 6)} fontSize="10" fill="var(--ink-secondary)">
          {peak.n ? `peak ${peak.n}` : ""}
        </text>
      </svg>
      <div className="mt-1 flex justify-between text-[9.5px]" style={{ color: "var(--ink-muted)" }}>
        <span>{label(days[0].d)}</span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: "var(--critical)" }} /> day with red alerts
        </span>
        <span>{label(days[days.length - 1].d)}</span>
      </div>
    </div>
  );
}

export default function OpsConsole({ loggedIn }: { loggedIn: boolean }) {
  const [ops, setOps] = useState<Ops | null>(null);
  const [inbox, setInbox] = useState<Inbox[]>([]);
  const [watch, setWatch] = useState<Watch | null>(null);

  useEffect(() => {
    const load = () => {
      fetch("/api/ops").then((r) => r.json()).then(setOps).catch(() => {});
      // Sweeping here means the console itself keeps monitoring while it is
      // open, so the scheduled job is a backstop rather than the only thing
      // watching. Same endpoint, same dedupe — an extra sweep costs nothing.
      fetch("/api/watch").then((r) => r.json()).then(setWatch).catch(() => {});
      if (loggedIn) {
        fetch("/api/inbox").then((r) => r.json()).then((d) => setInbox(d.alerts ?? [])).catch(() => {});
      }
    };
    load();
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, [loggedIn]);

  if (!ops) return null;

  const deployed = ops.teams.filter((t) => t.status === "deployed");

  const reds = watch?.queue.filter((q) => q.colour === "red").length ?? 0;

  return (
    <section className="grid gap-2.5 lg:grid-cols-3">
      {watch && (
        <div className="lg:col-span-2">
          <Panel
            title="Officially issued — awaiting a coordinator"
            right={
              <span className="shrink-0 text-[10px]" style={{ color: "var(--ink-muted)" }}>
                {watch.sourceReachable
                  ? `${watch.checked} live · NDMA Sachet`
                  : "NDMA unreachable"}
              </span>
            }
          >
            {!watch.sourceReachable ? (
              // An outage must never read as an all-clear.
              <p className="text-[11.5px]" style={{ color: "var(--serious)" }}>
                NDMA Sachet is not responding. This is not an all-clear — official alerts may be
                live and unseen.
              </p>
            ) : watch.queue.length === 0 ? (
              <p className="text-[11.5px]" style={{ color: "var(--ink-muted)" }}>
                Nothing new at orange or above. {watch.checked} alerts checked.
              </p>
            ) : (
              <>
                <p className="mb-2 text-[11px]" style={{ color: "var(--ink-secondary)" }}>
                  {watch.queue.length} unreviewed ·{" "}
                  {(watch.queue.reduce((a, q) => a + q.people, 0) / 1e7).toFixed(1)} crore people covered
                  {reds > 0 && (
                    <>
                      {" · "}
                      <span style={{ color: "var(--critical)" }}>■ {reds} red</span>
                    </>
                  )}
                </p>
                <ul className="flex flex-col gap-1">
                  {watch.queue.slice(0, 8).map((q) => (
                    <li
                      key={q.capId}
                      className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[11.5px]"
                      style={{ background: "var(--surface-2)" }}
                    >
                      <span
                        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase"
                        style={{ background: COLOUR[q.colour] ?? "var(--warning)", color: "#0d0d0d" }}
                      >
                        {q.colour}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {q.disasterType} — {q.area}
                      </span>
                      {q.people > 0 && (
                        <span
                          className="shrink-0 tabular-nums text-[11px]"
                          title="People under this alert, projected to 2026"
                        >
                          {q.people >= 1e5
                            ? `${(q.people / 1e5).toFixed(1)}L`
                            : q.people.toLocaleString("en-IN")}
                        </span>
                      )}
                      <span className="shrink-0 text-[10.5px]" style={{ color: "var(--ink-muted)" }}>
                        {q.source}
                      </span>
                    </li>
                  ))}
                </ul>
                {watch.queue.length > 8 && (
                  <p className="mt-1.5 text-[10.5px]" style={{ color: "var(--ink-muted)" }}>
                    +{watch.queue.length - 8} more
                  </p>
                )}
              </>
            )}
          </Panel>
        </div>
      )}

      {watch && (
        <Panel
          title="Alert tempo — 14 days"
          right={
            <span className="shrink-0 text-[10px]" style={{ color: "var(--ink-muted)" }}>
              first seen by the monitor
            </span>
          }
        >
          <TempoChart activity={ops.activity ?? []} today={ops.today} />
        </Panel>
      )}

      {(ops.gaps ?? []).length > 0 && (
        <div className="lg:col-span-2">
          <Panel
            title="Coverage gaps — under alert, nobody in reach"
            right={
              <span className="shrink-0 text-[10px]" style={{ color: "var(--ink-muted)" }}>
                no available team within 150 km
              </span>
            }
          >
            <ul className="flex flex-col gap-1">
              {ops.gaps.map((g) => (
                <li
                  key={`${g.area}-${g.people}`}
                  className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[11.5px]"
                  style={{ background: "var(--surface-2)", borderLeft: `2px solid ${COLOUR[g.colour] ?? "var(--warning)"}` }}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {g.type} — {g.area}
                  </span>
                  <span className="shrink-0 tabular-nums" title="People under this alert, projected to 2026">
                    {g.people >= 1e5 ? `${(g.people / 1e5).toFixed(1)}L` : g.people.toLocaleString("en-IN")}
                  </span>
                  <span className="shrink-0 text-[10.5px]" style={{ color: "var(--serious)" }}>
                    nearest {g.nearestTeam.replace(/ NDRF.*$/, " NDRF")} · {g.distanceKm} km
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      )}

      {/* Camps sit beside coverage gaps on purpose: one says where nobody is,
          the other says who is waiting on a truck. Same question, two halves. */}
      <div className="lg:col-span-2">
        <Panel
          title="Relief camps — short of supplies"
          right={
            <span className="shrink-0 text-[10px]" style={{ color: "var(--ink-muted)" }}>
              people waiting x urgency
            </span>
          }
        >
          <CampBoard />
        </Panel>
      </div>

      {(ops.fatigue ?? []).length > 0 && (
        <Panel
          title="Alert fatigue watch — 30 days"
          right={
            <span className="shrink-0 text-[10px]" style={{ color: "var(--ink-muted)" }}>
              many warnings, no SOS raised
            </span>
          }
        >
          <ul className="flex flex-col gap-1 text-[11.5px]">
            {ops.fatigue.map((f) => (
              <li key={f.state} className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate">{f.state}</span>
                <span className="shrink-0 tabular-nums" style={{ color: "var(--warning)" }}>
                  {f.alerts} alerts{f.red ? ` (${f.red} red)` : ""}
                </span>
                <span className="shrink-0 tabular-nums" style={{ color: "var(--ink-muted)" }}>
                  · 0 incidents
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[9.5px] leading-snug" style={{ color: "var(--ink-muted)" }}>
            Where warnings keep resolving into nothing, the next one gets ignored. Incidents here
            are our SOS record, not ground truth — this measures attention risk, never falsity.
          </p>
        </Panel>
      )}

      <Panel
        title="Relief operations"
        right={
          <span className="shrink-0 text-[10px]" style={{ color: "var(--ink-muted)" }}>
            live
          </span>
        }
      >
        <div className="grid grid-cols-2 gap-2">
          {[
            ["Open incidents", ops.stats.open, "#fab219"],
            ["Teams deployed", ops.stats.deployed, "#3f92e8"],
            ["Teams available", ops.stats.available, "#0ca30c"],
            ["Assigned", ops.stats.assigned, "#7fb6f0"],
          ].map(([label, value, colour]) => (
            <div key={String(label)} className="rounded-lg p-2.5" style={{ background: "var(--surface-2)" }}>
              <p className="text-[10px] uppercase tracking-wider" style={{ color: "var(--ink-muted)" }}>
                {label}
              </p>
              <p className="mt-0.5 text-xl font-semibold tabular-nums" style={{ color: String(colour) }}>
                {value}
              </p>
            </div>
          ))}
        </div>

        <p className="mt-3 mb-1.5 text-[10px] uppercase tracking-wider" style={{ color: "var(--ink-muted)" }}>
          Supplies across all units
        </p>
        <ul className="flex flex-col gap-1 text-[11.5px]">
          {[
            ["Boats", ops.stats.boats],
            ["Medical kits", ops.stats.medicalKits],
            ["Food packets", ops.stats.foodPackets],
          ].map(([label, value]) => (
            <li key={String(label)} className="flex justify-between">
              <span style={{ color: "var(--ink-secondary)" }}>{label}</span>
              <span className="tabular-nums">{Number(value).toLocaleString("en-IN")}</span>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Teams deployed">
        {deployed.length ? (
          <ul className="flex flex-col gap-2">
            {deployed.map((t) => (
              <li key={t.id} className="text-[11.5px]">
                <span className="flex items-center gap-2">
                  <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "#3f92e8" }} />
                  <span className="truncate font-medium">{t.name}</span>
                </span>
                <span className="ml-3.5 block" style={{ color: "var(--ink-muted)" }}>
                  {t.kind} · {t.place}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-6 text-center text-xs" style={{ color: "var(--ink-muted)" }}>
            No team deployed — {ops.stats.available} units standing by
          </p>
        )}
      </Panel>

      <Panel title={loggedIn ? "Alerts you received" : "Alerts sent"}>
        {loggedIn && inbox.length > 0 ? (
          <ul className="flex flex-col gap-2.5">
            {inbox.slice(0, 4).map((a) => (
              <li key={a.id} className="text-[11.5px] leading-snug">
                <span className="font-medium" style={{ color: LEVEL[a.level] ?? "#fab219" }}>
                  {a.level.toUpperCase()} · {a.region}
                </span>
                <span className="mt-0.5 block">{a.message}</span>
                <span className="mt-0.5 block text-[10px]" style={{ color: "var(--ink-muted)" }}>
                  delivered via {a.channels.join(", ")}
                </span>
              </li>
            ))}
          </ul>
        ) : ops.alerts.length ? (
          <ul className="flex flex-col gap-2.5">
            {ops.alerts.slice(0, 4).map((a) => (
              <li key={a.id} className="text-[11.5px] leading-snug">
                <span className="font-medium" style={{ color: LEVEL[a.level] ?? "#fab219" }}>
                  {a.level.toUpperCase()} · {a.region}
                </span>
                <span className="mt-0.5 block" style={{ color: "var(--ink-secondary)" }}>
                  {a.message}
                </span>
                <span className="mt-0.5 block text-[10px]" style={{ color: "var(--ink-muted)" }}>
                  {a.recipients} recipient{a.recipients === 1 ? "" : "s"} · {a.channels || "none"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-6 text-center text-xs" style={{ color: "var(--ink-muted)" }}>
            No alerts sent yet
          </p>
        )}
      </Panel>
    </section>
  );
}
