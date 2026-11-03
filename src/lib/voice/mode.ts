"use client";

import { useSyncExternalStore } from "react";

/**
 * Voice preferences, kept on the device.
 *
 * Two decisions live here, and both are ones the code cannot make well alone.
 *
 * WHICH ENGINE
 *
 *   device   speaks instantly, costs nothing, needs no network and no key, and
 *            its quality is whatever the machine has installed
 *   neural   better on Hindi, and every reply waits on a round trip and a quota
 *
 * The default is `device`, and that is a demo decision rather than a permanent
 * one: the free neural tiers are currently exhausted, so `neural` spends a
 * request to be told no and falls back anyway — which a listener experiences as
 * the app pausing before it speaks. With a working provider key, switch it here
 * and the pause buys something.
 *
 * WHICH VOICE
 *
 * pickVoice() ranks by name because the Web Speech API exposes no quality
 * field. Ranking by name is a guess about how something sounds, and the first
 * guess here was wrong in both directions on a real machine. So the guess is
 * only a default: these overrides let someone who can actually hear it choose,
 * having pressed play on each one.
 *
 * Stored by script class rather than per language tag, because that is the real
 * split — one voice reads Devanagari and romanised Hinglish, another reads
 * English, and a person has an opinion about each.
 */

export type VoiceMode = "device" | "neural";
export type VoiceSlot = "indic" | "english";

interface Prefs {
  mode: VoiceMode;
  indic?: string;
  english?: string;
}

const KEY = "bhimshila.voice";
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());

/**
 * The raw string is the snapshot, not the parsed object.
 *
 * useSyncExternalStore compares by reference, so returning a freshly parsed
 * object every read makes React see a change on every render and spin.
 */
let raw: string | null = null;
let parsed: Prefs = { mode: "device" };
const DEFAULT: Prefs = Object.freeze({ mode: "device" });

export function readVoicePrefs(): Prefs {
  if (typeof window === "undefined") return DEFAULT;
  let now: string | null = null;
  try {
    now = window.localStorage.getItem(KEY);
  } catch {
    return DEFAULT;
  }
  if (now !== raw) {
    raw = now;
    try {
      const j = now ? (JSON.parse(now) as Prefs) : null;
      parsed = j && typeof j === "object" ? { mode: j.mode === "neural" ? "neural" : "device", indic: j.indic, english: j.english } : { mode: "device" };
    } catch {
      parsed = { mode: "device" };
    }
  }
  return parsed;
}

export const readVoicePrefsServer = (): Prefs => DEFAULT;

export function writeVoicePrefs(next: Partial<Prefs>) {
  const merged = { ...readVoicePrefs(), ...next };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(merged));
  } catch {
    /* private mode — this session still works, just not the next one */
  }
  raw = null; // force a re-parse on the next read
  notify();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useVoicePrefs(): Prefs {
  return useSyncExternalStore(subscribe, readVoicePrefs, readVoicePrefsServer);
}
