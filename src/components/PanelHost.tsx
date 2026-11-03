"use client";

import { useState } from "react";
import IndiaMap from "./IndiaMap";
import type { Panel } from "@/lib/agent/panels";

const STATUS: Record<string, string> = {
  low: "var(--good)",
  moderate: "var(--warning)",
  high: "var(--serious)",
  severe: "var(--critical)",
  // IMD alert colours are the same ladder under their official names.
  yellow: "var(--warning)",
  orange: "var(--serious)",
  red: "var(--critical)",
};

const STATUS_ICON: Record<string, string> = {
  low: "●",
  moderate: "▲",
  high: "▲",
  severe: "■",
};

function Shell({
  title,
  subtitle,
  source,
  children,
}: {
  title: string;
  subtitle?: string;
  source?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="panel-in rounded-xl p-5"
      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
    >
      <header className="mb-4">
        <h2 className="text-lg font-semibold leading-tight">{title}</h2>
        {subtitle && (
          <p className="mt-0.5 text-sm" style={{ color: "var(--ink-secondary)" }}>
            {subtitle}
          </p>
        )}
      </header>
      {children}
      {source && (
        <footer className="mt-4 pt-3 text-xs" style={{ borderTop: "1px solid var(--border)", color: "var(--ink-muted)" }}>
          Source: {source}
        </footer>
      )}
    </section>
  );
}

/** Horizontal bars — magnitude comparison, sequential fill, values direct-labelled. */
function Bars({ rows, unit }: { rows: { name: string; value: number; note?: string }[]; unit: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ol className="flex flex-col gap-2.5">
      {rows.map((r, i) => (
        <li key={r.name} className="grid grid-cols-[1.5rem_9rem_1fr_auto] items-center gap-3 text-sm">
          <span style={{ color: "var(--ink-muted)" }}>{i + 1}</span>
          <span className="truncate">{r.name}</span>
          <span className="h-2.5 w-full overflow-hidden rounded-sm" style={{ background: "var(--surface-2)" }}>
            <span
              className="block h-full rounded-sm"
              style={{
                width: `${Math.max(2, (r.value / max) * 100)}%`,
                background: "var(--seq-400)",
              }}
            />
          </span>
          <span className="tabular-nums" style={{ color: "var(--ink-secondary)" }}>
            {r.value.toLocaleString("en-IN")}
            {unit}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * The confirm gate. The agent stages a write; this is where a human approves
 * it. Two steps by design — voice mishears, and an alert or a dispatch is not
 * something to undo after the fact.
 */
function ConfirmCard({ panel }: { panel: Extract<Panel, { panel: "confirm_action" }> }) {
  const [state, setState] = useState<"idle" | "sending" | "done" | "cancelled" | "error">("idle");
  const [result, setResult] = useState<string>("");

  async function run(confirm: boolean) {
    if (state !== "idle") return;
    setState("sending");
    try {
      // Resolving is not outward-facing, so it needs no staging round trip.
      if (panel.kind === "resolve") {
        if (!confirm) return setState("cancelled");
        const done = await fetch("/api/ops", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(panel.request),
        }).then((r) => r.json());
        if (done.error) {
          setState("error");
          setResult(done.error);
          return;
        }
        setState("done");
        setResult(`Incident #${done.resolved} closed${done.teamReleased ? " — team back to available" : ""}`);
        return;
      }

      // Stage, then confirm — the same two calls a scripted operator would make.
      const staged = await fetch("/api/ops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(panel.request),
      }).then((r) => r.json());

      if (!confirm) {
        await fetch("/api/ops", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "cancel", actionId: staged.actionId }),
        });
        setState("cancelled");
        return;
      }

      const done = await fetch("/api/ops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm", actionId: staged.actionId }),
      }).then((r) => r.json());

      if (done.error) {
        setState("error");
        setResult(done.error);
        return;
      }

      // resolve returned above, so only alert and dispatch reach here
      setState("done");
      setResult(
        panel.kind === "alert"
          ? `Alert to ${done.region}: ` +
              ((done.delivery ?? [])
                .map((d: { channel: string; delivered: number; unavailable?: string }) =>
                  d.unavailable ? `${d.channel} unavailable` : `${d.channel} ${d.delivered} delivered`,
                )
                .join(", ") || "recorded") +
              (done.note ? ` — ${done.note}` : "")
          : `${done.teamName} dispatched to incident #${done.incidentId}` +
              (done.distanceKm !== null ? ` · ${done.distanceKm} km` : ""),
      );
    } catch (e) {
      setState("error");
      setResult(e instanceof Error ? e.message : "Failed");
    }
  }

  const accent =
    panel.kind === "alert"
      ? "var(--warning)"
      : panel.kind === "resolve"
        ? "var(--good)"
        : "var(--seq-400)";
  const verb =
    panel.kind === "alert" ? "and send" : panel.kind === "resolve" ? "and close" : "dispatch";

  return (
    <section
      className="panel-in rounded-xl p-5"
      style={{ background: "var(--surface)", border: `1px solid ${accent}` }}
    >
      <header className="mb-3 flex items-center gap-2">
        <span style={{ color: accent }}>{panel.kind === "alert" ? "▲" : panel.kind === "resolve" ? "●" : "◈"}</span>
        <h2 className="text-lg font-semibold leading-tight">{panel.title}</h2>
      </header>

      <dl className="flex flex-col gap-1.5">
        {panel.lines.map((l) => (
          <div key={l.label} className="grid grid-cols-[6.5rem_1fr] gap-3 text-sm">
            <dt style={{ color: "var(--ink-muted)" }}>{l.label}</dt>
            <dd style={{ color: "var(--ink-primary)" }}>{l.value}</dd>
          </div>
        ))}
      </dl>

      {state === "idle" && (
        <div className="mt-4 flex gap-2">
          <button
            onClick={() => run(true)}
            className="rounded-lg px-4 py-2 text-sm font-medium"
            style={{ background: accent, color: "#0d0d0d" }}
          >
            Confirm {verb}
          </button>
          <button
            onClick={() => run(false)}
            className="rounded-lg px-4 py-2 text-sm"
            style={{ background: "var(--surface-2)", color: "var(--ink-secondary)" }}
          >
            Cancel
          </button>
        </div>
      )}

      {state === "sending" && (
        <p className="mt-4 text-sm" style={{ color: "var(--ink-muted)" }}>Working…</p>
      )}
      {state === "done" && (
        <p className="mt-4 text-sm" style={{ color: "var(--good)" }}>✓ {result}</p>
      )}
      {state === "cancelled" && (
        <p className="mt-4 text-sm" style={{ color: "var(--ink-muted)" }}>Cancelled — nothing was sent.</p>
      )}
      {state === "error" && (
        <p className="mt-4 text-sm" style={{ color: "var(--critical)" }}>■ {result}</p>
      )}
    </section>
  );
}

export default function PanelHost({ panel }: { panel: Panel }) {
  switch (panel.panel) {
    case "choropleth": {
      // A scoped map (districts of one state) spotlights that state; the
      // national view paints every state.
      const isDistrict = panel.subtitle?.includes("district") ?? false;
      return (
        <Shell title={panel.title} subtitle={panel.subtitle} source={panel.source}>
          <IndiaMap
            values={panel.features.map((f) => ({ name: f.name, value: f.value }))}
            unit={panel.unit}
            highlight={isDistrict ? panel.title.split("—").pop()?.trim() : undefined}
          />
        </Shell>
      );
    }

    case "ranked_list":
      return (
        <Shell title={panel.title} subtitle={panel.subtitle} source={panel.source}>
          <Bars rows={panel.rows} unit={panel.unit} />
        </Shell>
      );

    case "region_card": {
      const r = panel.region;
      return (
        <Shell title={panel.title} subtitle={panel.subtitle} source={panel.source}>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {panel.facts.map((f) => (
              <div key={f.label} className="rounded-lg p-3" style={{ background: "var(--surface-2)" }}>
                <dt className="text-xs" style={{ color: "var(--ink-muted)" }}>{f.label}</dt>
                <dd className="mt-1 text-xl font-semibold tabular-nums">{f.value}</dd>
              </div>
            ))}
          </dl>
          {r.hazards.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-xs" style={{ color: "var(--ink-muted)" }}>Recorded hazards</p>
              <ul className="flex flex-wrap gap-2">
                {r.hazards.map((h) => (
                  <li
                    key={h}
                    className="rounded-full px-3 py-1 text-xs"
                    style={{ background: "var(--surface-2)", color: "var(--ink-secondary)" }}
                  >
                    {h}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-4">
            <IndiaMap
              values={[{ name: r.name, value: r.density }]}
              highlight={r.level === "state" ? r.name : undefined}
              markers={[{ name: r.name, lat: r.center[0], lng: r.center[1] }]}
              showLabels={false}
              unit=" /km²"
            />
          </div>
        </Shell>
      );
    }

    case "risk_card": {
      const color = STATUS[panel.level] ?? "var(--ink-muted)";
      return (
        <Shell title={panel.title} subtitle={panel.subtitle} source={panel.source}>
          {/* status is never colour alone — icon + label always accompany it */}
          <div className="flex items-baseline gap-3">
            <span className="text-5xl font-semibold tabular-nums" style={{ color }}>
              {panel.score}
            </span>
            <span className="text-sm" style={{ color: "var(--ink-muted)" }}>/ 100</span>
            <span className="ml-auto flex items-center gap-2 text-sm font-medium" style={{ color }}>
              <span aria-hidden>{STATUS_ICON[panel.level] ?? "●"}</span>
              {panel.level.toUpperCase()}
            </span>
          </div>

          <p className="mt-3 text-sm leading-relaxed" style={{ color: "var(--ink-secondary)" }}>
            {panel.evidence}
          </p>

          <ul className="mt-4 flex flex-col gap-2">
            {panel.factors.map((f) => (
              <li key={f.label} className="flex items-center gap-3 text-sm">
                <span className="w-44 shrink-0" style={{ color: "var(--ink-secondary)" }}>{f.label}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-sm" style={{ background: "var(--surface-2)" }}>
                  <span
                    className="block h-full rounded-sm"
                    style={{ width: `${Math.min(100, f.points * 3.3)}%`, background: "var(--seq-400)" }}
                  />
                </span>
                <span className="w-52 shrink-0 text-right text-xs" style={{ color: "var(--ink-muted)" }}>
                  {f.detail}
                </span>
              </li>
            ))}
          </ul>

          {panel.shelters && panel.shelters.length > 0 && (
            <div className="mt-4 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
              <p className="mb-2 text-xs" style={{ color: "var(--ink-muted)" }}>Nearest higher-ground facilities</p>
              <ul className="flex flex-col gap-1 text-sm">
                {panel.shelters.slice(0, 4).map((s) => (
                  <li key={`${s.name}-${s.distanceM}`} className="flex justify-between">
                    <span>{s.name} <span style={{ color: "var(--ink-muted)" }}>({s.kind})</span></span>
                    <span className="tabular-nums" style={{ color: "var(--ink-secondary)" }}>{s.distanceM} m</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Shell>
      );
    }

    case "timeline": {
      const pts = panel.points;
      const max = Math.max(1, ...pts.map((p) => p.v));
      const W = 1000, H = 200;
      const step = pts.length > 1 ? W / (pts.length - 1) : W;
      const path = pts
        .map((p, i) => `${i === 0 ? "M" : "L"} ${i * step} ${H - (p.v / max) * (H - 20)}`)
        .join(" ");
      return (
        <Shell title={panel.title} subtitle={panel.subtitle} source={panel.source}>
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={panel.title}>
            <line x1={0} x2={W} y1={H} y2={H} stroke="var(--baseline)" strokeWidth="1" />
            <path d={`${path} L ${W} ${H} L 0 ${H} Z`} fill="var(--seq-400)" fillOpacity="0.16" />
            <path d={path} fill="none" stroke="var(--seq-400)" strokeWidth="2" />
          </svg>
          <div className="mt-2 flex justify-between text-xs" style={{ color: "var(--ink-muted)" }}>
            <span>{pts[0]?.t.replace("T", " ")}</span>
            <span>peak {max}{panel.unit}</span>
            <span>{pts[pts.length - 1]?.t.replace("T", " ")}</span>
          </div>
        </Shell>
      );
    }

    case "point_map": {
      // Points carrying status go through the event layer: fill by severity,
      // glyph by hazard, detail on hover. The plain marker layer prints a label
      // beside every dot, which is right for three shelters and unreadable for
      // sixty live alerts.
      const statusPoints = panel.points.filter((p) => p.level);
      return (
        <Shell title={panel.title} subtitle={panel.subtitle} source={panel.source}>
          <IndiaMap
            values={[]}
            events={statusPoints.map((p) => ({
              kind: p.kind ?? "alert",
              name: p.name,
              lat: p.lat,
              lng: p.lng,
              level: p.level!,
              detail: p.note,
            }))}
            markers={panel.points
              .filter((p) => !p.level)
              .map((p) => ({ name: p.name, lat: p.lat, lng: p.lng, note: p.note }))}
          />
          {panel.legend && panel.legend.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px]">
              {panel.legend.map((l) => (
                <li key={l.level} className="flex items-center gap-1.5">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: STATUS[l.level] ?? "var(--ink-muted)" }}
                  />
                  <span style={{ color: "var(--ink-muted)" }}>{l.label}</span>
                </li>
              ))}
            </ul>
          )}
        </Shell>
      );
    }

    case "incident_board":
      return (
        <Shell title={panel.title} subtitle={panel.subtitle} source={panel.source}>
          <ol className="flex flex-col gap-2">
            {panel.incidents.map((i) => (
              <li
                key={i.id}
                className="flex items-start gap-3 rounded-lg p-3"
                style={{ background: "var(--surface-2)" }}
              >
                <span
                  className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg text-sm font-semibold tabular-nums"
                  style={{
                    background: STATUS[["", "low", "low", "moderate", "high", "severe"][i.severity]] ?? "#1f6fc4",
                    color: "#0d0d0d",
                  }}
                >
                  {i.priority}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium leading-snug">{i.title}</p>
                  <p className="mt-0.5 text-[11px]" style={{ color: "var(--ink-muted)" }}>
                    #{i.id} · {i.category.replace("_", " ")} · {i.place ?? "location unknown"}
                    {i.peopleCount ? ` · ${i.peopleCount} people` : ""}
                  </p>
                  {i.reasons.length > 0 && (
                    <p className="mt-1 text-[11px]" style={{ color: "var(--ink-secondary)" }}>
                      {i.reasons.join(" · ")}
                    </p>
                  )}
                </div>
                <span
                  className="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-medium"
                  style={{
                    background: i.assignedTeam ? "#123a68" : "#3a2a15",
                    color: i.assignedTeam ? "#7fb6f0" : "#fab219",
                  }}
                >
                  {i.assignedTeam ?? "unassigned"}
                </span>
              </li>
            ))}
          </ol>
        </Shell>
      );

    case "confirm_action":
      return <ConfirmCard panel={panel} />;

    case "protocol_card":
      return (
        <Shell title={panel.title} subtitle={panel.subtitle} source={panel.source}>
          <div className="flex flex-col gap-4">
            {panel.entries.map((e) => (
              <div key={e.reference}>
                <p className="text-sm font-medium">{e.title}</p>
                <p className="mt-1 text-sm leading-relaxed" style={{ color: "var(--ink-secondary)" }}>
                  {e.body}
                </p>
                <p className="mt-1.5 text-[11px]" style={{ color: "var(--ink-muted)" }}>
                  {e.source} · {e.reference}
                </p>
              </div>
            ))}
          </div>
          <p
            className="mt-4 rounded-lg p-2.5 text-[11px] leading-relaxed"
            style={{ background: "var(--surface-2)", color: "var(--ink-muted)" }}
          >
            Figures are indicative — confirm against the current SDRF circular before disbursing.
          </p>
        </Shell>
      );

    case "note":
      return (
        <Shell title={panel.title} subtitle={panel.subtitle} source={panel.source}>
          <p className="text-sm leading-relaxed" style={{ color: "var(--ink-secondary)" }}>{panel.body}</p>
        </Shell>
      );
  }
}
