"use client";

import { useEffect, useState } from "react";

/**
 * Relief camps short of supplies — the next truck, in order.
 *
 * Kerala's students built this by hand in 2018, during the flood, because no
 * system held it. The ordering is the whole value: a driver needs to know what
 * is first, not to browse every camp, so this is a list and not a table.
 *
 * Shows who is holding the stock beside each shortage, and says plainly when
 * nobody is — "no team carrying it" is a fact a coordinator can act on, where
 * a blank space just looks like missing data.
 */

interface Need {
  item: string;
  short: number;
  urgency: "normal" | "urgent" | "critical";
}

interface Camp {
  id: number;
  name: string;
  place: string;
  people: number;
  team: string | null;
  worst: Need | null;
  unmet: Need[];
  supplier: string | null;
}

const URGENCY_COLOUR: Record<string, string> = {
  critical: "var(--critical, var(--serious))",
  urgent: "var(--warning)",
  normal: "var(--seq-250)",
};

export default function CampBoard() {
  const [camps, setCamps] = useState<Camp[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/camps")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (alive) setCamps(d.camps ?? []);
      })
      .catch(() => {
        // A failed lookup is not an empty camp list — saying "no camps need
        // anything" because a fetch died is the false all-clear this whole
        // feature was built to avoid.
        if (alive) setError("Could not load camps.");
      });
    return () => {
      alive = false;
    };
  }, []);

  if (error) {
    return (
      <p className="px-1 py-2 text-[11px]" style={{ color: "var(--warning)" }}>
        {error} This is a lookup failure, not an all-clear.
      </p>
    );
  }

  if (camps === null) {
    return (
      <p className="px-1 py-2 text-[11px]" style={{ color: "var(--ink-muted)" }}>
        Loading camps…
      </p>
    );
  }

  if (!camps.length) {
    return (
      <p className="px-1 py-2 text-[11px]" style={{ color: "var(--ink-muted)" }}>
        No open camp has an outstanding need.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-1">
      {camps.slice(0, 8).map((c) => (
        <li
          key={c.id}
          className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[11.5px]"
          style={{
            background: "var(--surface-2)",
            borderLeft: `2px solid ${URGENCY_COLOUR[c.worst?.urgency ?? "normal"]}`,
          }}
        >
          <span className="min-w-0 flex-1 truncate" title={`${c.name}, ${c.place}`}>
            {c.name} — {c.place}
          </span>

          <span
            className="shrink-0 tabular-nums"
            title="People sheltering here"
            style={{ color: "var(--ink-secondary)" }}
          >
            {c.people.toLocaleString("en-IN")}
          </span>

          {c.worst && (
            <span className="shrink-0 tabular-nums" title={`${c.unmet.length} outstanding need(s)`}>
              {c.worst.short.toLocaleString("en-IN")} {c.worst.item}
              {c.unmet.length > 1 ? ` +${c.unmet.length - 1}` : ""}
            </span>
          )}

          <span
            className="shrink-0 text-[10.5px]"
            style={{ color: c.supplier ? "var(--good)" : "var(--serious)" }}
          >
            {c.supplier ? `${c.supplier} has stock` : "nobody carrying it"}
          </span>
        </li>
      ))}
    </ul>
  );
}
