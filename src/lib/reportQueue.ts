"use client";

/**
 * Field reports that survive no network.
 *
 * Same shape as the mission queue and kept separate for the same reason: a
 * report is a create-once fact with a payload, not a replayable transition.
 * Photos are the complication — localStorage holds ~5MB, so a queue of
 * compressed photos fills it after a handful. Rather than fail silently at
 * the quota, the enqueue reports honestly whether the report was kept, and
 * the UI says which truth applies: "sent", "kept for later", or "could not
 * keep this offline — retry when you have signal".
 */

const KEY = "bhimshila.report.queue";

export interface QueuedReport {
  id: string;
  taskId: number;
  kind: "note" | "photo";
  body?: string;
  media?: string;
  mediaType?: string;
  /** When the volunteer captured it, not when it was sent. */
  capturedAt: string;
  attempts: number;
}

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());

function read(): QueuedReport[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as QueuedReport[]) : [];
  } catch {
    return [];
  }
}

function write(items: QueuedReport[]): boolean {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(items));
    notify();
    return true;
  } catch {
    // Quota. The caller tells the volunteer instead of pretending it is kept.
    return false;
  }
}

export function queuedReportCount(): number {
  return read().length;
}
export const queuedReportCountServer = () => 0;

export function subscribeReports(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export type EnqueueOutcome = "sent" | "queued" | "failed";

/** Try to send now; keep locally if the network is out. */
export async function submitReport(
  taskId: number,
  input: { kind: "note" | "photo"; body?: string; media?: string; mediaType?: string },
): Promise<{ outcome: EnqueueOutcome; error?: string }> {
  const item: QueuedReport = {
    id: `${taskId}-${Date.now()}`,
    taskId,
    ...input,
    capturedAt: new Date().toISOString(),
    attempts: 0,
  };

  const sent = await trySend(item);
  if (sent === "ok") return { outcome: "sent" };
  if (sent !== "network") return { outcome: "failed", error: sent };

  return write([...read(), item])
    ? { outcome: "queued" }
    : {
        outcome: "failed",
        error:
          item.kind === "photo"
            ? "No network, and this phone's offline store is full — the photo could not be kept. Retry when you have signal."
            : "No network and the offline store is full.",
      };
}

/** "ok", "network", or a server-stated reason (which retrying will not fix). */
async function trySend(item: QueuedReport): Promise<string> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return "network";
  try {
    const res = await fetch(`/api/tasks/${item.taskId}/reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: item.kind,
        body: item.body,
        media: item.media,
        mediaType: item.mediaType,
        capturedAt: item.capturedAt,
      }),
    });
    if (res.ok) return "ok";
    // 4xx is a verdict, not an outage — replaying it forever helps nobody.
    if (res.status >= 400 && res.status < 500) {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      return d.error ?? `Rejected (${res.status})`;
    }
    return "network";
  } catch {
    return "network";
  }
}

let flushing = false;

export async function flushReports(): Promise<{ sent: number; remaining: number }> {
  if (flushing || typeof window === "undefined" || !navigator.onLine) {
    return { sent: 0, remaining: read().length };
  }
  flushing = true;
  let sent = 0;
  try {
    const queue = read();
    const left: QueuedReport[] = [];
    for (const item of queue) {
      const r = await trySend(item);
      if (r === "ok") sent++;
      else if (r === "network") left.push({ ...item, attempts: item.attempts + 1 });
      // A server verdict drops the item — it was seen and refused, not lost.
    }
    write(left);
    return { sent, remaining: left.length };
  } finally {
    flushing = false;
  }
}

/** Retry on reconnect and on a slow timer. Returns an unsubscribe. */
export function startReportSync(onChange: (r: { sent: number }) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const run = () => {
    void flushReports().then((r) => {
      if (r.sent > 0) onChange(r);
    });
  };
  run();
  window.addEventListener("online", run);
  const timer = setInterval(run, 30_000);
  return () => {
    window.removeEventListener("online", run);
    clearInterval(timer);
  };
}

/**
 * Shrink a photo to something a disaster network can carry.
 *
 * 1280px on the long edge at JPEG 0.72 lands around 150–400KB — readable
 * detail for a coordinator, small enough to send on 2G and to keep a few of
 * offline. The original never leaves the phone.
 */
export function compressPhoto(file: File): Promise<{ dataUrl: string; type: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const long = Math.max(img.width, img.height);
      const scale = long > 1280 ? 1280 / long : 1;
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const cx = canvas.getContext("2d");
      if (!cx) return reject(new Error("Canvas unavailable"));
      cx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve({ dataUrl: canvas.toDataURL("image/jpeg", 0.72), type: "image/jpeg" });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file is not a readable image"));
    };
    img.src = url;
  });
}
