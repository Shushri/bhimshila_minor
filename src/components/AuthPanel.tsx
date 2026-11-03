"use client";

import { useState } from "react";

export interface SessionUser {
  id: number;
  phone: string;
  name: string;
  role: "citizen" | "volunteer" | "coordinator";
  place: string | null;
}

const ROLES: { id: SessionUser["role"]; label: string; blurb: string }[] = [
  { id: "citizen", label: "Citizen", blurb: "Receive alerts, raise an SOS" },
  { id: "volunteer", label: "Volunteer", blurb: "Report needs from the field" },
  { id: "coordinator", label: "Coordinator", blurb: "Dispatch teams, send alerts" },
];

export default function AuthPanel({
  onAuthed,
  onClose,
}: {
  onAuthed: (u: SessionUser) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"login" | "signup">("signup");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [place, setPlace] = useState("");
  // Citizen by default. The role that can broadcast and dispatch is a choice
  // someone must make deliberately, never the one they get by pressing enter.
  const [role, setRole] = useState<SessionUser["role"]>("citizen");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: mode, phone, password, name, place, role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong");
      onAuthed(data.user);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const field =
    "w-full rounded-lg px-3 py-2.5 text-sm outline-none placeholder:opacity-45";
  const fieldStyle = {
    background: "var(--plane)",
    border: "1px solid var(--border)",
    color: "var(--ink-primary)",
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ background: "rgba(6,8,12,0.82)" }}
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="panel-in w-full max-w-md rounded-2xl p-6"
        style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
      >
        <h2 className="text-lg font-semibold">
          {mode === "signup" ? "Create your BhimShila account" : "Log in to BhimShila"}
        </h2>
        <p className="mt-1 text-xs" style={{ color: "var(--ink-muted)" }}>
          Your number decides which alerts reach you and what you are allowed to do.
        </p>

        {mode === "signup" && (
          <div className="mt-4 grid grid-cols-3 gap-2">
            {ROLES.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setRole(r.id)}
                className="rounded-lg p-2.5 text-left"
                style={{
                  background: role === r.id ? "#17508f" : "var(--plane)",
                  border: "1px solid var(--border)",
                }}
              >
                <span className="block text-xs font-medium">{r.label}</span>
                <span
                  className="mt-0.5 block text-[10px] leading-tight"
                  style={{ color: role === r.id ? "#dce9fa" : "var(--ink-muted)" }}
                >
                  {r.blurb}
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="mt-4 flex flex-col gap-2.5">
          {mode === "signup" && (
            <input
              className={field}
              style={fieldStyle}
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
          <input
            className={field}
            style={fieldStyle}
            placeholder="Mobile number (10 digits)"
            inputMode="numeric"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
          <input
            className={field}
            style={fieldStyle}
            type="password"
            placeholder="Password (min 6 characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {mode === "signup" && (
            <input
              className={field}
              style={fieldStyle}
              placeholder="Your district or town — e.g. Kangra"
              value={place}
              onChange={(e) => setPlace(e.target.value)}
            />
          )}
        </div>

        {err && (
          <p className="mt-3 text-xs" style={{ color: "var(--critical)" }}>■ {err}</p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="mt-4 w-full rounded-lg py-2.5 text-sm font-medium disabled:opacity-50"
          style={{ background: "#17508f", color: "#fff" }}
        >
          {busy ? "…" : mode === "signup" ? "Create account" : "Log in"}
        </button>

        <button
          type="button"
          onClick={() => {
            setMode(mode === "signup" ? "login" : "signup");
            setErr(null);
          }}
          className="mt-3 w-full text-center text-xs"
          style={{ color: "var(--ink-muted)" }}
        >
          {mode === "signup" ? "Already registered? Log in" : "New here? Create an account"}
        </button>
      </form>
    </div>
  );
}
