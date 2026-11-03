"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  enqueueAction,
  startMissionSync,
  pendingCount,
  pendingCountServer,
  subscribePending,
} from "@/lib/missionQueue";
import {
  queuedReportCount,
  queuedReportCountServer,
  startReportSync,
  subscribeReports,
} from "@/lib/reportQueue";
import MissionTools from "./MissionTools";

/**
 * The volunteer screen.
 *
 * This is the one screen that has to survive a crisis. Someone is standing in
 * water, holding a phone in one hand, with a signal that comes and goes. So:
 * large targets, no forms, three buttons in the order the work actually
 * happens, and every press written locally before anything touches the network.
 *
 * The buttons never wait. Pressing "I'm on site" updates the row immediately and
 * queues the transition — because the volunteer's time is the truth being
 * recorded, not the moment the request happened to succeed.
 */

interface Task {
  id: number;
  status: "assigned" | "accepted" | "on_site" | "done" | "declined";
  title: string;
  category: string;
  place: string | null;
  severity: number;
  peopleCount: number | null;
  teamName: string;
  assigneeName: string | null;
  /** Null on a dispatch, which lands on the org rather than a person. */
  assigneeUserId: number | null;
  /** What the coordinator asked for, when a coordinator raised it. */
  note: string | null;
  raisedBy: string | null;
  outcome: string | null;
  acceptedAt: string | null;
  onSiteAt: string | null;
  doneAt: string | null;
  lat: number | null;
  lng: number | null;
}

const SEVERITY: Record<number, string> = {
  5: "var(--critical)",
  4: "var(--serious)",
  3: "var(--warning)",
};

/** Plain words for a coordinator reading the board, not state names. */
const STATUS_WORD: Record<string, string> = {
  assigned: "not started yet",
  accepted: "accepted, on the way",
  on_site: "on site now",
  done: "finished",
  declined: "declined",
};

const STEP_LABEL: Record<string, string> = {
  accepted: "Accept",
  on_site: "I'm on site",
  done: "Done",
};

/**
 * What this task is waiting for. Null once it is finished.
 *
 * An assigned task offers Accept only when nobody owns it yet — that is a
 * dispatch, sitting unclaimed for whoever in the org is free. A mission a
 * coordinator addressed to someone by name already has its owner, so the next
 * honest thing to ask that person is whether they have arrived.
 */
function nextStep(t: Task): "accepted" | "on_site" | "done" | null {
  if (t.status === "assigned") return t.assigneeUserId === null ? "accepted" : "on_site";
  if (t.status === "accepted") return "on_site";
  if (t.status === "on_site") return "done";
  return null;
}

const time = (iso: string | null) =>
  iso
    ? new Date(iso.replace(" ", "T") + (iso.includes("Z") ? "" : "Z")).toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Kolkata",
      })
    : null;

function TaskCard({
  task,
  onAdvance,
  readOnly = false,
}: {
  task: Task;
  onAdvance: (id: number, to: "accepted" | "on_site" | "done", outcome?: string) => void;
  /**
   * A coordinator is watching, not working.
   *
   * They were being shown the volunteer's buttons — Accept, I'm on site, Done —
   * on missions belonging to people they had just sent. Pressing any of them
   * would have recorded the coordinator as the person who arrived, which is
   * both wrong in the deployment log and the one record that has to be true.
   * What a coordinator needs from this board is which missions are running and
   * who is on them.
   */
  readOnly?: boolean;
}) {
  const [closing, setClosing] = useState(false);
  const [outcome, setOutcome] = useState("");
  const step = readOnly ? null : nextStep(task);
  const done = task.status === "done";

  return (
    <li
      className="rounded-xl p-3.5"
      style={{
        background: "var(--surface)",
        border: `1px solid ${done ? "var(--border)" : "transparent"}`,
        opacity: done ? 0.6 : 1,
      }}
    >
      <div className="flex items-start gap-2.5">
        <span
          className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[13px] font-bold"
          style={{ background: SEVERITY[task.severity] ?? "var(--ink-muted)", color: "#0d0d0d" }}
        >
          {task.severity}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium leading-snug">{task.title}</p>
          <p className="mt-0.5 text-[11.5px]" style={{ color: "var(--ink-muted)" }}>
            {task.place ?? "location unknown"} · {task.category.replace("_", " ")}
            {task.peopleCount ? ` · ${task.peopleCount} people` : ""}
          </p>
          {/* Who is on it. The coordinator's board is a list of people and
              what they are doing; a status with no name against it answers
              half the question. */}
          {readOnly && (
            <p className="mt-1 text-[11.5px]" style={{ color: "var(--seq-250)" }}>
              {task.assigneeName
                ? `${task.assigneeName} — ${STATUS_WORD[task.status] ?? task.status}`
                : "unclaimed — nobody has taken it yet"}
              {task.teamName ? ` · ${task.teamName}` : ""}
            </p>
          )}
          {/* The brief, in the coordinator's own words, shown to whoever it
              was sent to. */}
          {task.note && (
            <p className="mt-1 text-[11.5px] leading-snug" style={{ color: "var(--ink-secondary)" }}>
              {task.note}
              {task.raisedBy ? (
                <span style={{ color: "var(--ink-muted)" }}> — {task.raisedBy}</span>
              ) : null}
            </p>
          )}
        </div>
        {/* The question a volunteer actually has after Accept is "which way".
            Hands the coordinates to the phone's own navigator. */}
        {task.lat !== null && task.lng !== null && task.status !== "done" && (
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${task.lat},${task.lng}`}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 rounded-lg px-2.5 py-2 text-[12px]"
            style={{ background: "var(--surface-2)", color: "var(--seq-250)" }}
            title="Directions in your maps app"
          >
            🧭
          </a>
        )}
      </div>

      {/* The log, visible to the person writing it. */}
      {(task.acceptedAt || task.onSiteAt || task.doneAt) && (
        <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px]" style={{ color: "var(--ink-muted)" }}>
          {task.acceptedAt && <span>accepted {time(task.acceptedAt)}</span>}
          {task.onSiteAt && <span>on site {time(task.onSiteAt)}</span>}
          {task.doneAt && <span>done {time(task.doneAt)}</span>}
          {task.assigneeName && <span>· {task.assigneeName}</span>}
        </div>
      )}

      {done && task.outcome && (
        <p className="mt-2 rounded-lg px-2.5 py-1.5 text-[11.5px]" style={{ background: "var(--surface-2)" }}>
          {task.outcome}
        </p>
      )}

      {step && !closing && (
        <button
          onClick={() => (step === "done" ? setClosing(true) : onAdvance(task.id, step))}
          className="mt-3 w-full rounded-lg py-3.5 text-[15px] font-semibold"
          style={{
            background: step === "done" ? "#0ca30c" : "#17508f",
            color: "#fff",
          }}
        >
          {STEP_LABEL[step]}
        </button>
      )}

      {closing && (
        <div className="mt-3">
          <input
            autoFocus
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            placeholder="What happened? One line."
            className="w-full rounded-lg px-3 py-3 text-[14px] outline-none"
            style={{ background: "var(--plane)", border: "1px solid var(--border)", color: "var(--ink)" }}
          />
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => onAdvance(task.id, "done", outcome.trim() || "completed")}
              className="flex-1 rounded-lg py-3 text-[14px] font-semibold"
              style={{ background: "#0ca30c", color: "#fff" }}
            >
              Close the mission
            </button>
            <button
              onClick={() => setClosing(false)}
              className="rounded-lg px-4 py-3 text-[13px]"
              style={{ background: "var(--plane)", border: "1px solid var(--border)", color: "var(--ink-secondary)" }}
            >
              Back
            </button>
          </div>
        </div>
      )}

      {/* Chat, ground reports and the warn-people request travel with the
          mission. Declined tasks lose them — that thread has no participants. */}
      {task.status !== "declined" && <MissionTools taskId={task.id} />}
    </li>
  );
}

export default function MissionBoard() {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [orgs, setOrgs] = useState<{ id: number; name: string; role: string }[]>([]);
  /**
   * "all" means a coordinator is looking — the API scopes by role, and this
   * board renders read-only for them. Watching is not the same job as going.
   */
  const [scope, setScope] = useState<"all" | "member">("member");
  const [toast, setToast] = useState<string | null>(null);

  // Queue depth lives in localStorage, not React — read as external state so
  // nothing has to setState inside an effect to keep the badge current.
  const queued = useSyncExternalStore(subscribePending, pendingCount, pendingCountServer);
  const queuedReports = useSyncExternalStore(subscribeReports, queuedReportCount, queuedReportCountServer);

  const load = useCallback(() => {
    fetch("/api/missions")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setTasks(d.tasks ?? []);
        setOrgs(d.orgs ?? []);
        setScope(d.scope === "all" ? "all" : "member");
      })
      .catch(() => {
        /* offline — keep what is on screen, the queue holds the actions */
      });
  }, []);

  useEffect(load, [load]);
  useEffect(() => {
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(
    () =>
      startMissionSync((r) => {
        setToast(`${r.sent} update${r.sent === 1 ? "" : "s"} synced`);
        load();
      }),
    [load],
  );
  useEffect(
    () =>
      startReportSync((r) => {
        setToast(`${r.sent} field report${r.sent === 1 ? "" : "s"} uploaded now that you are back online`);
      }),
    [],
  );

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  /**
   * Advance optimistically.
   *
   * The row changes the instant the button is pressed, before the network is
   * consulted at all. A volunteer who taps "on site" and watches a spinner has
   * been given a reason to stop trusting the app at the worst possible moment.
   */
  const advance = useCallback(
    (id: number, to: "accepted" | "on_site" | "done", outcome?: string) => {
      const now = new Date().toISOString();
      setTasks((cur) =>
        (cur ?? []).map((t) =>
          t.id === id
            ? {
                ...t,
                status: to,
                outcome: outcome ?? t.outcome,
                acceptedAt: to === "accepted" ? now : t.acceptedAt,
                onSiteAt: to === "on_site" ? now : t.onSiteAt,
                doneAt: to === "done" ? now : t.doneAt,
              }
            : t,
        ),
      );
      enqueueAction(id, to, outcome);
    },
    [],
  );

  if (!tasks) {
    return (
      <p className="px-1 py-8 text-center text-[12px]" style={{ color: "var(--ink-muted)" }}>
        Loading your missions…
      </p>
    );
  }

  const open = tasks.filter((t) => t.status !== "done" && t.status !== "declined");
  const closed = tasks.filter((t) => t.status === "done");

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-[16px] font-semibold">My missions</h2>
          <p className="text-[11px]" style={{ color: "var(--ink-muted)" }}>
            {orgs.length ? orgs.map((o) => o.name).join(" · ") : "You are not in an organisation yet"}
          </p>
        </div>
        {queued + queuedReports > 0 && (
          <span
            className="rounded-md px-2 py-1 text-[10.5px]"
            style={{ background: "#3a2a12", color: "var(--warning)" }}
            title="Saved on this phone. They will send themselves when the network returns."
          >
            {queued + queuedReports} waiting to sync
          </span>
        )}
      </div>

      {!orgs.length && (
        <p
          className="rounded-lg px-3 py-2.5 text-[12px] leading-snug"
          style={{ background: "var(--surface-2)", color: "var(--ink-secondary)" }}
        >
          Ask your coordinator for an invite link. Opening it once puts you in the
          organisation and missions start arriving here.
        </p>
      )}

      {!open.length && orgs.length > 0 && (
        <p
          className="rounded-lg px-3 py-6 text-center text-[12.5px]"
          style={{ background: "var(--surface)", color: "var(--ink-muted)" }}
        >
          Nothing assigned right now.
        </p>
      )}

      <ul className="flex flex-col gap-2.5">
        {open.map((t) => (
          <TaskCard key={t.id} task={t} onAdvance={advance} readOnly={scope === "all"} />
        ))}
      </ul>

      {closed.length > 0 && (
        <>
          <p className="mt-2 text-[10px] uppercase tracking-wider" style={{ color: "var(--ink-muted)" }}>
            Closed today
          </p>
          <ul className="flex flex-col gap-2">
            {closed.map((t) => (
              <TaskCard key={t.id} task={t} onAdvance={advance} readOnly={scope === "all"} />
            ))}
          </ul>
        </>
      )}

      {toast && (
        <div
          className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg px-4 py-2.5 text-[12px] shadow-2xl"
          style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
