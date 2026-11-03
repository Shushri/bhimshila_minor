"use client";

import { useEffect, useState } from "react";

/**
 * Raise a mission — the coordinator's half of coordination.
 *
 * Until this existed, missions could only appear one way: a coordinator
 * confirmed a dispatch on a citizen SOS, a task landed on the whole
 * organisation with nobody's name on it, and a volunteer had to press Accept
 * to claim it. That models one real situation — a call comes in, whoever is
 * free takes it — and completely fails the other, which is a coordinator
 * looking at an alert and deciding that these two people should go and do this
 * specific thing.
 *
 * So this addresses the mission to named people. There is no Accept step
 * afterwards, because accepting answers "who is taking this" and that is
 * already answered by the time it arrives.
 */

interface Choices {
  orgs: { id: number; name: string; role: string }[];
  members: { orgId: number; people: { id: number; name: string; role: string }[] }[];
  incidents: { id: number; title: string; place: string | null; severity: number }[];
  alerts: { id: number; region: string; level: string; message: string }[];
}

export default function RaiseMission({ onCreated }: { onCreated?: () => void }) {
  const [open, setOpen] = useState(false);
  const [choices, setChoices] = useState<Choices | null>(null);
  const [orgId, setOrgId] = useState<number | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [note, setNote] = useState("");
  /** One control, two sources — "alert:12" or "incident:5". */
  const [cause, setCause] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (!open || choices) return;
    void fetch("/api/missions", { method: "PUT" })
      .then((r) => r.json())
      .then((d: Choices & { error?: string }) => {
        if (d.error) return setError(d.error);
        setChoices(d);
        if (d.orgs.length === 1) setOrgId(d.orgs[0].id);
      })
      .catch(() => setError("Could not load your organisations."));
  }, [open, choices]);

  const people = choices?.members.find((m) => m.orgId === orgId)?.people ?? [];

  const submit = async () => {
    setBusy(true);
    setError(null);
    const [kind, id] = cause.split(":");
    try {
      const res = await fetch("/api/missions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamId: orgId,
          volunteerIds: [...picked],
          note,
          incidentId: kind === "incident" ? Number(id) : null,
          alertId: kind === "alert" ? Number(id) : null,
        }),
      });
      const d = (await res.json()) as { error?: string; created?: number };
      if (!res.ok) throw new Error(d.error ?? "Could not raise the mission.");
      setDone(`Sent to ${d.created} volunteer${d.created === 1 ? "" : "s"}.`);
      setPicked(new Set());
      setNote("");
      setCause("");
      onCreated?.();
      // Left open briefly so the confirmation is read before the form clears.
      setTimeout(() => {
        setDone(null);
        setOpen(false);
      }, 2200);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not raise the mission.");
    } finally {
      setBusy(false);
    }
  };

  const ready = !!orgId && picked.size > 0 && note.trim().length > 0 && !!cause;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg px-3 py-2 text-[12px] font-medium"
        style={{ background: "var(--seq-400)", color: "#fff" }}
      >
        ✚ Raise a mission
      </button>
    );
  }

  return (
    <div
      className="rounded-xl p-4"
      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-semibold">Raise a mission</h3>
        <button
          onClick={() => setOpen(false)}
          className="text-[11px]"
          style={{ color: "var(--ink-muted)" }}
        >
          close
        </button>
      </div>

      {!choices && !error && (
        <p className="mt-3 text-[11.5px]" style={{ color: "var(--ink-muted)" }}>
          Loading your organisations…
        </p>
      )}

      {choices && (
        <div className="mt-3 space-y-3">
          {choices.orgs.length === 0 && (
            <p className="text-[11.5px]" style={{ color: "var(--warning)" }}>
              You are not in an organisation yet. Register one in Organisations first — a mission
              has to come from somewhere.
            </p>
          )}

          {choices.orgs.length > 1 && (
            <label className="block">
              <span className="text-[11px]" style={{ color: "var(--ink-secondary)" }}>
                Organisation
              </span>
              <select
                value={orgId ?? ""}
                onChange={(e) => {
                  setOrgId(Number(e.target.value));
                  setPicked(new Set());
                }}
                className="mt-1 w-full rounded-md px-2 py-1.5 text-[11.5px]"
                style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--ink)" }}
              >
                <option value="">Choose…</option>
                {choices.orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {orgId && (
            <div>
              <span className="text-[11px]" style={{ color: "var(--ink-secondary)" }}>
                Who goes — {picked.size} selected
              </span>
              {people.length === 0 ? (
                <p className="mt-1 text-[11px]" style={{ color: "var(--ink-muted)" }}>
                  Nobody has joined this organisation yet. Share its invite link from Organisations.
                </p>
              ) : (
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {people.map((p) => {
                    const on = picked.has(p.id);
                    return (
                      <button
                        key={p.id}
                        onClick={() => {
                          const next = new Set(picked);
                          if (on) next.delete(p.id);
                          else next.add(p.id);
                          setPicked(next);
                        }}
                        className="rounded-full px-2.5 py-1 text-[11px]"
                        style={{
                          background: on ? "var(--seq-400)" : "var(--bg)",
                          border: `1px solid ${on ? "var(--seq-400)" : "var(--border)"}`,
                          color: on ? "#fff" : "var(--ink-secondary)",
                        }}
                      >
                        {on ? "✓ " : ""}
                        {p.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <label className="block">
            <span className="text-[11px]" style={{ color: "var(--ink-secondary)" }}>
              What to do
            </span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Take the boat to Bataghuli and move the families on the east bank to the school."
              className="mt-1 w-full rounded-md px-2 py-1.5 text-[11.5px] outline-none"
              style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--ink)" }}
            />
          </label>

          <label className="block">
            <span className="text-[11px]" style={{ color: "var(--ink-secondary)" }}>
              Responding to
            </span>
            <select
              value={cause}
              onChange={(e) => setCause(e.target.value)}
              className="mt-1 w-full rounded-md px-2 py-1.5 text-[11.5px]"
              style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--ink)" }}
            >
              <option value="">Choose an alert or an incident…</option>
              {choices.alerts.length > 0 && (
                <optgroup label="Alerts we sent">
                  {choices.alerts.map((a) => (
                    <option key={`a${a.id}`} value={`alert:${a.id}`}>
                      {a.level} · {a.region} — {a.message}
                    </option>
                  ))}
                </optgroup>
              )}
              {choices.incidents.length > 0 && (
                <optgroup label="Open incidents">
                  {choices.incidents.map((i) => (
                    <option key={`i${i.id}`} value={`incident:${i.id}`}>
                      #{i.id} {i.title}
                      {i.place ? ` — ${i.place}` : ""}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>

          {error && (
            <p className="text-[11.5px]" style={{ color: "var(--bad, #d03b3b)" }}>
              {error}
            </p>
          )}
          {done && (
            <p className="text-[11.5px]" style={{ color: "var(--good)" }}>
              {done}
            </p>
          )}

          <button
            onClick={submit}
            disabled={!ready || busy}
            className="w-full rounded-lg px-3 py-2 text-[12px] font-medium disabled:opacity-40"
            style={{ background: "var(--seq-400)", color: "#fff" }}
          >
            {busy ? "Sending…" : `Send to ${picked.size || "…"} volunteer${picked.size === 1 ? "" : "s"}`}
          </button>
          <p className="text-[10.5px] leading-snug" style={{ color: "var(--ink-muted)" }}>
            It lands on their missions board immediately, already theirs — no acceptance step.
          </p>
        </div>
      )}
    </div>
  );
}
