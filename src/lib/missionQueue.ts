"use client";

/**
 * Mission actions that survive no network.
 *
 * A volunteer marking "on site" is standing in the water. That is exactly where
 * the signal goes, and it is the moment the record matters most — the timestamp
 * on that transition is the deployment log. So the button writes locally and
 * returns immediately, and the network catches up later.
 *
 * Kept separate from the SOS queue rather than generalised into one. They look
 * alike and they are not: an SOS is a new fact that can only be created once,
 * while a mission action is a state transition that is safe to replay and must
 * carry the time it *happened* rather than the time it was sent. Merging them
 * would mean one of those two truths getting bent to fit the other.
 */

const KEY = "bhimshila.mission.queue";

export interface QueuedAction {
  id: string;
  taskId: number;
  to: "accepted" | "on_site" | "done" | "declined";
  outcome?: string;
  /** When the volunteer pressed it, not when it was sent. */
  at: string;
  attempts: number;
}

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());

function read(): QueuedAction[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as QueuedAction[]) : [];
  } catch {
    return [];
  }
}

function write(items: QueuedAction[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* storage full or blocked — the action is lost, and the UI says pending */
  }
  notify();
}

export function pendingCount(): number {
  return read().length;
}
export const pendingCountServer = () => 0;

export function subscribePending(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => e.key === KEY && cb();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

/** Queue an action and try to send it now. Returns immediately either way. */
export function enqueueAction(taskId: number, to: QueuedAction["to"], outcome?: string) {
  const item: QueuedAction = {
    id: `${taskId}-${to}-${Date.now()}`,
    taskId,
    to,
    outcome,
    at: new Date().toISOString(),
    attempts: 0,
  };
  write([...read(), item]);
  void flushActions();
  return item;
}

export interface FlushResult {
  sent: number;
  failed: number;
  remaining: number;
}

let flushing = false;

/**
 * Send what is queued, oldest first.
 *
 * Order matters here in a way it does not for SOS: accepted must land before
 * on_site, or the server rejects the transition. So this stops at the first
 * failure rather than carrying on, and retries the whole tail next time.
 */
export async function flushActions(): Promise<FlushResult> {
  if (flushing || typeof window === "undefined" || !navigator.onLine) {
    return { sent: 0, failed: 0, remaining: read().length };
  }
  flushing = true;
  let sent = 0;
  let failed = 0;

  try {
    const queue = [...read()].sort((a, b) => a.at.localeCompare(b.at));
    const left: QueuedAction[] = [];

    for (let i = 0; i < queue.length; i++) {
      const item = queue[i];
      try {
        const res = await fetch(`/api/tasks/${item.taskId}/advance`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to: item.to, outcome: item.outcome, at: item.at }),
        });

        // 409 means the world moved on — someone else advanced it, or this
        // already landed. Either way replaying it forever helps nobody, so it
        // is dropped rather than retried. 403 likewise: membership will not
        // change by trying again.
        if (res.ok || res.status === 409 || res.status === 403) {
          sent++;
          continue;
        }
        throw new Error(String(res.status));
      } catch {
        failed++;
        left.push({ ...item, attempts: item.attempts + 1 });
        // Everything after this depends on it landing first.
        left.push(...queue.slice(i + 1));
        break;
      }
    }
    write(left);
    return { sent, failed, remaining: left.length };
  } finally {
    flushing = false;
  }
}

/** Retry on reconnect and on a slow timer. Returns an unsubscribe. */
export function startMissionSync(onChange: (r: FlushResult) => void): () => void {
  if (typeof window === "undefined") return () => {};

  const run = () => {
    void flushActions().then((r) => {
      if (r.sent > 0) onChange(r);
    });
  };

  run();
  window.addEventListener("online", run);
  const timer = setInterval(run, 20_000);
  return () => {
    window.removeEventListener("online", run);
    clearInterval(timer);
  };
}
