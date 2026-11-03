"use client";

import { useState } from "react";
import { openWindow } from "@/lib/windows";

/**
 * One button, one window: the 12-hour shift handover, every number a query.
 * Copy puts the plain text on the clipboard — handovers get pasted into
 * whatsapp groups and duty registers, and that is fine; it contains counts
 * and dispatch states, never a citizen's location.
 */

function Brief({ brief, written, at }: { brief: string; written: string; at: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2.5">
      <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed" style={{ color: "var(--ink)" }}>
        {brief}
      </p>
      <p className="text-[9.5px]" style={{ color: "var(--ink-muted)" }}>
        Written: {written} · {new Date(at).toLocaleString("en-IN", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}
      </p>
      <button
        onClick={() => {
          void navigator.clipboard?.writeText(brief).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          });
        }}
        className="self-start rounded-lg px-3.5 py-2 text-[12px] font-medium"
        style={{ background: "#17508f", color: "#fff" }}
      >
        {copied ? "✓ Copied" : "Copy for the duty register"}
      </button>
    </div>
  );
}

export default function HandoverButton() {
  const [busy, setBusy] = useState(false);

  async function open() {
    setBusy(true);
    try {
      const r = await fetch("/api/handover");
      const d = await r.json();
      openWindow({
        id: "handover",
        title: "Shift handover — last 12 hours",
        glyph: "⇥",
        source: "every number is a query · lib record",
        node: r.ok ? (
          <Brief brief={d.brief} written={d.written} at={d.at} />
        ) : (
          <p className="text-[12px]" style={{ color: "var(--serious)" }}>■ {d.error ?? "Failed"}</p>
        ),
        w: 520,
        h: 480,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={open}
      disabled={busy}
      className="self-start rounded-md px-3 py-1.5 text-[11.5px] font-medium disabled:opacity-50"
      style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--ink-secondary)" }}
      title="A 12-hour digest for the incoming shift — every number from the record"
    >
      ⇥ {busy ? "Writing…" : "Shift handover"}
    </button>
  );
}
