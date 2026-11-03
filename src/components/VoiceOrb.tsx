"use client";

import { useEffect, useRef } from "react";

/**
 * The orb — the one control for the whole platform.
 *
 * Everything else on the page is a readout. This is the only thing you touch:
 * press it and talk, and it stays open for the whole conversation rather than
 * needing a click per sentence.
 *
 * The animation is deliberately not React state. Audio amplitude arrives at
 * 60fps, and re-rendering a component that often to move a circle is how these
 * things end up janky next to the thing they are imitating. A single CSS
 * custom property is written from a requestAnimationFrame loop and the browser
 * compositor does the rest, so the orb keeps moving smoothly while the page
 * behind it is busy streaming panels.
 */

export type OrbState = "idle" | "listening" | "thinking" | "speaking" | "denied";

const COPY: Record<OrbState, string> = {
  idle: "Tap to talk",
  listening: "Listening",
  thinking: "Working on it",
  speaking: "Speaking",
  denied: "Microphone blocked",
};

/**
 * One hue per state, so the orb reads at a glance from across a room.
 *
 * Reusing the app's status steps rather than inventing a palette: listening is
 * the live blue, thinking the warning amber, speaking the good green, denied
 * the critical red.
 */
const HUE: Record<OrbState, [string, string]> = {
  idle: ["#1f6fc4", "#7fb6f0"],
  listening: ["#3f92e8", "#bcd9f8"],
  thinking: ["#fab219", "#ffd98a"],
  speaking: ["#0ca30c", "#7ee87e"],
  denied: ["#d03b3b", "#f08a8a"],
};

export default function VoiceOrb({
  state,
  transcript,
  onToggle,
  hint,
}: {
  state: OrbState;
  /** Live interim text, shown above the orb while it is being spoken. */
  transcript?: string;
  onToggle: () => void;
  /** Short line under the label — what the agent is doing right now. */
  hint?: string;
}) {
  const orbRef = useRef<HTMLButtonElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);

  const active = state === "listening";

  // ── Amplitude drives the orb only while the mic is actually open.
  //
  // Opening an AudioContext for a mic that is not in use would keep the browser
  // recording indicator lit, which is both rude and alarming in an app about
  // emergencies.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;

        const ctx = new AudioContext();
        ctxRef.current = ctx;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.75;
        ctx.createMediaStreamSource(stream).connect(analyser);

        const bins = new Uint8Array(analyser.frequencyBinCount);
        let smoothed = 0;

        const tick = () => {
          analyser.getByteFrequencyData(bins);
          // Mean of the speech-relevant bins. Full-spectrum RMS barely moves
          // for a human voice and the orb ends up looking dead.
          let sum = 0;
          for (let i = 2; i < 40; i++) sum += bins[i];
          const level = Math.min(1, sum / (38 * 140));

          // Rises fast, falls slow — a syllable should push it out immediately,
          // and the gap between words should not make it flicker.
          smoothed = level > smoothed ? level : smoothed * 0.88 + level * 0.12;
          orbRef.current?.style.setProperty("--level", smoothed.toFixed(3));
          rafRef.current = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        /* permission refused — the parent already shows `denied` */
      }
    })();

    // Captured now: by cleanup time the ref may point at a different node.
    const orb = orbRef.current;

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      void ctxRef.current?.close();
      ctxRef.current = null;
      orb?.style.setProperty("--level", "0");
    };
  }, [active]);

  const [from, to] = HUE[state];

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-50 flex flex-col items-end gap-2">
      {transcript && (
        <div
          className="pointer-events-auto max-w-[min(78vw,26rem)] rounded-2xl px-3.5 py-2 text-[13px] leading-snug shadow-2xl backdrop-blur"
          style={{
            background: "rgba(16,22,33,0.88)",
            border: "1px solid rgba(127,182,240,0.28)",
            color: "var(--ink)",
          }}
        >
          {transcript}
        </div>
      )}

      <div className="pointer-events-auto flex items-center gap-2.5">
        <div className="flex flex-col items-end text-right">
          <span className="text-[11px] font-medium" style={{ color: "var(--ink-secondary)" }}>
            {COPY[state]}
          </span>
          {hint && (
            <span className="text-[10px]" style={{ color: "var(--ink-muted)" }}>
              {hint}
            </span>
          )}
        </div>

        <button
          ref={orbRef}
          onClick={onToggle}
          aria-label={state === "listening" ? "Stop listening" : "Start talking"}
          aria-pressed={state === "listening"}
          className="orb"
          data-state={state}
          style={
            {
              "--from": from,
              "--to": to,
              "--level": 0,
            } as React.CSSProperties
          }
        >
          <span className="orb-core" />
          <span className="orb-ring" />
          <span className="orb-ring orb-ring-2" />
        </button>
      </div>

      <style jsx>{`
        .orb {
          position: relative;
          width: 68px;
          height: 68px;
          border-radius: 50%;
          border: none;
          cursor: pointer;
          background: transparent;
          display: grid;
          place-items: center;
          /* Amplitude pushes the whole orb out. Transform only, so this stays
             on the compositor and never triggers layout. */
          transform: scale(calc(1 + var(--level) * 0.16));
          transition: transform 90ms ease-out;
          -webkit-tap-highlight-color: transparent;
        }
        .orb:focus-visible {
          outline: 2px solid var(--from);
          outline-offset: 6px;
        }

        .orb-core {
          position: absolute;
          inset: 12px;
          border-radius: 50%;
          background: radial-gradient(circle at 32% 28%, var(--to), var(--from) 62%, #0b1220 130%);
          box-shadow:
            0 0 calc(18px + var(--level) * 34px) color-mix(in srgb, var(--from) 70%, transparent),
            inset 0 0 14px rgba(255, 255, 255, 0.18);
          transition: box-shadow 120ms ease-out;
        }

        /* Two rings, offset in phase, so the pulse reads as a breath rather
           than a blink. */
        .orb-ring {
          position: absolute;
          inset: 4px;
          border-radius: 50%;
          border: 1.5px solid color-mix(in srgb, var(--from) 55%, transparent);
          opacity: 0;
        }
        .orb-ring-2 {
          inset: 0;
          animation-delay: 0.85s !important;
        }

        /* Idle: a slow breath, so it reads as awake without demanding anything. */
        .orb[data-state="idle"] .orb-core {
          animation: breathe 4.2s ease-in-out infinite;
        }

        /* Listening: rings travel outward, driven by the ring animation rather
           than amplitude — amplitude is already doing the scale. */
        .orb[data-state="listening"] .orb-ring {
          animation: ripple 1.7s ease-out infinite;
        }

        /* Thinking: a rotating sweep. The one state where nothing is being
           said, so it must not look like it is waiting for the user. */
        .orb[data-state="thinking"] .orb-core {
          animation: spin 1.15s linear infinite;
          background: conic-gradient(from 0deg, var(--from), var(--to), var(--from));
        }

        /* Speaking: a steady pulse, distinctly slower than thinking. */
        .orb[data-state="speaking"] .orb-core {
          animation: pulse 1.05s ease-in-out infinite;
        }

        .orb[data-state="denied"] .orb-core {
          animation: none;
          opacity: 0.75;
        }

        @keyframes breathe {
          0%, 100% { transform: scale(1); opacity: 0.88; }
          50% { transform: scale(1.06); opacity: 1; }
        }
        @keyframes ripple {
          0% { transform: scale(0.85); opacity: 0.7; }
          100% { transform: scale(1.5); opacity: 0; }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.09); }
        }

        /* Someone who has asked for less motion still needs the state, so the
           colour and label stay and only the movement goes. */
        @media (prefers-reduced-motion: reduce) {
          .orb, .orb-core, .orb-ring {
            animation: none !important;
            transition: none !important;
            transform: none !important;
          }
        }
      `}</style>
    </div>
  );
}
