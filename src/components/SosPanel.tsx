"use client";

import { useState } from "react";
import { useVoice } from "@/lib/voice/useVoice";
import { RECOGNITION_LANG } from "@/lib/voice/language";
import { enqueue, flush } from "@/lib/offlineQueue";

/**
 * Citizen SOS.
 *
 * The organizers' design question was how to keep entry simple enough for a
 * stressed person to actually use. The answer is that they should not have to
 * fill anything in: they speak, and the model does the structuring.
 */
export default function SosPanel({
  onSent,
  onClose,
}: {
  onSent: (r: { incidentId: number; queued: boolean; remaining?: number }) => void;
  onClose: () => void;
}) {
  const [message, setMessage] = useState("");
  const [place, setPlace] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const { listening, interim, supported, toggle } = useVoice({
    lang: RECOGNITION_LANG,
    onFinal: (t) => setMessage((m) => (m ? `${m} ${t}` : t)),
  });

  async function send() {
    const text = (message || interim).trim();
    if (!text || busy) return;
    setBusy(true);
    setErr(null);

    // Queue first, always. An SOS must survive a dead tower, so it is written
    // to disk before anything is attempted over the network.
    enqueue({ message: text, place: place.trim() || undefined });

    try {
      const r = await flush();
      if (r.sent > 0) {
        onSent({ queued: false, incidentId: r.incidents[0] ?? 0 });
      } else {
        onSent({ queued: true, incidentId: 0, remaining: r.remaining });
      }
    } catch {
      onSent({ queued: true, incidentId: 0, remaining: 1 });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ background: "rgba(6,8,12,0.82)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="panel-in w-full max-w-lg rounded-2xl p-6"
        style={{ background: "var(--surface)", border: "1px solid var(--critical)" }}
      >
        <h2 className="text-lg font-semibold" style={{ color: "var(--critical)" }}>
          Emergency SOS
        </h2>
        <p className="mt-1 text-xs" style={{ color: "var(--ink-muted)" }}>
          Bas bol dijiye kya hua hai — Hindi ya English, dono chalega. Form bharne ki zaroorat nahi.
          Network na ho tab bhi bhej sakte hain; network aate hi apne aap chala jayega.
        </p>

        <div className="mt-4 flex items-start gap-3">
          <button
            onClick={toggle}
            disabled={!supported}
            className="relative grid h-14 w-14 shrink-0 place-items-center rounded-2xl disabled:opacity-40"
            style={{ background: listening ? "var(--critical)" : "#17508f" }}
            aria-label={listening ? "Stop" : "Speak"}
          >
            {listening && (
              <span className="pulse-ring absolute inset-0 rounded-2xl" style={{ background: "var(--critical)" }} />
            )}
            <svg width="22" height="22" viewBox="0 0 24 24" fill="#fff" className="relative">
              <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z" />
              <path d="M19 11a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.92V21a1 1 0 1 0 2 0v-3.08A7 7 0 0 0 19 11Z" />
            </svg>
          </button>

          <textarea
            value={interim || message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            placeholder={listening ? "Sun raha hoon…" : "Kya hua hai? e.g. paani ghar me ghus gaya, teen bacche hain"}
            className="min-h-[5.5rem] flex-1 rounded-lg px-3 py-2.5 text-sm outline-none placeholder:opacity-45"
            style={{ background: "var(--plane)", border: "1px solid var(--border)", color: "var(--ink-primary)" }}
          />
        </div>

        <input
          value={place}
          onChange={(e) => setPlace(e.target.value)}
          placeholder="Location — district or town (optional)"
          className="mt-2.5 w-full rounded-lg px-3 py-2.5 text-sm outline-none placeholder:opacity-45"
          style={{ background: "var(--plane)", border: "1px solid var(--border)", color: "var(--ink-primary)" }}
        />

        {err && <p className="mt-3 text-xs" style={{ color: "var(--critical)" }}>■ {err}</p>}

        <div className="mt-4 flex gap-2">
          <button
            onClick={send}
            disabled={busy || !(message || interim).trim()}
            className="flex-1 rounded-lg py-2.5 text-sm font-semibold disabled:opacity-40"
            style={{ background: "var(--critical)", color: "#fff" }}
          >
            {busy ? "Sending…" : "Send SOS"}
          </button>
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2.5 text-sm"
            style={{ background: "var(--surface-2)", color: "var(--ink-secondary)" }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
