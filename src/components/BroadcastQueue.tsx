"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * The coordinator's broadcast queue — volunteer requests to warn the public,
 * each with the mission, the org and the exact words attached.
 *
 * Approval is the human confirmation. The volunteer authored the wording, this
 * screen shows it verbatim with its provenance, and the tap sends exactly that
 * to people registered around the incident. Declining records who declined.
 */

interface CastRequest {
  id: number;
  volunteer: string;
  org: string;
  incidentTitle: string;
  place: string | null;
  severity: number;
  message: string;
  status: "pending" | "approved" | "declined";
  at: string;
}

export default function BroadcastQueue() {
  const [requests, setRequests] = useState<CastRequest[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/broadcast-requests")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setRequests(d.requests ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);

  async function decide(id: number, action: "approve" | "decline") {
    setBusy(id);
    setNote(null);
    try {
      const r = await fetch("/api/broadcast-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Failed");
      setRequests(d.requests ?? []);
      if (d.status === "approved") {
        const live = (d.delivery ?? []).filter((x: { delivered: number }) => x.delivered > 0);
        setNote(
          live.length
            ? `Sent to ${d.recipients} people in ${d.region} via ${live.map((x: { channel: string }) => x.channel).join(", ")}.`
            : `Recorded for ${d.region}, but no registered recipient was reachable there.`,
        );
      } else {
        setNote("Declined — the volunteer sees that, with your name on it.");
      }
    } catch (e) {
      setNote(`■ ${e instanceof Error ? e.message : "Failed"}`);
    } finally {
      setBusy(null);
    }
  }

  if (requests === null) return null;

  const pending = requests.filter((r) => r.status === "pending");
  const decided = requests.filter((r) => r.status !== "pending");

  return (
    <section className="rounded-xl p-3" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
      <header className="mb-2 flex items-baseline justify-between">
        <h3 className="text-[13px] font-semibold">Broadcast requests from the field</h3>
        {pending.length > 0 && (
          <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: "var(--serious)", color: "#0d0d0d" }}>
            {pending.length} waiting
          </span>
        )}
      </header>

      {note && (
        <p className="mb-2 rounded-lg px-2.5 py-1.5 text-[11px]" style={{ background: "var(--surface-2)", color: note.startsWith("■") ? "var(--serious)" : "var(--ink-secondary)" }}>
          {note}
        </p>
      )}

      {pending.length === 0 && (
        <p className="py-4 text-center text-[11.5px]" style={{ color: "var(--ink-muted)" }}>
          Nothing waiting. Volunteers raise these from their mission screen.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {pending.map((r) => (
          <li key={r.id} className="rounded-lg p-2.5" style={{ background: "var(--surface-2)", border: "1px solid var(--serious)" }}>
            <p className="text-[10.5px]" style={{ color: "var(--ink-muted)" }}>
              {r.volunteer} · {r.org} · on-mission at “{r.incidentTitle}”{r.place ? ` — ${r.place}` : ""} · severity {r.severity}
            </p>
            {/* The words that will go out, exactly as they will go out. */}
            <p className="mt-1.5 rounded-md px-2.5 py-2 text-[12.5px] leading-snug" style={{ background: "var(--plane)" }}>
              “{r.message}”
            </p>
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => decide(r.id, "approve")}
                disabled={busy !== null}
                className="flex-1 rounded-md py-2 text-[12px] font-semibold disabled:opacity-40"
                style={{ background: "var(--serious)", color: "#0d0d0d" }}
              >
                {busy === r.id ? "…" : `Send this to ${r.place ?? "the area"}`}
              </button>
              <button
                onClick={() => decide(r.id, "decline")}
                disabled={busy !== null}
                className="rounded-md px-3.5 py-2 text-[12px] disabled:opacity-40"
                style={{ background: "var(--plane)", border: "1px solid var(--border)", color: "var(--ink-secondary)" }}
              >
                Decline
              </button>
            </div>
          </li>
        ))}
      </ul>

      {decided.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {decided.slice(0, 4).map((r) => (
            <li key={r.id} className="flex items-baseline gap-2 text-[10.5px]" style={{ color: "var(--ink-muted)" }}>
              <span style={{ color: r.status === "approved" ? "var(--good)" : "var(--ink-muted)" }}>
                {r.status === "approved" ? "✓ sent" : "— declined"}
              </span>
              <span className="min-w-0 flex-1 truncate">
                “{r.message}” — {r.volunteer}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
