"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The notification centre — a bell, a count, and one merged stream: alerts
 * delivered to you, official alerts matching places you watch, decisions on
 * broadcasts you requested, and missions waiting on your org.
 *
 * "Unread" is a local cursor, not server state. What this person has seen on
 * this device is this device's business; the server already knows enough
 * about who is where.
 */

interface Item {
  id: string;
  kind: "delivery" | "watch" | "decision" | "mission";
  title: string;
  body: string;
  at: string;
  severity?: string;
}

interface Watch {
  id: number;
  place: string;
  hazard: string | null;
  minColour: string;
}

const CURSOR_KEY = "bhimshila.notif.cursor";

const KIND_GLYPH: Record<Item["kind"], string> = {
  delivery: "▲",
  watch: "◆",
  decision: "📣",
  mission: "✚",
};

const SEV: Record<string, string> = {
  red: "var(--critical)",
  severe: "var(--critical)",
  orange: "var(--serious)",
  warning: "var(--warning)",
  yellow: "var(--warning)",
  advisory: "var(--good)",
};

const timeAgo = (iso: string) => {
  const t = Date.parse(iso.replace(" ", "T") + (iso.includes("Z") || iso.includes("+") ? "" : "Z"));
  if (Number.isNaN(t)) return "";
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  if (m < 60 * 36) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / 1440)}d`;
};

function Watches() {
  const [subs, setSubs] = useState<Watch[] | null>(null);
  const [place, setPlace] = useState("");
  const [minColour, setMinColour] = useState("yellow");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/subscriptions")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setSubs(d.subscriptions))
      .catch(() => setSubs([]));
  }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      const r = await fetch("/api/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ place, minColour }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Failed");
      setSubs(d.subscriptions);
      setPlace("");
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Failed");
    }
  }

  async function remove(id: number) {
    const r = await fetch(`/api/subscriptions?id=${id}`, { method: "DELETE" });
    const d = await r.json().catch(() => null);
    if (r.ok && d) setSubs(d.subscriptions);
  }

  return (
    <div className="border-t px-3 py-2.5" style={{ borderColor: "var(--border)" }}>
      <p className="mb-1.5 text-[9.5px] uppercase tracking-wider" style={{ color: "var(--ink-muted)" }}>
        Places you watch — official alerts there land here
      </p>
      {subs?.map((s) => (
        <span
          key={s.id}
          className="mb-1 mr-1 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10.5px]"
          style={{ background: "var(--surface-2)", color: "var(--ink-secondary)" }}
        >
          {s.place}
          <span style={{ color: SEV[s.minColour] }}>· {s.minColour}+</span>
          <button onClick={() => remove(s.id)} aria-label={`Stop watching ${s.place}`} className="ml-0.5 opacity-60">
            ×
          </button>
        </span>
      ))}
      <form onSubmit={add} className="mt-1 flex gap-1">
        <input
          value={place}
          onChange={(e) => setPlace(e.target.value)}
          placeholder="District or state…"
          className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-[11px] outline-none"
          style={{ background: "var(--plane)", border: "1px solid var(--border)", color: "var(--ink)" }}
        />
        <select
          value={minColour}
          onChange={(e) => setMinColour(e.target.value)}
          className="rounded-md px-1.5 py-1.5 text-[11px] outline-none"
          style={{ background: "var(--plane)", border: "1px solid var(--border)", color: "var(--ink-secondary)" }}
          aria-label="Minimum severity"
        >
          <option value="yellow">yellow+</option>
          <option value="orange">orange+</option>
          <option value="red">red only</option>
        </select>
        <button
          type="submit"
          disabled={!place.trim()}
          className="rounded-md px-2.5 text-[11px] font-medium disabled:opacity-40"
          style={{ background: "#17508f", color: "#fff" }}
        >
          Watch
        </button>
      </form>
      {err && <p className="mt-1 text-[10px]" style={{ color: "var(--serious)" }}>■ {err}</p>}
    </div>
  );
}

export default function NotificationBell() {
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState<string>(() =>
    typeof window === "undefined" ? "" : window.localStorage.getItem(CURSOR_KEY) ?? "",
  );
  const panelRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(() => {
    fetch("/api/notifications")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setItems(d.items ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  // Opening the panel is reading it — so the cursor moves in the click
  // handler, where the reading actually happens, not in an effect.
  const toggle = useCallback(() => {
    setOpen((o) => {
      if (!o && items.length) {
        const newest = items[0].at;
        setCursor(newest);
        try {
          window.localStorage.setItem(CURSOR_KEY, newest);
        } catch {
          /* fine — the badge comes back next visit */
        }
      }
      return !o;
    });
  }, [items]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

  const unread = items.filter((i) => !cursor || i.at > cursor).length;

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={toggle}
        aria-label={`Notifications${unread ? ` — ${unread} new` : ""}`}
        aria-expanded={open}
        className="relative grid h-8 w-8 place-items-center rounded-md text-[15px]"
        style={{ background: open ? "#17508f" : "var(--plane)", border: "1px solid var(--border)" }}
      >
        🔔
        {unread > 0 && (
          <span
            className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full px-0.5 text-[9px] font-bold"
            style={{ background: "var(--critical)", color: "#fff" }}
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className="panel-in absolute right-0 top-10 z-50 w-[min(92vw,22rem)] overflow-hidden rounded-xl shadow-2xl"
          style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        >
          <div className="max-h-[55vh] overflow-y-auto">
            {items.length === 0 && (
              <p className="px-3 py-6 text-center text-[11.5px]" style={{ color: "var(--ink-muted)" }}>
                Nothing yet. Watch a place below and official alerts there will land here.
              </p>
            )}
            <ul>
              {items.map((i) => (
                <li key={i.id} className="border-b px-3 py-2" style={{ borderColor: "var(--border)" }}>
                  <p className="flex items-baseline gap-1.5 text-[11.5px] font-medium leading-snug">
                    <span style={{ color: SEV[i.severity ?? ""] ?? "var(--seq-250)" }} aria-hidden>
                      {KIND_GLYPH[i.kind]}
                    </span>
                    <span className="min-w-0 flex-1">{i.title}</span>
                    <span className="shrink-0 text-[9.5px] font-normal" style={{ color: "var(--ink-muted)" }}>
                      {timeAgo(i.at)}
                    </span>
                  </p>
                  <p className="mt-0.5 text-[10.5px] leading-snug" style={{ color: "var(--ink-secondary)" }}>
                    {i.body}
                  </p>
                </li>
              ))}
            </ul>
          </div>
          <Watches />
        </div>
      )}
    </div>
  );
}
