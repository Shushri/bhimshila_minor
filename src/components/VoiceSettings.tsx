"use client";

import { useEffect, useState } from "react";
import { pickVoice, type VoiceLike } from "@/lib/voice/voices";
import { useVoicePrefs, writeVoicePrefs, type VoiceSlot } from "@/lib/voice/mode";

/**
 * Choose the speaking voice, having heard it.
 *
 * pickVoice() ranks by name because the Web Speech API exposes no quality
 * field, and a name is a guess about a sound. That guess was wrong in both
 * directions on a real machine — the stock Hindi voice was assumed to be the
 * robotic one and is not; the stock English voices are. So the ranking supplies
 * a default and this supplies the correction, next to a play button, because
 * the only reliable test is listening.
 *
 * Two slots rather than one per language tag: one voice reads Devanagari and
 * romanised Hinglish, another reads English, and people have an opinion about
 * each.
 */

const SAMPLE: Record<VoiceSlot, string> = {
  indic: "Assam mein terah alert hain. Do orange, ek red — Mizoram mein.",
  english: "Thirteen live alerts across Assam. Two orange, one red in Mizoram.",
};

const SLOT_LABEL: Record<VoiceSlot, string> = {
  indic: "Hindi and Hinglish",
  english: "English",
};

export default function VoiceSettings() {
  const prefs = useVoicePrefs();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [playing, setPlaying] = useState<string | null>(null);

  // The list arrives asynchronously in Chrome: getVoices() is empty on the
  // first call and fills in when voiceschanged fires.
  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);

  const preview = (slot: VoiceSlot, voiceName?: string) => {
    const list: VoiceLike[] = voices;
    const v =
      (voiceName && voices.find((x) => x.name === voiceName)) ??
      pickVoice(voices, SAMPLE[slot]) ??
      (list[0] as SpeechSynthesisVoice | undefined);
    if (!v) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(SAMPLE[slot]);
    u.voice = v as SpeechSynthesisVoice;
    u.lang = v.lang;
    u.rate = 1.02;
    u.onend = () => setPlaying(null);
    u.onerror = () => setPlaying(null);
    setPlaying(`${slot}:${v.name}`);
    // Chrome drops an utterance queued in the same tick as cancel().
    setTimeout(() => window.speechSynthesis.speak(u), 60);
  };

  if (typeof window !== "undefined" && !window.speechSynthesis) return null;

  return (
    <div className="mt-5 border-t pt-4" style={{ borderColor: "var(--border)" }}>
      <h3 className="text-[15px] font-semibold">Voice</h3>
      <p className="mt-0.5 text-[11px]" style={{ color: "var(--ink-muted)" }}>
        Who speaks the answers.
      </p>

      <div className="mt-3 flex gap-1.5">
        {(["device", "neural"] as const).map((m) => (
          <button
            key={m}
            onClick={() => writeVoicePrefs({ mode: m })}
            className="rounded-md px-3 py-1.5 text-[11.5px] font-medium"
            style={{
              background: prefs.mode === m ? "var(--seq-250)" : "var(--surface)",
              border: "1px solid var(--border)",
              color: prefs.mode === m ? "var(--ink)" : "var(--ink-secondary)",
            }}
            aria-pressed={prefs.mode === m}
          >
            {m === "device" ? "This device — instant" : "Neural — needs a key"}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[10.5px] leading-snug" style={{ color: "var(--ink-muted)" }}>
        {prefs.mode === "device"
          ? "Speaks immediately, works offline, and costs nothing. Quality is whatever this machine has installed — pick below."
          : "Better Hindi, but every reply waits on a round trip. Falls back to this device when the provider is out of quota."}
      </p>

      {prefs.mode === "device" && (
        <ul className="mt-3 space-y-2.5">
          {(["indic", "english"] as VoiceSlot[]).map((slot) => {
            const auto = pickVoice(voices, SAMPLE[slot]);
            const current = prefs[slot] ?? auto?.name ?? "";
            return (
              <li key={slot}>
                <label className="text-[11px]" style={{ color: "var(--ink-secondary)" }}>
                  {SLOT_LABEL[slot]}
                </label>
                <div className="mt-1 flex gap-1.5">
                  <select
                    value={current}
                    onChange={(e) =>
                      writeVoicePrefs({
                        [slot]: e.target.value === auto?.name ? undefined : e.target.value,
                      })
                    }
                    className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-[11.5px] outline-none"
                    style={{
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      color: "var(--ink)",
                    }}
                  >
                    {voices.map((v) => (
                      <option key={v.name} value={v.name}>
                        {v.name} · {v.lang}
                        {v.name === auto?.name ? "  (default)" : ""}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => preview(slot, current)}
                    disabled={!voices.length}
                    className="shrink-0 rounded-md px-3 py-1.5 text-[11.5px] font-medium disabled:opacity-40"
                    style={{
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      color: "var(--ink)",
                    }}
                  >
                    {playing?.startsWith(`${slot}:`) ? "▪ playing" : "▶ hear it"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {!voices.length && (
        <p className="mt-2 text-[10.5px]" style={{ color: "var(--warning)" }}>
          This browser reports no installed voices yet — it fills in a moment after the page loads.
        </p>
      )}
    </div>
  );
}
