"use client";

import { useEffect, useState } from "react";
import type { FeedItem } from "@/lib/feed";

/**
 * The confirmation step, made explicit.
 *
 * Every outward-facing action in this system is two-phase — stage, then
 * confirm — and that used to be visible only as a card the agent produced. Now
 * that a coordinator drives the board directly, the gate has to live here, and
 * it has to show what is about to happen in the words it will happen in.
 *
 * The message is editable but pre-filled with the issuing authority's own
 * wording where there is one. Someone who overtypes it has made a decision;
 * someone who does not has relayed the government verbatim, which is the better
 * default and should take no effort.
 */

export type ActionKind = "alert" | "dispatch" | "resolve" | "verify";

interface Staged {
  actionId: number;
  kind: string;
}

export default function ActionModal({
  action,
  item,
  onClose,
  onDone,
}: {
  action: ActionKind;
  item: FeedItem;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [message, setMessage] = useState("");
  const [level, setLevel] = useState(item.severity === "red" ? "severe" : "warning");
  const [staged, setStaged] = useState<Staged | null>(null);
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const region = item.state || item.place;
  const incidentId = item.id.startsWith("inc:") ? Number(item.id.slice(4)) : null;

  // Stage as soon as the modal opens, so the confirmation shows real numbers —
  // who it reaches, which team, how far — rather than asking a coordinator to
  // approve something described only in the abstract.
  useEffect(() => {
    if (action === "verify") return;
    const body =
      action === "alert"
        ? { action: "prepare_alert", region, message: message || undefined, level }
        : action === "dispatch"
          ? incidentId !== null
            ? { action: "prepare_dispatch", incidentId }
            : // No incident: the coordinator is acting on an alert or a lead
              // before anyone has called. The place travels instead, and the
              // server opens an anticipatory incident for it.
              {
                action: "prepare_dispatch",
                title: `${item.title} — ${item.place}`,
                place: item.place,
                lat: item.lat,
                lng: item.lng,
                severity: item.severity === "red" ? 4 : item.severity === "orange" ? 3 : 2,
              }
          : { action: "resolve", incidentId };

    // setBusy lives inside the promise chain rather than the effect body: a
    // synchronous setState here cascades a render before the request has even
    // left, and the linter is right to refuse it.
    fetch("/api/ops", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? `Failed (${r.status})`);
        if (action === "resolve") {
          onDone(`Incident resolved${d.teamReleased ? ", team released" : ""}.`);
          return;
        }
        setStaged({ actionId: d.actionId, kind: d.kind });
        setPreview(d);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "Could not stage this"));
    // Staged once per open; re-staging on every keystroke would mint a new
    // pending action for each character typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action]);

  async function confirm() {
    if (!staged) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/ops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The edited message travels with the confirm, so what the coordinator
        // read on screen is what goes out.
        body: JSON.stringify({
          action: "confirm",
          actionId: staged.actionId,
          ...(action === "alert" ? { ...(message ? { message } : {}), level } : {}),
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `Failed (${r.status})`);

      if (action === "alert") {
        const live = (d.delivery ?? []).filter((x: { delivered: number }) => x.delivered > 0);
        onDone(
          live.length
            ? `Sent to ${d.recipients} people via ${live.map((x: { channel: string }) => x.channel).join(", ")}.`
            : `Recorded, but nothing was delivered — no recipient is reachable in ${d.region}.`,
        );
      } else {
        onDone(`${d.teamName} dispatched${d.distanceKm ? `, ${d.distanceKm}km out` : ""}.`);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not confirm");
      setBusy(false);
    }
  }

  const title =
    action === "alert"
      ? `Warn ${region}`
      : action === "dispatch"
        ? "Send a team"
        : action === "resolve"
          ? "Mark resolved"
          : `Check ${item.place}`;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ background: "rgba(4,7,12,0.72)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl p-4 shadow-2xl"
        style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-[15px] font-semibold">{title}</h3>
          <button onClick={onClose} className="text-[16px]" style={{ color: "var(--ink-muted)" }}>
            ×
          </button>
        </div>

        {err && (
          <p className="mt-2 rounded-md px-2.5 py-1.5 text-[11.5px]" style={{ background: "#3a1a1a", color: "var(--serious)" }}>
            {err}
          </p>
        )}

        {action === "alert" && (
          <>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[11.5px]">
              <div className="rounded-lg px-2.5 py-1.5" style={{ background: "var(--surface-2)" }}>
                <p className="text-[9.5px] uppercase" style={{ color: "var(--ink-muted)" }}>Region</p>
                <p>{region}</p>
              </div>
              <div className="rounded-lg px-2.5 py-1.5" style={{ background: "var(--surface-2)" }}>
                <p className="text-[9.5px] uppercase" style={{ color: "var(--ink-muted)" }}>Reaches</p>
                <p>{preview ? `${(preview.recipients as number) ?? "…"} registered` : "…"}</p>
              </div>
            </div>

            <label className="mt-3 block text-[9.5px] uppercase tracking-wider" style={{ color: "var(--ink-muted)" }}>
              Message — leave blank to send {item.issuer}&rsquo;s own wording
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              placeholder={`Blank sends the wording issued by ${item.issuer}, in their language.`}
              className="mt-1 w-full rounded-md px-2.5 py-2 text-[12px] outline-none"
              style={{ background: "var(--plane)", border: "1px solid var(--border)", color: "var(--ink)" }}
            />

            <div className="mt-2 flex gap-1.5">
              {["advisory", "warning", "severe"].map((l) => (
                <button
                  key={l}
                  onClick={() => setLevel(l)}
                  className="rounded-md px-2.5 py-1 text-[11px]"
                  style={{
                    background: level === l ? "#17508f" : "var(--plane)",
                    border: "1px solid var(--border)",
                    color: level === l ? "#fff" : "var(--ink-secondary)",
                  }}
                >
                  {l}
                </button>
              ))}
            </div>
          </>
        )}

        {action === "dispatch" && preview && (
          <div className="mt-3 flex flex-col gap-1.5 text-[11.5px]">
            {Object.entries({
              Incident: item.title,
              Location: item.place,
              // The staged decision itself — the team this confirm will move.
              // Approving a dispatch without seeing who is being sent would
              // make the confirm step theatre.
              Team: preview.teamName
                ? `${preview.teamName}${preview.teamPlace ? ` — ${preview.teamPlace}` : ""}${
                    preview.distanceKm != null ? `, ${preview.distanceKm} km out` : ""
                  }`
                : null,
              Backup: (preview.backup as { teamName: string; distanceKm: number } | null)?.teamName
                ? `${(preview.backup as { teamName: string; distanceKm: number }).teamName}, ${(preview.backup as { teamName: string; distanceKm: number }).distanceKm} km`
                : null,
            })
              .filter(([, v]) => v !== null)
              .map(([k, v]) => (
                <div key={k} className="rounded-lg px-2.5 py-1.5" style={{ background: "var(--surface-2)" }}>
                  <span className="text-[9.5px] uppercase" style={{ color: "var(--ink-muted)" }}>{k} </span>
                  {String(v)}
                </div>
              ))}
          </div>
        )}

        <p className="mt-3 text-[10.5px] leading-snug" style={{ color: "var(--ink-muted)" }}>
          Nothing has been sent yet. This is staged and waiting for you.
        </p>

        <div className="mt-3 flex gap-2">
          <button
            onClick={confirm}
            disabled={busy || !staged}
            className="rounded-md px-3.5 py-2 text-[12px] font-medium"
            style={{ background: "#17508f", color: "#fff", opacity: busy || !staged ? 0.5 : 1 }}
          >
            {busy ? "…" : action === "alert" ? "Send it" : "Confirm"}
          </button>
          <button
            onClick={onClose}
            className="rounded-md px-3.5 py-2 text-[12px]"
            style={{ background: "var(--plane)", border: "1px solid var(--border)", color: "var(--ink-secondary)" }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
