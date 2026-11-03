"use client";

/**
 * Dashboard primitives.
 *
 * Magnitude is sequential — one hue, light→dark. Status colours (good/warning/
 * serious/critical) are reserved for risk level and always ship with a label,
 * never colour alone. No rainbow categorical anywhere: it fails colour-vision
 * deficiency and it is the single most common dashboard mistake.
 */

export const STATUS: Record<string, string> = {
  low: "#0ca30c",
  moderate: "#fab219",
  high: "#ec835a",
  severe: "#d03b3b",
};

const fmt = (n: number) => n.toLocaleString("en-IN");

export function Panel({
  title,
  right,
  children,
  className = "",
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`flex min-w-0 flex-col rounded-lg ${className}`}
      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
    >
      <header className="flex items-center justify-between gap-2 px-3.5 pt-3">
        <h2
          className="truncate text-[10.5px] font-semibold uppercase tracking-[0.1em]"
          style={{ color: "var(--ink-muted)" }}
        >
          {title}
        </h2>
        {right}
      </header>
      <div className="min-w-0 flex-1 px-3.5 pb-3.5 pt-3">{children}</div>
    </section>
  );
}

export function StatCard({
  label,
  value,
  delta,
  note,
  icon,
}: {
  label: string;
  value: string;
  delta?: string;
  note?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div
      className="flex items-start justify-between gap-3 rounded-lg px-4 py-3"
      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
    >
      <div className="min-w-0">
        <p
          className="truncate text-[10.5px] font-semibold uppercase tracking-[0.1em]"
          style={{ color: "var(--ink-muted)" }}
        >
          {label}
        </p>
        <div className="mt-1.5 flex items-baseline gap-2">
          <span className="truncate text-[2.1rem] font-semibold leading-none tabular-nums">
            {value}
          </span>
          {delta && (
            <span className="shrink-0 text-[11px] tabular-nums" style={{ color: "#3f92e8" }}>
              {delta}
            </span>
          )}
        </div>
        {note && (
          <p className="mt-1.5 truncate text-[11px]" style={{ color: "var(--ink-secondary)" }}>
            {note}
          </p>
        )}
      </div>
      {icon && <div className="shrink-0 opacity-70">{icon}</div>}
    </div>
  );
}

/** Horizontal bars — the safe default for comparing magnitude across labels. */
export function HBars({
  rows,
  unit = "",
  labelWidth = "5.5rem",
  colorBy,
}: {
  rows: { label: string; value: number; level?: string }[];
  unit?: string;
  labelWidth?: string;
  colorBy?: "status";
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ol className="flex flex-col gap-[7px]">
      {rows.map((r) => (
        <li
          key={r.label}
          className="grid items-center gap-2 text-[11.5px]"
          style={{ gridTemplateColumns: `${labelWidth} 1fr auto` }}
        >
          <span className="truncate capitalize" title={r.label}>
            {r.label}
          </span>
          <span className="h-[7px] overflow-hidden rounded-sm" style={{ background: "#232322" }}>
            <span
              className="block h-full rounded-sm"
              style={{
                width: `${Math.max(3, (r.value / max) * 100)}%`,
                background:
                  colorBy === "status" && r.level ? STATUS[r.level] ?? "#1f6fc4" : "#1f6fc4",
              }}
            />
          </span>
          <span className="tabular-nums" style={{ color: "var(--ink-secondary)" }}>
            {fmt(r.value)}
            {unit}
          </span>
        </li>
      ))}
    </ol>
  );
}


