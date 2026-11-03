"use client";

import { useState } from "react";
import { openWindow } from "@/lib/windows";
import type { RainAnomaly } from "@/lib/kb/anomaly";

/**
 * The state drill-down — click a state, and the command centre opens layered
 * floating windows over the map: official alerts, our risk surface, forecast,
 * the 80-year rainfall anomaly, news, population at risk, deployments, and a
 * live weather map. The Jarvis half of the design.
 *
 * Two rules from the platform doc, enforced here:
 * - every window names its source and its age in the chrome — a CAP alert from
 *   4 minutes ago and a reanalysis from 1940 must not look equally current;
 * - layers never blend into one score. Each window keeps its own provenance,
 *   and the risk window says out loud that it is our estimate, not a warning.
 *
 * All windows fill from ONE fetch. They open instantly with skeletons, and
 * re-open (same ids) with content when the data lands — the frame answering
 * immediately is what makes the gesture feel like a response.
 */

interface AlertRow {
  id: string;
  colour: string;
  type: string;
  kind: string;
  issuer: string;
  area: string;
  message: string;
  language: string;
  people: number | null;
  basis: string | null;
}

interface StateBrief {
  state: {
    name: string;
    population: number;
    population2026: number | null;
    density: number;
    areaKm2: number;
    hazards: string[];
    center: [number, number];
    districts: number;
    source: string;
  };
  alerts: { list: AlertRow[]; live: boolean } | { error: string };
  risk:
    | {
        districts: { district: string; score: number; level: string; antecedent72h: number; next24h: number }[];
        scanned: number;
        elevated: number;
        source: string;
        /** Set when the scan being served is an older sweep (rate-limit fallback). */
        staleMin: number | null;
      }
    | { error: string };
  forecast:
    | { hourly: { t: string; mm: number }[]; nowIdx: number; next24h: number; next48h: number; peakIntensity: number; asOf: string | null }
    | { error: string };
  anomaly: RainAnomaly | { error: string };
  news: { items: { title: string; link: string; published: string | null; source: string }[] } | { error: string };
  quakes: { magnitude: number; place: string; time: string }[];
  population: {
    underAlert: number;
    exposed: { name: string; people: number; share: number; fragileHousingPct: number | null; ruralPct: number | null }[];
    source: string;
  };
  deployments:
    | { id: number; name: string; kind: string; place: string; status: string; distanceKm: number; boats: number; medicalKits: number; foodPackets: number }[]
    | { error: string };
  rivers:
    | {
        rows: {
          district: string;
          today: number;
          median90d: number;
          ratio: number;
          changePct: number;
          trend: "rising" | "falling" | "steady";
          peakAhead: { date: string; discharge: number; ratio: number } | null;
        }[];
        headline: string;
        source: string;
      }
    | { error: string };
}

const fmt = (n: number) => n.toLocaleString("en-IN");
const crore = (n: number) =>
  n >= 1e7 ? `${(n / 1e7).toFixed(1)} crore` : n >= 1e5 ? `${(n / 1e5).toFixed(1)} lakh` : fmt(n);

const COLOUR: Record<string, string> = {
  red: "var(--critical)",
  orange: "var(--serious)",
  yellow: "var(--warning)",
  green: "var(--good)",
  severe: "var(--critical)",
  high: "var(--serious)",
  moderate: "var(--warning)",
  low: "var(--good)",
};

const GLYPH: Record<string, string> = {
  rain: "☂", quake: "◈", flood: "≋", flashflood: "⇊", storm: "⚡",
  cyclone: "◉", wind: "➤", landslide: "⛰", heat: "☀", cold: "❄", alert: "▲",
};

function Skeleton({ lines = 4 }: { lines?: number }) {
  return (
    <div className="flex animate-pulse flex-col gap-2" aria-label="loading">
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          className="h-8 rounded-md"
          style={{ background: "var(--surface-2)", width: `${100 - (i % 3) * 12}%` }}
        />
      ))}
    </div>
  );
}

function Failed({ error, what, retry }: { error: string; what: string; retry?: () => void }) {
  return (
    <div className="rounded-lg p-3 text-[11.5px] leading-relaxed" style={{ background: "#3a1a1a", color: "var(--serious)" }}>
      Could not load {what} — {error}. This is a source outage, not an all-clear.
      {retry && (
        <button
          onClick={retry}
          className="mt-2 block rounded-md px-2.5 py-1.5 text-[11px] font-medium"
          style={{ background: "var(--surface-2)", color: "var(--ink-secondary)" }}
        >
          ↻ Try again
        </button>
      )}
    </div>
  );
}

const label = "text-[9.5px] uppercase tracking-wider";
const muted = { color: "var(--ink-muted)" } as const;
const secondary = { color: "var(--ink-secondary)" } as const;

// ────────────────────────────────────────────── window contents

function AlertsWin({ d, retry }: { d: StateBrief; retry?: () => void }) {
  if ("error" in d.alerts) return <Failed error={d.alerts.error} what="official alerts" retry={retry} />;
  if (!d.alerts.list.length)
    return (
      <p className="text-[12px]" style={secondary}>
        No live official alert names {d.state.name} right now.
        {d.alerts.live ? "" : " The national feed also returned nothing — treat that as unknown, not clear."}
      </p>
    );
  return (
    <ol className="flex flex-col gap-2">
      {d.alerts.list.map((a) => (
        <li key={a.id} className="rounded-lg p-2.5" style={{ background: "var(--surface-2)" }}>
          <div className="flex items-center gap-2">
            <span
              className="rounded px-1.5 py-0.5 text-[9.5px] font-semibold uppercase"
              style={{ background: COLOUR[a.colour] ?? "var(--warning)", color: "#0d0d0d" }}
            >
              {GLYPH[a.kind] ?? "▲"} {a.colour}
            </span>
            <span className="truncate text-[11.5px] font-medium">{a.type}</span>
            {a.people !== null && (
              <span className="ml-auto shrink-0 text-[10.5px] tabular-nums" title={a.basis ?? ""} style={secondary}>
                {crore(a.people)} under it
              </span>
            )}
          </div>
          <p className="mt-1 text-[10.5px]" style={muted}>
            {a.issuer} · {a.area}
          </p>
          {/* The issuer's own words, in the issuer's own language. Never our
              translation — quoting the government beats paraphrasing it. */}
          <p className="mt-1 line-clamp-3 text-[11px] leading-snug" style={secondary} lang={a.language}>
            {a.message}
          </p>
        </li>
      ))}
    </ol>
  );
}

function RiskWin({ d, retry }: { d: StateBrief; retry?: () => void }) {
  if ("error" in d.risk) return <Failed error={d.risk.error} what="the district risk scan" retry={retry} />;
  const max = Math.max(1, ...d.risk.districts.map((r) => r.score));
  return (
    <div>
      <p className="mb-2 text-[11px]" style={secondary}>
        {d.risk.elevated} of {d.risk.scanned} districts elevated (≥28/100)
        {d.risk.staleMin !== null && (
          <span className="ml-1.5 rounded px-1.5 py-0.5 text-[9.5px]" style={{ background: "#3a2a12", color: "var(--warning)" }}>
            sweep from {d.risk.staleMin} min ago — source is rate-limiting
          </span>
        )}
      </p>
      <ol className="flex flex-col gap-1.5">
        {d.risk.districts.map((r) => (
          <li key={r.district} className="grid grid-cols-[7.5rem_1fr_2.5rem] items-center gap-2 text-[11px]">
            <span className="truncate">{r.district}</span>
            <span className="h-2 overflow-hidden rounded-sm" style={{ background: "var(--surface-2)" }}>
              <span
                className="block h-full rounded-sm"
                style={{ width: `${(r.score / max) * 100}%`, background: COLOUR[r.level] ?? "var(--seq-400)" }}
              />
            </span>
            <span className="text-right tabular-nums" style={secondary}>{r.score}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ForecastWin({ d, retry }: { d: StateBrief; retry?: () => void }) {
  if ("error" in d.forecast) return <Failed error={d.forecast.error} what="the rainfall forecast" retry={retry} />;
  const f = d.forecast;
  const pts = f.hourly;
  const max = Math.max(0.5, ...pts.map((p) => p.mm));
  const W = 560, H = 130;
  const step = pts.length > 1 ? W / (pts.length - 1) : W;
  const nowX = f.nowIdx * step;
  return (
    <div>
      <div className="mb-2 grid grid-cols-3 gap-2 text-center">
        {[
          ["next 24h", `${f.next24h} mm`],
          ["next 48h", `${f.next48h} mm`],
          ["peak", `${f.peakIntensity} mm/h`],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg px-2 py-1.5" style={{ background: "var(--surface-2)" }}>
            <p className={label} style={muted}>{k}</p>
            <p className="text-[13px] font-semibold tabular-nums">{v}</p>
          </div>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="hourly rainfall">
        <line x1={0} x2={W} y1={H - 1} y2={H - 1} stroke="var(--baseline)" strokeWidth="1" />
        {pts.map((p, i) => (
          <rect
            key={p.t}
            x={i * step}
            y={H - 4 - (p.mm / max) * (H - 14)}
            width={Math.max(1, step - 0.6)}
            height={Math.max(0.5, (p.mm / max) * (H - 14))}
            fill={i < f.nowIdx ? "var(--seq-650)" : "var(--seq-400)"}
          />
        ))}
        <line x1={nowX} x2={nowX} y1={6} y2={H} stroke="var(--ink-muted)" strokeDasharray="3 3" strokeWidth="1" />
        <text x={nowX + 4} y={13} fontSize="9" fill="var(--ink-muted)">now</text>
      </svg>
      <p className="mt-1 flex justify-between text-[9.5px]" style={muted}>
        <span>yesterday</span>
        <span>peak {max.toFixed(1)} mm/h</span>
        <span>+3 days</span>
      </p>
    </div>
  );
}

function AnomalyWin({ d, retry }: { d: StateBrief; retry?: () => void }) {
  if ("error" in d.anomaly) return <Failed error={d.anomaly.error} what="the 80-year comparison" retry={retry} />;
  const a = d.anomaly;
  const tone =
    a.verdict === "exceptional" || a.verdict === "unusual"
      ? "var(--critical)"
      : a.verdict === "elevated"
        ? "var(--warning)"
        : "var(--ink-secondary)";
  return (
    <div>
      <div className="flex items-baseline gap-3">
        <span className="text-4xl font-semibold tabular-nums" style={{ color: tone }}>
          {a.percentile}
          <span className="text-lg">th</span>
        </span>
        <span className="text-[11px]" style={muted}>percentile of {a.yearsCompared} years</span>
        <span className="ml-auto flex items-center gap-1.5 text-[11.5px] font-medium" style={{ color: tone }}>
          <span aria-hidden>{a.verdict === "normal" || a.verdict === "dry" ? "●" : a.verdict === "elevated" ? "▲" : "■"}</span>
          {a.verdict.toUpperCase()}
        </span>
      </div>
      <p className="mt-2 text-[11.5px] leading-relaxed" style={secondary}>{a.evidence}</p>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        {[
          ["this fortnight", `${a.currentMm} mm`],
          ["median year", `${a.medianMm} mm`],
          [`record · ${a.wettest.year}`, `${a.wettest.mm} mm`],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg px-2 py-1.5" style={{ background: "var(--surface-2)" }}>
            <p className={label} style={muted}>{k}</p>
            <p className="text-[12.5px] font-semibold tabular-nums">{v}</p>
          </div>
        ))}
      </div>
      {d.quakes.length > 0 && (
        <div className="mt-3 border-t pt-2" style={{ borderColor: "var(--border)" }}>
          <p className={`${label} mb-1`} style={muted}>seismic · USGS, last 90 days, within 800 km</p>
          {d.quakes.slice(0, 3).map((q) => (
            <p key={q.time} className="text-[11px]" style={secondary}>
              ◈ M{q.magnitude.toFixed(1)} — {q.place}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function NewsWin({ d, retry }: { d: StateBrief; retry?: () => void }) {
  if ("error" in d.news) return <Failed error={d.news.error} what="news feeds" retry={retry} />;
  if (!d.news.items.length)
    return <p className="text-[12px]" style={secondary}>No headline mentions {d.state.name} or its districts right now.</p>;
  return (
    <ol className="flex flex-col gap-1.5">
      {d.news.items.map((n) => (
        <li key={n.link}>
          <a
            href={n.link}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-lg p-2 text-[11.5px] leading-snug hover:underline"
            style={{ background: "var(--surface-2)" }}
          >
            {n.title}
            <span className="mt-0.5 block text-[9.5px]" style={muted}>
              {n.source}
              {n.published ? ` · ${new Date(n.published).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}
              {" · opens the source ↗"}
            </span>
          </a>
        </li>
      ))}
    </ol>
  );
}

function PopulationWin({ d }: { d: StateBrief }) {
  const p = d.population;
  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg px-2.5 py-2" style={{ background: "var(--surface-2)" }}>
          <p className={label} style={muted}>population · 2026 projection</p>
          <p className="text-lg font-semibold tabular-nums">{crore(d.state.population2026 ?? d.state.population)}</p>
        </div>
        <div className="rounded-lg px-2.5 py-2" style={{ background: "var(--surface-2)" }}>
          <p className={label} style={muted}>under a live alert</p>
          <p className="text-lg font-semibold tabular-nums" style={{ color: p.underAlert ? "var(--serious)" : undefined }}>
            {p.underAlert ? crore(p.underAlert) : "—"}
          </p>
        </div>
      </div>
      {p.exposed.length > 0 && (
        <ol className="mt-2.5 flex flex-col gap-1.5">
          {p.exposed.map((e) => (
            <li key={e.name} className="flex items-baseline gap-2 text-[11px]">
              <span className="truncate">{e.name}</span>
              <span className="ml-auto shrink-0 tabular-nums" style={secondary}>{crore(e.people)}</span>
              {e.fragileHousingPct !== null && e.fragileHousingPct > 30 && (
                <span className="shrink-0 rounded px-1 text-[9px]" style={{ background: "#3a2a15", color: "var(--warning)" }}>
                  {Math.round(e.fragileHousingPct)}% kutcha
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
      <p className="mt-2 text-[9.5px] leading-snug" style={muted}>
        Exposure is distinct-by-district and scoped to this state. Kutcha share flags who loses a roof first.
      </p>
    </div>
  );
}

function RiversWin({ d, retry }: { d: StateBrief; retry?: () => void }) {
  if ("error" in d.rivers) return <Failed error={d.rivers.error} what="river discharge" retry={retry} />;
  const r = d.rivers;
  if (!r.rows.length) {
    // An answer, not an outage: these catchments are too small for the grid.
    return <p className="text-[11.5px] leading-relaxed" style={secondary}>{r.headline}</p>;
  }
  const TREND = { rising: ["▲", "var(--serious)"], steady: ["●", "var(--ink-muted)"], falling: ["▼", "var(--good)"] } as const;
  return (
    <div>
      <p className="mb-2 text-[11.5px] leading-snug" style={secondary}>{r.headline}</p>
      <ol className="flex flex-col gap-1.5">
        {r.rows.map((row) => {
          const [glyph, tone] = TREND[row.trend];
          const hot = row.ratio >= 2;
          return (
            <li key={row.district} className="rounded-lg px-2.5 py-2" style={{ background: "var(--surface-2)", border: hot ? "1px solid var(--serious)" : "1px solid transparent" }}>
              <div className="flex items-baseline gap-2 text-[11.5px]">
                <span className="min-w-0 flex-1 truncate font-medium">{row.district}</span>
                <span className="shrink-0 tabular-nums" style={{ color: hot ? "var(--serious)" : "var(--ink-secondary)" }}>
                  {row.ratio}× normal
                </span>
                <span className="shrink-0 text-[10.5px]" style={{ color: tone }} title={`${row.changePct > 0 ? "+" : ""}${row.changePct}% vs a week ago`}>
                  {glyph} {row.trend}
                </span>
              </div>
              <p className="mt-0.5 text-[9.5px] tabular-nums" style={muted}>
                {fmt(Math.round(row.today))} m³/s today · median {fmt(Math.round(row.median90d))}
                {row.peakAhead
                  ? ` · forecast peak ${row.peakAhead.ratio}× on ${new Date(row.peakAhead.date + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" })}`
                  : ""}
              </p>
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-[9.5px] leading-snug" style={muted}>
        Checked at the state&rsquo;s most populous districts. {r.source}.
      </p>
    </div>
  );
}

function DeployWin({ d, retry }: { d: StateBrief; retry?: () => void }) {
  if ("error" in d.deployments) return <Failed error={d.deployments.error} what="deployments" retry={retry} />;
  return (
    <ol className="flex flex-col gap-1.5">
      {d.deployments.map((t) => (
        <li key={t.id} className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[11px]" style={{ background: "var(--surface-2)" }}>
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: t.status === "available" ? "var(--good)" : "var(--warning)" }}
            title={t.status}
          />
          <span className="min-w-0">
            <span className="block truncate font-medium">{t.name}</span>
            <span className="block text-[9.5px]" style={muted}>
              {t.kind} · {t.place} · {t.status}
              {t.boats ? ` · ${t.boats} boats` : ""}
              {t.medicalKits ? ` · ${t.medicalKits} kits` : ""}
            </span>
          </span>
          <span className="ml-auto shrink-0 tabular-nums" style={secondary}>{fmt(t.distanceKm)} km</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Live weather map — Windy's embeddable viewer, which exists to be embedded.
 *
 * Sandboxed: an embedded page is untrusted content inside an operations tool.
 * allow-scripts without allow-same-origin breaks Windy's tiles, so both are
 * granted — but no top-navigation, no forms, no popups.
 */
function WeatherMapWin({ lat, lng }: { lat: number; lng: number }) {
  const [overlay, setOverlay] = useState<"satellite" | "rain" | "radar" | "wind">("satellite");
  const src =
    `https://embed.windy.com/embed2.html?lat=${lat.toFixed(2)}&lon=${lng.toFixed(2)}` +
    `&detailLat=${lat.toFixed(2)}&detailLon=${lng.toFixed(2)}&zoom=6&level=surface` +
    `&overlay=${overlay}&menu=&message=&marker=true&calendar=now&type=map&location=coordinates`;
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex flex-wrap gap-1">
        {(["satellite", "rain", "radar", "wind"] as const).map((o) => (
          <button
            key={o}
            onClick={() => setOverlay(o)}
            className="rounded-md px-2 py-1 text-[10.5px]"
            style={{
              background: overlay === o ? "#17508f" : "var(--surface-2)",
              color: overlay === o ? "#fff" : "var(--ink-secondary)",
            }}
          >
            {o}
          </button>
        ))}
        <span className="ml-auto self-center text-[9.5px]" style={muted}>windy.com · external</span>
      </div>
      <iframe
        key={overlay}
        src={src}
        title="Live weather map (Windy)"
        className="min-h-0 w-full flex-1 rounded-lg"
        style={{ border: "1px solid var(--border)" }}
        sandbox="allow-scripts allow-same-origin"
        referrerPolicy="no-referrer"
        loading="lazy"
      />
    </div>
  );
}

function HubWin({ d, onOpen }: { d: StateBrief; onOpen: (which: "deploy" | "weather") => void }) {
  const s = d.state;
  return (
    <div>
      <div className="grid grid-cols-3 gap-2">
        {[
          ["districts", fmt(s.districts)],
          ["density", `${fmt(Math.round(s.density))}/km²`],
          ["area", `${crore(s.areaKm2)} km²`],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg px-2 py-1.5 text-center" style={{ background: "var(--surface-2)" }}>
            <p className={label} style={muted}>{k}</p>
            <p className="text-[12.5px] font-semibold tabular-nums">{v}</p>
          </div>
        ))}
      </div>
      {s.hazards.length > 0 && (
        <p className="mt-2 text-[11px]" style={secondary}>
          Recorded hazard classes: {s.hazards.join(", ")}
        </p>
      )}
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <button
          onClick={() => onOpen("weather")}
          className="rounded-md px-2.5 py-1.5 text-[10.5px]"
          style={{ background: "var(--surface-2)", color: "var(--ink-secondary)" }}
        >
          ▦ satellite &amp; radar
        </button>
        <button
          onClick={() => onOpen("deploy")}
          className="rounded-md px-2.5 py-1.5 text-[10.5px]"
          style={{ background: "var(--surface-2)", color: "var(--ink-secondary)" }}
        >
          ✚ teams near here
        </button>
        <a
          href="https://sachet.ndma.gov.in/"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md px-2.5 py-1.5 text-[10.5px]"
          style={{ background: "var(--surface-2)", color: "var(--ink-secondary)" }}
        >
          NDMA Sachet ↗
        </a>
        <a
          href="https://mausam.imd.gov.in/"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md px-2.5 py-1.5 text-[10.5px]"
          style={{ background: "var(--surface-2)", color: "var(--ink-secondary)" }}
        >
          IMD ↗
        </a>
      </div>
      <p className="mt-2 text-[9.5px]" style={muted}>{s.source}</p>
    </div>
  );
}

// ────────────────────────────────────────────── the deck

const DECK = "state";

/**
 * Open the drill-down for a state. Windows appear immediately with skeletons
 * and fill when the single /api/state call lands. Window ids are stable per
 * state, so an arrangement someone made is remembered (lib/windows persists
 * geometry by id).
 */
export function openStateDeck(stateName: string): void {
  const key = stateName.toLowerCase().replace(/[^a-z]/g, "");
  const id = (part: string) => `state:${key}:${part}`;

  const spawn = (part: string, title: string, glyph: string, source: string, node: React.ReactNode, w: number, h: number, x?: number, y?: number) =>
    openWindow({ id: id(part), deck: DECK, title, glyph, source, node, w, h, x, y });

  // The frame answers before the data does.
  const vw = typeof window !== "undefined" ? window.innerWidth : 1440;
  spawn("hub", stateName, "◈", "command deck", <Skeleton lines={2} />, 430, 250, 24, 86);
  spawn("alerts", `Official alerts — ${stateName}`, "◆", "NDMA Sachet · live, 5-min cache", <Skeleton />, 460, 460, 24, 356);
  spawn("risk", `Risk surface — ${stateName}`, "◇", "Open-Meteo scan · our estimate, 15-min cache", <Skeleton />, 430, 360, Math.max(500, vw - 900), 86);
  spawn("forecast", `Forecast — ${stateName}`, "☂", "Open-Meteo · 15-min cache", <Skeleton lines={3} />, 470, 330, Math.max(520, vw - 920), 470);
  spawn("anomaly", `Rain vs 80 years — ${stateName}`, "↺", "ERA5 reanalysis 1940→ · 6-h cache", <Skeleton lines={3} />, 420, 360, Math.max(940, vw - 448), 86);
  spawn("news", `News — ${stateName}`, "⌕", "The Hindu · NDTV · PIB · live RSS", <Skeleton />, 420, 350, Math.max(940, vw - 448), 470);
  spawn("population", `Population at risk — ${stateName}`, "⚖", "Census 2011 → 2026 projection", <Skeleton lines={3} />, 460, 330, 24, 640);
  spawn("rivers", `Rivers — ${stateName}`, "≋", "GloFAS model · 6-h cache", <Skeleton lines={4} />, 460, 340, Math.max(490, Math.floor(vw / 2) - 230), 560);
  spawn("weather", `Satellite & radar — ${stateName}`, "▦", "windy.com embed · external, sandboxed", <Skeleton lines={5} />, 620, 470, Math.max(300, Math.floor(vw / 2) - 310), 250);

  void fetch(`/api/state/${encodeURIComponent(stateName)}`)
    .then(async (r) => {
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
      return r.json() as Promise<StateBrief>;
    })
    .then((d) => {
      const again = () => openStateDeck(d.state.name);
      const openExtra = (which: "deploy" | "weather") => {
        if (which === "deploy")
          spawn("deploy", `Deployments near ${d.state.name}`, "✚", "our records · live", <DeployWin d={d} retry={again} />, 440, 380);
        else
          spawn(
            "weather",
            `Satellite & radar — ${d.state.name}`,
            "▦",
            "windy.com embed · external, sandboxed",
            <WeatherMapWin lat={d.state.center[0]} lng={d.state.center[1]} />,
            620,
            470,
          );
      };
      spawn("hub", d.state.name, "◈", "command deck", <HubWin d={d} onOpen={openExtra} />, 430, 250, 24, 86);
      spawn("alerts", `Official alerts — ${d.state.name}`, "◆", "NDMA Sachet · live, 5-min cache", <AlertsWin d={d} retry={again} />, 460, 460, 24, 356);
      spawn("risk", `Risk surface — ${d.state.name}`, "◇", "Open-Meteo scan · our estimate, 15-min cache", <RiskWin d={d} retry={again} />, 430, 360, Math.max(500, vw - 900), 86);
      spawn("forecast", `Forecast — ${d.state.name}`, "☂", "Open-Meteo · 15-min cache", <ForecastWin d={d} retry={again} />, 470, 330, Math.max(520, vw - 920), 470);
      spawn("anomaly", `Rain vs 80 years — ${d.state.name}`, "↺", ("error" in d.anomaly ? "ERA5 reanalysis" : d.anomaly.source) + " · 6-h cache", <AnomalyWin d={d} retry={again} />, 420, 360, Math.max(940, vw - 448), 86);
      spawn("news", `News — ${d.state.name}`, "⌕", "The Hindu · NDTV · PIB · live RSS", <NewsWin d={d} retry={again} />, 420, 350, Math.max(940, vw - 448), 470);
      spawn("population", `Population at risk — ${d.state.name}`, "⚖", d.population.source, <PopulationWin d={d} />, 460, 330, 24, 640);
      spawn("rivers", `Rivers — ${d.state.name}`, "≋", "GloFAS model · 6-h cache", <RiversWin d={d} retry={again} />, 460, 340, Math.max(490, Math.floor(vw / 2) - 230), 560);
      openExtra("weather");
    })
    .catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      spawn("hub", stateName, "◈", "command deck", <Failed error={msg} what="the state briefing" />, 430, 200, 24, 86);
      for (const part of ["alerts", "risk", "forecast", "anomaly", "news", "population"]) {
        spawn(part, `${stateName}`, "◈", "unreachable", <Failed error={msg} what="this layer" />, 380, 180);
      }
    });
}
