"use client";

import { useEffect, useState } from "react";
import MissionBoard from "@/components/MissionBoard";
import AuthPanel, { type SessionUser } from "@/components/AuthPanel";
import NotificationBell from "@/components/NotificationBell";
import WindowLayer from "@/components/WindowLayer";
import CommandDeck from "@/components/CommandDeck";
import Link from "next/link";

/**
 * The volunteer's home.
 *
 * Deliberately not the coordinator board with things hidden. A volunteer's job
 * is three or four missions and nothing else, and a screen that shows them the
 * whole country first makes them scroll past it to find their own work.
 */
export default function MissionsPage() {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);

  useEffect(() => {
    fetch("/api/auth")
      .then((r) => r.json())
      .then((d) => setUser(d.user ?? null))
      .catch(() => setUser(null));
  }, []);

  return (
    <div className="min-h-dvh" style={{ background: "var(--plane)", color: "var(--ink)" }}>
      <header
        className="flex items-center gap-2 px-3 py-2.5"
        style={{ borderBottom: "1px solid var(--border)", background: "var(--surface)" }}
      >
        <Link href="/" className="text-[15px] font-semibold tracking-tight">
          BhimShila
        </Link>
        <span className="text-[10.5px]" style={{ color: "var(--ink-muted)" }}>
          field
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/"
            className="rounded-md px-2.5 py-1.5 text-[11px]"
            style={{ background: "var(--plane)", border: "1px solid var(--border)", color: "var(--ink-secondary)" }}
          >
            Live map
          </Link>
          {user && <NotificationBell />}
          {user && (
            <span className="text-[10.5px]" style={{ color: "var(--ink-muted)" }}>
              {user.name}
            </span>
          )}
        </div>
      </header>

      <main className="p-3 pb-24">
        {user === undefined ? null : user ? (
          <MissionBoard />
        ) : (
          <p className="mx-auto max-w-md px-1 py-10 text-center text-[13px]" style={{ color: "var(--ink-muted)" }}>
            Log in to see the missions assigned to your organisation.
          </p>
        )}
      </main>

      {user === null && <AuthPanel onClose={() => {}} onAuthed={setUser} />}

      {/* The field screen gets the same voice and windows as the board — a
          volunteer's hands are full, which is who voice was for all along. */}
      <WindowLayer />
      <CommandDeck />
    </div>
  );
}
