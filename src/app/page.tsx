"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Dashboard from "@/components/Dashboard";
import { Mark } from "@/components/Logo";
import RaiseMission from "@/components/RaiseMission";
import ActionModal, { type ActionKind } from "@/components/ActionModal";
import AuthPanel, { type SessionUser } from "@/components/AuthPanel";
import SosPanel from "@/components/SosPanel";
import OpsConsole from "@/components/OpsConsole";
import TelegramLink from "@/components/TelegramLink";
import SettingsPanel from "@/components/SettingsPanel";
import { keyCount, keyCountServer, subscribeKeys } from "@/lib/byok";
import OrgPanel from "@/components/OrgPanel";
import WindowLayer from "@/components/WindowLayer";
import CommandDeck from "@/components/CommandDeck";
import BroadcastQueue from "@/components/BroadcastQueue";
import NotificationBell from "@/components/NotificationBell";
import IntelBrief from "@/components/IntelBrief";
import HandoverButton from "@/components/HandoverButton";
import Link from "next/link";
import { startQueueSync } from "@/lib/offlineQueue";
import type { FeedItem } from "@/lib/feed";

/**
 * BhimShila — the operations board.
 *
 * The page used to be a question box: you asked, panels appeared. That is the
 * wrong shape for someone watching a screen during a response, because it
 * requires knowing what to ask before anything is on screen at all. The board
 * shows everything by default and the coordinator drives.
 *
 * The agent has not gone anywhere — it is what ranks the board, estimates who
 * is under each alert, and writes the evidence lines. And it is back on top
 * too: the command deck at the bottom of the screen takes a typed or spoken
 * question and answers with floating panels over the board, so the two designs
 * are no longer either/or. The board shows everything; the deck answers the
 * question you actually have.
 */

type Tab = "overview" | "intel" | "ops" | "orgs";

const TABS: { id: Tab; glyph: string; label: string }[] = [
  { id: "overview", glyph: "▦", label: "Overview" },
  { id: "intel", glyph: "◈", label: "AI Intelligence" },
  { id: "ops", glyph: "⚙", label: "Operations" },
  { id: "orgs", glyph: "⚑", label: "Organisations" },
];

export default function Home() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [showAuth, setShowAuth] = useState(false);
  const [showSos, setShowSos] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  // Read from localStorage as external state so the badge is right on first
  // paint and stays right if another tab changes it.
  const ownKeys = useSyncExternalStore(subscribeKeys, keyCount, keyCountServer);
  const [toast, setToast] = useState<string | null>(null);
  const [pending, setPending] = useState<{ action: ActionKind; item: FeedItem } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [tab, setTab] = useState<Tab>("overview");

  useEffect(() => {
    fetch("/api/auth")
      .then((r) => r.json())
      .then((d) => setUser(d.user ?? null))
      .catch(() => {});
  }, []);

  useEffect(
    () => startQueueSync((r) => setToast(`${r.sent} queued SOS synced now that you are back online`)),
    [],
  );

  // Voice drives the shell: "operations kholo" lands here from the deck's
  // command router, as does a spoken "SOS".
  useEffect(() => {
    const onTab = (e: Event) => setTab((e as CustomEvent<Tab>).detail);
    const onSos = () => setShowSos(true);
    window.addEventListener("bhimshila:tab", onTab);
    window.addEventListener("bhimshila:sos", onSos);
    return () => {
      window.removeEventListener("bhimshila:tab", onTab);
      window.removeEventListener("bhimshila:sos", onSos);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  function act(action: string, item: FeedItem) {
    // Acting on a row reaches real people and real responders, so it needs an
    // account behind it. Raising an SOS deliberately does not.
    if (!user) {
      setShowAuth(true);
      return;
    }
    setPending({ action: action as ActionKind, item });
  }

  const focusAsk = () => window.dispatchEvent(new Event("bhimshila:focus-ask"));

  const railItem =
    "grid h-9 w-9 place-items-center rounded-lg text-[15px] transition-colors hover:bg-[#17508f33]";

  return (
    <div className="min-h-dvh" style={{ background: "var(--plane)", color: "var(--ink)" }}>
      {/* The icon rail — the command centre's spine on a desktop. Everything
          on it exists elsewhere too (header, deck), so below lg it simply
          disappears rather than collapsing into a hamburger. */}
      <aside
        className="fixed inset-y-0 left-0 z-20 hidden w-11 flex-col items-center gap-1 pt-2.5 lg:flex"
        style={{ background: "var(--surface)", borderRight: "1px solid var(--border)" }}
      >
        <span className="mb-2 grid h-9 w-9 place-items-center" title="BhimShila">
          <Mark size={26} />
        </span>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={railItem}
            style={
              tab === t.id
                ? { background: "#17508f33", color: "var(--seq-250)", boxShadow: "inset 2px 0 0 var(--seq-400)" }
                : { color: "var(--ink-secondary)" }
            }
            title={t.label}
            aria-pressed={tab === t.id}
          >
            {t.glyph}
          </button>
        ))}
        <span className="my-1 h-px w-6" style={{ background: "var(--border)" }} aria-hidden />
        <Link href="/missions" className={railItem} style={{ color: "var(--ink-secondary)" }} title="My missions">
          ✚
        </Link>
        <button onClick={focusAsk} className={railItem} style={{ color: "var(--ink-secondary)" }} title="Ask the platform ( / )">
          ⌕
        </button>
        <button
          onClick={() => setShowSos(true)}
          className={railItem}
          style={{ color: "var(--critical)" }}
          title="Raise SOS"
        >
          ▲
        </button>
      </aside>

      <header
        className="sticky top-0 z-20 flex flex-wrap items-center gap-2 px-3 py-2.5 backdrop-blur lg:pl-14"
        style={{
          borderBottom: "1px solid var(--border)",
          background: "rgba(26,26,25,0.88)",
          // The one line of brand light on an otherwise dark shell.
          boxShadow: "inset 0 2px 0 #1c5cab",
        }}
      >
        <div className="flex items-baseline gap-2">
          {/* The rail carries the mark on a desktop and disappears below lg,
              so the header carries it on a phone — where most citizens are. */}
          <span className="self-center lg:hidden">
            <Mark size={20} />
          </span>
          <span
            className="text-[15px] font-semibold tracking-tight"
            style={{
              background: "linear-gradient(135deg, #bcd9f8 20%, #3f92e8 80%)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
              filter: "drop-shadow(0 0 12px rgba(63,146,232,0.45))",
            }}
          >
            BhimShila
          </span>
          <span
            className="hidden text-[10.5px] xl:inline"
            style={{ color: "var(--ink-muted)" }}
            title="Named for the boulder that split the flood at Kedarnath in June 2013 and saved the temple — and the people sheltering in it. That was luck. This is not meant to be."
          >
            भीमशिला · disaster intelligence for India
          </span>
        </div>

        {/* Looks like the platform search; IS the command deck. One input. */}
        <button
          onClick={focusAsk}
          className="mx-3 hidden min-w-0 max-w-md flex-1 items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[11.5px] md:flex"
          style={{ background: "var(--plane)", border: "1px solid var(--border)", color: "var(--ink-muted)" }}
        >
          <span aria-hidden>⌕</span>
          <span className="truncate">Search the platform — alerts, districts, missions, protocols…</span>
          <kbd className="ml-auto rounded px-1.5 text-[9.5px]" style={{ background: "var(--surface-2)" }}>/</kbd>
        </button>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* A volunteer's own work is one tap away rather than buried. The
              board stays visible to them — a field team that cannot see the
              national picture is working blind — but it is not what they came
              for. */}
          {/* The rail carries this on a desktop; the chip covers phones. */}
          {user && user.role !== "citizen" && (
            <Link
              href="/missions"
              className="rounded-md px-2.5 py-1.5 text-[11px] font-medium lg:hidden"
              style={{ background: "#17508f", color: "#fff" }}
            >
              My missions
            </Link>
          )}
          <button
            onClick={() => setShowSos(true)}
            className="rounded-md px-2.5 py-1.5 text-[11px] font-medium"
            style={{ background: "var(--critical)", color: "#0d0d0d" }}
          >
            Raise SOS
          </button>
          {/* Open to everyone, logged in or not: the hosted keys are shared and
              rate-limit for anonymous visitors first. */}
          <button
            onClick={() => setShowSettings(true)}
            className="rounded-md px-2 py-1.5 text-[11px]"
            style={{
              background: "var(--plane)",
              border: "1px solid var(--border)",
              color: ownKeys ? "var(--good)" : "var(--ink-secondary)",
            }}
            title={ownKeys ? `${ownKeys} of your own keys in use` : "Use your own model key"}
          >
            {ownKeys ? `key ✓` : "key"}
          </button>
          {user && <TelegramLink />}
          {user && <NotificationBell />}
          {user ? (
            <span className="flex items-center gap-1.5 text-[10.5px]" style={{ color: "var(--ink-muted)" }}>
              {user.name} · {user.role}
              <button
                onClick={() => {
                  void fetch("/api/auth", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "logout" }),
                  }).then(() => setUser(null));
                }}
                className="rounded px-1.5 py-0.5 underline"
                title="Log out on this device"
              >
                log out
              </button>
            </span>
          ) : (
            <button
              onClick={() => setShowAuth(true)}
              className="rounded-md px-2.5 py-1.5 text-[11px]"
              style={{ background: "var(--plane)", border: "1px solid var(--border)", color: "var(--ink-secondary)" }}
            >
              Log in
            </button>
          )}
        </div>
      </header>

      {/* pb-24 keeps the command deck from covering the last row of the board */}
      <main className="flex flex-col gap-2.5 p-2.5 pb-24 lg:pl-14">
        {/* The rail's twin, with words — and the only tab control on a phone. */}
        <nav className="flex gap-1 overflow-x-auto" aria-label="Workspace">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="shrink-0 rounded-md px-3 py-1.5 text-[11.5px] font-medium"
              style={
                tab === t.id
                  ? { background: "#17508f", color: "#fff" }
                  : { background: "var(--surface)", border: "1px solid var(--border)", color: "var(--ink-secondary)" }
              }
              aria-pressed={tab === t.id}
            >
              {t.glyph} {t.label}
            </button>
          ))}
        </nav>

        {tab === "overview" && (
          <>
            {/* The citizen's two questions, one tap from the door — "what do
                I do" and "where do I go" must not require knowing what to
                ask. Both run through the same deck everyone else uses. */}
            <div className="flex flex-wrap gap-1.5">
              {[
                ["⌂ Nearest shelter", `nearest shelter near ${user?.place ?? "me"}`],
                ["☂ Abhi kya karun?", `${user?.place ?? "yahan"} me flood aaye toh kya karna chahiye`],
                ["◆ Mere area ke alerts", `koi official alert hai ${user?.place ?? "India"} me?`],
              ].map(([label, q]) => (
                <button
                  key={label}
                  onClick={() => window.dispatchEvent(new CustomEvent("bhimshila:ask", { detail: q }))}
                  className="rounded-full px-3 py-1.5 text-[11px]"
                  style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--ink-secondary)" }}
                >
                  {label}
                </button>
              ))}
            </div>
            <Dashboard key={refreshKey} onAct={act} />
          </>
        )}

        {tab === "intel" && <IntelBrief />}

        {tab === "ops" && (
          <>
            {user?.role === "coordinator" && <RaiseMission onCreated={() => setRefreshKey((k) => k + 1)} />}
            {user?.role === "coordinator" && <HandoverButton />}
            {/* The volunteer→coordinator gate: field requests to warn the
                public land here, wording and evidence attached. */}
            {user?.role === "coordinator" && <BroadcastQueue />}
            <OpsConsole loggedIn={!!user} />
          </>
        )}

        {tab === "orgs" &&
          (user ? (
            <OrgPanel canRegister={user.role === "coordinator"} />
          ) : (
            <p className="mx-auto max-w-md py-10 text-center text-[12.5px]" style={{ color: "var(--ink-muted)" }}>
              Log in to see organisations — coordinators register NGOs here, and an invite link
              puts a volunteer inside one.
            </p>
          ))}
      </main>

      <WindowLayer />
      <CommandDeck />

      {pending && (
        <ActionModal
          action={pending.action}
          item={pending.item}
          onClose={() => setPending(null)}
          onDone={(msg) => {
            setPending(null);
            setToast(msg);
            setRefreshKey((k) => k + 1);
          }}
        />
      )}

      {showAuth && (
        <AuthPanel
          onClose={() => setShowAuth(false)}
          onAuthed={(u) => {
            setUser(u);
            setShowAuth(false);
          }}
        />
      )}

      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}

      {showSos && (
        <SosPanel
          onClose={() => setShowSos(false)}
          onSent={(r) => {
            setShowSos(false);
            setToast(
              r.queued
                ? "No network — SOS saved and will send itself the moment you reconnect"
                : `SOS received — incident #${r.incidentId} opened`,
            );
            setRefreshKey((k) => k + 1);
          }}
        />
      )}

      {toast && (
        <div
          className="panel-in fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg px-4 py-2.5 text-[12px] shadow-2xl backdrop-blur"
          style={{ background: "rgba(16,21,29,0.92)", border: "1px solid rgba(127,182,240,0.25)" }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
