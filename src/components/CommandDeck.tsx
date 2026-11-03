"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { byokHeader } from "@/lib/byok";
import VoiceOrb, { type OrbState } from "./VoiceOrb";
import PanelHost from "./PanelHost";
import type { Panel } from "@/lib/agent/panels";
import { useSpeech, useVoice } from "@/lib/voice/useVoice";
import { RECOGNITION_LANG } from "@/lib/voice/language";
import { commandAck, uiCommand } from "@/lib/voice/commands";
import { closeDeck, closeWindow, openWindow } from "@/lib/windows";
import { openStateDeck } from "./StateDeck";

/**
 * The command deck — ask the platform anything, by keyboard or by voice.
 *
 * This is the generative-UI mechanic from the original design, mounted on top
 * of the board instead of replacing it: the board answers "what is happening",
 * the deck answers the question you actually have. The model never generates
 * UI — it picks a panel from a fixed set and the deck opens it as a floating
 * window over the map.
 *
 * The rules the deck enforces, all from the UI design doc:
 * - the next question clears the last answer's windows, unless pinned
 * - at most two unpinned answer windows at once — a third replaces the oldest
 * - the transcript of what was heard is always visible while listening;
 *   a misheard voice command must fail obviously, not silently
 * - typed input is always present; mics fail, and `/` focuses the box
 */

/** Where each panel kind opens, sized to its content rather than one default. */
const PANEL_SIZE: Record<Panel["panel"], { w: number; h: number }> = {
  choropleth: { w: 500, h: 560 },
  region_card: { w: 500, h: 600 },
  ranked_list: { w: 440, h: 460 },
  risk_card: { w: 480, h: 540 },
  timeline: { w: 540, h: 340 },
  point_map: { w: 500, h: 560 },
  incident_board: { w: 480, h: 540 },
  confirm_action: { w: 440, h: 420 },
  protocol_card: { w: 460, h: 480 },
  note: { w: 420, h: 280 },
};

const DECK = "agent";

interface Exchange {
  role: "user" | "assistant";
  content: string;
}

/**
 * One executor for both halves of Jarvis: the deterministic command router
 * runs it directly, and the model's control_ui tool reaches it as a streamed
 * "ui" event. Either way the action set is the same fixed enum.
 */
function runUi(cmd: import("@/lib/voice/commands").UiCommand): void {
  switch (cmd.kind) {
    case "open_state":
      openStateDeck(cmd.state);
      break;
    case "close_all":
      closeDeck();
      break;
    case "tab":
      window.dispatchEvent(new CustomEvent("bhimshila:tab", { detail: cmd.tab }));
      break;
    case "missions":
      window.location.href = "/missions";
      break;
    case "sos":
      window.dispatchEvent(new Event("bhimshila:sos"));
      break;
  }
}

/** The model's action strings, mapped onto the same executor. */
function runServerUi(action: string, state?: string): void {
  if (action === "open_state" && state) runUi({ kind: "open_state", state });
  else if (action === "close_all") runUi({ kind: "close_all" });
  else if (action === "sos") runUi({ kind: "sos" });
  else if (action.startsWith("tab_"))
    runUi({ kind: "tab", tab: action.slice(4) as "overview" | "intel" | "ops" | "orgs" });
}

export default function CommandDeck() {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState("");
  const [asked, setAsked] = useState("");
  const [toolHint, setToolHint] = useState<string | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const historyRef = useRef<Exchange[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const panelSeq = useRef(0);
  const openedThisTurn = useRef<string[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const { speak, cancel: cancelSpeech, speaking } = useSpeech();

  const ask = useCallback(
    async (query: string, spoken: boolean) => {
      const q = query.trim();
      if (!q) return;

      // Jarvis first: "Kerala kholo" is a command, not a question, and it
      // executes here in the client — no model, no network, no wait. Only
      // what is genuinely a question travels to the agent.
      const cmd = uiCommand(q);
      if (cmd) {
        runUi(cmd);
        const ackText = commandAck(cmd);
        setAsked(q);
        setError(null);
        setAnswer(ackText);
        if (spoken) void speak(ackText);
        return;
      }

      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      cancelSpeech();
      setBusy(true);
      setError(null);
      setAsked(q);
      setAnswer("");
      setToolHint(null);
      // The next question replaces the last answer — pinned windows stay.
      closeDeck(DECK);
      openedThisTurn.current = [];

      try {
        const res = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...byokHeader() },
          body: JSON.stringify({ query: q, history: historyRef.current.slice(-6) }),
          signal: ac.signal,
        });
        if (!res.ok || !res.body) {
          const d = await res.json().catch(() => ({}));
          throw new Error((d as { error?: string }).error ?? `The assistant is unreachable (${res.status}).`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let text = "";

        const handle = (line: string) => {
          if (!line.trim()) return;
          let ev: Record<string, unknown>;
          try {
            ev = JSON.parse(line);
          } catch {
            return;
          }
          switch (ev.type) {
            case "meta":
              setProvider(String(ev.provider ?? ""));
              break;
            case "tool_start":
              setToolHint(String(ev.name ?? "").replace(/_/g, " "));
              break;
            case "panel": {
              const panel = ev.panel as Panel;
              const size = PANEL_SIZE[panel.panel] ?? { w: 440, h: 400 };
              const id = `agent:${++panelSeq.current}`;
              // Two unpinned answers at once — a third replaces the oldest.
              if (openedThisTurn.current.length >= 2) {
                const oldest = openedThisTurn.current.shift();
                if (oldest) closeWindow(oldest);
              }
              openWindow({
                id,
                deck: DECK,
                transient: true,
                title: panel.title,
                source: panel.source,
                glyph: "◈",
                w: size.w,
                h: size.h,
                // Answers open on the right half, clear of the feed rail.
                x: typeof window !== "undefined" ? Math.max(340, window.innerWidth - size.w - 48 - openedThisTurn.current.length * 44) : undefined,
                y: 92 + openedThisTurn.current.length * 40,
                node: <PanelHost panel={panel} />,
              });
              openedThisTurn.current.push(id);
              break;
            }
            case "text":
              if (ev.replaces) text = String(ev.delta ?? "");
              else text += String(ev.delta ?? "");
              setAnswer(text.trim());
              break;
            case "done": {
              const finalText = String(ev.text ?? text).trim();
              setAnswer(finalText);
              historyRef.current = [
                ...historyRef.current.slice(-4),
                { role: "user", content: q },
                { role: "assistant", content: finalText || "(showed a panel)" },
              ];
              // Speak only when spoken to — a typed question answered aloud
              // startles a control room.
              if (spoken && finalText) void speak(finalText);
              break;
            }
            case "ui":
              runServerUi(String(ev.action ?? ""), ev.state ? String(ev.state) : undefined);
              break;
            case "tool_error":
              setToolHint(null);
              break;
            case "error":
              setError(String(ev.message ?? "The assistant failed."));
              break;
          }
        };

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          lines.forEach(handle);
        }
        if (buffer) handle(buffer);
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          setError(e instanceof Error ? e.message : "The assistant failed.");
        }
      } finally {
        if (abortRef.current === ac) {
          setBusy(false);
          setToolHint(null);
        }
      }
    },
    [cancelSpeech, speak],
  );

  // Other surfaces (the intelligence tab's suggested questions) can hand the
  // deck a query to run — one answer surface, many doors into it.
  useEffect(() => {
    const onAskQuery = (e: Event) => {
      const q = (e as CustomEvent<string>).detail;
      if (typeof q === "string" && q.trim()) void ask(q, false);
    };
    window.addEventListener("bhimshila:ask", onAskQuery);
    return () => window.removeEventListener("bhimshila:ask", onAskQuery);
  }, [ask]);

  const voice = useVoice({
    lang: RECOGNITION_LANG,
    conversational: true,
    onFinal: (text) => void ask(text, true),
    // Any sound interrupts the reply — a talking agent must shut up the moment
    // it is spoken to.
    onSpeechStart: cancelSpeech,
  });
  const { pause: pauseMic, resume: resumeMic } = voice;

  // While the agent is speaking the mic pauses, so it does not transcribe the
  // agent's own voice back at itself; it resumes the moment the reply ends.
  useEffect(() => {
    if (speaking) pauseMic();
    else resumeMic();
  }, [speaking, pauseMic, resumeMic]);

  // `/` focuses the ask box from anywhere that is not already a text field,
  // and the shell's search affordances ask for focus by event — the top bar
  // looks like a search box but there is exactly one real input.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    const onAsk = () => inputRef.current?.focus();
    window.addEventListener("keydown", onKey);
    window.addEventListener("bhimshila:focus-ask", onAsk);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("bhimshila:focus-ask", onAsk);
    };
  }, []);

  function toggleVoice() {
    if (voice.listening) {
      voice.stop();
      cancelSpeech();
    } else {
      voice.start();
    }
  }

  const orbState: OrbState = voice.error?.includes("denied")
    ? "denied"
    : speaking
      ? "speaking"
      : busy
        ? "thinking"
        : voice.listening
          ? "listening"
          : "idle";

  // The orb is always there — the platform's presence in the corner. Idle it
  // breathes; tapped, it listens; and it doubles as the voice control for
  // anyone who never finds the mic button in the dock.
  const showOrb = true;

  return (
    <>
      {/* The dock — always present, keyboard first. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-3 pb-3">
        <div className="pointer-events-auto w-full max-w-2xl">
          {(asked || error) && (
            <div
              className="panel-in mb-1.5 rounded-xl px-3.5 py-2.5 text-[12px] leading-snug shadow-2xl backdrop-blur"
              style={{ background: "rgba(16,22,33,0.9)", border: "1px solid rgba(127,182,240,0.22)" }}
            >
              <p style={{ color: "var(--ink-muted)" }}>
                <span className="mr-1.5" aria-hidden>›</span>
                {asked}
              </p>
              {error ? (
                <p className="mt-1" style={{ color: "var(--serious)" }}>■ {error}</p>
              ) : (
                <p className="mt-1" style={{ color: "var(--ink)" }}>
                  {answer || (
                    <span style={{ color: "var(--ink-muted)" }}>
                      {toolHint ? `running ${toolHint}…` : "thinking…"}
                    </span>
                  )}
                </p>
              )}
              {provider && busy && (
                <p className="mt-1 text-[9.5px] uppercase tracking-wider" style={{ color: "var(--ink-muted)" }}>
                  {provider}
                </p>
              )}
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void ask(input, false);
              setInput("");
            }}
            className="dock flex items-center gap-1.5 rounded-xl px-2 py-1.5 shadow-2xl backdrop-blur"
            style={{ background: "rgba(16,21,29,0.92)", border: "1px solid var(--border)" }}
          >
            <span className="pl-1.5 text-[12px]" style={{ color: "var(--seq-250)" }} aria-hidden>
              ◈
            </span>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder='Ask anything — "Kerala mein kya chal raha hai", "kitne SOS pending hain"…  ( / )'
              className="min-w-0 flex-1 bg-transparent px-1 py-1.5 text-[12.5px] outline-none placeholder:opacity-40"
              style={{ color: "var(--ink)" }}
              aria-label="Ask the assistant"
            />
            {voice.supported && (
              <button
                type="button"
                onClick={toggleVoice}
                title={voice.listening ? "Stop listening" : "Talk instead of typing"}
                aria-pressed={voice.listening}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[13px]"
                style={{
                  background: voice.listening ? "#17508f" : "var(--surface-2)",
                  color: voice.listening ? "#fff" : "var(--ink-secondary)",
                }}
              >
                {voice.listening ? "◉" : "🎙"}
              </button>
            )}
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="shrink-0 rounded-lg px-3 py-1.5 text-[11.5px] font-medium disabled:opacity-40"
              style={{ background: "#17508f", color: "#fff" }}
            >
              Ask
            </button>
          </form>
        </div>
      </div>

      {/* The orb appears only in a voice conversation — a second, redundant
          control for a keyboard user is noise. */}
      {showOrb && (
        <VoiceOrb
          state={orbState}
          transcript={voice.interim || undefined}
          onToggle={toggleVoice}
          hint={toolHint ? `running ${toolHint}` : provider ?? undefined}
        />
      )}
    </>
  );
}
