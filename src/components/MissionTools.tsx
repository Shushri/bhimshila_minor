"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { compressPhoto, submitReport } from "@/lib/reportQueue";

/**
 * The drawer under a mission card: chat, ground reports, and the broadcast
 * request. Phone-first — the person using this has one hand free and is
 * standing in the situation they are reporting.
 *
 * Chat is a thread per mission, deliberately not DMs. Reports carry photos
 * compressed on the phone before anything is sent. The broadcast tab does not
 * broadcast: it puts the volunteer's words at the top of the coordinator's
 * queue, and says exactly that, because a button that overstates what it does
 * teaches people to distrust the whole screen.
 */

type Tab = "chat" | "report" | "cast";

interface Msg {
  id: number;
  userId: number;
  name: string;
  role: string;
  body: string;
  at: string;
}

interface Report {
  id: number;
  name: string;
  kind: "note" | "photo";
  body: string | null;
  media: string | null;
  capturedAt: string | null;
  at: string;
}

interface CastRequest {
  id: number;
  message: string;
  status: "pending" | "approved" | "declined";
  at: string;
}

const time = (iso: string) =>
  new Date(iso.replace(" ", "T") + (iso.includes("Z") ? "" : "Z")).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });

const field =
  "w-full rounded-lg px-3 py-2.5 text-[13px] outline-none placeholder:opacity-45";
const fieldStyle = {
  background: "var(--plane)",
  border: "1px solid var(--border)",
  color: "var(--ink)",
} as const;

function ChatTab({ taskId }: { taskId: number }) {
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [me, setMe] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(() => {
    fetch(`/api/tasks/${taskId}/messages`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        setMsgs(d.messages);
        setMe(d.me);
      })
      .catch(() => {
        /* offline — the thread stays as it was */
      });
  }, [taskId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 12_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [msgs?.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setDraft("");
    setErr(null);
    try {
      const r = await fetch(`/api/tasks/${taskId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Could not send");
      setMsgs(d.messages);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Could not send — no network?");
      setDraft(body); // give the words back rather than losing them
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex max-h-56 flex-col gap-1.5 overflow-y-auto pr-1">
        {msgs === null && (
          <p className="py-3 text-center text-[11px]" style={{ color: "var(--ink-muted)" }}>
            Loading the thread…
          </p>
        )}
        {msgs?.length === 0 && (
          <p className="py-3 text-center text-[11px]" style={{ color: "var(--ink-muted)" }}>
            Nothing yet. Everyone on this mission — and the coordinator desk — reads this thread.
          </p>
        )}
        {msgs?.map((m) => (
          <div
            key={m.id}
            className="max-w-[85%] rounded-lg px-2.5 py-1.5 text-[12px] leading-snug"
            style={{
              background: m.userId === me ? "#17508f" : "var(--surface-2)",
              color: m.userId === me ? "#fff" : "var(--ink)",
              alignSelf: m.userId === me ? "flex-end" : "flex-start",
            }}
          >
            {m.userId !== me && (
              <p className="text-[9.5px] font-medium" style={{ color: m.role === "coordinator" ? "var(--warning)" : "var(--seq-250)" }}>
                {m.name}
                {m.role === "coordinator" ? " · coordinator" : ""}
              </p>
            )}
            {m.body}
            <span className="ml-2 text-[9px] opacity-60">{time(m.at)}</span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      {err && <p className="text-[10.5px]" style={{ color: "var(--serious)" }}>■ {err}</p>}
      <form onSubmit={send} className="flex gap-1.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Message the mission…"
          className={field}
          style={fieldStyle}
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          className="shrink-0 rounded-lg px-3.5 text-[13px] font-medium disabled:opacity-40"
          style={{ background: "#17508f", color: "#fff" }}
        >
          Send
        </button>
      </form>
    </div>
  );
}

function ReportTab({ taskId }: { taskId: number }) {
  const [reports, setReports] = useState<Report[] | null>(null);
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<{ dataUrl: string; type: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(() => {
    fetch(`/api/tasks/${taskId}/reports`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setReports(d.reports))
      .catch(() => {});
  }, [taskId]);

  useEffect(load, [load]);

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setStatus("Compressing…");
    try {
      setPhoto(await compressPhoto(f));
      setStatus(null);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Could not read that image");
    }
  }

  async function send() {
    if (busy) return;
    setBusy(true);
    setStatus(null);
    const input = photo
      ? { kind: "photo" as const, body: note.trim() || undefined, media: photo.dataUrl, mediaType: photo.type }
      : { kind: "note" as const, body: note.trim() };
    const r = await submitReport(taskId, input);
    setBusy(false);
    if (r.outcome === "sent") {
      setNote("");
      setPhoto(null);
      setStatus("Filed.");
      load();
    } else if (r.outcome === "queued") {
      setNote("");
      setPhoto(null);
      setStatus("No network — kept on this phone, it will send itself when you reconnect.");
    } else {
      setStatus(`■ ${r.error}`);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {photo && (
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element -- a data URL preview; next/image cannot optimise it */}
          <img src={photo.dataUrl} alt="Report photo, ready to send" className="max-h-44 w-full rounded-lg object-cover" />
          <button
            onClick={() => setPhoto(null)}
            className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full text-[13px]"
            style={{ background: "rgba(13,13,13,0.8)", color: "#fff" }}
            aria-label="Remove photo"
          >
            ×
          </button>
        </div>
      )}
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder={photo ? "What is in the photo? (optional)" : "What are you seeing on the ground?"}
        className={field}
        style={fieldStyle}
      />
      <div className="flex gap-1.5">
        <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={pick} className="hidden" />
        <button
          onClick={() => fileRef.current?.click()}
          className="rounded-lg px-3 py-2.5 text-[13px]"
          style={{ background: "var(--surface-2)", color: "var(--ink-secondary)" }}
        >
          📷 Photo
        </button>
        <button
          onClick={send}
          disabled={busy || (!note.trim() && !photo)}
          className="flex-1 rounded-lg py-2.5 text-[13px] font-semibold disabled:opacity-40"
          style={{ background: "#17508f", color: "#fff" }}
        >
          {busy ? "…" : "File the report"}
        </button>
      </div>
      {status && (
        <p className="text-[11px] leading-snug" style={{ color: status.startsWith("■") ? "var(--serious)" : "var(--ink-secondary)" }}>
          {status}
        </p>
      )}

      {reports && reports.length > 0 && (
        <ul className="mt-1 flex flex-col gap-1.5">
          {reports.map((r) => (
            <li key={r.id} className="rounded-lg p-2" style={{ background: "var(--surface-2)" }}>
              {r.media && (
                // eslint-disable-next-line @next/next/no-img-element -- access-controlled data URL from the mission API
                <img src={r.media} alt={r.body ?? "Field photo"} className="mb-1.5 max-h-40 w-full rounded object-cover" />
              )}
              {r.body && <p className="text-[12px] leading-snug">{r.body}</p>}
              <p className="mt-1 text-[9.5px]" style={{ color: "var(--ink-muted)" }}>
                {r.name} · {r.capturedAt ? `captured ${time(r.capturedAt)}, ` : ""}filed {time(r.at)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CastTab({ taskId }: { taskId: number }) {
  const [requests, setRequests] = useState<CastRequest[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`/api/tasks/${taskId}/broadcast-request`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setRequests(d.requests ?? []))
      .catch(() => {});
  }, [taskId]);

  useEffect(load, [load]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/tasks/${taskId}/broadcast-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Could not send the request");
      setMessage("");
      load();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const STATUS_TONE: Record<CastRequest["status"], string> = {
    pending: "var(--warning)",
    approved: "var(--good)",
    declined: "var(--ink-muted)",
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] leading-snug" style={{ color: "var(--ink-secondary)" }}>
        This does not broadcast. Your words go to the top of the coordinator&rsquo;s queue with this
        mission attached; if approved, they are sent exactly as written to people registered around
        the incident.
      </p>
      <form onSubmit={send} className="flex flex-col gap-1.5">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={2}
          placeholder='e.g. "Nala rising fast near the school — move to the panchayat bhawan on high ground"'
          className={field}
          style={fieldStyle}
        />
        <button
          type="submit"
          disabled={busy || !message.trim()}
          className="rounded-lg py-2.5 text-[13px] font-semibold disabled:opacity-40"
          style={{ background: "var(--serious)", color: "#0d0d0d" }}
        >
          {busy ? "…" : "Ask the coordinator to warn people here"}
        </button>
      </form>
      {err && <p className="text-[10.5px]" style={{ color: "var(--serious)" }}>■ {err}</p>}
      {requests.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {requests.map((r) => (
            <li key={r.id} className="rounded-lg p-2 text-[11.5px]" style={{ background: "var(--surface-2)" }}>
              <span className="font-medium" style={{ color: STATUS_TONE[r.status] }}>
                {r.status === "pending" ? "● waiting on the coordinator" : r.status === "approved" ? "✓ sent" : "— declined"}
              </span>
              <p className="mt-0.5 leading-snug" style={{ color: "var(--ink-secondary)" }}>{r.message}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function MissionTools({ taskId }: { taskId: number }) {
  const [tab, setTab] = useState<Tab | null>(null);

  const TABS: { id: Tab; label: string }[] = [
    { id: "chat", label: "💬 Chat" },
    { id: "report", label: "📷 Report" },
    { id: "cast", label: "📣 Warn people" },
  ];

  return (
    <div className="mt-2.5">
      <div className="flex gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(tab === t.id ? null : t.id)}
            className="flex-1 rounded-lg py-2 text-[12px] font-medium"
            style={{
              background: tab === t.id ? "#17508f" : "var(--surface-2)",
              color: tab === t.id ? "#fff" : "var(--ink-secondary)",
            }}
            aria-expanded={tab === t.id}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab && (
        <div className="panel-in mt-2 rounded-xl p-2.5" style={{ background: "var(--plane)", border: "1px solid var(--border)" }}>
          {tab === "chat" && <ChatTab taskId={taskId} />}
          {tab === "report" && <ReportTab taskId={taskId} />}
          {tab === "cast" && <CastTab taskId={taskId} />}
        </div>
      )}
    </div>
  );
}
