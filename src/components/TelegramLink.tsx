"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Connect Telegram, so an alert reaches a phone rather than only a login.
 *
 * in_app delivery is real but passive — the person has to come back and look.
 * Telegram is the one channel that both pushes and costs nothing: no Meta
 * business account, no paid gateway, and none of the DLT registration Indian
 * A2P SMS requires.
 *
 * The person has to message the bot first; Telegram will not hand out a chat id
 * from a phone number. That is a feature, not an obstacle — it means nobody is
 * added to a broadcast list without opting in — so this is an opt-in button
 * rather than something done to them at signup.
 */

interface Status {
  linked: boolean;
  configured: boolean;
  justLinked?: boolean;
  hint?: string;
}

export default function TelegramLink() {
  const [status, setStatus] = useState<Status | null>(null);
  const [link, setLink] = useState<{ url: string; expiresInMinutes: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    fetch("/api/telegram")
      .then((r) => (r.status === 401 ? null : r.json()))
      .then((d) => d && setStatus(d))
      .catch(() => {
        /* offline — leave the last known state */
      });
  }, []);

  useEffect(refresh, [refresh]);

  // While a link is outstanding, poll — the user completes it in another app
  // and comes back expecting this to already say connected.
  useEffect(() => {
    if (!link || status?.linked) return;
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [link, status?.linked, refresh]);

  async function start() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/telegram", { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Could not start linking");
      setLink(d);
      window.open(d.url, "_blank", "noopener");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not start linking");
    } finally {
      setBusy(false);
    }
  }

  if (!status) return null;

  // Derived, not stored: once linked there is nothing outstanding, so the
  // pending link simply stops being rendered rather than being cleared by an
  // effect that would cascade a render to do it.
  if (status.linked) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[10.5px]"
        style={{ background: "#12301a", color: "#7ee87e" }}
        title="Confirmed alerts for your region will arrive on Telegram"
      >
        ✓ Telegram connected
      </span>
    );
  }

  if (!status.configured) {
    return (
      <span
        className="hidden rounded-md px-2 py-1 text-[10.5px] md:inline"
        style={{ background: "var(--surface-2)", color: "var(--ink-muted)" }}
        title={status.hint}
      >
        Telegram not configured
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={start}
        disabled={busy}
        className="rounded-md px-2.5 py-1.5 text-[11px] font-medium"
        style={{
          background: link ? "var(--surface-2)" : "#17508f",
          border: "1px solid var(--border)",
          color: link ? "var(--ink-secondary)" : "#fff",
          opacity: busy ? 0.6 : 1,
        }}
      >
        {link ? "Waiting for Telegram…" : busy ? "…" : "Get alerts on Telegram"}
      </button>
      {link && (
        <a
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10.5px] underline"
          style={{ color: "var(--ink-muted)" }}
        >
          reopen link
        </a>
      )}
      {err && (
        <span className="text-[10.5px]" style={{ color: "var(--serious)" }}>
          {err}
        </span>
      )}
    </span>
  );
}
