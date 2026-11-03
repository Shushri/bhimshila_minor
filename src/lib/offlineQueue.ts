"use client";

/**
 * Offline SOS queue.
 *
 * The brief asks for this directly: "usable when connectivity and time are both
 * scarce". In a disaster the network is the first thing to go, and an SOS that
 * fails because a tower is down is an SOS that never existed.
 *
 * So the send path never fails: the report is written to localStorage first,
 * then flushed — on reconnect, on page load, and on a slow retry timer. It is
 * localStorage rather than IndexedDB deliberately; the payloads are a few
 * hundred bytes and a synchronous write cannot be interrupted by the tab dying
 * mid-transaction, which is exactly the failure mode that matters here.
 */

const KEY = "dai.sos.queue";

export interface QueuedSos {
  id: string;
  message: string;
  place?: string;
  lat?: number;
  lng?: number;
  queuedAt: string;
  attempts: number;
}

function read(): QueuedSos[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as QueuedSos[];
  } catch {
    return [];
  }
}

const listeners = new Set<() => void>();

function write(items: QueuedSos[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(items));
  cachedSize = items.length;
  for (const l of listeners) l();
}

// useSyncExternalStore requires a stable snapshot — recomputing from
// localStorage on every render would return a new value each time and loop.
let cachedSize = -1;

export function queueSize(): number {
  if (cachedSize < 0) cachedSize = read().length;
  return cachedSize;
}

/** The queue is external state; this is how React subscribes to it. */
export function subscribeQueue(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      cachedSize = read().length;
      cb();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

export const queueSizeServer = () => 0;

export function enqueue(item: Omit<QueuedSos, "id" | "queuedAt" | "attempts">): QueuedSos {
  const q = read();
  const entry: QueuedSos = {
    ...item,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    queuedAt: new Date().toISOString(),
    attempts: 0,
  };
  q.push(entry);
  write(q);
  return entry;
}

export interface FlushResult {
  sent: number;
  remaining: number;
  incidents: number[];
}

/**
 * Try to deliver everything queued. Anything that fails stays queued — the
 * queue only shrinks on a confirmed server acknowledgement.
 */
export async function flush(): Promise<FlushResult> {
  const queue = read();
  if (!queue.length) return { sent: 0, remaining: 0, incidents: [] };

  const survivors: QueuedSos[] = [];
  const incidents: number[] = [];
  let sent = 0;

  for (const item of queue) {
    try {
      const res = await fetch("/api/sos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: item.message,
          place: item.place,
          lat: item.lat,
          lng: item.lng,
          queuedAt: item.queuedAt,
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      if (data.incidentId) incidents.push(data.incidentId);
      sent++;
    } catch {
      survivors.push({ ...item, attempts: item.attempts + 1 });
    }
  }

  write(survivors);
  return { sent, remaining: survivors.length, incidents };
}

/**
 * Flush on reconnect, on load, and on a slow timer — the timer covers the case
 * where the browser reports online but the network is still unusable, which is
 * common on a recovering tower.
 */
export function startQueueSync(onChange: (r: FlushResult) => void): () => void {
  if (typeof window === "undefined") return () => {};

  const run = async () => {
    if (!navigator.onLine || !queueSize()) return;
    const r = await flush();
    if (r.sent > 0) onChange(r);
  };

  window.addEventListener("online", run);
  const timer = setInterval(run, 30_000);
  void run();

  return () => {
    window.removeEventListener("online", run);
    clearInterval(timer);
  };
}
