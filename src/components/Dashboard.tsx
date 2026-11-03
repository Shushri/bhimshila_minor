"use client";

import { useEffect, useMemo, useState } from "react";
import IndiaMap from "./IndiaMap";
import { openStateDeck } from "./StateDeck";
import type { Feed, FeedItem, FeedSource, Severity, Verification } from "@/lib/feed";

/**
 * The operations board.
 *
 * This replaces an ask-a-question interface, and the reason is that a
 * coordinator watching a screen at 3am should not have to know what to ask.
 * Everything the system knows is on the board already; the work is filtering it
 * down and acting on a row. The agent stays underneath as the intelligence that
 * ranks, verifies and explains — it is no longer the way you drive.
 *
 * One rule the layout enforces: where a row came from is never implicit.
 * "An authority issued this", "our scan flagged it and nobody has warned", and
 * "a person asked for help" are three different kinds of claim, and a board
 * that renders them identically invites a coordinator to act on ours as though
 * it were the government's.
 */

const SEVERITY_COLOUR: Record<Severity, string> = {
  red: "var(--critical)",
  orange: "var(--serious)",
  yellow: "var(--warning)",
  info: "var(--ink-muted)",
};

/** Source is carried by a glyph as well as a colour, never colour alone. */
const SOURCE_MARK: Record<FeedSource, { glyph: string; label: string }> = {
  official: { glyph: "◆", label: "Issued by an authority" },
  model: { glyph: "◇", label: "Our scan only — a lead, not a warning" },
  incident: { glyph: "●", label: "A person asked for help" },
};

const VERIFICATION_LABEL: Record<Verification, string> = {
  confirmed: "Confirmed — authority and our scan agree",
  official_only: "Official — our scan is quiet here",
  model_only: "Unverified lead — nobody has warned",
  reported: "Reported by citizens",
};

const HAZARD_GLYPH: Record<string, string> = {
  flood: "≋", flashflood: "⇊", storm: "⚡", rain: "☂", cyclone: "◉",
  wind: "➤", landslide: "⛰", heat: "☀", cold: "❄", quake: "◈", alert: "▲",
};

const fmt = (n: number) => n.toLocaleString("en-IN");
const crore = (n: number) =>
  n >= 1e7 ? `${(n / 1e7).toFixed(1)} cr` : n >= 1e5 ? `${(n / 1e5).toFixed(1)} L` : fmt(n);

// ────────────────────────────────────────────────────────────── stat strip

function Stat({
  label,
  value,
  tone,
  delta,
  glyph,
}: {
  label: string;
  value: string;
  tone?: string;
  /** Change against the hour-old snapshot. Omitted when there is none yet. */
  delta?: number;
  /** Tile icon, top-right — the same glyph language the rest of the app uses. */
  glyph?: string;
}) {
  return (
    <div className="tile relative rounded-lg px-3 py-2" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
      <p className="text-[9.5px] uppercase tracking-wider" style={{ color: "var(--ink-muted)" }}>
        {label}
      </p>
      {glyph && (
        <span className="absolute right-2.5 top-2 text-[13px]" style={{ color: tone ?? "var(--seq-250)", opacity: 0.85 }} aria-hidden>
          {glyph}
        </span>
      )}
      <p className="mt-0.5 flex items-baseline gap-1.5 text-lg font-semibold tabular-nums" style={{ color: tone ?? "var(--ink)" }}>
        {value}
        {delta !== undefined && delta !== 0 && (
          <span
            className="rounded px-1 py-0.5 text-[9px] font-medium tabular-nums"
            style={{
              background: delta > 0 ? "#3a2a12" : "#14301b",
              color: delta > 0 ? "var(--warning)" : "var(--good)",
            }}
            title="Change since the snapshot taken about an hour ago on this device"
          >
            {delta > 0 ? "▲" : "▼"} {Math.abs(delta) >= 1e5 ? crore(Math.abs(delta)) : fmt(Math.abs(delta))}
            <span className="opacity-70"> (1h)</span>
          </span>
        )}
      </p>
    </div>
  );
}

type StatDeltas = Partial<Record<keyof Feed["stats"], number>>;

/**
 * Real deltas, not invented ones: the previous stats are snapshotted on this
 * device and refreshed hourly, so "▲ 2" means two more than an hour ago here —
 * never a number the server made up. Called from the fetch callback, where the
 * fresh stats actually arrive.
 */
function computeDeltas(stats: Feed["stats"]): StatDeltas {
  if (typeof window === "undefined") return {};
  const KEY = "bhimshila.stats.snapshot";
  try {
    const raw = window.localStorage.getItem(KEY);
    const snap = raw ? (JSON.parse(raw) as { at: number; stats: Feed["stats"] }) : null;
    let next: StatDeltas = {};
    if (snap && Date.now() - snap.at < 2 * 3600_000) {
      next = Object.fromEntries(
        (Object.keys(stats) as (keyof Feed["stats"])[]).map((k) => [k, stats[k] - (snap.stats[k] ?? stats[k])]),
      );
      if (Date.now() - snap.at < 3600_000) return next; // keep comparing to it
    }
    window.localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), stats }));
    return next;
  } catch {
    return {}; // no storage — no deltas, the numbers still stand on their own
  }
}

// ────────────────────────────────────────────────────────────── filters

interface Filters {
  source: FeedSource | "all";
  severity: Severity | "all";
  verification: Verification | "all";
  state: string;
  q: string;
}

const EMPTY: Filters = { source: "all", severity: "all", verification: "all", state: "all", q: "" };

function Chip({
  on,
  onClick,
  children,
  tone,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
  tone?: string;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-md px-2 py-1 text-[10.5px] font-medium transition-colors"
      style={{
        background: on ? (tone ?? "#17508f") : "var(--plane)",
        border: `1px solid ${on ? "transparent" : "var(--border)"}`,
        color: on ? "#fff" : "var(--ink-secondary)",
      }}
    >
      {children}
    </button>
  );
}

// ────────────────────────────────────────────────────────────── feed row

function Row({
  item,
  selected,
  onSelect,
}: {
  item: FeedItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const mark = SOURCE_MARK[item.source];
  return (
    <li>
      <button
        onClick={onSelect}
        className="row-hover flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left"
        style={{
          background: selected ? "#17508f22" : "var(--surface-2)",
          border: `1px solid ${selected ? "#17508f" : "transparent"}`,
        }}
      >
        <span
          className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded text-[11px]"
          style={{ background: SEVERITY_COLOUR[item.severity], color: "#0d0d0d" }}
          title={`${item.severity} · ${mark.label}`}
        >
          {HAZARD_GLYPH[item.kind] ?? "▲"}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-1.5">
            <span className="truncate text-[12px] font-medium">{item.title}</span>
            <span className="shrink-0 text-[10px]" style={{ color: "var(--ink-muted)" }}>
              {mark.glyph}
            </span>
          </span>
          <span className="mt-0.5 block truncate text-[10.5px]" style={{ color: "var(--ink-muted)" }}>
            {item.place}
            {item.state ? ` · ${item.state}` : ""} · {item.issuer}
          </span>
        </span>

        {item.people !== null && (
          <span className="shrink-0 tabular-nums text-[11px]" title={`${fmt(item.people)} people`}>
            {crore(item.people)}
          </span>
        )}
      </button>
    </li>
  );
}

// ────────────────────────────────────────────────────────────── detail

function Detail({
  item,
  onAct,
  busy,
}: {
  item: FeedItem;
  onAct: (action: string, item: FeedItem) => void;
  busy: string | null;
}) {
  const mark = SOURCE_MARK[item.source];
  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="flex items-center gap-2">
          <span
            className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase"
            style={{ background: SEVERITY_COLOUR[item.severity], color: "#0d0d0d" }}
          >
            {item.severity}
          </span>
          <span className="text-[10.5px]" style={{ color: "var(--ink-muted)" }}>
            {mark.glyph} {mark.label}
          </span>
        </div>
        <h3 className="mt-1.5 text-[15px] font-semibold leading-tight">{item.title}</h3>
        <p className="mt-0.5 text-[11.5px]" style={{ color: "var(--ink-secondary)" }}>
          {item.place}
          {item.state ? `, ${item.state}` : ""}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Issued by" value={item.issuer} />
        <Stat
          label="People under it"
          value={item.people !== null ? fmt(item.people) : "not estimable"}
        />
      </div>

      <div>
        <p className="mb-1 text-[9.5px] uppercase tracking-wider" style={{ color: "var(--ink-muted)" }}>
          {VERIFICATION_LABEL[item.verification]}
        </p>
        <ul className="flex flex-col gap-1">
          {item.evidence.filter(Boolean).map((e, i) => (
            <li
              key={i}
              className="rounded-md px-2.5 py-1.5 text-[11.5px] leading-snug"
              style={{ background: "var(--surface-2)", color: "var(--ink-secondary)" }}
            >
              {e}
            </li>
          ))}
        </ul>
      </div>

      {item.actions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {item.actions.map((a) => (
            <button
              key={a}
              onClick={() => onAct(a, item)}
              disabled={busy !== null}
              className="rounded-md px-3 py-1.5 text-[11.5px] font-medium"
              style={{
                background: a === "verify" ? "var(--plane)" : "#17508f",
                border: "1px solid var(--border)",
                color: a === "verify" ? "var(--ink-secondary)" : "#fff",
                opacity: busy ? 0.5 : 1,
              }}
            >
              {busy === a
                ? "…"
                : a === "alert"
                  ? "Draft an alert"
                  : a === "dispatch"
                    ? "Send a team"
                    : a === "resolve"
                      ? "Mark resolved"
                      : "Check this"}
            </button>
          ))}
        </div>
      )}

      <p className="text-[10px] leading-snug" style={{ color: "var(--ink-muted)" }}>
        Nothing here sends on its own — every action opens a confirmation first.
      </p>
    </div>
  );
}

// ────────────────────────────────────────────────────────────── board

export default function Dashboard({ onAct }: { onAct: (action: string, item: FeedItem) => void }) {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [deltas, setDeltas] = useState<StatDeltas>({});
  // The resting heat surface: every state painted by its worst district in
  // our scan. Separate fetch because the feed is 60-second data and this is
  // 15-minute data — and separate provenance: this glow is OUR estimate.
  const [heat, setHeat] = useState<{ name: string; value: number }[]>([]);

  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch("/api/feed")
        .then((r) => r.json())
        .then((d: Feed) => {
          if (!alive) return;
          setFeed(d);
          setDeltas(computeDeltas(d.stats));
          setStale(false);
        })
        .catch(() => alive && setStale(true));
    };
    load();
    const t = setInterval(load, 60_000);

    const loadHeat = () => {
      fetch("/api/overview")
        .then((r) => r.json())
        .then((d: { states?: { state: string; worst: number }[] }) => {
          if (alive && d.states?.length) {
            setHeat(d.states.map((s) => ({ name: s.state, value: s.worst })));
          }
        })
        .catch(() => {
          /* the map still works as outlines + events */
        });
    };
    loadHeat();
    const h = setInterval(loadHeat, 900_000);

    return () => {
      alive = false;
      clearInterval(t);
      clearInterval(h);
    };
  }, []);

  const states = useMemo(
    () => [...new Set((feed?.items ?? []).map((i) => i.state).filter(Boolean))].sort(),
    [feed],
  );

  const shown = useMemo(() => {
    const q = filters.q.toLowerCase().trim();
    return (feed?.items ?? []).filter(
      (i) =>
        (filters.source === "all" || i.source === filters.source) &&
        (filters.severity === "all" || i.severity === filters.severity) &&
        (filters.verification === "all" || i.verification === filters.verification) &&
        (filters.state === "all" || i.state === filters.state) &&
        (!q ||
          i.title.toLowerCase().includes(q) ||
          i.place.toLowerCase().includes(q) ||
          i.issuer.toLowerCase().includes(q)),
    );
  }, [feed, filters]);

  const selected = shown.find((i) => i.id === selectedId) ?? null;

  if (!feed) {
    return (
      <div className="grid h-64 place-items-center text-[12px]" style={{ color: "var(--ink-muted)" }}>
        Scanning 724 districts and polling NDMA…
      </div>
    );
  }

  const s = feed.stats;

  return (
    <div className="flex flex-col gap-2.5">
      {/* An unreachable source is never allowed to look like quiet. */}
      {!feed.officialReachable && (
        <div
          className="rounded-lg px-3 py-2 text-[11.5px]"
          style={{ background: "#3a1a1a", color: "var(--serious)" }}
        >
          NDMA Sachet is not responding. This is not an all-clear — official alerts may be live and
          unseen.
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 lg:grid-cols-6">
        <Stat label="Official alerts" value={fmt(s.official)} delta={deltas.official} glyph="◆" />
        <Stat label="Red" value={fmt(s.red)} tone={s.red ? "var(--critical)" : undefined} delta={deltas.red} glyph="■" />
        <Stat label="People covered" value={crore(s.peopleCovered)} delta={deltas.peopleCovered} glyph="⚖" />
        <Stat label="Districts scanned" value={fmt(s.districtsScanned)} glyph="▦" />
        <Stat
          label="Unverified leads"
          value={fmt(s.modelOnly)}
          tone={s.modelOnly ? "var(--warning)" : undefined}
          delta={deltas.modelOnly}
          glyph="◇"
        />
        <Stat
          label="Unassigned SOS"
          value={fmt(s.unassigned)}
          tone={s.unassigned ? "var(--serious)" : undefined}
          delta={deltas.unassigned}
          glyph="●"
        />
      </div>

      <div className="grid gap-2.5 lg:grid-cols-[1fr_23rem]">
        <div className="flex flex-col gap-2.5">
          <div className="rounded-xl p-2.5" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
            <IndiaMap
              values={heat}
              unit="/100"
              // The dropdown, a map click and the deck all set the same state
              // filter, and the camera follows it — one selection, one truth.
              focus={filters.state !== "all" ? filters.state : undefined}
              onReset={() => setFilters((f) => ({ ...f, state: "all" }))}
              events={shown
                .filter((i) => i.lat !== null && i.lng !== null)
                .map((i) => ({
                  kind: i.kind,
                  name: i.place,
                  state: i.state,
                  lat: i.lat!,
                  lng: i.lng!,
                  level: i.severity === "info" ? "low" : i.severity,
                  detail: `${i.title} · ${i.issuer}`,
                }))}
              onPick={(name) => {
                // A state click is the drill-down gesture: the deck opens its
                // layered windows, and the feed narrows to the same state so
                // both views agree about what you are looking at.
                openStateDeck(name);
                const hit = shown.find((i) => i.state === name);
                if (hit) setFilters((f) => ({ ...f, state: name }));
              }}
            />
            <p className="mt-1.5 text-[10px]" style={{ color: "var(--ink-muted)" }}>
              State glow = worst district in our 15-minute rainfall scan (0–100) — our estimate, not
              an official warning. Click a state for its command deck: alerts, risk, forecast,
              satellite &amp; radar, 80-year context, news, population, deployments.
            </p>
            <ul className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1 text-[10px]">
              {(["red", "orange", "yellow"] as Severity[]).map((c) => (
                <li key={c} className="flex items-center gap-1.5">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: SEVERITY_COLOUR[c] }}
                  />
                  <span style={{ color: "var(--ink-muted)" }}>{c}</span>
                </li>
              ))}
              {(Object.keys(SOURCE_MARK) as FeedSource[]).map((k) => (
                <li key={k} className="flex items-center gap-1.5" style={{ color: "var(--ink-muted)" }}>
                  <span>{SOURCE_MARK[k].glyph}</span>
                  <span>{SOURCE_MARK[k].label}</span>
                </li>
              ))}
            </ul>
          </div>

          {selected && (
            <div className="rounded-xl p-3" style={{ background: "var(--surface)" }}>
              <Detail item={selected} onAct={onAct} busy={null} />
            </div>
          )}
        </div>

        <div className="flex min-h-0 flex-col gap-2 rounded-xl p-2.5" style={{ background: "var(--surface)" }}>
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-medium">
              {shown.length} of {feed.items.length}
            </p>
            {stale && (
              <span className="text-[10px]" style={{ color: "var(--warning)" }}>
                refresh failed — showing last good
              </span>
            )}
          </div>

          <input
            value={filters.q}
            onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
            placeholder="Filter by place, hazard, authority…"
            className="w-full rounded-md px-2.5 py-1.5 text-[11.5px] outline-none"
            style={{ background: "var(--plane)", border: "1px solid var(--border)", color: "var(--ink)" }}
          />

          <div className="flex flex-wrap gap-1">
            {(["all", "official", "model", "incident"] as const).map((v) => (
              <Chip
                key={v}
                on={filters.source === v}
                onClick={() => setFilters((f) => ({ ...f, source: v }))}
              >
                {v === "all" ? "All sources" : v === "model" ? "Our leads" : v}
              </Chip>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            {(["all", "red", "orange", "yellow"] as const).map((v) => (
              <Chip
                key={v}
                on={filters.severity === v}
                onClick={() => setFilters((f) => ({ ...f, severity: v }))}
                tone={v !== "all" ? SEVERITY_COLOUR[v] : undefined}
              >
                {v}
              </Chip>
            ))}
          </div>

          <select
            value={filters.state}
            onChange={(e) => setFilters((f) => ({ ...f, state: e.target.value }))}
            className="w-full rounded-md px-2 py-1.5 text-[11px] outline-none"
            style={{ background: "var(--plane)", border: "1px solid var(--border)", color: "var(--ink)" }}
          >
            <option value="all">Every state</option>
            {states.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>

          {(filters.source !== "all" ||
            filters.severity !== "all" ||
            filters.state !== "all" ||
            filters.q) && (
            <button
              onClick={() => setFilters(EMPTY)}
              className="self-start text-[10.5px] underline"
              style={{ color: "var(--ink-muted)" }}
            >
              clear filters
            </button>
          )}

          <ul className="flex max-h-[52vh] flex-col gap-1 overflow-y-auto pr-0.5">
            {shown.map((i) => (
              <Row
                key={i.id}
                item={i}
                selected={i.id === selectedId}
                onSelect={() => setSelectedId(i.id === selectedId ? null : i.id)}
              />
            ))}
            {!shown.length && (
              <li className="px-2 py-6 text-center text-[11.5px]" style={{ color: "var(--ink-muted)" }}>
                Nothing matches these filters.
              </li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
