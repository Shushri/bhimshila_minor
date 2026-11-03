"use client";

import { useMemo, useState } from "react";
import stateOutlines from "@/data/state-outlines.json";
import districtShapes from "@/data/india-districts.json";

/**
 * India, drawn as glowing state outlines over district hairlines, on a dark
 * plane with a faint graticule — the cartography of a control room.
 *
 * The border carries the value — a bright stroke on a near-black fill reads at
 * a glance in a dark room, where large flat fills glare. Magnitude is
 * sequential (one hue, dim→bright); status colours stay reserved for live
 * events and always ship with a glyph, never colour alone.
 *
 * Focus: pass a state name and the camera glides to it. The zoom is a CSS
 * transform on one <g> rather than viewBox maths — transforms animate on the
 * compositor, viewBox does not — and every stroke is non-scaling, so a
 * hairline stays a hairline at 6×. Event markers counter-scale for the same
 * reason: a dot that grows with the zoom reads as the hazard growing.
 */

type Ring = [number, number][];
const OUTLINES = stateOutlines as unknown as Record<string, Ring[]>;

interface DistrictShape {
  d: string;
  s: string;
  g: [number, number][][][];
}
const DISTRICTS = districtShapes as unknown as DistrictShape[];

const BOUNDS = { minLng: 68.0, maxLng: 97.5, minLat: 6.5, maxLat: 37.2 };
const W = 1000;
const H = Math.round((W * (BOUNDS.maxLat - BOUNDS.minLat)) / (BOUNDS.maxLng - BOUNDS.minLng) * 0.99);
const MAX_ZOOM = 6;

const px = (lng: number) => ((lng - BOUNDS.minLng) / (BOUNDS.maxLng - BOUNDS.minLng)) * W;
const py = (lat: number) => ((BOUNDS.maxLat - lat) / (BOUNDS.maxLat - BOUNDS.minLat)) * H;

/** Sequential ramp, dim → bright. Low values recede, high values glow. */
const RAMP = ["#1d4f7a", "#1f6fc4", "#3f92e8", "#7fb6f0", "#bcd9f8", "#e8f3ff"];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

/** This outline set predates a few renames and reorganisations. */
const ALIASES: Record<string, string> = {
  orissa: "odisha",
  uttaranchal: "uttarakhand",
  pondicherry: "puducherry",
  nctofdelhi: "delhi",
  // Andaman: "and" vs "&" vs trailing "Islands" all have to land on one key
  andamanandnicobar: "andamannicobar",
  andamannicobarislands: "andamannicobar",
  andamanandnicobarislands: "andamannicobar",
  // Telangana split from Andhra in 2014; this geometry predates the split
  telangana: "andhrapradesh",
  // Ladakh separated from J&K in 2019, likewise
  ladakh: "jammukashmir",
  jammuandkashmir: "jammukashmir",
  dadraandnagarhaveli: "dadranagarhaveli",
  dadranagarhavelianddamananddiu: "dadranagarhaveli",
  damananddiu: "damandiu",
};
const canon = (s: string) => {
  const n = norm(s);
  return ALIASES[n] ?? n;
};

export interface MapValue {
  name: string;
  value: number;
}

export interface EventMarker {
  /** Hazard family — drives the glyph. See hazardKind() in kb/sachet.ts. */
  kind: string;
  name: string;
  state?: string;
  lat: number;
  lng: number;
  level: string;
  score?: number;
  detail?: string;
}

const LEVEL_FILL: Record<string, string> = {
  low: "#0ca30c",
  moderate: "#fab219",
  high: "#ec835a",
  severe: "#d03b3b",
  // IMD's alert colours are the same status ladder under the official names, so
  // they reuse the same steps rather than introducing a second palette — one
  // status language across the whole app.
  yellow: "#fab219",
  orange: "#ec835a",
  red: "#d03b3b",
};

/**
 * Glyph per hazard kind — status must survive colour-vision deficiency, so
 * nothing on this map is ever distinguished by colour alone.
 */
const GLYPH: Record<string, string> = {
  rain: "☂",
  quake: "◈",
  flood: "≋",
  flashflood: "⇊",
  storm: "⚡",
  cyclone: "◉",
  wind: "➤",
  landslide: "⛰",
  heat: "☀",
  cold: "❄",
  alert: "▲",
};

const glyphFor = (kind: string) => GLYPH[kind] ?? GLYPH.alert;

const fmt = (n: number) => n.toLocaleString("en-IN");

function ringPath(ring: Ring) {
  let d = "";
  ring.forEach(([lng, lat], i) => {
    d += `${i === 0 ? "M" : "L"}${px(lng).toFixed(1)} ${py(lat).toFixed(1)}`;
  });
  return d + "Z";
}

/** Label anchor: centroid of the state's largest ring. */
function anchorOf(rings: Ring[]): [number, number] {
  const r = rings[0];
  const lng = r.reduce((a, p) => a + p[0], 0) / r.length;
  const lat = r.reduce((a, p) => a + p[1], 0) / r.length;
  return [lng, lat];
}

/** Every 5° — enough to read as instrumentation, too faint to compete. */
const GRATICULE = (() => {
  const lines: string[] = [];
  for (let lng = 70; lng < BOUNDS.maxLng; lng += 5) lines.push(`M${px(lng).toFixed(1)} 0V${H}`);
  for (let lat = 10; lat < BOUNDS.maxLat; lat += 5) lines.push(`M0 ${py(lat).toFixed(1)}H${W}`);
  return lines.join(" ");
})();

export default function IndiaMap({
  values,
  unit = "",
  events = [],
  markers = [],
  highlight,
  focus,
  showLabels = true,
  onPick,
  onReset,
}: {
  values: MapValue[];
  unit?: string;
  events?: EventMarker[];
  markers?: { name: string; lat: number; lng: number; note?: string }[];
  highlight?: string;
  /** State to glide the camera to. Cleared → the camera glides home. */
  focus?: string;
  showLabels?: boolean;
  onPick?: (name: string) => void;
  /** Renders the "All India" chip while focused. */
  onReset?: () => void;
}) {
  const [hover, setHover] = useState<{
    label: string;
    sub: string;
    value: number | null;
    x: number;
    y: number;
    /** Rendered width of the map at hover time — the tooltip clamps to it. */
    w: number;
  } | null>(null);

  const lookup = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of values) m.set(canon(v.name), v.value);
    return m;
  }, [values]);

  const { min, span } = useMemo(() => {
    const vs = values.map((v) => v.value);
    const lo = vs.length ? Math.min(...vs) : 0;
    const hi = vs.length ? Math.max(...vs) : 1;
    return { min: lo, span: hi - lo || 1 };
  }, [values]);

  const shapes = useMemo(
    () =>
      Object.entries(OUTLINES).map(([name, rings]) => ({
        name,
        key: canon(name),
        d: rings.map(ringPath).join(" "),
        anchor: anchorOf(rings),
        area: rings[0].length,
        rings,
      })),
    [],
  );

  // District hairlines, one path per district, built once. 757 paths sounds
  // heavy and is not: they are static, memoised strings on the compositor.
  const districtPaths = useMemo(
    () =>
      DISTRICTS.map((d) => ({
        name: d.d,
        state: d.s,
        key: canon(d.s),
        d: d.g.map((poly) => poly.map((ring) => ringPath(ring as Ring)).join(" ")).join(" "),
      })),
    [],
  );

  const hl = highlight ? canon(highlight) : null;
  const fc = focus ? canon(focus) : null;
  const focused = fc ? shapes.find((s) => s.key === fc) ?? null : null;

  // Camera: fit the focused state's bounding box, padded, capped — Goa at a
  // full 6× is a blur of two districts; the cap keeps context in frame.
  const cam = useMemo(() => {
    if (!focused) return { k: 1, tx: 0, ty: 0 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const ring of focused.rings) {
      for (const [lng, lat] of ring) {
        const x = px(lng), y = py(lat);
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
    const pad = Math.max((maxX - minX), (maxY - minY)) * 0.14 + 8;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    const k = Math.min(MAX_ZOOM, W / (maxX - minX), H / (maxY - minY));
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    return { k, tx: W / 2 - k * cx, ty: H / 2 - k * cy };
  }, [focused]);

  const k = cam.k;

  return (
    <div className="relative w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="map-frame h-auto w-full select-none overflow-hidden rounded-lg"
        style={{ maxHeight: "58vh" }}
        role="img"
        aria-label={focused ? `Map of India, focused on ${focused.name}` : "Map of India by state"}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <radialGradient id="plane" cx="50%" cy="42%" r="75%">
            <stop offset="0%" stopColor="#0c1220" />
            <stop offset="70%" stopColor="#080b12" />
            <stop offset="100%" stopColor="#05070c" />
          </radialGradient>
          <filter id="lineGlow" x="-25%" y="-25%" width="150%" height="150%">
            <feGaussianBlur stdDeviation="2.4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="dotGlow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <rect x={0} y={0} width={W} height={H} fill="url(#plane)" />
        <path d={GRATICULE} stroke="#7fb6f0" strokeOpacity={0.05} strokeWidth={1} fill="none" />

        <g
          style={{
            transform: `translate(${cam.tx}px, ${cam.ty}px) scale(${k})`,
            transformOrigin: "0 0",
            transition: "transform 520ms cubic-bezier(0.22, 0.9, 0.24, 1)",
          }}
        >
          {/* District hairlines — the texture that makes it a map of a real
              country rather than a logo of one. Brighter inside the focused
              state, where they become the subject. */}
          {districtPaths.map((d) => {
            const inFocus = fc !== null && d.key === fc;
            if (fc !== null && !inFocus && k > 1.01) {
              // While zoomed, other states' internals are noise — skip them.
              return null;
            }
            return (
              <path
                key={`d-${d.state}-${d.name}`}
                d={d.d}
                fill={inFocus ? "#7fb6f0" : "none"}
                fillOpacity={inFocus ? 0.03 : 0}
                stroke={inFocus ? "#7fb6f0" : "#31415a"}
                strokeOpacity={inFocus ? 0.5 : 0.35}
                strokeWidth={0.7}
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
                onMouseMove={
                  inFocus
                    ? (e) => {
                        const r = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
                        setHover({
                          label: d.name,
                          sub: d.state,
                          value: null,
                          x: e.clientX - r.left,
                          y: e.clientY - r.top,
                          w: r.width,
                        });
                      }
                    : undefined
                }
              />
            );
          })}

          {shapes.map((s) => {
            const v = lookup.get(s.key);
            const t = v === undefined ? null : (v - min) / span;
            const stroke =
              t === null ? "#2a3646" : RAMP[Math.min(RAMP.length - 1, Math.round(t * (RAMP.length - 1)))];
            const dim = (hl !== null && s.key !== hl) || (fc !== null && s.key !== fc);
            const active = hover?.label === s.name;

            return (
              <path
                key={s.name}
                d={s.d}
                fill={stroke}
                fillOpacity={dim ? 0.02 : active ? 0.2 : fc ? 0.05 : 0.075}
                stroke={stroke}
                strokeWidth={active || s.key === fc ? 2 : 1.2}
                vectorEffect="non-scaling-stroke"
                strokeOpacity={dim ? 0.2 : 1}
                strokeLinejoin="round"
                filter={dim ? undefined : "url(#lineGlow)"}
                onMouseMove={(e) => {
                  // The focused state's surface belongs to its districts.
                  if (fc !== null && s.key === fc) return;
                  const r = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
                  setHover({
                    label: s.name,
                    sub: v === undefined ? "no data" : "",
                    value: v ?? null,
                    x: e.clientX - r.left,
                    y: e.clientY - r.top,
                    w: r.width,
                  });
                }}
                onClick={() => onPick?.(s.name)}
                style={{
                  cursor: onPick ? "pointer" : "default",
                  transition: "fill-opacity 140ms, stroke-opacity 140ms",
                  pointerEvents: fc !== null && s.key === fc ? "none" : undefined,
                }}
              />
            );
          })}

          {/* State labels read at country scale; at state scale the district
              hairlines are labelled by hover instead, so the names get out of
              the imagery's way. */}
          {showLabels &&
            k === 1 &&
            shapes
              .filter((s) => s.area > 60)
              .map((s) => (
                <text
                  key={`t-${s.name}`}
                  x={px(s.anchor[0])}
                  y={py(s.anchor[1])}
                  textAnchor="middle"
                  fontSize="11"
                  fill="#c9d6e6"
                  fillOpacity={hl && s.key !== hl ? 0.25 : 0.82}
                  style={{ pointerEvents: "none" }}
                >
                  {s.name}
                </text>
              ))}

          {/* live events — severity by fill, kind by glyph. Counter-scaled so
              a dot never grows with the zoom. */}
          {events.map((e, i) => {
            const fill = LEVEL_FILL[e.level] ?? "#fab219";
            const cx = px(e.lng);
            const cy = py(e.lat);
            return (
              <g
                key={`${e.name}-${e.lat}-${i}`}
                transform={`translate(${cx} ${cy}) scale(${1 / k})`}
                filter="url(#dotGlow)"
                onMouseMove={(ev) => {
                  const r = ev.currentTarget.ownerSVGElement!.getBoundingClientRect();
                  setHover({
                    label: `${glyphFor(e.kind)} ${e.name}${e.state ? `, ${e.state}` : ""}`,
                    sub: e.detail ?? "",
                    value: e.score ?? null,
                    x: ev.clientX - r.left,
                    y: ev.clientY - r.top,
                    w: r.width,
                  });
                }}
                style={{ cursor: "pointer" }}
              >
                <circle r={11} fill={fill} fillOpacity={0.2} />
                <circle r={7} fill={fill} stroke="#080b12" strokeWidth={1.2} />
                <text
                  y={3.2}
                  textAnchor="middle"
                  fontSize="9"
                  fontWeight="700"
                  fill="#080b12"
                  style={{ pointerEvents: "none" }}
                >
                  {glyphFor(e.kind)}
                </text>
              </g>
            );
          })}

          {markers.map((m) => (
            <g key={`${m.name}-${m.lat}`} transform={`translate(${px(m.lng)} ${py(m.lat)}) scale(${1 / k})`} filter="url(#dotGlow)">
              <circle r={5} fill="#d03b3b" stroke="#080b12" strokeWidth={1.4} />
              <text y={-12} textAnchor="middle" fontSize="12" fontWeight="600" fill="#fff">
                {m.name}
              </text>
            </g>
          ))}
        </g>
      </svg>

      {focused && onReset && (
        <button
          onClick={onReset}
          className="absolute right-2 top-2 z-10 rounded-md px-2.5 py-1.5 text-[10.5px] font-medium backdrop-blur"
          style={{ background: "rgba(20,22,26,0.85)", border: "1px solid var(--border)", color: "var(--ink-secondary)" }}
          title="Back to the whole country"
        >
          ⤢ All India
        </button>
      )}

      {hover && (
        <div
          className="pointer-events-none absolute z-10 rounded-lg px-3 py-2 text-sm shadow-2xl"
          style={{
            // Clamped to the rendered width, not a fixed number — the map is
            // fluid and a hardcoded clamp misplaces the tooltip at any other
            // size. 260 ≈ the tooltip's own max width.
            left: Math.max(4, Math.min(hover.x + 14, hover.w - 260)),
            top: Math.max(hover.y - 12, 4),
            background: "#151b26",
            border: "1px solid rgba(127,182,240,0.28)",
          }}
        >
          <div className="font-semibold leading-tight">{hover.label}</div>
          {hover.sub && (
            <div className="mt-0.5 max-w-[15rem] text-[11px]" style={{ color: "var(--ink-muted)" }}>
              {hover.sub}
            </div>
          )}
          {hover.value !== null && (
            <div className="mt-0.5 tabular-nums" style={{ color: "#7fb6f0" }}>
              {fmt(hover.value)}
              {unit}
            </div>
          )}
        </div>
      )}

      <div className="mt-2.5 flex items-center gap-3 text-[10.5px]" style={{ color: "var(--ink-muted)" }}>
        <span className="tabular-nums">{fmt(Math.round(min))}</span>
        <div className="flex h-1.5 flex-1 overflow-hidden rounded-full" style={{ maxWidth: 200 }}>
          {RAMP.map((c) => (
            <div key={c} className="flex-1" style={{ background: c }} />
          ))}
        </div>
        <span className="tabular-nums">
          {fmt(Math.round(min + span))}
          {unit}
        </span>
      </div>
    </div>
  );
}
