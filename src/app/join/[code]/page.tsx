"use client";

import { useEffect, useRef, useState, use } from "react";
import AuthPanel, { type SessionUser } from "@/components/AuthPanel";
import Link from "next/link";

/**
 * Where an invite link lands.
 *
 * The code is the credential, so the only thing standing between opening this
 * and being in the organisation is having an account. Someone sent this link at
 * the start of a response and the person opening it is probably already in the
 * field, so the flow is: open, sign up if needed, joined — and the join is
 * retried automatically the moment they have a session rather than making them
 * find the link again.
 */
export default function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);
  const [state, setState] = useState<"idle" | "joined" | "failed">("idle");
  const started = useRef(false);
  const [org, setOrg] = useState<{ name: string; memberCount: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth")
      .then((r) => r.json())
      .then((d) => setUser(d.user ?? null))
      .catch(() => setUser(null));
  }, []);

  // Joins as soon as there is a session — including straight after signup, so
  // nobody has to go back and tap the link a second time.
  //
  // The "have we started" guard is a ref rather than the state it reads most
  // naturally from: setting state synchronously in an effect body cascades a
  // render before the request has even left.
  useEffect(() => {
    if (!user || started.current) return;
    started.current = true;
    fetch("/api/orgs/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "That invite link is not valid.");
        setOrg(d.org);
        setState("joined");
      })
      .catch((e) => {
        setErr(e instanceof Error ? e.message : "Could not join");
        setState("failed");
      });
  }, [user, code]);

  return (
    <div
      className="grid min-h-dvh place-items-center p-5"
      style={{ background: "var(--plane)", color: "var(--ink)" }}
    >
      <div className="w-full max-w-sm text-center">
        <p className="text-[15px] font-semibold tracking-tight">BhimShila</p>

        {user === undefined && (
          <p className="mt-6 text-[12.5px]" style={{ color: "var(--ink-muted)" }}>
            …
          </p>
        )}

        {user === null && (
          <p className="mt-4 text-[12.5px] leading-snug" style={{ color: "var(--ink-secondary)" }}>
            You have been invited to join a relief organisation. Create an account or
            log in, and you will be added straight away.
          </p>
        )}

        {user && state === "idle" && (
          <p className="mt-6 text-[12.5px]" style={{ color: "var(--ink-muted)" }}>
            Joining…
          </p>
        )}

        {state === "joined" && org && (
          <>
            <p className="mt-6 text-[14px]">
              You are in <strong>{org.name}</strong>.
            </p>
            <p className="mt-1 text-[11.5px]" style={{ color: "var(--ink-muted)" }}>
              {org.memberCount} {org.memberCount === 1 ? "member" : "members"} · missions
              assigned to this organisation will appear on your screen.
            </p>
            <Link
              href="/missions"
              className="mt-5 inline-block rounded-lg px-4 py-2.5 text-[13px] font-semibold"
              style={{ background: "#17508f", color: "#fff" }}
            >
              Go to my missions
            </Link>
          </>
        )}

        {state === "failed" && (
          <>
            <p className="mt-6 text-[12.5px]" style={{ color: "var(--serious)" }}>
              {err}
            </p>
            <p className="mt-2 text-[11px]" style={{ color: "var(--ink-muted)" }}>
              Ask your coordinator for a current link.
            </p>
          </>
        )}
      </div>

      {user === null && <AuthPanel onClose={() => {}} onAuthed={setUser} />}
    </div>
  );
}
