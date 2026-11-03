"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Organisations, for the coordinator.
 *
 * Registering one is a claim that these people will turn up when dispatched, so
 * it is a coordinator's act and needs someone accountable behind it. The moment
 * it exists it is in the dispatch pool — `nearestTeams()` resolves through the
 * same table — which is why the base coordinates are required rather than
 * optional: an org with no location can never be the nearest team to anything.
 */

/**
 * The stock-take. Absolute counts, not deltas — the lead types what is on the
 * shelf after loading the truck, and a blank field means "unchanged". This is
 * what turns the board's supplies figures from a seeded label into a number
 * that moves.
 */
function StockEditor({ orgId }: { orgId: number }) {
  const [vals, setVals] = useState<{ boats: string; medicalKits: string; foodPackets: string }>({
    boats: "",
    medicalKits: "",
    foodPackets: "",
  });
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setNote(null);
    try {
      const body: Record<string, number | undefined> = { id: orgId };
      for (const k of ["boats", "medicalKits", "foodPackets"] as const) {
        if (vals[k].trim() !== "") body[k] = Number(vals[k]);
      }
      const r = await fetch("/api/orgs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Failed");
      setNote(
        `Recorded: ${d.resources.boats} boats · ${d.resources.medicalKits} kits · ${d.resources.foodPackets} food packets.`,
      );
      setVals({ boats: "", medicalKits: "", foodPackets: "" });
    } catch (e) {
      setNote(`■ ${e instanceof Error ? e.message : "Failed"}`);
    } finally {
      setBusy(false);
    }
  }

  const cell =
    "w-full rounded-md px-2 py-1.5 text-[11px] outline-none placeholder:opacity-50";
  const cellStyle = { background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--ink)" } as const;

  return (
    <div className="mt-2">
      <p className="text-[10px] uppercase tracking-wider" style={{ color: "var(--ink-muted)" }}>
        Stock-take — blank means unchanged
      </p>
      <div className="mt-1 grid grid-cols-[1fr_1fr_1fr_auto] gap-1.5">
        {(["boats", "medicalKits", "foodPackets"] as const).map((k) => (
          <input
            key={k}
            inputMode="numeric"
            placeholder={k === "medicalKits" ? "kits" : k === "foodPackets" ? "food" : "boats"}
            value={vals[k]}
            onChange={(e) => setVals((v) => ({ ...v, [k]: e.target.value.replace(/[^0-9]/g, "") }))}
            className={cell}
            style={cellStyle}
            aria-label={k}
          />
        ))}
        <button
          onClick={save}
          disabled={busy || Object.values(vals).every((v) => v.trim() === "")}
          className="rounded-md px-3 text-[11px] font-medium disabled:opacity-40"
          style={{ background: "#17508f", color: "#fff" }}
        >
          {busy ? "…" : "Save"}
        </button>
      </div>
      {note && (
        <p className="mt-1 text-[10.5px]" style={{ color: note.startsWith("■") ? "var(--serious)" : "var(--good)" }}>
          {note}
        </p>
      )}
    </div>
  );
}

interface Org {
  id: number;
  name: string;
  kind: string;
  place: string;
  status: string;
  capacity: number;
  contact: string | null;
  memberCount: number;
  inviteCode?: string;
}

interface Member {
  id: number;
  name: string;
  phone: string;
  role: "lead" | "member";
  joinedAt: string;
}

const KINDS = [
  { id: "ngo", label: "NGO" },
  { id: "rescue", label: "Rescue" },
  { id: "medical", label: "Medical" },
];

function InviteLink({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window === "undefined" ? "" : `${window.location.origin}/join/${code}`;

  return (
    <div className="mt-2 flex items-center gap-2">
      <code
        className="min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-[10.5px]"
        style={{ background: "var(--plane)", color: "var(--ink-secondary)" }}
      >
        {url}
      </code>
      <button
        onClick={() => {
          void navigator.clipboard.writeText(url).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
          });
        }}
        className="shrink-0 rounded-md px-2.5 py-1.5 text-[10.5px] font-medium"
        style={{ background: copied ? "#12301a" : "#17508f", color: copied ? "#7ee87e" : "#fff" }}
      >
        {copied ? "copied" : "copy"}
      </button>
    </div>
  );
}

export default function OrgPanel({ canRegister }: { canRegister: boolean }) {
  const [orgs, setOrgs] = useState<Org[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({
    name: "",
    kind: "ngo",
    place: "",
    lat: "",
    lng: "",
    contact: "",
    capacity: "20",
  });

  const load = useCallback(() => {
    fetch("/api/orgs")
      .then((r) => r.json())
      .then((d) => setOrgs(d.orgs ?? []))
      .catch(() => setOrgs([]));
  }, []);

  useEffect(load, [load]);

  useEffect(() => {
    if (open === null) return;
    fetch(`/api/orgs?id=${open}`)
      .then((r) => (r.ok ? r.json() : { members: [] }))
      .then((d) => setMembers(d.members ?? []))
      .catch(() => setMembers([]));
  }, [open]);

  async function register() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/orgs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          kind: form.kind,
          place: form.place,
          lat: Number(form.lat),
          lng: Number(form.lng),
          contact: form.contact || null,
          capacity: Number(form.capacity) || 20,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Could not register");
      setAdding(false);
      setForm({ name: "", kind: "ngo", place: "", lat: "", lng: "", contact: "", capacity: "20" });
      load();
      setOpen(d.org.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not register");
    } finally {
      setBusy(false);
    }
  }

  if (!orgs) return null;

  const mine = orgs.filter((o) => o.inviteCode);
  const rest = orgs.filter((o) => !o.inviteCode);

  return (
    <div className="rounded-xl p-3" style={{ background: "var(--surface)" }}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-[13px] font-semibold">Organisations</h3>
          <p className="text-[10.5px]" style={{ color: "var(--ink-muted)" }}>
            {orgs.length} in the dispatch pool · {orgs.filter((o) => o.status === "deployed").length} deployed
          </p>
        </div>
        {canRegister && (
          <button
            onClick={() => setAdding((a) => !a)}
            className="rounded-md px-2.5 py-1.5 text-[11px] font-medium"
            style={{ background: adding ? "var(--plane)" : "#17508f", color: adding ? "var(--ink-secondary)" : "#fff", border: "1px solid var(--border)" }}
          >
            {adding ? "Cancel" : "Register one"}
          </button>
        )}
      </div>

      {adding && (
        <div className="mt-3 flex flex-col gap-2">
          {err && (
            <p className="rounded-md px-2.5 py-1.5 text-[11px]" style={{ background: "#3a1a1a", color: "var(--serious)" }}>
              {err}
            </p>
          )}
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Organisation name"
            className="rounded-md px-2.5 py-2 text-[12px] outline-none"
            style={{ background: "var(--plane)", border: "1px solid var(--border)", color: "var(--ink)" }}
          />
          <div className="flex gap-1.5">
            {KINDS.map((k) => (
              <button
                key={k.id}
                onClick={() => setForm({ ...form, kind: k.id })}
                className="rounded-md px-2.5 py-1.5 text-[11px]"
                style={{
                  background: form.kind === k.id ? "#17508f" : "var(--plane)",
                  border: "1px solid var(--border)",
                  color: form.kind === k.id ? "#fff" : "var(--ink-secondary)",
                }}
              >
                {k.label}
              </button>
            ))}
          </div>
          <input
            value={form.place}
            onChange={(e) => setForm({ ...form, place: e.target.value })}
            placeholder="Base location — e.g. Dhubri, Assam"
            className="rounded-md px-2.5 py-2 text-[12px] outline-none"
            style={{ background: "var(--plane)", border: "1px solid var(--border)", color: "var(--ink)" }}
          />
          {/* Required, not optional: dispatch picks the nearest team by distance,
              so an org without coordinates can never be chosen for anything. */}
          <div className="grid grid-cols-2 gap-2">
            <input
              value={form.lat}
              onChange={(e) => setForm({ ...form, lat: e.target.value })}
              placeholder="Latitude"
              inputMode="decimal"
              className="rounded-md px-2.5 py-2 text-[12px] outline-none"
              style={{ background: "var(--plane)", border: "1px solid var(--border)", color: "var(--ink)" }}
            />
            <input
              value={form.lng}
              onChange={(e) => setForm({ ...form, lng: e.target.value })}
              placeholder="Longitude"
              inputMode="decimal"
              className="rounded-md px-2.5 py-2 text-[12px] outline-none"
              style={{ background: "var(--plane)", border: "1px solid var(--border)", color: "var(--ink)" }}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              value={form.contact}
              onChange={(e) => setForm({ ...form, contact: e.target.value })}
              placeholder="Contact (optional)"
              className="rounded-md px-2.5 py-2 text-[12px] outline-none"
              style={{ background: "var(--plane)", border: "1px solid var(--border)", color: "var(--ink)" }}
            />
            <input
              value={form.capacity}
              onChange={(e) => setForm({ ...form, capacity: e.target.value })}
              placeholder="Capacity"
              inputMode="numeric"
              className="rounded-md px-2.5 py-2 text-[12px] outline-none"
              style={{ background: "var(--plane)", border: "1px solid var(--border)", color: "var(--ink)" }}
            />
          </div>
          <p className="text-[10px] leading-snug" style={{ color: "var(--ink-muted)" }}>
            It joins the dispatch pool immediately — the nearest available team to an
            incident is chosen by distance from this point.
          </p>
          <button
            onClick={register}
            disabled={busy || !form.name.trim() || !form.place.trim() || !form.lat || !form.lng}
            className="rounded-md py-2 text-[12px] font-medium"
            style={{
              background: "#17508f",
              color: "#fff",
              opacity: busy || !form.name.trim() || !form.place.trim() || !form.lat || !form.lng ? 0.5 : 1,
            }}
          >
            {busy ? "…" : "Register"}
          </button>
        </div>
      )}

      <ul className="mt-3 flex flex-col gap-1">
        {[...mine, ...rest].slice(0, open === null ? 6 : 40).map((o) => (
          <li key={o.id}>
            <button
              onClick={() => setOpen(open === o.id ? null : o.id)}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[11.5px]"
              style={{ background: open === o.id ? "#17508f22" : "var(--surface-2)" }}
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: o.status === "deployed" ? "var(--serious)" : "var(--good)" }}
                title={o.status}
              />
              <span className="min-w-0 flex-1 truncate">{o.name}</span>
              <span className="shrink-0 text-[10.5px]" style={{ color: "var(--ink-muted)" }}>
                {o.memberCount} {o.memberCount === 1 ? "member" : "members"}
              </span>
            </button>

            {open === o.id && (
              <div className="mt-1 rounded-lg px-2.5 py-2" style={{ background: "var(--plane)" }}>
                <p className="text-[10.5px]" style={{ color: "var(--ink-muted)" }}>
                  {o.kind} · {o.place} · capacity {o.capacity}
                  {o.contact ? ` · ${o.contact}` : ""}
                </p>

                {o.inviteCode ? (
                  <>
                    <p className="mt-2 text-[10px] uppercase tracking-wider" style={{ color: "var(--ink-muted)" }}>
                      Invite link — anyone who opens it joins this organisation
                    </p>
                    <InviteLink code={o.inviteCode} />
                  </>
                ) : (
                  <p className="mt-1.5 text-[10.5px]" style={{ color: "var(--ink-muted)" }}>
                    You do not lead this organisation, so its invite link is not shown.
                  </p>
                )}

                {/* Leads and coordinators keep the stock honest. */}
                {(o.inviteCode || canRegister) && <StockEditor orgId={o.id} />}

                {members.length > 0 && (
                  <ul className="mt-2 flex flex-col gap-0.5">
                    {members.map((m) => (
                      <li key={m.id} className="flex items-center gap-2 text-[11px]">
                        <span className="min-w-0 flex-1 truncate">{m.name}</span>
                        <span style={{ color: m.role === "lead" ? "var(--ink)" : "var(--ink-muted)" }}>
                          {m.role}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
